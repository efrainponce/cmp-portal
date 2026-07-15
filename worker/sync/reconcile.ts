// Full-board and full-mirror reconciliation (cron + manual trigger).
import type { Env } from '../env';
import { fetchItems } from '../lib/monday';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { upsertItem } from './upsert';
import { logSync } from './log';

export async function reconcileBoard(env: Env, slug: BoardSlug): Promise<{ upserts: number; deletes: number }> {
  const def = BOARDS[slug];
  const seen = new Set<number>();
  let upserts = 0;
  let cursor: string | null | undefined;

  do {
    const page = await fetchItems(env, def.id, cursor);
    for (const item of page.items) {
      seen.add(Number(item.id));
      const r = await upsertItem(env, slug, item, { skipIfUnchanged: true });
      if (r.changed) upserts++;
    }
    cursor = page.cursor;
  } while (cursor);

  const existing = await env.DB.prepare(
    `SELECT item_id FROM items WHERE board_id = ?`,
  ).bind(def.id).all<{ item_id: number }>();

  let deletes = 0;
  for (const row of existing.results ?? []) {
    if (seen.has(row.item_id)) continue;
    await env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`)
      .bind(def.id, row.item_id).run();
    deletes++;
  }

  await logSync(env, 'reconcile', def.id, null, true, `upserts=${upserts} deletes=${deletes}`);
  return { upserts, deletes };
}

export async function reconcileAll(env: Env): Promise<void> {
  for (const slug of Object.keys(BOARDS) as BoardSlug[]) {
    try {
      await reconcileBoard(env, slug);
    } catch (e) {
      await logSync(env, 'reconcile', BOARDS[slug].id, null, false, String(e));
    }
  }
}
