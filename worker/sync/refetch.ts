// Single-item refetch: never trust webhook/UI payloads — always re-pull from Monday.
import type { Env } from '../env';
import { fetchItem } from '../lib/monday';
import { boardById } from '../../shared/boards';
import { upsertItem } from './upsert';
import { confirmOutboxEcho } from './echo';
import { logSync } from './log';

export async function refetchItem(env: Env, boardId: number, itemId: number): Promise<void> {
  const def = boardById(boardId);
  if (!def) {
    await logSync(env, 'manual', boardId, itemId, false, 'unknown board_id');
    return;
  }

  const item = await fetchItem(env, itemId);
  if (!item) {
    await env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`)
      .bind(boardId, itemId).run();
    await logSync(env, 'manual', boardId, itemId, true, 'not found on Monday — mirror row deleted');
    return;
  }

  await upsertItem(env, def.slug, item);
  await confirmOutboxEcho(env, boardId, itemId, item.column_values);
  await logSync(env, 'manual', boardId, itemId, true, 'refetched');
}
