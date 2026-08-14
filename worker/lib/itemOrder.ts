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
// patrón que worker/lib/lineaAjustes.ts. `manual_order` queda sin usar por
// ahora (Fase 2, futura: reacomodo manual dentro del portal); ya vive en el
// esquema para que esa fase no necesite otra migración.
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
