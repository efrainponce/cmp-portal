// worker/lib/costoSinAirtable.ts — aviso cuando se elige un producto cuyo
// Costo Distribuidor NO está en Airtable.
//
// El costo de una línea sale del catálogo de Productos (`numeric_mkzpx7eb`),
// que baja de Airtable (cmp-tallas api/sync_producto.py). Si allá está vacío,
// la línea se queda sin costo y no hay nada que el portal pueda inventar:
// Efraín, 2026-09-25, "no podemos usar el último costo" — el dato se captura
// en Airtable. Reporte original de Elisa: la Bota 12477 y la Polo dry fit no
// traían costo (756 de 1470 productos vienen así).
//
// Así que en vez de rellenar, se AVISA: notificación en la bandeja Importantes
// (sin WhatsApp) con el link directo al registro del producto en Airtable.
// Solo a admin/compras: vendedor no ve costos (shared/visibility.ts).
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { emitNotification } from './notify';

const PRODUCTO_COSTO = 'numeric_mkzpx7eb';        // Costo Distribuidor
const PRODUCTO_AIRTABLE_ID = 'text_mkzmgvc7';      // id del registro en Airtable (rec…)
// Base "CMP Product Catalog", tabla "productos" — mismos ids que
// cmp-tallas api/sync_producto.py (AIRTABLE_BASE_ID / AIRTABLE_TABLE_ID).
const AIRTABLE_BASE = 'apprQnMOKPEBYt4AU';
const AIRTABLE_TABLA = 'tblxZZLHRUAeJbGa2';

const ROLES_CON_COSTOS = new Set(['admin', 'compras']);

/** Link al registro del producto en Airtable; null si el id no tiene forma de rec…. */
export function airtableProductoUrl(recordId: string | null | undefined): string | null {
  const id = (recordId ?? '').trim();
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return null;
  return `https://airtable.com/${AIRTABLE_BASE}/${AIRTABLE_TABLA}/${id}`;
}

interface ColText { id: string; text?: string | null }

/** Lo que el aviso necesita del producto, a partir de sus columnas. `null` = el
 * producto SÍ trae costo, no hay nada que avisar. */
export function faltaCosto(
  nombre: string, cols: ColText[],
): { nombre: string; link: string | null } | null {
  const text = (id: string) => cols.find(c => c.id === id)?.text?.trim() ?? '';
  if (Number(text(PRODUCTO_COSTO).replace(/,/g, '')) > 0) return null;
  return { nombre, link: airtableProductoUrl(text(PRODUCTO_AIRTABLE_ID)) };
}

/** Best-effort: nunca tira el write que lo dispara. Una notificación por
 * persona, producto y día (dedupe_key) — elegir el mismo producto en 5 líneas
 * no llena la bandeja. */
export async function avisarSiFaltaCosto(
  env: Env, viewer: Identity, lineaId: number, productoId: number,
): Promise<void> {
  try {
    if (!ROLES_CON_COSTOS.has(viewer.role)) return;
    const producto = await env.DB
      .prepare(`SELECT name, columns FROM items WHERE board_id = ? AND item_id = ?`)
      .bind(BOARDS.productos.id, productoId)
      .first<{ name: string; columns: string }>();
    if (!producto) return;
    const falta = faltaCosto(producto.name, JSON.parse(producto.columns || '[]') as ColText[]);
    if (!falta) return;

    const linea = await env.DB
      .prepare(`SELECT parent_item_id FROM items WHERE board_id = ? AND item_id = ?`)
      .bind(BOARDS.oportunidades_sub.id, lineaId)
      .first<{ parent_item_id: number | null }>();

    const dia = new Date().toISOString().slice(0, 10);
    await emitNotification(env, {
      recipientEmail: viewer.email,
      severity: 'importante',
      wa: false,
      kind: 'costo_sin_airtable',
      title: `Sin costo en Airtable: ${falta.nombre}`,
      body: falta.link
        ? 'El Costo Distribuidor no está en Airtable, así que la línea quedó sin costo. Captúralo en Airtable (clic aquí) y vuelve a elegir el producto.'
        : 'El Costo Distribuidor no está en Airtable y el producto no tiene registro ligado en Airtable. Hay que darlo de alta allá.',
      link: falta.link,
      boardKey: 'oportunidades',
      boardId: BOARDS.oportunidades.id,
      itemId: linea?.parent_item_id ?? null,
      dedupeKey: `costo_sin_airtable:${viewer.email}:${productoId}:${dia}`,
    });
  } catch { /* best-effort: el aviso nunca rompe la edición */ }
}
