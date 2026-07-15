// Outbox echo confirmation: did Monday's fresh state match what we wrote?
import type { Env } from '../env';
import type { MondayCol } from '../lib/monday';
import { writeHash, type ColRawValue } from '../lib/canon';
import { logSync } from './log';

interface OutboxRow { id: number; cols: string; content_hash: string }

export async function confirmOutboxEcho(
  env: Env,
  boardId: number,
  itemId: number,
  freshColumns: MondayCol[],
): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, cols, content_hash FROM outbox WHERE board_id = ? AND item_id = ? AND status IN ('pending','sent')`,
  ).bind(boardId, itemId).all<OutboxRow>();

  const now = new Date().toISOString();
  for (const row of rows.results ?? []) {
    const sentCols = JSON.parse(row.cols) as Record<string, string>;
    const colIds = new Set(Object.keys(sentCols));

    const freshMap: Record<string, ColRawValue> = {};
    const typesMap: Record<string, string> = {};
    for (const c of freshColumns) {
      if (!colIds.has(c.id)) continue;
      freshMap[c.id] = { text: c.text, value: c.value };
      typesMap[c.id] = c.type;
    }

    const freshHash = writeHash(freshMap, typesMap);
    const status = freshHash === row.content_hash ? 'confirmed' : 'conflict';

    await env.DB.prepare(`UPDATE outbox SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, now, row.id).run();
    await logSync(env, 'outbox', boardId, itemId, status === 'confirmed', `outbox#${row.id} -> ${status}`);
  }
}
