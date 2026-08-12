// Rutas genéricas de boards espejados de Monday (list/detail/patch/create/
// refresh/updates) + identidad del viewer y rosters. Movido tal cual desde
// worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import type { BoardSlug } from '../../shared/boards';
import type {
  CreateRequest, CreateResponse, CreateUpdateRequest, ItemDetailDTO, ListResponse,
  MeDTO, MentionUserDTO, UpdateDTO, VendedorDTO, WriteRequest, WriteResponse,
} from '../../shared/dto';
import {
  listItems, getItem, childrenOf, childSlugOf, etagFor, pendingItemIds, listVendedores,
  ownsItem, leadsOthers, hasPendingWrites, upsertIdentity,
} from '../lib/dal';
import { toItemDTO, toColMeta } from '../lib/serialize';
import { canReadBoard } from '../../shared/visibility';
import { submitWrite, OutboxError } from '../lib/outbox';
import { submitCreate, CreateError } from '../lib/createRecord';
import { fetchUpdates, createUpdate, addFileToUpdate, fetchAssetPublicUrls, deleteItem, type MentionInput } from '../lib/monday';
import { cachedFetchUsers } from '../lib/rosterCache';
import { getBoardAccess } from '../lib/boardAccess';
import { refetchItem, refetchItemTree } from '../sync';
import { jsonStatus } from '../lib/http';
import { emitNotification } from '../lib/notify';

function isBoardSlug(s: string): s is BoardSlug {
  return Object.prototype.hasOwnProperty.call(BOARDS, s);
}

/** El `:slug` de la ruta, solo si además es un board que el viewer puede ver.
 * El filtrado por columnas de serialize.ts NO alcanza como única defensa: el
 * `name` del item va siempre en el DTO, así que un board 100% interno para el
 * rol (`proveedores` para vendedor/almacén) seguía listando sus 98 nombres —
 * y su detalle, sus updates y sus adjuntos — con `cols: {}` (Efraín,
 * 2026-07-30: "ventas no puede ver nada de costeo ni proveedores"). Null = la
 * ruta responde 404, el mismo "no existe" que un slug inventado: para ese rol
 * el board efectivamente no existe. */
function boardFor(c: Context<{ Bindings: Env }>): BoardSlug | null {
  const slug = c.req.param('slug');
  if (!isBoardSlug(slug)) return null;
  return canReadBoard(slug, c.get('viewer').role) ? slug : null;
}

// Ventana en la que un refetch recién hecho se considera "ya fresco" — evita
// pegarle a Monday dos veces cuando el drawer recarga en ráfaga (abrir + write
// + relectura). Corta, porque la garantía que pide el negocio es que al ABRIR
// una oportunidad se vea exactamente lo que Monday tiene (Efraín, 2026-07-30).
const FRESH_WINDOW_MS = 3_000;

/** Trae el item (y sus líneas, si el board tiene subitems) directo de Monday
 * antes de responder. Nunca lanza: si Monday falla o va lento, se sirve el
 * mirror — mejor un dato de hace un rato que un drawer roto. */
async function pullFromMonday(env: Env, slug: BoardSlug, itemId: number, syncedAt?: string): Promise<void> {
  if (syncedAt && Date.now() - Date.parse(syncedAt) < FRESH_WINDOW_MS) return;
  const childSlug = childSlugOf(slug);
  // Si el outbox todavía tiene writes en vuelo para este item (o sus líneas),
  // el mirror YA refleja la edición del usuario y Monday puede no haberla
  // recibido todavía — leer "fresh" ahora arriesga pisarla con el valor viejo.
  // Deja que el outbox confirme por su cuenta (ver hasPendingWrites).
  const pending = await hasPendingWrites(env, BOARDS[slug].id, itemId, childSlug ? BOARDS[childSlug].id : undefined);
  if (pending) return;
  try {
    if (childSlug) await refetchItemTree(env, BOARDS[slug].id, itemId);
    else await refetchItem(env, BOARDS[slug].id, itemId);
  } catch { /* Monday caído/rate-limited — seguimos con el mirror */ }
}

// Deep-link boardKey (src/lib/routing.ts) para la notificación de mención —
// 'proyectos' vive bajo la ruta 'doctallas' en el front; el resto coincide con el slug.
function mentionBoardKey(slug: string): string {
  if (slug === 'oportunidades') return 'oportunidades';
  if (slug === 'proyectos') return 'doctallas';
  return slug;
}

export function boardRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/me', async c => {
    const viewer = c.get('viewer');
    const admin = c.get('impersonatedBy');
    const dto: MeDTO = {
      email: viewer.email, nombre: viewer.nombre ?? '', role: viewer.role, mondayUserId: viewer.monday_user_id,
      phone: viewer.phone ?? null,
      impersonatedBy: admin ? { email: admin.email, nombre: admin.nombre ?? admin.email } : null,
      boardAccess: await getBoardAccess(c.env, viewer.role),
    };
    return c.json(dto);
  });

  // Autoregistro del propio teléfono — el portal lo exige tras el login (ver
  // PhoneGateScreen) porque es lo único que liga esta cuenta al bot de WhatsApp
  // (worker/wa/store.ts identityByPhone). Solo toca `phone`: no deja que el
  // propio usuario cambie su rol ni se reactive. Bajo impersonación el viewer
  // ya es el suplantado (worker/mw/identity.ts), así que esto guardaría el
  // teléfono de ESA cuenta — el frontend evita llegar aquí durante "ver como".
  app.put('/api/me/phone', async c => {
    const viewer = c.get('viewer');
    const body = await c.req.json<{ phone?: string }>();
    const phone = (body.phone ?? '').trim();
    if (phone.replace(/\D/g, '').length < 10) {
      return c.json({ error: 'Captura un teléfono válido (10 dígitos).' }, 400);
    }
    try {
      await upsertIdentity(c.env, {
        email: viewer.email, phone, nombre: viewer.nombre ?? null,
        monday_user_id: viewer.monday_user_id, role: viewer.role, active: 1,
      });
    } catch {
      // UNIQUE constraint en identity.phone: ya está ligado a otra cuenta.
      return c.json({ error: 'Ese teléfono ya está registrado con otra cuenta del portal.' }, 409);
    }
    return c.json({ ok: true, phone });
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
    const dto: VendedorDTO[] = rows.map(r => ({ id: r.monday_user_id, nombre: r.nombre, email: r.email }));
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
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
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
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
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
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    // `?fresh=1` (lo manda el drawer al abrir y al refrescar): relee item +
    // líneas de Monday ANTES de responder. El mirror se enteraba de los cambios
    // solo por webhook (con debounce de 10s que tira las ráfagas) o por el
    // reconcile cada 6h — abrir una oportunidad recién costeada mostraba costos
    // viejos o en 0 (OPP-0795, Efraín 2026-07-30). El scoping por viewer se
    // aplica ANTES: nadie dispara refetches de items que no puede ver.
    if (c.req.query('fresh')) {
      const known = await getItem(c.env, slug, itemId, viewer);
      if (known) await pullFromMonday(c.env, slug, itemId, known.synced_at);
    }

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
    // ¿La ve por ser suya, o porque lidera la zona de su dueño? Reusa el MISMO
    // predicado que el write path (scope 'own'), así la UI nunca ofrece editar
    // algo que el server va a rechazar. La consulta extra solo la paga un líder.
    dto.ownedByViewer = leadsOthers(viewer) ? await ownsItem(c.env, slug, itemId, viewer) : true;
    return c.json(dto);
  });

  app.patch('/api/boards/:slug/items/:id', async c => {
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
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
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);

    // El borrado era la única ruta de /api/boards que no miraba al viewer:
    // cualquier autenticado podía borrar CUALQUIER item de Monday sabiendo su
    // id. Mismo guard de scoping que refresh/updates (dal.getItem), con scope
    // 'own': borrar es escribir, y un líder de zona solo LEE lo de su equipo.
    const viewer = c.get('viewer');
    const row = await getItem(c.env, slug, itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    try {
      await deleteItem(c.env, itemId);
      return c.json({ ok: true });
    } catch {
      return jsonStatus({ ok: false, error: 'No se pudo eliminar' }, 500);
    }
  });

  app.post('/api/boards/:slug/items/:id/refresh', async c => {
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, slug, itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    // Antes solo releía el padre y con un guard de 30s: el botón "Refrescar"
    // no arreglaba costos/cantidades viejos de las LÍNEAS, que es justo lo que
    // el usuario está mirando (Efraín, 2026-07-30). Ahora baja el árbol
    // completo y el guard es la ventana corta compartida con `?fresh=1`.
    await pullFromMonday(c.env, slug, itemId, row.synced_at);
    return c.json({ ok: true, skipped: false });
  });

  // Updates (comments) live on Monday, never mirrored — always a fresh GraphQL
  // call. Reuses getItem's viewer scoping so a vendedor can't read/post on an
  // opportunity that isn't theirs just by knowing its id.
  app.get('/api/boards/:slug/items/:id/updates', async c => {
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, slug, itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const updates = await fetchUpdates(c.env, itemId);
    // Monday nests replies under their parent update; the feed shows them as
    // plain comments (no threading UI), so flatten and re-sort newest first.
    const flat = updates
      .flatMap(u => [u, ...(u.replies ?? [])])
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const dto: UpdateDTO[] = flat.map(u => ({
      id: u.id, body: u.text_body ?? '', author: u.creator?.name ?? 'Monday', createdAt: u.created_at,
      attachments: (u.assets ?? []).map(a => ({ id: a.id, name: a.name, ext: a.file_extension.replace(/^\./, '').toLowerCase() })),
    }));
    return c.json(dto);
  });

  // Same channel backs both the Actualizaciones composer and payment-request
  // buttons (anticipo/saldo) — posting straight to the Monday item's updates
  // feed is exactly where the team already looks for status, per Efraín's brief.
  app.post('/api/boards/:slug/items/:id/updates', async c => {
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, slug, itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<CreateUpdateRequest>();
    const text = (body.body ?? '').trim();
    if (!text) return c.json({ error: 'body is required' }, 400);
    const mentions = (body.mentions ?? []).filter(m => Number.isFinite(m.id) && typeof m.nombre === 'string' && m.nombre.length > 0);

    // Cuando el autor tiene cuenta real de Monday (monday_user_id > 0), la firma
    // se manda como @mention de verdad — Monday la renderiza como link clickeable
    // en vez de solo texto plano. Nativos (id sintético <= 0) no tienen a quién
    // apuntar el mention, así que se quedan con el texto plano de siempre.
    const authorName = viewer.nombre ?? viewer.email;
    const authorMention: MentionInput | null =
      viewer.monday_user_id > 0 && viewer.nombre ? { id: viewer.monday_user_id, nombre: viewer.nombre } : null;
    const signed = authorMention
      ? `${text}\n\n— @${authorMention.nombre} vía Portal CMP`
      : `${text}\n\n— ${authorName} vía Portal CMP`;
    const updateMentions = authorMention ? [...mentions, authorMention] : mentions;
    const u = await createUpdate(c.env, itemId, signed, updateMentions);

    // Notifica a cada compañero mencionado (nunca al propio autor). Best-effort:
    // emitNotification ya se traga sus propios errores; aquí solo protegemos el
    // lookup de identity para que un fallo de D1 no rompa la respuesta del update.
    for (const mention of mentions) {
      if (mention.id === viewer.monday_user_id) continue;
      try {
        const identityRow = await c.env.DB.prepare(
          `SELECT email FROM identity WHERE monday_user_id = ? AND active = 1`,
        ).bind(mention.id).first<{ email: string }>();
        if (!identityRow) continue;
        await emitNotification(c.env, {
          recipientEmail: identityRow.email,
          severity: 'importante',
          kind: 'mention',
          title: `Te mencionaron en ${row.name}`,
          body: text.slice(0, 140),
          boardKey: mentionBoardKey(slug),
          boardId: BOARDS[slug].id,
          itemId,
          actor: viewer.nombre ?? viewer.email,
          dedupeKey: `mention:${u.id}:${identityRow.email}`,
        });
      } catch { /* best-effort — no bloquea la respuesta del update */ }
    }

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
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
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
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
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
