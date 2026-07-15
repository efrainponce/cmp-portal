// worker/lib/outbox.ts — optimistic write path: D1 mirror first, Monday async via waitUntil.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';
import type { WriteResponse } from '../../shared/dto';
import { BOARDS, boardById } from '../../shared/boards';
import { canWrite } from '../../shared/visibility';
import { COLUMN_META } from '../../shared/column-meta.gen';
import { canonValue, writeHash } from './canon';
import { encodeColumnValue } from './columnEncode';
import { refetchItem } from '../sync';
import { getItem } from './dal';
import type { RawCol } from './serialize';

export class OutboxError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function submitWrite(
  env: Env,
  ctx: ExecutionContext,
  slug: BoardSlug,
  itemId: number,
  cols: Record<string, string>,
  viewer: Identity,
): Promise<WriteResponse> {
  const colIds = Object.keys(cols ?? {});
  if (colIds.length === 0) throw new OutboxError(400, 'no columns');
  for (const colId of colIds) {
    if (!canWrite(slug, colId, viewer.role)) throw new OutboxError(403, `cannot write ${colId}`);
  }

  const row = await getItem(env, slug, itemId, viewer);
  if (!row) throw new OutboxError(404, 'not found');

  const board = BOARDS[slug];
  const boardMeta = COLUMN_META[slug] ?? {};
  const types: Record<string, string> = {};
  for (const colId of colIds) types[colId] = boardMeta[colId]?.type ?? 'text';

  // Optimistic merge into the mirror's raw columns array — Monday's refetch will
  // correct any shape mismatch once the write round-trips (see confirmOutboxEcho).
  const existing: RawCol[] = JSON.parse(row.columns || '[]');
  const byId = new Map(existing.map(c => [c.id, c]));
  for (const colId of colIds) {
    const canon = canonValue(types[colId], cols[colId]);
    const merged: RawCol = { id: colId, type: types[colId], text: canon, value: JSON.stringify(canon) };
    const prev = byId.get(colId);
    if (prev) Object.assign(prev, merged);
    else existing.push(merged);
  }

  const now = new Date().toISOString();
  await env.DB
    .prepare('UPDATE items SET columns = ?, synced_at = ? WHERE board_id = ? AND item_id = ?')
    .bind(JSON.stringify(existing), now, board.id, itemId)
    .run();

  const canonCols: Record<string, string> = {};
  for (const colId of colIds) canonCols[colId] = canonValue(types[colId], cols[colId]);
  const contentHash = writeHash(canonCols, types);

  await env.DB
    .prepare(
      `INSERT INTO outbox (board_id, item_id, cols, content_hash, author_email, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
    .bind(board.id, itemId, JSON.stringify(cols), contentHash, viewer.email, now, now)
    .run();

  ctx.waitUntil(flushOutbox(env));
  return { ok: true, pending: true };
}

interface OutboxRow {
  id: number;
  board_id: number;
  item_id: number;
  cols: string;
  attempts: number;
}

export async function flushOutbox(env: Env): Promise<void> {
  const res = await env.DB
    .prepare(
      `SELECT id, board_id, item_id, cols, attempts FROM outbox
       WHERE status = 'pending' AND attempts < 5 ORDER BY created_at LIMIT 20`,
    )
    .all<OutboxRow>();
  for (const row of res.results ?? []) await flushOne(env, row);
}

async function flushOne(env: Env, row: OutboxRow): Promise<void> {
  const now = new Date().toISOString();
  try {
    const cols: Record<string, string> = JSON.parse(row.cols);
    const slug = boardById(row.board_id)?.slug;
    const boardMeta = slug ? (COLUMN_META[slug] ?? {}) : {};
    // Structured per-type encoding (not canonValue's flattened scalar) — Monday
    // rejects/no-ops complex types like board_relation without {item_ids:[...]}.
    const values: Record<string, unknown> = {};
    for (const [colId, raw] of Object.entries(cols)) {
      values[colId] = encodeColumnValue(boardMeta[colId]?.type ?? 'text', raw);
    }
    await mondayMutate(env, row.board_id, row.item_id, values);
    await env.DB
      .prepare(`UPDATE outbox SET status = 'sent', attempts = attempts + 1, updated_at = ? WHERE id = ?`)
      .bind(now, row.id)
      .run();
    await env.DB
      .prepare(`INSERT INTO sync_log (kind, board_id, item_id, ok, detail, at) VALUES ('outbox', ?, ?, 1, 'sent', ?)`)
      .bind(row.board_id, row.item_id, now)
      .run();
    await refetchItem(env, row.board_id, row.item_id);
  } catch (err) {
    const attempts = row.attempts + 1;
    const status = attempts >= 5 ? 'failed' : 'pending';
    const detail = err instanceof Error ? err.message : String(err);
    await env.DB
      .prepare(`UPDATE outbox SET status = ?, attempts = ?, updated_at = ? WHERE id = ?`)
      .bind(status, attempts, now, row.id)
      .run();
    await env.DB
      .prepare(`INSERT INTO sync_log (kind, board_id, item_id, ok, detail, at) VALUES ('outbox', ?, ?, 0, ?, ?)`)
      .bind(row.board_id, row.item_id, detail, now)
      .run();
  }
}

// Minimal inline Monday GQL client — deliberately not worker/lib/monday.ts (Module A owns it).
async function mondayMutate(env: Env, boardId: number, itemId: number, columnValues: Record<string, unknown>): Promise<void> {
  const query = `mutation ($b: ID!, $i: ID!, $v: JSON!) {
    change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v, create_labels_if_missing: true) { id }
  }`;
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: env.MONDAY_API_KEY,
      'API-Version': '2025-04',
    },
    body: JSON.stringify({ query, variables: { b: String(boardId), i: String(itemId), v: JSON.stringify(columnValues) } }),
  });
  const body = (await res.json()) as { errors?: { message: string }[] };
  if (!res.ok || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message ?? `monday mutation failed (${res.status})`);
  }
}
