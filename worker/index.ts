// worker/index.ts — Hono wiring. Webhook routes bypass access/identity; everything else
// under /api/* requires both. Non-/api requests fall through to the static asset bundle.
import { Hono, type Context } from 'hono';
import type { Env } from './env';
import { BOARDS } from '../shared/boards';
import type { BoardSlug } from '../shared/boards';
import type {
  CreateRequest, CreateResponse, CreateUpdateRequest, IdentityDTO, ItemDetailDTO, ListResponse,
  MeDTO, MentionUserDTO, MondayUserDTO, QuoteVersionRequest, QuoteVersionResponse, QuoteVersionsResponse,
  UpdateDTO, VendedorDTO, WriteRequest, WriteResponse,
} from '../shared/dto';
import { access } from './mw/access';
import { identity } from './mw/identity';
import { syncRoutes, reconcileAll, refetchItem, refetchItemTree, upsertItem } from './sync';
import { waRoutes } from './wa/routes';
import { assistantRoutes } from './assistant/routes';
import {
  listItems, getItem, childrenOf, childSlugOf, etagFor, pendingItemIds, listVendedores,
  listIdentities, upsertIdentity, proyectoForOportunidad,
} from './lib/dal';
import { toItemDTO, toColMeta } from './lib/serialize';
import { submitWrite, flushOutbox, OutboxError } from './lib/outbox';
import { submitCreate, CreateError } from './lib/createRecord';
import {
  generateCotizacion, generateSheet, confirmTallas, importTallas, generateOC,
  AutomationError,
} from './lib/automations';
import { enviarACosteo, enviarAValidacion, checkCosteo, CosteoError, type EnviarCosteoResult } from './lib/costeo';
import { listVersions, submitVersion, recordFirstVersion, QuoteVersionError } from './lib/quoteVersions';
import { fetchUpdates, createUpdate, createSubitem } from './lib/monday';
import { cachedFetchUsers } from './lib/rosterCache';
import { listWarehouses, listMovements, listStock, createMovement, InventoryError } from './lib/inventory';
import type { CreateMovementRequest, CreateMovementResponse } from '../shared/inventory';
import { listZoneImages, uploadZoneImage, EmbellImageError } from './lib/embellecimientoImagenes';
import { resolveCotizacionPdfUrl, CotizacionPdfError, type PdfKind } from './lib/cotizacionPdfs';

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

// Responses are scoped per viewer (see dal.ts scopeFor) and, since admin
// impersonation lets one browser act as several identities in a session,
// must never be cached/replayed across viewers by the browser's own HTTP
// cache — that would silently hand one viewer's data to the next.
app.use('/api/*', async (c, next) => {
  await next();
  // Don't clobber a route's own explicit Cache-Control (e.g. the signed PDF proxy).
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'private, no-store');
});

assistantRoutes(app);

app.get('/api/me', c => {
  const viewer = c.get('viewer');
  const admin = c.get('impersonatedBy');
  const dto: MeDTO = {
    email: viewer.email, nombre: viewer.nombre ?? '', role: viewer.role, mondayUserId: viewer.monday_user_id,
    impersonatedBy: admin ? { email: admin.email, nombre: admin.nombre ?? admin.email } : null,
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
  const mentions = (body.mentions ?? []).filter(m => Number.isFinite(m.id) && typeof m.nombre === 'string' && m.nombre.length > 0);

  const signed = `${text}\n\n— ${viewer.nombre ?? viewer.email} vía Portal CMP`;
  const u = await createUpdate(c.env, itemId, signed, mentions);
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
    // TTL corto: el admin importa teléfonos/equipos y espera datos recientes.
    const users = await cachedFetchUsers(c.env, 10 * 60_000);
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

// Pre-chequeo de solo lectura: la UI deshabilita "Mandar a costeo" y lista lo
// que falta ANTES de que alguien pueda dar click. Sin ningún efecto.
app.get('/api/oportunidades/:id/costeo-check', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);

  try {
    return c.json(await checkCosteo(c.env, itemId, c.get('viewer')));
  } catch (err) {
    if (err instanceof CosteoError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
    return jsonStatus({ ok: false, errors: ['internal error'] }, 500);
  }
});

// Mandar a costeo = el flujo real de cmp-tallas (validar_costeo): valida, snapshotea
// costos, genera el PDF de solicitud y mueve deal_stage→"En costeo". 422 con la
// lista de errores legibles si algo falta (pre-chequeo local o rechazo del endpoint).
app.post('/api/oportunidades/:id/enviar-costeo', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);

  try {
    const result = await enviarACosteo(c.env, itemId, c.get('viewer'));
    // El stage, el PDF y los snapshots de subitems los escribió cmp-tallas
    // directo en Monday — refresca el árbol completo en el mirror.
    if (result.ok) await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
    return result.ok ? c.json(result) : jsonStatus(result, 422);
  } catch (err) {
    if (err instanceof CosteoError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
    if (err instanceof AutomationError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
    if (err instanceof OutboxError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
    return jsonStatus({ ok: false, errors: ['internal error'] }, 500);
  }
});

// Mandar a Validación de costeo = avance manual de Compras (etapa 15→7), sin
// automatización de cmp-tallas de por medio (no existe endpoint para este
// paso — docs/cmp-tallas-endpoint-map.md).
app.post('/api/oportunidades/:id/enviar-validacion', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');
  if (viewer.role !== 'compras' && viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

  try {
    const result = await enviarAValidacion(c.env, c.executionCtx, itemId, viewer);
    return result.ok ? c.json(result) : jsonStatus(result, 422);
  } catch (err) {
    if (err instanceof CosteoError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
    if (err instanceof OutboxError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
    return jsonStatus({ ok: false, errors: ['internal error'] }, 500);
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
    if (result.ok) {
      await recordFirstVersion(c.env, itemId, viewer, typeof result.folio_cotizacion === 'string' ? result.folio_cotizacion : undefined, Number(result.total ?? 0));
    }
    await refetchItem(c.env, BOARDS.oportunidades.id, itemId);
    return c.json(result);
  } catch (err) {
    if (err instanceof AutomationError) return jsonStatus({ ok: false, reason: err.message }, err.status);
    return jsonStatus({ ok: false, reason: 'internal error' }, 500);
  }
});

// Versiones de cotización — la vigente se arma del mirror; D1 archiva las
// anteriores. [] solo cuando la oportunidad no tiene líneas todavía.
app.get('/api/oportunidades/:id/versiones', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  const row = await getItem(c.env, 'oportunidades', itemId, viewer);
  if (!row) return c.json({ error: 'not found' }, 404);

  const versions = await listVersions(c.env, itemId, viewer);
  return c.json({ versions } satisfies QuoteVersionsResponse);
});

app.post('/api/oportunidades/:id/version', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');
  const body = await c.req.json<QuoteVersionRequest>();

  try {
    const { changed } = await submitVersion(c.env, c.executionCtx, itemId, viewer, body.lines ?? []);
    // Una nueva versión con cambios ES una solicitud de costeo — mismo flujo real
    // que el botón "Mandar a costeo" (valida, genera PDF, deal_stage → "En costeo"),
    // sin importar en qué etapa estuviera antes (Efraín, 2026-07-16).
    const costeo = changed
      ? await enviarACosteo(c.env, itemId, viewer).catch((e): EnviarCosteoResult => ({
          ok: false, errors: [e instanceof Error ? e.message : 'No se pudo reenviar a costeo.'],
        }))
      : undefined;
    // Un solo refetch de árbol al final: recoge tanto las líneas editadas como lo
    // que cmp-tallas escribió (stage, PDF, snapshots) — submitVersion ya no refetchea.
    if (changed) await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
    const versions = changed ? await listVersions(c.env, itemId, viewer) : undefined;
    return c.json({ ok: true, changed, versions, costeo } satisfies QuoteVersionResponse);
  } catch (err) {
    if (err instanceof QuoteVersionError) return jsonStatus({ ok: false, changed: false, error: err.message } satisfies QuoteVersionResponse, err.status);
    if (err instanceof OutboxError) return jsonStatus({ ok: false, changed: false, error: err.message } satisfies QuoteVersionResponse, err.status);
    return jsonStatus({ ok: false, changed: false, error: 'internal error' } satisfies QuoteVersionResponse, 500);
  }
});

// Crear una línea de producto en Nueva oportunidad (stage 4) — subitems sin versioning.
app.post('/api/oportunidades/:id/productos', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');
  const body = await c.req.json<{ cantidad?: number }>();

  try {
    const item = await getItem(c.env, 'oportunidades', itemId, viewer);
    if (!item) return c.json({ error: 'not found' }, 404);

    // MirrorItem.columns is raw [{id,type,text,value}] JSON — same shape/parsing
    // as worker/lib/costeo.ts's colsOf, not the serialized ItemDTO.cols.
    const raw: { id: string; text: string; value: string }[] = JSON.parse(item.columns || '[]');
    const stageCol = raw.find(col => col.id === 'deal_stage');
    let stageIndex = '';
    try {
      stageIndex = String((JSON.parse(stageCol?.value ?? 'null') as { index?: unknown })?.index ?? '');
    } catch { /* value vacío/optimista — cae en 'no coincide con 4' abajo */ }
    if (stageIndex !== '4') {
      return c.json({ error: 'Solo se pueden crear líneas en Nueva oportunidad' }, 400);
    }

    // Subitem real (create_subitem, no create_item) — así Monday lo linkea al
    // padre automáticamente; create_item en el board de subitems NO lo hace.
    // Cantidad arranca en 0 a propósito (Efraín) — el grid la marca con warning
    // hasta que el vendedor la captura, en vez de fingir una cantidad de 1.
    const subitemName = 'Nueva línea';
    const subitemCols: Record<string, unknown> = {
      numeric_mkzm6399: body.cantidad ?? 0, // cantidad
    };
    const subitem = await createSubitem(c.env, itemId, subitemName, subitemCols);

    await upsertItem(c.env, 'oportunidades_sub', subitem);
    return c.json({ ok: true, id: subitem.id });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Error creando producto:', detail);
    return c.json({ error: 'No se pudo crear la línea: ' + detail }, 500);
  }
});

// Imágenes de referencia por zona de embellecimiento — :id es la línea
// (subitem de oportunidades_sub), no la oportunidad. Monday no tiene una
// columna por zona; la zona va codificada en el nombre del archivo
// (ver worker/lib/embellecimientoImagenes.ts).
app.get('/api/oportunidades/lineas/:id/embellecimiento-imagenes', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  try {
    const images = await listZoneImages(c.env, itemId, viewer);
    return c.json(images);
  } catch (err) {
    if (err instanceof EmbellImageError) return jsonStatus({ error: err.message }, err.status);
    return c.json({ error: 'internal error' }, 500);
  }
});

// Vista previa embebida del PDF de cotización (sin firmar/firmada) — transmite
// los bytes desde nuestro dominio en vez de mandar el link crudo de Monday al
// iframe, que exige sesión de monday.com y bloquea el framing por CSP (ver
// worker/lib/cotizacionPdfs.ts).
app.get('/api/oportunidades/:id/cotizacion-pdf/:kind', async c => {
  const itemId = Number(c.req.param('id'));
  const kind = c.req.param('kind') as PdfKind;
  if (!Number.isFinite(itemId) || (kind !== 'sin_firmar' && kind !== 'firmada')) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  try {
    const url = await resolveCotizacionPdfUrl(c.env, itemId, viewer, kind);
    if (!url) return c.json({ error: 'not found' }, 404);
    const upstream = await fetch(url);
    if (!upstream.ok) return jsonStatus({ error: 'no se pudo obtener el PDF' }, 502);
    // Buffer en vez de pasar upstream.body como stream — el proxy de Vite en dev
    // se cuelga con una Response de Workers streameada sin Content-Length
    // (verificado en vivo: la petición nunca regresaba a través del proxy).
    // El PDF es chico (cientos de KB), bufferear no cuesta nada y evita el hang.
    const bytes = await upstream.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err) {
    if (err instanceof CotizacionPdfError) return jsonStatus({ error: err.message }, err.status);
    return c.json({ error: 'internal error' }, 500);
  }
});

app.post('/api/oportunidades/lineas/:id/embellecimiento-imagen', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  const form = await c.req.formData();
  const zone = String(form.get('zone') ?? '');
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);
  // Imagen o archivo (PDF, etc.) — file_mm5akjy5 es una columna de archivo
  // genérica de Monday, no solo de imágenes (Efraín, 2026-07-16).

  try {
    const result = await uploadZoneImage(c.env, c.executionCtx, itemId, viewer, zone, file, file.name);
    return c.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof EmbellImageError) return jsonStatus({ error: err.message }, err.status);
    return c.json({ error: 'internal error' }, 500);
  }
});

// El Proyecto ligado a la oportunidad (tallas/OC viven ahí, no en la Oportunidad).
// 200 con {proyecto: null} cuando aún no existe — el drawer muestra el estado vacío.
app.get('/api/oportunidades/:id/proyecto', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  const opp = await getItem(c.env, 'oportunidades', itemId, viewer);
  if (!opp) return c.json({ error: 'not found' }, 404);

  const row = await proyectoForOportunidad(c.env, itemId, viewer);
  if (!row) return c.json({ proyecto: null });

  const [pending, children, childPending] = await Promise.all([
    pendingItemIds(c.env, BOARDS.proyectos.id),
    childrenOf(c.env, 'proyectos', row.item_id, viewer),
    pendingItemIds(c.env, BOARDS.proyectos_sub.id),
  ]);
  const dto: ItemDetailDTO = toItemDTO(row, 'proyectos', viewer.role, pending.has(row.item_id));
  dto.children = children.map(r => toItemDTO(r, 'proyectos_sub', viewer.role, childPending.has(r.item_id)));
  return c.json({ proyecto: dto });
});

// Acciones de cmp-tallas sobre el Proyecto. Cada una exige que el viewer pueda
// ver el Proyecto (scoping de dal) + un gate de rol que refleja el botón de
// Monday: confirmar=VENDEDOR, importar/oc=COMPRAS, regenerar=ambos.
const PROYECTO_ACTIONS: Record<string, {
  roles: string[];
  run: (env: Env, id: number) => Promise<{ ok: boolean; [k: string]: unknown }>;
}> = {
  'tallas-regenerar': { roles: ['vendedor', 'compras', 'admin'], run: (env, id) => generateSheet(env, id) },
  'tallas-confirmar': { roles: ['vendedor', 'admin'], run: (env, id) => confirmTallas(env, id) },
  'tallas-importar': { roles: ['compras', 'admin'], run: (env, id) => importTallas(env, id) },
  'generar-oc': { roles: ['compras', 'admin'], run: (env, id) => generateOC(env, id) },
};

app.post('/api/proyectos/:id/:action', async c => {
  const itemId = Number(c.req.param('id'));
  if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
  const action = PROYECTO_ACTIONS[c.req.param('action')];
  if (!action) return c.json({ error: 'not found' }, 404);
  const viewer = c.get('viewer');

  if (!action.roles.includes(viewer.role)) return c.json({ error: 'forbidden' }, 403);
  const row = await getItem(c.env, 'proyectos', itemId, viewer);
  if (!row) return c.json({ error: 'not found' }, 404);

  try {
    const result = await action.run(c.env, itemId);
    // cmp-tallas escribe directo en Monday (links, archivos, subitems) — refresca el mirror.
    await refetchItemTree(c.env, BOARDS.proyectos.id, itemId);
    return c.json(result);
  } catch (err) {
    if (err instanceof AutomationError) return jsonStatus({ ok: false, reason: err.message }, err.status);
    return jsonStatus({ ok: false, reason: 'internal error' }, 500);
  }
});

// Inventario (2026-07-15): native D1 feature, not a Monday-mirrored board — quantity-
// based stock across bodegas + vendedores carrying samples. Open to any authenticated
// non-cliente identity (same policy as the open catalogs: productos/instituciones/contactos).
function requireInventoryAccess(c: Context<{ Bindings: Env }>): Response | null {
  if (c.get('viewer').role === 'cliente') return c.json({ error: 'forbidden' }, 403);
  return null;
}

app.get('/api/inventario/warehouses', async c => {
  const denied = requireInventoryAccess(c);
  if (denied) return denied;
  return c.json(await listWarehouses(c.env));
});

app.get('/api/inventario/stock', async c => {
  const denied = requireInventoryAccess(c);
  if (denied) return denied;
  return c.json(await listStock(c.env));
});

app.get('/api/inventario/movements', async c => {
  const denied = requireInventoryAccess(c);
  if (denied) return denied;
  return c.json(await listMovements(c.env));
});

app.post('/api/inventario/movements', async c => {
  const denied = requireInventoryAccess(c);
  if (denied) return denied;
  const body = await c.req.json<CreateMovementRequest>();
  try {
    const movement = await createMovement(c.env, body);
    return c.json({ ok: true, id: movement.id } satisfies CreateMovementResponse);
  } catch (err) {
    if (err instanceof InventoryError) {
      return jsonStatus({ ok: false, error: err.message } satisfies CreateMovementResponse, err.status);
    }
    return jsonStatus({ ok: false, error: 'internal error' } satisfies CreateMovementResponse, 500);
  }
});

app.all('*', c => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(reconcileAll(env).then(() => flushOutbox(env)));
  },
};
