// worker/lib/itemOrder.ts — orden de líneas (Efraín, 2026-08-14: el portal
// mostraba las líneas alfabéticas, ignorando el orden en que el vendedor las
// acomodó en Monday). Monday no expone un campo `position` formal para
// subitems — el orden real es implícito en el array que regresa su API, y
// solo llega completo y confiable en worker/sync/refetch.ts refetchItemTree
// (relectura del árbol completo de UN padre; upsertItem/reconcile procesan
// items sueltos o páginas de board sin contexto de hermanos, así que no
// pueden derivar este orden).
//
// Tabla lazy, nunca se altera `items` (worker/lib/dal.ts ~82-86) — mismo
// patrón que worker/lib/lineaAjustes.ts. `manual_order` es la Fase 2 que aquí
// se dejó prevista y que estrenó el dragger de las OC (Efraín, 2026-08-25):
// se guarda aparte de `monday_order` justo para que el reacomodo del portal
// sobreviva a la siguiente relectura de Monday (ver setManualOrder).
import type { Env } from '../env';

let tableReady = false;

export async function ensureItemOrderTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS item_order (
      board_id       INTEGER NOT NULL,
      item_id        INTEGER NOT NULL,
      parent_item_id INTEGER NOT NULL,
      monday_order   INTEGER,
      manual_order   INTEGER,
      updated_at     TEXT NOT NULL,
      PRIMARY KEY (board_id, item_id)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_item_order_parent ON item_order(board_id, parent_item_id)'),
  ]);
  tableReady = true;
}

/** Guarda el orden en que Monday regresó las líneas de un padre (índice del
 * array = posición). Nunca toca `manual_order`: eso es lo que hará que un
 * reacomodo manual (Fase 2) sobreviva a la siguiente relectura de Monday. */
export async function upsertMondayOrder(
  env: Env, boardId: number, parentItemId: number, subitemIds: number[],
): Promise<void> {
  if (subitemIds.length === 0) return;
  await ensureItemOrderTable(env);
  const now = new Date().toISOString();
  const statements = subitemIds.map((id, index) => env.DB.prepare(
    `INSERT INTO item_order (board_id, item_id, parent_item_id, monday_order, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(board_id, item_id) DO UPDATE SET
       parent_item_id = excluded.parent_item_id, monday_order = excluded.monday_order, updated_at = excluded.updated_at`,
  ).bind(boardId, id, parentItemId, index, now));
  await env.DB.batch(statements);
}

/** Reacomodo manual (la Fase 2 que este archivo dejó pendiente — Efraín,
 * 2026-08-25: "un dragger para cambiar de lugar las filas de la OC, por
 * proveedor"). `subset` son las líneas de UNA tarjeta de proveedor en su orden
 * nuevo; las demás no se mueven — solo se PERMUTAN LOS LUGARES que esas líneas
 * ya ocupaban dentro del orden global del padre. Sin esto, arrastrar en la OC
 * de un proveedor reacomodaría también lo que ven Cotización y Tallas, que
 * leen el mismo orden (worker/lib/dal.ts childrenOf).
 *
 * Pura y exportada: worker/lib/itemOrder.test.ts la ancla. */
export function aplicarOrdenParcial(actual: number[], subset: number[]): number[] {
  const enSubset = new Set(subset);
  const out = [...actual];
  let k = 0;
  for (let i = 0; i < out.length; i++) {
    if (enSubset.has(out[i]) && k < subset.length) out[i] = subset[k++];
  }
  return out;
}

/** Escribe `manual_order` para TODAS las líneas del padre, no solo las que se
 * movieron: el ORDER BY es COALESCE(manual_order, monday_order, …) y mezclar
 * las dos escalas dejaría el orden a medias. Como efecto buscado, a partir del
 * primer arrastre el orden del padre deja de seguir a Monday (que no expone
 * `position` para subitems — ver el encabezado de este archivo). */
export async function setManualOrder(
  env: Env, boardId: number, parentItemId: number, orderedIds: number[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  await ensureItemOrderTable(env);
  const now = new Date().toISOString();
  const statements = orderedIds.map((id, index) => env.DB.prepare(
    `INSERT INTO item_order (board_id, item_id, parent_item_id, manual_order, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(board_id, item_id) DO UPDATE SET
       parent_item_id = excluded.parent_item_id, manual_order = excluded.manual_order, updated_at = excluded.updated_at`,
  ).bind(boardId, id, parentItemId, index, now));
  // De a 50: un Proyecto con muchas tallas se pasaría del presupuesto de una
  // sola batch (mismo criterio que el resto de los escritores de D1).
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }
}

/** Orden del portal (manual si lo hay, si no el de Monday) por item_id — para
 * los caminos que NO leen del espejo, como `generarOcNative`, que trae los
 * subitems directo de Monday y sin esto imprimiría la OC en el orden viejo. */
export async function ordenPortal(
  env: Env, boardId: number, parentItemId: number,
): Promise<Map<number, number>> {
  await ensureItemOrderTable(env);
  const { results } = await env.DB.prepare(
    `SELECT item_id, COALESCE(manual_order, monday_order) AS pos
       FROM item_order WHERE board_id = ? AND parent_item_id = ?`,
  ).bind(boardId, parentItemId).all<{ item_id: number; pos: number | null }>();
  const map = new Map<number, number>();
  for (const r of results ?? []) if (r.pos != null) map.set(Number(r.item_id), Number(r.pos));
  return map;
}
