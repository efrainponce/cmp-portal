// Single-item refetch: never trust webhook/UI payloads — always re-pull from Monday.
import type { Env } from '../env';
import { fetchItem, fetchItemWithSubitems } from '../lib/monday';
import { boardById, BOARDS, type BoardSlug } from '../../shared/boards';
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

/** Item + subitems refetch in one Monday call. Upserts everything and DELETES
 * mirror subitem rows that no longer exist on Monday — needed after cmp-tallas
 * flows that rewrite subitems (import_tallas) or snapshot columns on them
 * (validar_costeo). No-op child cleanup for boards without a subitem board. */
export async function refetchItemTree(env: Env, boardId: number, itemId: number): Promise<void> {
  const def = boardById(boardId);
  if (!def) {
    await logSync(env, 'manual', boardId, itemId, false, 'unknown board_id');
    return;
  }

  const tree = await fetchItemWithSubitems(env, itemId);
  if (!tree) {
    await env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`)
      .bind(boardId, itemId).run();
    await logSync(env, 'manual', boardId, itemId, true, 'not found on Monday — mirror row deleted');
    return;
  }

  await upsertItem(env, def.slug, tree.item);
  await confirmOutboxEcho(env, boardId, itemId, tree.item.column_values);

  const childSlug = (Object.keys(BOARDS) as BoardSlug[]).find(k => BOARDS[k].parent === def.slug);
  if (childSlug) {
    const childBoardId = BOARDS[childSlug].id;
    for (const sub of tree.subitems) {
      await upsertItem(env, childSlug, sub);
    }
    const keep = tree.subitems.map(s => Number(s.id));
    const placeholders = keep.map(() => '?').join(',');
    await env.DB.prepare(
      `DELETE FROM items WHERE board_id = ? AND parent_item_id = ?${keep.length ? ` AND item_id NOT IN (${placeholders})` : ''}`,
    ).bind(childBoardId, itemId, ...keep).run();
  }

  await logSync(env, 'manual', boardId, itemId, true, `refetched tree (${tree.subitems.length} subitems)`);
}
