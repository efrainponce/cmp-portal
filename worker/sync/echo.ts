// Outbox echo confirmation: did Monday's fresh state match what we wrote?
import type { Env } from '../env';
import type { MondayCol } from '../lib/monday';
import { writeHash, type ColRawValue } from '../lib/canon';
import { logSync } from './log';

interface OutboxRow { id: number; item_id: number; cols: string; content_hash: string }

/** Estado fresco de UN item tal como lo devolvió Monday, para compararlo
 * contra lo que el outbox mandó. */
export interface FreshItem {
  itemId: number;
  columns: MondayCol[];
  // El nombre del item NO viene en column_values: es un campo aparte. Un
  // rename (pseudo-columna `name`, ver worker/lib/outbox.ts) quedaría siempre
  // en 'conflict' si no se compara con esto.
  name?: string | null;
}

function echoStatus(row: OutboxRow, fresh: FreshItem): 'confirmed' | 'conflict' {
  const sentCols = JSON.parse(row.cols) as Record<string, string>;
  const colIds = new Set(Object.keys(sentCols));

  const freshMap: Record<string, ColRawValue> = {};
  const typesMap: Record<string, string> = {};
  for (const c of fresh.columns) {
    if (!colIds.has(c.id)) continue;
    freshMap[c.id] = { text: c.text, value: c.value };
    typesMap[c.id] = c.type;
  }
  if (colIds.has('name') && fresh.name != null) {
    freshMap.name = { text: fresh.name, value: null };
    typesMap.name = 'text';
  }
  return writeHash(freshMap, typesMap) === row.content_hash ? 'confirmed' : 'conflict';
}

// Parámetros por query en D1 (~100): 99 ids + el board_id.
const BIND_CHUNK = 99;

/** Versión por lote de confirmOutboxEcho: UNA consulta al outbox para todos los
 * items releídos (en vez de una por item), y solo escribe cuando de verdad hay
 * writes en vuelo para alguno — que es casi nunca en un refetch del delta
 * sync. Es lo que mantiene el refetch en lote dentro del presupuesto de
 * subrequests. */
export async function confirmOutboxEchoMany(env: Env, boardId: number, fresh: FreshItem[]): Promise<void> {
  if (fresh.length === 0) return;
  const byId = new Map(fresh.map(f => [f.itemId, f]));
  const rows: OutboxRow[] = [];
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += BIND_CHUNK) {
    const slice = ids.slice(i, i + BIND_CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const res = await env.DB.prepare(
      `SELECT id, item_id, cols, content_hash FROM outbox
        WHERE board_id = ? AND item_id IN (${placeholders}) AND status IN ('pending','sent')`,
    ).bind(boardId, ...slice).all<OutboxRow>();
    rows.push(...(res.results ?? []));
  }

  const now = new Date().toISOString();
  for (const row of rows) {
    const item = byId.get(row.item_id);
    if (!item) continue;
    const status = echoStatus(row, item);
    await env.DB.prepare(`UPDATE outbox SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, now, row.id).run();
    await logSync(env, 'outbox', boardId, row.item_id, status === 'confirmed', `outbox#${row.id} -> ${status}`);
  }
}

export async function confirmOutboxEcho(
  env: Env,
  boardId: number,
  itemId: number,
  freshColumns: MondayCol[],
  freshName?: string | null,
): Promise<void> {
  await confirmOutboxEchoMany(env, boardId, [{ itemId, columns: freshColumns, name: freshName }]);
}
