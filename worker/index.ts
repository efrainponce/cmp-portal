// worker/index.ts — Hono wiring. Webhook routes bypass access/identity; everything else
// under /api/* requires both. Non-/api requests fall through to the static asset bundle.
import { Hono } from 'hono';
import type { Env } from './env';
import { BOARDS } from '../shared/boards';
import type { BoardSlug } from '../shared/boards';
import type {
  CreateRequest, CreateResponse, CreateUpdateRequest, IdentityDTO, ItemDetailDTO, ListResponse,
  MeDTO, MondayUserDTO, UpdateDTO, VendedorDTO, WriteRequest, WriteResponse,
} from '../shared/dto';
import { access } from './mw/access';
import { identity } from './mw/identity';
import { syncRoutes, reconcileAll, refetchItem } from './sync';
import { waRoutes } from './wa/routes';
import {
  listItems, getItem, childrenOf, childSlugOf, etagFor, pendingItemIds, listVendedores,
  listIdentities, upsertIdentity,
} from './lib/dal';
import { toItemDTO, toColMeta } from './lib/serialize';
import { submitWrite, flushOutbox, OutboxError } from './lib/outbox';
import { submitCreate, CreateError } from './lib/createRecord';
import { generateCotizacion, AutomationError } from './lib/automations';
import { fetchUpdates, createUpdate, fetchUsers } from './lib/monday';

const app = new Hono<{ Bindings: Env }>();

function isBoardSlug(s: string): s is BoardSlug {
  return Object.prototype.hasOwnProperty.call(BOARDS, s);
}

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Webhook routes registered first so they never pass through access/identity.
syncRoutes(app);
waRoutes(app);

app.use('/api/*', access, identity);

app.get('/api/me', c => {
  const viewer = c.get('viewer');
  const dto: MeDTO = { email: viewer.email, nombre: viewer.nombre ?? '', role: viewer.role, mondayUserId: viewer.monday_user_id };
  return c.json(dto);
});

app.get('/api/boards', c => {
  const role = c.get('viewer').role;
  const boards = (Object.keys(BOARDS) as BoardSlug[])
    .map(slug => ({ slug, title: BOARDS[slug].title, cols: toColMeta(slug, role) }))
    .filter(b => b.cols.length > 0);
  return c.json(boards);
});

app.get('/api/vendedores', async c => {
  const rows = await listVendedores(c.env);
  const dto: VendedorDTO[] = rows.map(r => ({ id: r.monday_user_id, nombre: r.nombre }));
  return c.json(dto);
});

app.post('/api/boards/:slug/items', async c => {
  const slug = c.req.param('slug');
  const viewer = c.get('viewer');
  const body = await c.req.json<CreateRequest>();

  try {
    const result = await submitCreate(c.env, slug, body.name, body.cols, viewer);
    return c.json(result);
  } catch (err) {
    if (err instanceof CreateError) {
      return jsonStatus({ ok: false, error: err.message } satisfies CreateResponse, err.status);
    }
    return jsonStatus({ ok: false, error: 'internal error' } satisfies CreateResponse, 500);
  }
});

app.get('/api/boards/:slug/items', async c => {
  const slug = c.req.param('slug');
  if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');
  const q = c.req.query('q');

  const etag = await etagFor(c.env, slug);
  c.header('ETag', etag);
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304);

  const rows = await listItems(c.env, slug, viewer, q);
  const pending = await pendingItemIds(c.env, BOARDS[slug].id);
  const items = rows.map(r => toItemDTO(r, slug, viewer.role, pending.has(r.item_id)));
  const body: ListResponse = { board: slug, items, total: items.length, etag };
  return c.json(body);
});

app.get('/api/boards/:slug/items/:id', async c => {
  const slug = c.req.param('slug');
  if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  const row = await getItem(c.env, slug, itemId, viewer);
  if (!row) return c.json({ error: 'not found' }, 404);

  const pending = await pendingItemIds(c.env, BOARDS[slug].id);
  const dto: ItemDetailDTO = toItemDTO(row, slug, viewer.role, pending.has(row.item_id));

  const childSlug = childSlugOf(slug);
  if (childSlug) {
    const children = await childrenOf(c.env, slug, itemId, viewer);
    const childPending = await pendingItemIds(c.env, BOARDS[childSlug].id);
    dto.children = children.map(r => toItemDTO(r, childSlug, viewer.role, childPending.has(r.item_id)));
  }
  return c.json(dto);
});

app.patch('/api/boards/:slug/items/:id', async c => {
  const slug = c.req.param('slug');
  if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');
  const body = await c.req.json<WriteRequest>();

  try {
    const result = await submitWrite(c.env, c.executionCtx, slug, itemId, body.cols, viewer);
    return c.json(result);
  } catch (err) {
    if (err instanceof OutboxError) {
      return jsonStatus({ ok: false, pending: false, error: err.message } satisfies WriteResponse, err.status);
    }
    return jsonStatus({ ok: false, pending: false, error: 'internal error' } satisfies WriteResponse, 500);
  }
});

app.post('/api/boards/:slug/items/:id/refresh', async c => {
  const slug = c.req.param('slug');
  if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  const row = await getItem(c.env, slug, itemId, viewer);
  if (!row) return c.json({ error: 'not found' }, 404);

  const ageMs = Date.now() - new Date(row.synced_at).getTime();
  if (ageMs < 30_000) return c.json({ ok: true, skipped: true });

  await refetchItem(c.env, BOARDS[slug].id, itemId);
  return c.json({ ok: true, skipped: false });
});

// Updates (comments) live on Monday, never mirrored — always a fresh GraphQL
// call. Reuses getItem's viewer scoping so a vendedor can't read/post on an
// opportunity that isn't theirs just by knowing its id.
app.get('/api/boards/:slug/items/:id/updates', async c => {
  const slug = c.req.param('slug');
  if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  const row = await getItem(c.env, slug, itemId, viewer);
  if (!row) return c.json({ error: 'not found' }, 404);

  const updates = await fetchUpdates(c.env, itemId);
  const dto: UpdateDTO[] = updates.map(u => ({
    id: u.id, body: u.text_body ?? '', author: u.creator?.name ?? 'Monday', createdAt: u.created_at,
  }));
  return c.json(dto);
});

// Same channel backs both the Actualizaciones composer and payment-request
// buttons (anticipo/saldo) — posting straight to the Monday item's updates
// feed is exactly where the team already looks for status, per Efraín's brief.
app.post('/api/boards/:slug/items/:id/updates', async c => {
  const slug = c.req.param('slug');
  if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  const row = await getItem(c.env, slug, itemId, viewer);
  if (!row) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json<CreateUpdateRequest>();
  const text = (body.body ?? '').trim();
  if (!text) return c.json({ error: 'body is required' }, 400);

  const signed = `${text}\n\n— ${viewer.nombre ?? viewer.email} vía Portal CMP`;
  const u = await createUpdate(c.env, itemId, signed);
  const dto: UpdateDTO = {
    id: u.id, body: u.text_body ?? signed, author: u.creator?.name ?? (viewer.nombre ?? viewer.email), createdAt: u.created_at,
  };
  return c.json(dto);
});

// Admin-only: manage who can log in (phone, role, active) and pull the Monday
// user directory to import phones/teams instead of retyping them.
app.get('/api/admin/identities', async c => {
  if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const rows = await listIdentities(c.env);
  const dto: IdentityDTO[] = rows.map(r => ({
    email: r.email, phone: r.phone ?? null, nombre: r.nombre ?? null,
    mondayUserId: r.monday_user_id, role: r.role, active: !!r.active,
  }));
  return c.json(dto);
});

app.put('/api/admin/identities/:email', async c => {
  if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const email = decodeURIComponent(c.req.param('email'));
  const body = await c.req.json<Partial<IdentityDTO>>();
  if (!email.trim()) return c.json({ error: 'email is required' }, 400);
  const role = body.role ?? 'vendedor';
  const validRoles = ['vendedor', 'compras', 'admin', 'cliente'];
  if (!validRoles.includes(role)) return c.json({ error: 'invalid role' }, 400);
  if (!Number.isFinite(body.mondayUserId)) return c.json({ error: 'mondayUserId is required' }, 400);

  await upsertIdentity(c.env, {
    email,
    phone: body.phone?.trim() || null,
    nombre: body.nombre?.trim() || null,
    monday_user_id: body.mondayUserId as number,
    role,
    active: body.active === false ? 0 : 1,
  });
  return c.json({ ok: true });
});

app.get('/api/admin/monday-users', async c => {
  if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  try {
    const users = await fetchUsers(c.env);
    const dto: MondayUserDTO[] = users.map(u => ({
      id: Number(u.id), nombre: u.name, email: u.email, phone: u.phone ?? null,
      teams: (u.teams ?? []).map(t => t.name),
    }));
    return c.json(dto);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ error: `monday fetch failed: ${detail}` }, 502);
  }
});

app.post('/api/oportunidades/:id/cotizacion', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  const row = await getItem(c.env, 'oportunidades', itemId, viewer);
  if (!row) return c.json({ error: 'not found' }, 404);

  try {
    const result = await generateCotizacion(c.env, itemId);
    await refetchItem(c.env, BOARDS.oportunidades.id, itemId);
    return c.json(result);
  } catch (err) {
    if (err instanceof AutomationError) return jsonStatus({ ok: false, reason: err.message }, err.status);
    return jsonStatus({ ok: false, reason: 'internal error' }, 500);
  }
});

app.all('*', c => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(reconcileAll(env).then(() => flushOutbox(env)));
  },
};
