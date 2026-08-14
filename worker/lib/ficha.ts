// worker/lib/ficha.ts — la ficha comercial (descripción de catálogo) de una
// línea de Oportunidad, resuelta ANTES de guardar la línea en D1.
//
// La ficha vive en Productos (`long_text_mm0xse7v`). La línea solo trae un
// mirror de Monday (`lookup_mm0xw8p7`) que Monday recalcula de forma asíncrona
// después de ligar el producto y SIN disparar webhook: una línea recién creada
// llegaba al mirror con la ficha vacía y se quedaba así, marcada "Falta
// descripción" y bloqueada para costeo aunque el catálogo sí la trae (Efraín,
// 2026-08-14).
//
// Por eso el relleno va en el camino de ESCRITURA al mirror (upsert, reconcile,
// refetch) y no en cada lectura: en D1 queda la ficha ya resuelta y ningún
// consumidor —drawer, checkCosteo, PDFs, documentos, bot— paga una consulta
// extra ni tiene que acordarse de rellenarla (Efraín: "quiero que sea D1, la
// info debe estar en la tabla de productos").
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import type { MirrorItem } from '../../shared/types';

export const SUB_FICHA = 'lookup_mm0xw8p7';          // línea: mirror "Descripción Cotización"
export const SUB_PRODUCTO_REL = 'board_relation_mkzmafgp'; // línea → Producto de catálogo
export const PRODUCTO_FICHA = 'long_text_mm0xse7v';  // Productos: "Descripción cotización (largo)"

/** Forma mínima que necesita el relleno — la cumplen tanto `MondayItem` como
 * cualquier item recién leído de la API. */
interface ColLike { id: string; type?: string; text?: string | null; value?: string | null }
interface ItemLike { column_values: ColLike[] }

/** productoId → ficha comercial del mirror de Productos, en UNA consulta. Sin
 * scope de viewer a propósito: la ficha ya viaja en cada línea vía el mirror de
 * Monday, así que no expone nada nuevo. */
export async function fichasDeProductos(env: Env, productoIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(productoIds)];
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const res = await env.DB.prepare(
    `SELECT * FROM items WHERE board_id = ? AND item_id IN (${ids.map(() => '?').join(',')})`,
  ).bind(BOARDS.productos.id, ...ids).all<MirrorItem>();
  for (const row of res.results ?? []) {
    let ficha = '';
    try {
      const cols: ColLike[] = JSON.parse(row.columns || '[]');
      ficha = (cols.find(c => c.id === PRODUCTO_FICHA)?.text ?? '').trim();
    } catch { /* columns corrupto — como si no tuviera ficha */ }
    if (ficha) out.set(row.item_id, ficha);
  }
  return out;
}

/** Id del producto tal como llega en un WRITE del portal a la columna de
 * relación: el front manda el id pelón ("11013684747"), y los flujos internos
 * mandan `{item_ids:[…]}`. Null si no se puede leer un id. */
export function productoIdDeWrite(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string') {
    const n = Number(valor.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (valor && typeof valor === 'object') {
    const ids = (valor as { item_ids?: unknown[]; linked_item_ids?: unknown[] });
    const lista = ids.item_ids ?? ids.linked_item_ids ?? [];
    return lista.map(Number).find(Number.isFinite) ?? null;
  }
  return null;
}

/** Primer producto ligado de una línea (el `value` de la board_relation ya viene
 * normalizado a {linked_item_ids:[...]}, ver monday.ts normalizeCols). */
function productoLigado(item: ItemLike): number | null {
  const col = item.column_values.find(c => c.id === SUB_PRODUCTO_REL);
  if (!col?.value) return null;
  try {
    const ids: unknown[] = (JSON.parse(col.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
    return ids.map(Number).find(Number.isFinite) ?? null;
  } catch {
    return null;
  }
}

/** Rellena en las líneas la ficha que el mirror de Monday todavía no trae,
 * leyéndola del producto ligado. Muta `items` en el lugar y hace UNA consulta a
 * D1, solo si alguna línea la necesita.
 *
 * Se llama SIEMPRE antes de calcular el `content_hash`, para que la ficha
 * resuelta forme parte de lo que se compara: así una línea vieja (guardada sin
 * ficha) se repara sola en su próximo sync, y una que ya la tiene no vuelve a
 * escribirse cuando el mirror de Monday por fin se pone al día con el mismo
 * texto (no mover `synced_at` es lo que mantiene válidos los ETags de las
 * listas — ver worker/sync/refetch.ts). */
export async function hydrateFichaLineas(env: Env, items: ItemLike[]): Promise<void> {
  const faltantes = items.filter(i => !(i.column_values.find(c => c.id === SUB_FICHA)?.text ?? '').trim());
  if (faltantes.length === 0) return;
  const fichas = await fichasDeProductos(
    env, faltantes.map(productoLigado).filter((id): id is number => id !== null),
  );
  if (fichas.size === 0) return;
  for (const item of faltantes) {
    const productoId = productoLigado(item);
    const ficha = productoId !== null ? fichas.get(productoId) : undefined;
    if (!ficha) continue;
    const i = item.column_values.findIndex(c => c.id === SUB_FICHA);
    if (i >= 0) item.column_values[i] = { ...item.column_values[i], text: ficha };
    else item.column_values.push({ id: SUB_FICHA, type: 'mirror', text: ficha, value: null });
  }
}
