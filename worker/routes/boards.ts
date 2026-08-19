// Rutas genéricas de boards espejados de Monday (list/detail/patch/create/
// refresh/updates) + identidad del viewer y rosters. Movido tal cual desde
// worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Context, ExecutionContext, Hono } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { BOARDS, boardById } from '../../shared/boards';
import type { BoardSlug } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import type {
  ActivityResponse, CreateRequest, CreateResponse, CreateUpdateRequest, ItemDetailDTO, ListResponse,
  MeDTO, MentionUserDTO, UpdateDTO, VendedorDTO, WriteRequest, WriteResponse,
} from '../../shared/dto';
import {
  listItems, getItem, childrenOf, childSlugOf, etagFor, pendingItemIds, listVendedores,
  ownsItem, leadsOthers, hasPendingWrites, upsertIdentity,
} from '../lib/dal';
import { toItemDTO, toColMeta, itemDetailEtag } from '../lib/serialize';
import { canRead, canReadActivity, canReadBoard, canWrite } from '../../shared/visibility';
import { submitWrite, OutboxError } from '../lib/outbox';
import { submitCreate, submitCreateNative, isNativeCreatable, CreateError } from '../lib/createRecord';
import { duplicateVersion, esDraftVigente, hayLineaPendiente, QuoteVersionError, LINE_DEFINING_COLS } from '../lib/quoteVersions';
import { addFileToUpdate, fetchAssetPublicUrls, type MentionInput } from '../lib/monday';
import { borrarItem, BorradoError } from '../lib/itemBorrado';
import { esAjusteInline, registrarAjusteInline } from '../lib/lineaAjustes';
// Los updates de un item nativo (Zona Efrain) viven en D1, no en Monday — estas
// dos funciones eligen el lado por el id, así que la ruta no lo decide.
import {
  listUpdates, postUpdate, attachToNativeUpdate, nativeUpdateAsset,
} from '../lib/nativeUpdates';
import { listActivity, actorNameResolver } from '../lib/activityLog';
import { cachedFetchUsers } from '../lib/rosterCache';
import { getBoardAccess } from '../lib/boardAccess';
import { isZonaPrivadaAdminPermitido } from '../lib/zonas';
import { refetchItem, refetchItemTree } from '../sync';
import { jsonStatus, rejectUnknownQuery } from '../lib/http';
import { contentTypeFor } from '../lib/mime';
import { notifyItemComment } from '../lib/updateNotify';
import { markUpdatesSeen, seenByFor } from '../lib/updateSeen';

// `s` acepta undefined porque c.req.param() lo devuelve así cuando la ruta no
// trae el parámetro — y ahí la respuesta correcta es la misma que para un slug
// inventado: no es un board.
function isBoardSlug(s: string | undefined): s is BoardSlug {
  return s !== undefined && Object.prototype.hasOwnProperty.call(BOARDS, s);
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

/** Editar/borrar una línea de cotización (producto/color/cantidad/
 * embellecimiento) sobre una vigente ya costeada versiona en automático —
 * mismo mecanismo que "+ Nueva versión" (duplicateVersion), pero disparado
 * por el write mismo en vez de requerir que el vendedor lo pida aparte: las
 * versiones son un registro "detrás", nunca un candado para seguir editando
 * (Efraín, 2026-08-14). Incluye Ganada/Perdida (Efraín, 2026-08-14): también
 * se puede versionar ahí. Devuelve el error de duplicateVersion tal cual
 * (p.ej. sin líneas); el caller decide qué hacer.
 *
 * Dos cosas cambiaron el 2026-08-19 ("no podemos perder toda la info"):
 *  - `resetear` viaja hasta duplicateVersion, así que solo la línea que se
 *    tocó regresa a "No iniciado" — el costeo de las demás sobrevive.
 *  - el no-op ya no es "la vigente es un borrador COMPLETO" sino "ya hay
 *    alguna línea pendiente de costeo": con el reset por línea, la vigente
 *    casi nunca queda toda en borrador, y sin esto cada tecleo posterior
 *    archivaría otra versión (V2, V3, V4…). La primera edición sobre una
 *    cotización enteramente costeada archiva la foto de ese estado; mientras
 *    quede trabajo pendiente, las siguientes solo editan. */
async function autoVersionLineaCosteada(
  env: Env, ctx: ExecutionContext, parentItemId: number, viewer: Identity,
  resetear: 'todas' | number[],
): Promise<QuoteVersionError | null> {
  const lineas = await childrenOf(env, 'oportunidades', parentItemId, viewer);
  if (lineas.length === 0 || hayLineaPendiente(lineas)) return null;
  try {
    await duplicateVersion(env, ctx, parentItemId, viewer, { resetear });
    return null;
  } catch (err) {
    if (err instanceof QuoteVersionError) return err;
    throw err;
  }
}

// Ventana en la que un refetch recién hecho se considera "ya fresco" — evita
// pegarle a Monday dos veces cuando el drawer recarga en ráfaga (abrir + write
// + relectura). Corta, porque la garantía que pide el negocio es que al ABRIR
// una oportunidad se vea exactamente lo que Monday tiene (Efraín, 2026-07-30).
const FRESH_WINDOW_MS = 3_000;

/** Trae el item (y sus líneas, si el board tiene subitems) directo de Monday
 * antes de responder. Nunca lanza: si Monday falla o va lento, se sirve el
 * mirror — mejor un dato de hace un rato que un drawer roto. */
/** Devuelve true si de verdad se leyó Monday (false si se saltó por frescura o
 * por writes en vuelo) — el drawer lo usa para poder decir "sincronizado hace
 * unos segundos" con la verdad. */
async function pullFromMonday(env: Env, slug: BoardSlug, itemId: number, syncedAt?: string): Promise<boolean> {
  if (syncedAt && Date.now() - Date.parse(syncedAt) < FRESH_WINDOW_MS) return false;
  const childSlug = childSlugOf(slug);
  // Si el outbox todavía tiene writes en vuelo para este item (o sus líneas),
  // el mirror YA refleja la edición del usuario y Monday puede no haberla
  // recibido todavía — leer "fresh" ahora arriesga pisarla con el valor viejo.
  // Deja que el outbox confirme por su cuenta (ver hasPendingWrites).
  const pending = await hasPendingWrites(env, BOARDS[slug].id, itemId, childSlug ? BOARDS[childSlug].id : undefined);
  if (pending) return false;
  try {
    if (childSlug) await refetchItemTree(env, BOARDS[slug].id, itemId);
    else await refetchItem(env, BOARDS[slug].id, itemId);
    return true;
  } catch { /* Monday caído/rate-limited — seguimos con el mirror */ }
  return false;
}

// Deep-link boardKey (src/lib/routing.ts) para la notificación de mención —
// 'proyectos' vive bajo la ruta 'doctallas' en el front; el resto coincide con el slug.
/** vendedor_ids del mirror (JSON int array) — tolerante a filas viejas/vacías. */
function parseVendedorIds(raw: string | null): number[] {
  try {
    const ids = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(ids) ? ids.map(Number).filter(n => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
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
      zonaEfrainAccess: isZonaPrivadaAdminPermitido(viewer.email),
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
      // "Salir de Monday" (Zona Efrain): oportunidades pide `native` explícito
      // (lo manda el tab de la zona); contactos e instituciones ya no pasan por
      // aquí para decidirlo — submitCreate los deriva solo cuando el creador
      // está en la whitelist (Efraín, 2026-08-18: "que sea algo normal").
      // submitCreateNative revalida la whitelist por su cuenta, así que un
      // `native:true` fuera de lugar 403ea en vez de crear en Monday a escondidas.
      const result = body.native && isNativeCreatable(slug)
        ? await submitCreateNative(c.env, slug, body.name, body.cols, viewer)
        : await submitCreate(c.env, slug, body.name, body.cols, viewer);
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
    // Un filtro que esta ruta no conoce NO puede degradar a "sin filtro": esta
    // lista devuelve el board completo, y quien la usa para decidir sobre qué
    // items actuar (borrar, por ejemplo) se llevaría todo. Ver el porqué en
    // worker/lib/http.ts.
    const queryMala = rejectUnknownQuery(c.req.url, ['q', 'cols']);
    if (queryMala) return queryMala;
    const viewer = c.get('viewer');
    const q = c.req.query('q');

    // ?cols=a,b,c — el cliente declara qué columnas va a pintar y el resto no
    // viaja. El board Oportunidades trae ~34 columnas por item y la lista pinta
    // 8: medido, la respuesta completa son 2.15 MB (158 KB gz) por 628 items, y
    // se re-manda cada vez que CUALQUIER item se sincroniza (el ETag va sobre
    // MAX(synced_at) del board). Esto es solo transporte: `toItemDTO` sigue
    // intersectando contra shared/visibility.ts, así que pedir una columna que
    // el rol no puede leer no la devuelve.
    // Ojo con la diferencia entre AUSENTE y VACÍO: sin `cols` van todas las
    // columnas legibles (lo que necesitan las vistas genéricas), mientras que
    // `?cols=` vacío significa NINGUNA — es lo que piden los selectores de
    // catálogo, que solo pintan `name` (un campo propio del item, no una
    // columna). Por eso se compara contra undefined y no por verdadero/falso.
    const colsParam = c.req.query('cols');
    const only = colsParam !== undefined
      ? new Set(colsParam.split(',').map(s => s.trim()).filter(Boolean))
      : undefined;

    // La proyección entra en el ETag: si no, un cliente que pide 8 columnas y
    // otro que pide todas comparten llave y el 304 le sirve a uno la forma del
    // otro (se quedaría sin columnas, o con la lista vieja).
    const etag = await etagFor(c.env, slug, viewer, colsParam);
    c.header('ETag', etag);
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304);

    const [rows, pending] = await Promise.all([
      listItems(c.env, slug, viewer, q),
      pendingItemIds(c.env, BOARDS[slug].id),
    ]);
    const items = rows.map(r => toItemDTO(r, slug, viewer.role, pending.has(r.item_id), only));
    const body: ListResponse = { board: slug, items, total: items.length, etag };
    return c.json(body);
  });

  app.get('/api/boards/:slug/items/:id', async c => {
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const queryMala = rejectUnknownQuery(c.req.url, ['fresh']);
    if (queryMala) return queryMala;
    const viewer = c.get('viewer');

    // `?fresh=1` (lo manda el drawer al abrir y al refrescar): relee item +
    // líneas de Monday ANTES de responder. El mirror se enteraba de los cambios
    // solo por webhook (con debounce de 10s que tira las ráfagas) o por el
    // reconcile cada 6h — abrir una oportunidad recién costeada mostraba costos
    // viejos o en 0 (OPP-0795, Efraín 2026-07-30). El scoping por viewer se
    // aplica ANTES: nadie dispara refetches de items que no puede ver.
    let verificadoAt: string | null = null;
    if (c.req.query('fresh')) {
      const known = await getItem(c.env, slug, itemId, viewer);
      if (known && await pullFromMonday(c.env, slug, itemId, known.synced_at)) {
        verificadoAt = new Date().toISOString();
      }
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

    // `synced_at` de la fila ahora significa "cuándo cambió el contenido por
    // última vez" (refetch usa skipIfUnchanged, para no invalidarle la lista a
    // todos). Pero el drawer rotula "sincronizado hace …", que es cuándo se
    // VERIFICÓ contra Monday — y acabamos de verificar. Sin esto diría
    // "sincronizado hace 3 días" un segundo después de releer, que asusta y es
    // falso. No entra en el ETag (itemDetailEtag ignora syncedAt), así que no
    // provoca 200s de más.
    if (verificadoAt) dto.syncedAt = verificadoAt;

    // ETag sobre el CONTENIDO ya serializado (no sobre synced_at): abrir una
    // oportunidad dispara dos GETs de este endpoint — uno al espejo y otro con
    // ?fresh=1 tras releer Monday — y los dos devuelven exactamente lo mismo
    // salvo que alguien haya tocado el item en Monday mientras tanto. Medido:
    // ~138 KB cada uno en una oportunidad de 31 líneas, o sea 276 KB para
    // abrir UNA oportunidad. Con esto el segundo se va en 304 y no manda
    // cuerpo, sin tocar la garantía de que sí se relee Monday (Efraín,
    // 2026-08-13). Va sobre el JSON final porque `synced_at` cambia en cada
    // relectura aunque el dato sea idéntico — justo lo que NO queremos que
    // invalide. El rol del viewer ya está dentro del cuerpo (toItemDTO filtra
    // columnas por rol), así que no hace falta meterlo aparte en la llave.
    const etag = await itemDetailEtag(dto);
    c.header('ETag', etag);
    c.header('Cache-Control', 'no-cache'); // revalidar siempre, nunca servir de caché sin preguntar
    // La hora de sincronización viaja aparte porque NO entra en el ETag: así un
    // 304 igual puede refrescar el "sincronizado hace …" del drawer.
    if (dto.syncedAt) c.header('X-Synced-At', dto.syncedAt);
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
    return c.json(dto);
  });

  app.patch('/api/boards/:slug/items/:id', async c => {
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    const body = await c.req.json<WriteRequest>();

    // Cambio de Compras que se asienta como mini versión en vez de versionar —
    // se resuelve aquí (con la línea ANTES del write) y se registra después de
    // que el write salió bien.
    let ajusteCompras: { parentItemId: number; linea: MirrorItem } | null = null;

    if (slug === 'oportunidades_sub' && Object.keys(body.cols).some(id => LINE_DEFINING_COLS.has(id))) {
      // La misma validación por columna que submitWrite hará abajo, pero ANTES
      // de auto-versionar: sin esto, un PATCH que iba a morir en 403 dejaba
      // efectos irreversibles (versión archivada + Etapa Costeo reseteada en
      // todas las líneas + notificación enviada) sin aplicar ningún cambio.
      const rechazada = Object.keys(body.cols).find(id => !canWrite(slug, id, viewer.role));
      if (rechazada) {
        return jsonStatus({ ok: false, pending: false, error: `cannot write ${rechazada}` } satisfies WriteResponse, 403);
      }
      const linea = await getItem(c.env, 'oportunidades_sub', itemId, viewer, 'own');
      if (linea?.parent_item_id != null && !isNativeId(linea.parent_item_id)) {
        // Compras/admin cambiando color/cantidad NO reinician el ciclo de
        // costeo (Efraín, 2026-08-19: "en cotización los de compras siempre
        // pueden modificar colores y cantidades, acuérdate de hacer mini
        // versiones 1.1" + "los admins pueden hacer todo esto igual"):
        // versionar aquí archivaría la vigente y regresaría a costeo la línea
        // que ellos mismos están costeando. Queda como V{n}.{m}, igual que
        // "Ajustar línea". El vendedor sí versiona, sin cambios.
        if (esAjusteInline(viewer.role, Object.keys(body.cols))) {
          ajusteCompras = { parentItemId: linea.parent_item_id, linea };
        } else {
          // Solo esta línea vuelve a costeo: es la única que cambió.
          const versionError = await autoVersionLineaCosteada(c.env, c.executionCtx, linea.parent_item_id, viewer, [itemId]);
          if (versionError) {
            return jsonStatus({ ok: false, pending: false, error: versionError.message } satisfies WriteResponse, versionError.status);
          }
        }
      }
    }

    try {
      const result = await submitWrite(c.env, c.executionCtx, slug, itemId, body.cols, viewer);
      if (ajusteCompras && result.ok) {
        // Best-effort: la mini versión es trazabilidad, no debe convertir un
        // write ya aplicado en un 500. Sin subversión sobre un borrador todavía
        // sin costear (mismo criterio que autoVersionLineaCosteada): ahí no hay
        // vigente que retocar, la línea se está capturando.
        try {
          const lineas = await childrenOf(c.env, 'oportunidades', ajusteCompras.parentItemId, viewer);
          if (lineas.length > 0 && !esDraftVigente(lineas)) {
            await registrarAjusteInline(c.env, ajusteCompras.parentItemId, ajusteCompras.linea, body.cols, viewer);
          }
        } catch { /* la mini versión nunca bloquea el write */ }
      }
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

    if (slug === 'oportunidades_sub' && row.parent_item_id != null && !isNativeId(row.parent_item_id)) {
      // Borrar no descostea nada: la línea se va y las que quedan siguen
      // costeadas igual. La versión archivada conserva la que se borró.
      const versionError = await autoVersionLineaCosteada(c.env, c.executionCtx, row.parent_item_id, viewer, []);
      if (versionError) return jsonStatus({ ok: false, error: versionError.message }, versionError.status);
    }

    // Borra en Monday Y en el mirror (worker/lib/itemBorrado.ts): lo que se
    // quita del portal tiene que desaparecer de Monday, o los flujos que leen
    // Monday directo —costeo, cotización, tallas, OC— siguen viendo la línea
    // (Efraín, 2026-08-19). El mirror se limpia aquí mismo y no se espera al
    // webhook subitem_deleted: con su debounce de 10s más la latencia de
    // Monday la línea seguía en el drawer minutos después (Efraín,
    // 2026-08-13: "tarda muchísimo"). Si el webhook llega luego, su DELETE
    // sobre una fila que ya no existe es un no-op.
    try {
      await borrarItem(c.env, BOARDS[slug].id, itemId, viewer.email);
    } catch (err) {
      if (err instanceof BorradoError) return jsonStatus({ ok: false, error: err.message }, err.status);
      throw err;
    }
    return c.json({ ok: true });
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

    const updates = await listUpdates(c.env, itemId);
    // Monday nests replies under their parent update; the feed shows them as
    // plain comments (no threading UI), so flatten and re-sort newest first.
    const flat = updates
      .flatMap(u => [u, ...(u.replies ?? [])])
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    // "Ojitos": Monday's own `viewers` solo se llena por vistas dentro de
    // Monday.com; se fusiona con lo que el portal registró en D1 (worker/lib/updateSeen.ts)
    // para que el indicador cubra ambas superficies. Dedupe case-insensitive por nombre.
    const portalSeenBy = await seenByFor(c.env, flat.map(u => u.id));
    const dto: UpdateDTO[] = flat.map(u => {
      const names = new Map<string, string>();
      for (const n of portalSeenBy.get(u.id) ?? []) names.set(n.toLowerCase(), n);
      for (const v of u.viewers ?? []) if (v.user?.name) names.set(v.user.name.toLowerCase(), v.user.name);
      return {
        id: u.id, body: u.text_body ?? '', author: u.creator?.name ?? 'Monday', createdAt: u.created_at,
        attachments: (u.assets ?? []).map(a => ({ id: a.id, name: a.name, ext: a.file_extension.replace(/^\./, '').toLowerCase() })),
        seenBy: [...names.values()].sort((a, b) => a.localeCompare(b)),
      };
    });
    return c.json(dto);
  });

  // El "visto" del portal se registra aparte de Monday (ver seenByFor arriba)
  // — el front llama esto tras cargar el feed, marcando lo que acaba de traer.
  // Best-effort: nunca debe romper la lectura del feed.
  app.post('/api/boards/:slug/items/:id/updates/seen', async c => {
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, slug, itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ ids?: string[] }>();
    const ids = (body.ids ?? []).filter(id => typeof id === 'string' && id.length > 0);
    try {
      await markUpdatesSeen(c.env, ids, viewer.email);
    } catch { /* best-effort — nunca bloquea la lectura del feed */ }
    return c.json({ ok: true });
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
    // apuntar el mention, así que se quedan con el texto plano de siempre. Un
    // ITEM nativo (Zona Efrain) tampoco: su feed vive en D1 y ahí el HTML de la
    // mención se vería como HTML crudo — el firmado se queda plano.
    const authorName = viewer.nombre ?? viewer.email;
    const authorMention: MentionInput | null =
      !isNativeId(itemId) && viewer.monday_user_id > 0 && viewer.nombre
        ? { id: viewer.monday_user_id, nombre: viewer.nombre } : null;
    const signed = authorMention
      ? `${text}\n\n— @${authorMention.nombre} vía Portal CMP`
      : `${text}\n\n— ${authorName} vía Portal CMP`;
    const updateMentions = authorMention ? [...mentions, authorMention] : mentions;
    const u = await postUpdate(c.env, BOARDS[slug].id, itemId, signed, updateMentions, {
      email: viewer.email, nombre: viewer.nombre ?? undefined,
    });

    // Notifica el comentario: mencionados (Importantes + WhatsApp) + vendedor
    // dueño y comprador(es) asignado(s) (Importantes, sin WhatsApp) — mismo emisor
    // que usa el webhook `create_update` para los comentarios escritos dentro de
    // monday.com, así los dos caminos rutean igual (worker/lib/updateNotify.ts).
    // El webhook se salta lo que sale de aquí por la firma "vía Portal CMP".
    await notifyItemComment(c.env, {
      slug, itemId, itemName: row.name, updateId: String(u.id), text,
      columnsJson: row.columns, vendedorIds: parseVendedorIds(row.vendedor_ids),
      actorEmail: viewer.email, actorMondayUserId: viewer.monday_user_id, actorName: viewer.nombre,
      mentionIds: mentions.map(m => m.id),
    });

    const dto: UpdateDTO = {
      id: u.id, body: u.text_body ?? signed, author: u.creator?.name ?? (viewer.nombre ?? viewer.email), createdAt: u.created_at,
      attachments: [], seenBy: [],
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

    // El updateId lo manda el cliente: hay que confirmar que pertenece al item
    // recién validado por getItem — sin este check, cualquier id numérico de
    // update de TODO Monday recibía el archivo (el gate de renglón protegía el
    // objeto equivocado). El composer adjunta justo después de crear el update,
    // así que siempre está entre los 50 más recientes que trae fetchUpdates.
    const itemUpdates = await listUpdates(c.env, itemId);
    const belongs = itemUpdates.some(u =>
      u.id === updateId || (u.replies ?? []).some(r => r.id === updateId));
    if (!belongs) return c.json({ error: 'not found' }, 404);

    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);

    // Item nativo (Zona Efrain): no hay update de Monday al cual adjuntar — los
    // bytes van a R2 y el adjunto queda listado en la fila del update.
    if (isNativeId(itemId)) {
      try {
        const asset = await attachToNativeUpdate(c.env, updateId, file);
        return c.json({ ok: true, ...asset });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return jsonStatus({ ok: false, error: 'No se pudo adjuntar el archivo: ' + detail }, 500);
      }
    }

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

    // Adjunto de un update nativo (Zona Efrain): vive en R2, no en Monday.
    // `nativeUpdateAsset` acota la búsqueda al item ya validado — un assetId
    // adivinado no puede sacar el archivo de otro item.
    const nativo = isNativeId(itemId) ? await nativeUpdateAsset(c.env, itemId, assetId) : null;
    if (isNativeId(itemId) && !nativo) return c.json({ error: 'not found' }, 404);

    const url = nativo ? null : (await fetchAssetPublicUrls(c.env, [assetId])).get(assetId);
    if (!nativo && !url) return c.json({ error: 'not found' }, 404);

    const name = c.req.query('name') ?? 'archivo';
    const download = c.req.query('download') === '1';
    // Tipo por extensión (worker/lib/mime.ts): con octet-stream fijo, abrir
    // una imagen adjunta la descargaba en vez de mostrarla.
    const contentType = contentTypeFor(name);

    let bytes: ArrayBuffer;
    if (nativo) {
      const object = await c.env.FILES.get(nativo.key);
      if (!object) return jsonStatus({ error: 'no se pudo obtener el archivo' }, 404);
      bytes = await object.arrayBuffer();
    } else {
      const upstream = await fetch(url!);
      if (!upstream.ok) return jsonStatus({ error: 'no se pudo obtener el archivo' }, 502);
      // Buffer en vez de stream — mismo motivo que cotizacion-pdf: el proxy de
      // Vite en dev se cuelga con una Response streameada sin Content-Length.
      bytes = await upstream.arrayBuffer();
    }
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

  // Log de actividad (worker/lib/activityLog.ts) — mirror filtrado (whitelist
  // propia, no shared/visibility.ts) de activity_logs de Monday, persistido
  // cada 15 min por el delta sync. Para `oportunidades` incluye también sus
  // líneas (oportunidades_sub): un cambio de Precio de Venta vive ahí, no en
  // el item padre. Mismo scoping de lectura que el resto (getItem del propio
  // item alcanza — las líneas son del mismo dueño).
  app.get('/api/boards/:slug/items/:id/activity', async c => {
    const slug = boardFor(c);
    if (!slug) return c.json({ error: 'not found' }, 404);
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    // Historial = solo Compras/Admin (Efraín, 2026-08-18). Se niega el endpoint
    // COMPLETO, no columna por columna: el vendedor tiene permiso de leer sus
    // propias oportunidades, así que sin este gate seguía viendo el rastro de
    // quién editó qué. shared/visibility.ts canReadActivity.
    if (!canReadActivity(viewer.role)) return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, slug, itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const targets = [{ boardId: BOARDS[slug].id, itemId }];
    const childSlug = childSlugOf(slug);
    if (childSlug) {
      const children = await childrenOf(c.env, slug, itemId, viewer);
      for (const child of children) targets.push({ boardId: BOARDS[childSlug].id, itemId: child.item_id });
    }

    const allRows = await listActivity(c.env, targets);
    // Visibilidad por rol ANTES de serializar: la WHITELIST de activityLog.ts
    // es de ruido, no de permisos, y aquí salían columnas `vis: AC` (Costo
    // Distr., Techo, Margen Gob…) con valor previo y nuevo para vendedor y
    // almacén — violando "Ventas: cero costos y cero proveedores" (Efraín,
    // 2026-07-30). Mismo canRead de shared/visibility.ts que ya filtra los
    // DTOs de items; create_pulse/update_name (column_id null o 'name') pasan
    // siempre — el nombre del item ya viaja en todo DTO.
    const rows = allRows.filter(r => {
      if (r.column_id == null || r.column_id === 'name') return true;
      const rowSlug = boardById(r.board_id)?.slug;
      return rowSlug != null && canRead(rowSlug, r.column_id, viewer.role);
    });
    // Roster cacheado (mismo TTL que /api/users) — solo para mostrar nombre en
    // vez de un monday_user_id crudo. Un usuario NATIVO del portal (alta sin
    // Monday, worker/lib/dal.ts upsertIdentity: monday_user_id sintético
    // NEGATIVO) nunca aparece en el roster de Monday — sus ediciones a un item
    // nativo (worker/lib/activityLog.ts recordDirectChanges) se resuelven aparte
    // por `identity`, la única fuente que sí lo conoce.
    //
    // El actor se resuelve por CORREO cuando la fila lo trae (`actor_email`,
    // desde 2026-08-18). El monday_user_id NO identifica a la persona: varias
    // filas de identity pueden compartirlo a propósito ("Actuar en Monday
    // como", worker/routes/admin.ts) y el mapa por id le ponía a cada edición
    // el nombre de la ÚLTIMA fila con ese id — así una edición de admin salió
    // firmada por un vendedor que ni siquiera puede escribir esa columna
    // (encontrado en vivo, precio de venta de una oportunidad nativa).
    // Filas viejas sin correo se quedan con el nombre del roster de Monday (la
    // persona bajo la que se actuó): es lo único que de verdad se sabe de ellas.
    const userIds = [...new Set(rows.map(r => r.user_id).filter((id): id is number => id != null))];
    const actorEmails = [...new Set(rows.map(r => r.actor_email).filter((e): e is string => !!e))];
    const [users, identityRows] = await Promise.all([
      cachedFetchUsers(c.env, 6 * 3600_000).catch(() => []),
      userIds.length > 0 || actorEmails.length > 0
        ? c.env.DB.prepare(
            `SELECT email, monday_user_id, nombre FROM identity
              WHERE monday_user_id IN (${userIds.map(() => '?').join(',') || 'NULL'})
                 OR email IN (${actorEmails.map(() => '?').join(',') || 'NULL'})`,
          ).bind(...userIds, ...actorEmails)
            .all<{ email: string; monday_user_id: number; nombre: string | null }>().then(r => r.results ?? [])
        : Promise.resolve([]),
    ]);
    const actorName = actorNameResolver(users, identityRows);

    const dto: ActivityResponse = {
      entries: rows.map(r => ({
        itemId: String(r.item_id),
        event: r.event,
        columnTitle: r.column_title,
        previousText: r.previous_text,
        text: r.new_text,
        actorName: actorName(r),
        at: r.created_at,
      })),
    };
    return c.json(dto);
  });
}
