// worker/lib/createRecord.ts — synchronous item creation (no outbox: there's no
// item_id to key on until Monday responds). Mirrors outbox.ts's validation shape.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { CreateResponse } from '../../shared/dto';
import { BOARDS } from '../../shared/boards';
import { CREATE_DEFAULTS, CREATE_FIELDS, isCreatable } from '../../shared/createFields';
import { COLUMN_META } from '../../shared/column-meta.gen';
import { encodeColumnValue } from './columnEncode';
import { createItem } from './monday';
import { upsertItem } from '../sync';

export class CreateError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const CREATOR_ROLES: Identity['role'][] = ['vendedor', 'compras', 'admin'];

export async function submitCreate(
  env: Env,
  slug: string,
  name: string,
  cols: Record<string, string>,
  viewer: Identity,
): Promise<CreateResponse> {
  if (!isCreatable(slug)) throw new CreateError(404, 'not found');
  if (!CREATOR_ROLES.includes(viewer.role)) throw new CreateError(403, 'cannot create');
  if (!name?.trim()) throw new CreateError(400, 'name is required');

  const fields = CREATE_FIELDS[slug];
  const allowedIds = new Set(fields.map(f => f.id));
  const colIds = Object.keys(cols ?? {});
  for (const id of colIds) {
    if (!allowedIds.has(id)) throw new CreateError(400, `cannot set ${id}`);
  }
  for (const f of fields) {
    if (f.required && f.id !== 'name' && !cols?.[f.id]?.trim()) {
      throw new CreateError(400, `${f.id} is required`);
    }
  }

  const boardMeta = COLUMN_META[slug] ?? {};
  const columnValues: Record<string, unknown> = {};
  for (const id of colIds) {
    if (id === 'name') continue; // item_name is a separate mutation argument
    const type = boardMeta[id]?.type ?? 'text';
    const encoded = encodeColumnValue(type, cols[id]);
    if (encoded !== '') columnValues[id] = encoded;
  }
  // Server-stamped defaults (e.g. oportunidades start at "Nueva oportunidad") —
  // outside CREATE_FIELDS, so a client can neither set nor override them.
  for (const [id, raw] of Object.entries(CREATE_DEFAULTS[slug] ?? {})) {
    columnValues[id] = encodeColumnValue(boardMeta[id]?.type ?? 'text', raw);
  }

  const board = BOARDS[slug];
  let item;
  try {
    item = await createItem(env, board.id, name.trim(), columnValues);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CreateError(502, `monday create failed: ${detail}`);
  }

  await upsertItem(env, slug, item);
  return { ok: true, id: item.id };
}
