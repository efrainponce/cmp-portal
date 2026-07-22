// Full-board and full-mirror reconciliation (cron + manual trigger).
import type { Env } from '../env';
import { fetchItems, fetchBoardsUpdatedAt } from '../lib/monday';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { upsertItem } from './upsert';
import { logSync } from './log';

// Even if a board's updated_at never moves, force a full pass this often —
// bounds any staleness the light check could theoretically miss.
const FORCE_FULL_MS = 24 * 60 * 60 * 1000;

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

interface BoardState { board_id: number; monday_updated_at: string; reconciled_at: string }

/** One light Monday call for all boards; only boards whose updated_at moved
 * (or that haven't had a full pass in FORCE_FULL_MS) get paged in full. */
export async function reconcileAll(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS board_state (
       board_id INTEGER PRIMARY KEY, monday_updated_at TEXT NOT NULL, reconciled_at TEXT NOT NULL)`,
  ).run();

  const slugs = Object.keys(BOARDS) as BoardSlug[];
  let remote: Map<number, string> | null = null;
  try {
    remote = await fetchBoardsUpdatedAt(env, slugs.map(s => BOARDS[s].id));
  } catch (e) {
    await logSync(env, 'reconcile', 0, null, false, `boards updated_at check failed: ${e}`);
  }
  const stored = new Map<number, BoardState>();
  if (remote) {
    const res = await env.DB.prepare(`SELECT * FROM board_state`).all<BoardState>();
    for (const r of res.results ?? []) stored.set(r.board_id, r);
  }

  const now = new Date().toISOString();
  for (const slug of slugs) {
    const id = BOARDS[slug].id;
    const remoteAt = remote?.get(id);
    const prev = stored.get(id);
    const fresh = !!remoteAt && !!prev && prev.monday_updated_at === remoteAt
      && Date.now() - Date.parse(prev.reconciled_at) < FORCE_FULL_MS;
    if (fresh) {
      await logSync(env, 'reconcile', id, null, true, 'skipped — board updated_at unchanged');
      continue;
    }
    try {
      await reconcileBoard(env, slug);
      if (remoteAt) {
        await env.DB.prepare(
          `INSERT INTO board_state (board_id, monday_updated_at, reconciled_at) VALUES (?,?,?)
           ON CONFLICT(board_id) DO UPDATE SET monday_updated_at=excluded.monday_updated_at, reconciled_at=excluded.reconciled_at`,
        ).bind(id, remoteAt, now).run();
      }
    } catch (e) {
      await logSync(env, 'reconcile', id, null, false, String(e));
    }
  }

  // Retención del centro de notificaciones: purga leídas con más de 30 días —
  // best-effort, nunca debe tumbar el resto del reconcile.
  try {
    await env.DB.prepare(
      `DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < datetime('now','-30 days')`,
    ).run();
  } catch (e) {
    await logSync(env, 'reconcile', 0, null, false, `notifications prune failed: ${e}`);
  }
}
