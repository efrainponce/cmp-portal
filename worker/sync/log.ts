// Tiny sync_log writer shared by every sync helper.
import type { Env } from '../env';

export async function logSync(
  env: Env,
  kind: 'webhook' | 'reconcile' | 'manual' | 'outbox',
  boardId: number | null,
  itemId: number | null,
  ok: boolean,
  detail: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sync_log (kind, board_id, item_id, ok, detail, at) VALUES (?,?,?,?,?,?)`,
  ).bind(kind, boardId, itemId, ok ? 1 : 0, detail, new Date().toISOString()).run();
}
