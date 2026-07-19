// Rutas genéricas de boards espejados de Monday (list/detail/patch/create/
// refresh/updates) + identidad del viewer y rosters. Movido tal cual desde
// worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Hono } from 'hono';
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import type { BoardSlug } from '../../shared/boards';
import type {
  CreateRequest, CreateResponse, CreateUpdateRequest, ItemDetailDTO, ListResponse,
  MeDTO, MentionUserDTO, UpdateDTO, VendedorDTO, WriteRequest, WriteResponse,
} from '../../shared/dto';
import {
  listItems, getItem, childrenOf, childSlugOf, etagFor, pendingItemIds, listVendedores,
} from '../lib/dal';
import { toItemDTO, toColMeta } from '../lib/serialize';
import { submitWrite, OutboxError } from '../lib/outbox';
import { submitCreate, CreateError } from '../lib/createRecord';
import { fetchUpdates, createUpdate, addFileToUpdate, fetchAssetPublicUrls, deleteItem } from '../lib/monday';
import { cachedFetchUsers } from '../lib/rosterCache';
import { getBoardAccess } from '../lib/boardAccess';
import { refetchItem } from '../sync';
import { jsonStatus } from '../lib/http';

function isBoardSlug(s: string): s is BoardSlug {
  return Object.prototype.hasOwnProperty.call(BOARDS, s);
}

export function boardRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/me', async c => {
    const viewer = c.get('viewer');
    const admin = c.get('impersonatedBy');
    const dto: MeDTO = {
      email: viewer.email, nombre: viewer.nombre ?? '', role: viewer.role, mondayUserId: viewer.monday_user_id,
      impersonatedBy: admin ? { email: admin.email, nombre: admin.nombre ?? admin.email } : null,
      boardAccess: await getBoardAccess(c.env, viewer.role),
    };
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
    const rows = await listVendedores(c.env, c.req.query('role') ?? 'vendedor');
    const dto: VendedorDTO[] = rows.map(r => ({ id: r.monday_user_id, nombre: r.nombre }));
    return c.json(dto);
  });

  // Full Monday roster for @-tagging in Actualizaciones — any authenticated
  // viewer, unlike /api/admin/monday-users which also exposes email/phone.
  app.get('/api/users', async c => {
    try {
      // Roster cacheado 6 h en D1 — cambia casi nunca y esto se abre muy seguido.
      const users = await cachedFetchUsers(c.env, 6 * 3600_000);
      const dto: MentionUserDTO[] = users
        .map(u => ({ id: Number(u.id), nombre: u.name }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      return c.json(dto);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json({ error: `monday fetch failed: ${detail}` }, 502);
    }
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

    const etag = await etagFor(c.env, slug, viewer);
    c.header('ETag', etag);
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304);

    const [rows, pending] = await Promise.all([
      listItems(c.env, slug, viewer, q),
      pendingItemIds(c.env, BOARDS[slug].id),
    ]);
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

    const childSlug = childSlugOf(slug);
    const [row, pending, children, childPending] = await Promise.all([
      getItem(c.env, slug, itemId, viewer),
      pendingItemIds(c.env, BOARDS[slug].id),
      childSlug ? childrenOf(c.env, slug, itemId, viewer) : Promise.resolve([]),
      childSlug ? pendingItemIds(c.env, BOARDS[childSlug].id) : Promise.resolve(new Set<number>()),
    ]);
    if (!row) return c.json({ error: 'not found' }, 404);

    const dto: ItemDetailDTO = toItemDTO(row, slug, viewer.role, pending.has(row.item_id));
    if (childSlug) {
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

  app.delete('/api/boards/:slug/items/:id', async c => {
    const slug = c.req.param('slug');
    if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);

    try {
      await deleteItem(c.env, itemId);
      return c.json({ ok: true });
    } catch (err) {
      return jsonStatus({ ok: false, error: 'No se pudo eliminar' }, 500);
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
      attachments: (u.assets ?? []).map(a => ({ id: a.id, name: a.name, ext: a.file_extension.replace(/^\./, '').toLowerCase() })),
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
    const mentions = (body.mentions ?? []).filter(m => Number.isFinite(m.id) && typeof m.nombre === 'string' && m.nombre.length > 0);

    const signed = `${text}\n\n— ${viewer.nombre ?? viewer.email} vía Portal CMP`;
    const u = await createUpdate(c.env, itemId, signed, mentions);
    const dto: UpdateDTO = {
      id: u.id, body: u.text_body ?? signed, author: u.creator?.name ?? (viewer.nombre ?? viewer.email), createdAt: u.created_at,
      attachments: [],
    };
    return c.json(dto);
  });

  // Attaches one file to an update that already exists (the composer creates
  // the update first via the POST above, then calls this with its id) — a
  // real Monday asset on the update, not a link in the text, so it doesn't
  // expire like the presigned S3 links automations post.
  app.post('/api/boards/:slug/items/:id/updates/:updateId/attachment', async c => {
    const slug = c.req.param('slug');
    if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    const updateId = c.req.param('updateId');
    if (!Number.isFinite(itemId) || !/^\d+$/.test(updateId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, slug, itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);

    try {
      const asset = await addFileToUpdate(c.env, updateId, file, file.name);
      const ext = (asset.name.split('.').pop() ?? '').toLowerCase();
      return c.json({ ok: true, id: asset.id, name: asset.name, ext });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return jsonStatus({ ok: false, error: 'No se pudo adjuntar el archivo: ' + detail }, 502);
    }
  });

  // Proxies the bytes of an update attachment from our own domain — same
  // reasoning as the cotización PDF proxy (worker/routes/oportunidades.ts):
  // the raw Monday S3 link expires in ~1h and can trip CSP/framing if handed
  // straight to the browser, so we resolve it fresh per request and stream
  // the bytes back with our own headers.
  app.get('/api/boards/:slug/items/:id/updates/attachments/:assetId', async c => {
    const slug = c.req.param('slug');
    if (!isBoardSlug(slug)) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    const assetId = c.req.param('assetId');
    if (!Number.isFinite(itemId) || !/^\d+$/.test(assetId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, slug, itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const urls = await fetchAssetPublicUrls(c.env, [assetId]);
    const url = urls.get(assetId);
    if (!url) return c.json({ error: 'not found' }, 404);

    const name = c.req.query('name') ?? 'archivo';
    const download = c.req.query('download') === '1';
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    const contentType = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';

    const upstream = await fetch(url);
    if (!upstream.ok) return jsonStatus({ error: 'no se pudo obtener el archivo' }, 502);
    // Buffer en vez de stream — mismo motivo que cotizacion-pdf: el proxy de
    // Vite en dev se cuelga con una Response streameada sin Content-Length.
    const bytes = await upstream.arrayBuffer();
    const safeName = name.replace(/["\r\n]/g, '');
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=60',
      },
    });
  });
}
