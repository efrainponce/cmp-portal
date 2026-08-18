// worker/lib/nativeItems.ts — piezas comunes de un item NATIVO (Zona Efrain,
// "salir de Monday", shared/nativeId.ts): filas de `items` con id sintético que
// nunca pasan por un echo de Monday. Antes cada flujo nativo se armaba su
// propia conversión de columnas y su propio INSERT (proyectoTallas.ts,
// createRecord.ts, routes/oportunidades.ts) — aquí viven las dos operaciones
// que TODOS necesitan, para que un flujo nativo nuevo no tenga que redescubrir
// el shape del mirror.
import type { Env } from '../env';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { COLUMN_META } from '../../shared/column-meta.gen';
import { rawHash, type RawColumn } from './canon';
import { reserveNativeId } from './nativeSeq';

/** Convierte la forma de ESCRITURA de Monday ({item_ids:[...]}, números,
 * strings) al `RawColumn` que guarda el mirror — el trabajo que del lado real
 * hace el echo de Monday. `types` mapea columna→tipo; lo que no esté ahí se
 * trata como texto.
 *
 * board_relation guarda `linked_item_ids` como STRING, no como número: es lo
 * que Monday manda de verdad y hay código que compara con `===` contra strings
 * (ver worker/lib/ocProveedorPdf.ts y el comentario de boardRelationValue en
 * outbox.ts — bug real, 2026-08-13). */
export function toNativeColumns(desired: Record<string, unknown>, types: Record<string, string>): RawColumn[] {
  return Object.entries(desired).map(([id, raw]) => {
    const type = types[id] ?? 'text';
    if (type === 'board_relation') {
      const ids = ((raw as { item_ids?: number[] }).item_ids ?? []).map(String);
      return { id, type, text: ids.join(','), value: JSON.stringify({ linked_item_ids: ids }) };
    }
    const text = String(raw);
    return { id, type, text, value: JSON.stringify(text) };
  });
}

/** Subitem nativo: fila de `items` con id sintético propio y `parent_item_id`
 * apuntando al padre nativo. `vendedor_ids` va vacío a propósito — el scoping
 * de un subitem se resuelve SIEMPRE contra el padre (worker/lib/dal.ts
 * scopeFor: `board.parent` → EXISTS sobre el padre), nunca contra la fila
 * propia. Devuelve el item_id asignado. */
export async function insertNativeSubitem(
  env: Env,
  slug: BoardSlug,
  parentItemId: number,
  name: string,
  columns: RawColumn[],
): Promise<number> {
  const itemId = await reserveNativeId(env);
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO items (board_id, item_id, parent_item_id, name, group_id, vendedor_ids, monday_updated_at, synced_at, content_hash, columns)
       VALUES (?, ?, ?, ?, NULL, '[]', ?, ?, ?, ?)`,
    )
    .bind(BOARDS[slug].id, itemId, parentItemId, name, now, now, rawHash(columns), JSON.stringify(columns))
    .run();
  return itemId;
}

/** Estampa un archivo en una columna tipo `file` de un item nativo — el archivo
 * real vive en R2 (worker/lib/r2.ts), esto solo deja el rastro que el mirror
 * tendría si Monday lo hubiera resuelto: `text` con el nombre (lo que la UI
 * parsea, ver src/boards/oportunidades/proyecto/shared.tsx parseFiles) y
 * `value` con `{files:[{name}]}` (lo que parsea el worker, ver
 * embellecimientoImagenes.parseFiles). Sin `assetId`: no hay asset de Monday
 * que resolver — `readPortalFile` sirve estos desde R2 y nunca llega al
 * fallback.
 *
 * Acumula por default, igual que una columna file real de Monday: subir un
 * segundo archivo no borra el primero. */
export async function stampNativeFileMarker(
  env: Env,
  slug: BoardSlug,
  itemId: number,
  colId: string,
  filename: string,
  mode: 'append' | 'replace' = 'append',
): Promise<void> {
  const boardId = BOARDS[slug].id;
  const row = await env.DB
    .prepare(`SELECT columns FROM items WHERE board_id = ? AND item_id = ?`)
    .bind(boardId, itemId)
    .first<{ columns: string }>();
  const existing: RawColumn[] = row ? JSON.parse(row.columns || '[]') : [];
  const previo = existing.find(c => c.id === colId);
  const files: { name: string }[] = [];
  if (mode === 'append' && previo?.value) {
    try {
      for (const f of (JSON.parse(previo.value) as { files?: { name: string }[] }).files ?? []) {
        if (f?.name && f.name !== filename) files.push({ name: f.name });
      }
    } catch { /* valor no parseable — se reemplaza */ }
  }
  files.push({ name: filename });

  const filtered = existing.filter(c => c.id !== colId);
  filtered.push({ id: colId, type: 'file', text: files.map(f => f.name).join(', '), value: JSON.stringify({ files }) });
  await env.DB
    .prepare(`UPDATE items SET columns = ?, synced_at = ? WHERE board_id = ? AND item_id = ?`)
    .bind(JSON.stringify(filtered), new Date().toISOString(), boardId, itemId)
    .run();
}

/** `value` de una columna `status` con el shape REAL de Monday (`{index}`), no
 * el label suelto. TODO lo que agrupa o filtra por status lee `.index`
 * (src/lib/statusValue.ts, los boards del sidebar, notify.ts): un item nativo
 * escrito con el label como `value` desaparecía de todos los grupos — bug real
 * encontrado en la prueba end-to-end de producción (2026-08-18), donde el
 * Proyecto se volvió invisible al reescribirse `project_status`.
 *
 * El índice sale de shared/column-meta.gen.ts (misma fuente que la UI). Si el
 * label no está en la metadata se devuelve el texto tal cual: mejor un valor
 * raro que perder la escritura. */
export function nativeStatusValue(slug: BoardSlug, colId: string, label: string): unknown {
  const labels = COLUMN_META[slug]?.[colId]?.labels;
  if (labels) {
    const wanted = label.trim().toLowerCase();
    for (const [index, meta] of Object.entries(labels)) {
      if ((meta as { label?: string }).label?.trim().toLowerCase() === wanted) {
        return { index: Number(index), post_id: null, changed_at: new Date().toISOString() };
      }
    }
  }
  return label;
}
