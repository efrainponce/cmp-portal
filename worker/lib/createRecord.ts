// worker/lib/createRecord.ts — synchronous item creation (no outbox: there's no
// item_id to key on until Monday responds). Mirrors outbox.ts's validation shape.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { CreateResponse } from '../../shared/dto';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { CREATE_DEFAULTS, CREATE_FIELDS, isCreatable } from '../../shared/createFields';
import { COLUMN_META } from '../../shared/column-meta.gen';
import { encodeColumnValue } from './columnEncode';
import { createItem } from './monday';
import { upsertItem } from '../sync';
import { reserveNativeId } from './nativeSeq';
import { assertNoNativeLink, NativeLinkError } from './nativeItems';
import { rawHash, type RawColumn } from './canon';
import { cachedFetchUsers } from './rosterCache';
import { isZonaPrivadaAdminPermitido } from './zonas';
import { stampInstitucionDeContacto, OPP_CONTACTO_REL } from './nativeMirrors';
import { dealStageValue } from '../../shared/dealStages';
import { boardRelationValue } from './outbox';
import { recordDirectChanges } from './activityLog';

export class CreateError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const CREATOR_ROLES: Identity['role'][] = ['vendedor', 'compras', 'admin'];

const CONTACTO_VENDEDOR = 'multiple_person_mm03vqwx';   // Contactos → Vendedor

export async function submitCreate(
  env: Env,
  slug: string,
  name: string,
  cols: Record<string, string>,
  viewer: Identity,
): Promise<CreateResponse> {
  if (!isCreatable(slug)) throw new CreateError(404, 'not found');
  // Zona Efrain (Efraín, 2026-08-18): los contactos e instituciones que dan de
  // alta las 3 personas de la whitelist nacen NATIVOS, sin casilla ni forma
  // aparte — "que sea algo normal". Es lo que cierra la fuga: la oportunidad ya
  // era invisible en Monday, pero su Contacto (nombre, correo, teléfono) vivía
  // allá a la vista de cualquiera con acceso al board. Dentro del portal se
  // comportan como cualquier otro registro (Contactos sigue scopeado por
  // Vendedor); lo único que cambia es que no existen del lado de Monday.
  // Oportunidades NO entra aquí: ahí la decisión es explícita del tab de la
  // zona (`native: true`, ver la ruta de creación).
  if ((slug === 'contactos' || slug === 'instituciones') && isZonaPrivadaAdminPermitido(viewer.email)) {
    return submitCreateNative(env, slug, name, cols, viewer);
  }
  if (!CREATOR_ROLES.includes(viewer.role)) throw new CreateError(403, 'cannot create');
  // Usuario dado de alta desde el portal (sin persona real en Monday, ver
  // dal.createNativeIdentity): el auto-estampado de Vendedor en Contactos
  // (abajo) mandaría un id inventado a la columna de personas de Monday.
  if (viewer.monday_user_id <= 0) throw new CreateError(403, 'tu usuario no está vinculado a Monday; no puedes crear registros todavía');
  if (!name?.trim()) throw new CreateError(400, 'name is required');

  const fields = CREATE_FIELDS[slug];
  const allowedIds = new Set(fields.map(f => f.id));
  const colIds = Object.keys(cols ?? {});
  for (const id of colIds) {
    if (!allowedIds.has(id)) throw new CreateError(400, `cannot set ${id}`);
  }
  const boardMeta = COLUMN_META[slug] ?? {};
  for (const f of fields) {
    if (f.required && f.id !== 'name' && !cols?.[f.id]?.trim()) {
      throw new CreateError(400, `${boardMeta[f.id]?.title ?? f.id} es obligatorio`);
    }
  }

  const columnValues: Record<string, unknown> = {};
  for (const id of colIds) {
    if (id === 'name') continue; // item_name is a separate mutation argument
    const type = boardMeta[id]?.type ?? 'text';
    // Un registro NATIVO no existe del lado de Monday: ligarlo desde un item
    // REAL mandaría un id inventado en la mutación (Zona Efrain, 2026-08-18).
    // Mejor un error claro que un enlace roto en silencio.
    try {
      assertNoNativeLink(type, id, cols[id], boardMeta[id]?.title);
    } catch (err) {
      if (err instanceof NativeLinkError) throw new CreateError(400, err.message);
      throw err;
    }
    const encoded = encodeColumnValue(type, cols[id]);
    if (encoded !== '') columnValues[id] = encoded;
  }
  // Server-stamped defaults (e.g. oportunidades start at "Nueva oportunidad") —
  // outside CREATE_FIELDS, so a client can neither set nor override them.
  for (const [id, raw] of Object.entries(CREATE_DEFAULTS[slug] ?? {})) {
    columnValues[id] = encodeColumnValue(boardMeta[id]?.type ?? 'text', raw);
  }
  // Contactos está scopeado por Vendedor (shared/boards.ts authzCols), así que un
  // contacto sin vendedor sería invisible para el vendedor que lo acaba de crear
  // (y para el bot de WhatsApp, que no manda la columna). Si el cliente no la
  // mandó, se estampa al creador.
  if (slug === 'contactos' && !cols?.[CONTACTO_VENDEDOR]?.trim() && viewer.monday_user_id) {
    columnValues[CONTACTO_VENDEDOR] = encodeColumnValue(
      boardMeta[CONTACTO_VENDEDOR]?.type ?? 'people', String(viewer.monday_user_id),
    );
  }

  const board = BOARDS[slug];
  let item;
  try {
    // maxRetries:1 (no el default 4) — el front espera este round-trip para
    // navegar al item nuevo con su id real de Monday (ver comentario en
    // createItem, worker/lib/monday.ts).
    item = await createItem(env, board.id, name.trim(), columnValues, { maxRetries: 1 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CreateError(502, `monday create failed: ${detail}`);
  }

  await upsertItem(env, slug, item);
  return { ok: true, id: item.id };
}

/** Boards que pueden nacer 100% en D1. Contactos e Instituciones se sumaron el
 * 2026-08-18 (Efraín: "eso es vital también"): la oportunidad nativa ya era
 * invisible en Monday, pero su Contacto apuntaba a un item REAL — o sea que el
 * negocio se ocultaba y *con quién* se negocia, no. */
export type NativeCreatableSlug = 'oportunidades' | 'contactos' | 'instituciones';

export function isNativeCreatable(slug: string): slug is NativeCreatableSlug {
  return slug === 'oportunidades' || slug === 'contactos' || slug === 'instituciones';
}

/** "Salir de Monday" (Zona Efrain): crea un registro que nace y vive 100% en
 * D1 — mismo shape de fila que un item de Monday (`items`, mismas columnas por
 * id), pero con un item_id sintético (shared/nativeId.ts) que nunca se manda a
 * Monday. Solo la whitelist de Zona Efrain (worker/lib/zonas.ts) puede crearlos. */
export async function submitCreateNative(
  env: Env,
  slug: NativeCreatableSlug,
  name: string,
  cols: Record<string, string>,
  viewer: Identity,
): Promise<CreateResponse> {
  if (!isZonaPrivadaAdminPermitido(viewer.email)) {
    throw new CreateError(403, 'no autorizado para crear en Zona Efrain');
  }
  if (!name?.trim()) throw new CreateError(400, 'name is required');

  const fields = CREATE_FIELDS[slug];
  const allowedIds = new Set(fields.map(f => f.id));
  const colIds = Object.keys(cols ?? {});
  for (const id of colIds) {
    if (!allowedIds.has(id)) throw new CreateError(400, `cannot set ${id}`);
  }
  const boardMeta = COLUMN_META[slug] ?? {};
  for (const f of fields) {
    if (f.required && f.id !== 'name' && !cols?.[f.id]?.trim()) {
      throw new CreateError(400, `${boardMeta[f.id]?.title ?? f.id} es obligatorio`);
    }
  }

  const allValues: Record<string, string> = { ...cols };
  for (const [id, raw] of Object.entries(CREATE_DEFAULTS[slug] ?? {})) {
    allValues[id] = raw;
  }

  const rawColumns: RawColumn[] = [];
  for (const [id, raw] of Object.entries(allValues)) {
    if (id === 'name' || !raw?.trim()) continue;
    const type = boardMeta[id]?.type ?? 'text';
    const trimmed = raw.trim();
    // deal_stage: todo el pipeline decide la etapa por `.index`, no por el
    // label (shared/dealStages.ts dealStageValue) — un item nativo nunca
    // recibe el echo de Monday que normalmente lo rellena.
    if (id === 'deal_stage') {
      rawColumns.push({ id, type, text: trimmed, value: JSON.stringify(dealStageValue(trimmed)) });
      continue;
    }
    // board_relation (ej. deal_contact): encodeColumnValue da el shape de
    // ESCRITURA ({item_ids}) que espera la mutación de Monday — dal.ts
    // (linkedItemId) y ocProveedorPdf.ts esperan el shape de LECTURA
    // ({linked_item_ids}, ids como string) que normalmente rellena el echo.
    if (type === 'board_relation') {
      const text = await nativeDisplayText(env, type, id, trimmed);
      rawColumns.push({ id, type, text, value: JSON.stringify(boardRelationValue(trimmed)) });
      continue;
    }
    const value = encodeColumnValue(type, trimmed);
    if (value === '') continue;
    const text = await nativeDisplayText(env, type, id, trimmed);
    rawColumns.push({ id, type, text, value: JSON.stringify(value) });
  }

  const board = BOARDS[slug];
  const vendedorIds = new Set<number>();
  for (const colId of board.authzCols ?? []) {
    const n = Number(allValues[colId]);
    if (Number.isFinite(n)) vendedorIds.add(n);
  }
  // Mismo criterio que el camino real (arriba): un contacto sin Vendedor sería
  // invisible hasta para quien lo acaba de crear — se estampa al creador.
  if (slug === 'contactos' && vendedorIds.size === 0 && viewer.monday_user_id > 0) {
    vendedorIds.add(viewer.monday_user_id);
    rawColumns.push({
      id: CONTACTO_VENDEDOR, type: 'people',
      text: viewer.nombre ?? viewer.email,
      value: JSON.stringify({ personsAndTeams: [{ id: viewer.monday_user_id, kind: 'person' }] }),
    });
  }

  const itemId = await reserveNativeId(env);
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO items (board_id, item_id, parent_item_id, name, group_id, vendedor_ids, monday_updated_at, synced_at, content_hash, columns)
       VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      board.id, itemId, name.trim(), JSON.stringify([...vendedorIds]),
      now, now, rawHash(rawColumns), JSON.stringify(rawColumns),
    )
    .run();

  // La Institución de la Oportunidad es un ESPEJO del Contacto ligado: en un
  // item nativo nadie la calcula, y checkCosteo la exige (worker/lib/
  // nativeMirrors.ts). Se resuelve aquí mismo, al nacer con contacto.
  const contactoId = slug === 'oportunidades' ? Number(cols?.[OPP_CONTACTO_REL]) : NaN;
  if (Number.isFinite(contactoId) && contactoId > 0) {
    try { await stampInstitucionDeContacto(env, itemId, contactoId); } catch { /* best-effort */ }
  }

  // Sin Monday del otro lado no hay activity_logs que jalar (worker/lib/
  // activityLog.ts) — se registra directo, best-effort.
  try {
    await recordDirectChanges(env, slug, [{
      boardId: board.id, itemId, event: 'create_pulse',
      columnId: null, columnTitle: null, previousText: null, newText: name.trim(),
      userId: viewer.monday_user_id, userEmail: viewer.email,
    }]);
  } catch { /* best-effort */ }

  return { ok: true, id: String(itemId) };
}

/** Texto de display para una columna nativa recién creada — Monday lo resuelve
 * del lado suyo (id de persona → nombre, etc.); acá no hay a quién preguntarle,
 * así que se resuelve con lo que ya tenemos en D1/roster cacheado. */
async function nativeDisplayText(env: Env, type: string, colId: string, raw: string): Promise<string> {
  if (type === 'people') {
    const id = Number(raw);
    if (!Number.isFinite(id)) return raw;
    const users = await cachedFetchUsers(env, 6 * 3600_000);
    return users.find(u => Number(u.id) === id)?.name ?? raw;
  }
  // board_relations que el portal sabe resolver contra su propio mirror:
  // Oportunidad → Contacto, y Contacto → Institución (la que alimenta el
  // espejo "Institución" de la oportunidad, ver worker/lib/nativeMirrors.ts).
  const RELACION_A_BOARD: Record<string, BoardSlug> = {
    deal_contact: 'contactos',
    contact_account: 'instituciones',
  };
  const relBoard = RELACION_A_BOARD[colId];
  if (relBoard) {
    const relId = Number(raw);
    if (!Number.isFinite(relId)) return raw;
    const row = await env.DB
      .prepare(`SELECT name FROM items WHERE board_id = ? AND item_id = ?`)
      .bind(BOARDS[relBoard].id, relId)
      .first<{ name: string }>();
    return row?.name ?? raw;
  }
  // status/dropdown ya llegan como el label mismo; date/text sin transformar.
  return raw;
}
