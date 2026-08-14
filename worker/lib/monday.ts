// Thin Monday.com GraphQL client (Module A owns). API pinned 2025-04 (2024-10
// deprecated Feb 2026; also required for board_relation writes to CRM-template
// "Account" relation columns like Contactos' contact_account — see canon.ts).
import type { Env } from '../env';

const MONDAY_URL = 'https://api.monday.com/v2';
const API_VERSION = '2025-04';

export interface MondayCol { id: string; type: string; text: string | null; value: string | null }

export interface MondayItem {
  id: string;
  name: string;
  updated_at: string;
  group: { id: string } | null;
  parent_item: { id: string } | null;
  column_values: MondayCol[];
}

/** Texto de una columna dentro de un `MondayCol[]` en vivo (item recién leído
 * de la API, no el mirror) — antes duplicado idéntico en cotizacion.ts, oc.ts,
 * proyectoTallas.ts y costeo.ts. */
export function cvText(cols: MondayCol[], id: string): string {
  return cols.find(c => c.id === id)?.text?.trim() ?? '';
}

export function cvNum(cols: MondayCol[], id: string): number {
  const n = Number(cvText(cols, id).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Primer person id de una columna people ({personsAndTeams:[...]}) sobre un
 * `MondayCol[]` en vivo — mismo shape que notify.ts's personIdsFromColumns,
 * pero sobre el blob crudo en vez del mirror. Antes duplicado idéntico en
 * cotizacion.ts, oc.ts y proyectoTallas.ts. */
export function firstPersonId(cols: MondayCol[], id: string): number | null {
  const raw = cols.find(c => c.id === id)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { personsAndTeams?: Array<{ id: number | string; kind?: string }> };
    const person = (parsed.personsAndTeams ?? []).find(p => (p.kind ?? 'person') === 'person');
    return person ? Number(person.id) : null;
  } catch {
    return null;
  }
}

interface RawCol {
  id: string; type: string; text: string | null; value: string | null;
  display_value?: string | null;
  linked_item_ids?: string[];
}

// mirror/formula/board_relation columns carry no usable text/value via the generic
// fields (Monday leaves both null) — display_value + linked_item_ids stand in.
function normalizeCols(raw: RawCol[]): MondayCol[] {
  return raw.map(c => ({
    id: c.id,
    type: c.type,
    text: (c.display_value !== undefined ? c.display_value : c.text) ?? null,
    value: c.linked_item_ids !== undefined ? JSON.stringify({ linked_item_ids: c.linked_item_ids }) : (c.value ?? null),
  }));
}

const COL_FIELDS = `id type text value ... on MirrorValue{display_value} ... on FormulaValue{display_value} ... on BoardRelationValue{display_value linked_item_ids}`;
const ITEM_FIELDS = `id name updated_at group{id} parent_item{id} column_values{${COL_FIELDS}}`;

// Monday enforces a *field-level* per-minute budget on top of the transport-level
// 429 (surfaces as a 200 response carrying errors[] with extensions.status_code
// 429 / code FIELD_MINUTE_RATE_LIMIT_EXCEEDED — hit constantly by bulk paging
// over column_values{display_value} during hydrate/reconcile). Honor its
// retry_in_seconds hint; it's the same "slow down" signal as an HTTP 429.
function rateLimitWaitMs(errors: Array<{ extensions?: { status_code?: number; code?: string; retry_in_seconds?: number } }>): number | null {
  const hit = errors.find(e => e.extensions?.status_code === 429 || e.extensions?.code === 'FIELD_MINUTE_RATE_LIMIT_EXCEEDED');
  if (!hit) return null;
  return Math.min((hit.extensions?.retry_in_seconds ?? 10) * 1000 + 250, 30_000);
}

// Contador de calls a Monday por día (Efraín preguntó si el reconcile+delta
// nuevos se comen el tope diario del plan — antes no había ni un solo número
// real, puro estimado). Best-effort: nunca debe tumbar la call real de Monday
// si D1 falla. `tableReady` cachea el CREATE TABLE por isolate (evita pagarlo
// en cada una de las miles de calls que hace un full reconcile).
let tableReady = false;
async function trackApiCall(env: Env): Promise<void> {
  try {
    if (!tableReady) {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS monday_api_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0)`,
      ).run();
      tableReady = true;
    }
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO monday_api_usage (day, count) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET count = count + 1`,
    ).bind(day).run();
  } catch { /* nunca bloquear la call real por esto */ }
}

/** POST a GraphQL query to Monday. Retries on 429/5xx (transport or field-level
 * rate limit) with backoff; throws on any other errors[]. */
export async function gql(
  env: Env,
  query: string,
  variables?: Record<string, unknown>,
  opts?: { maxRetries?: number },
): Promise<any> {
  const maxRetries = opts?.maxRetries ?? 4;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(MONDAY_URL, {
      method: 'POST',
      headers: {
        Authorization: env.MONDAY_API_KEY,
        'Content-Type': 'application/json',
        'API-Version': API_VERSION,
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    });
    await trackApiCall(env);
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
      continue;
    }
    const json: any = await res.json();
    if (json.errors) {
      const wait = rateLimitWaitMs(json.errors);
      if (wait !== null && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw new Error(`Monday GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  }
}

export interface ItemsPage { cursor: string | null; items: MondayItem[] }

/** Board-level updated_at for many boards in ONE call — Monday bumps it on any
 * item/column change, so an unchanged value lets reconcile skip paging the
 * whole board (the webhook path covers real-time updates anyway). */
export async function fetchBoardsUpdatedAt(env: Env, boardIds: number[]): Promise<Map<number, string>> {
  const query = `query($ids:[ID!]){ boards(ids:$ids){ id updated_at } }`;
  const data = await gql(env, query, { ids: boardIds.map(String) });
  const out = new Map<number, string>();
  for (const b of data?.boards ?? []) out.set(Number(b.id), String(b.updated_at ?? ''));
  return out;
}

export interface ActivityLogEntry {
  boardId: number; entity: string; event: string; userId: string; createdAt: string; data: string;
}

/** Eventos de actividad de todas las boards dadas, en UNA sola call (cada Board
 * trae sus propios activity_logs ya filtrados por rango). Dos consumidores:
 * el delta sync (worker/sync/delta.ts, solo usa `data.pulse_id` para saber qué
 * refetchear) y el log de actividad por item (worker/lib/activityLog.ts, usa
 * todo lo demás). `from`/`to` van en ISO8601; `created_at` de la RESPUESTA es
 * un timestamp propietario de Monday (ticks de 100ns desde epoch Unix — NO
 * ISO, NO epoch en ms; verificado en vivo 2026-08-14 contra la fecha real de
 * un evento reciente), por eso viaja crudo — worker/lib/activityLog.ts lo
 * convierte con BigInt (Number pierde precisión pasado 2^53). */
export async function fetchActivityLogs(
  env: Env, boardIds: number[], from: string, to: string,
): Promise<ActivityLogEntry[]> {
  const query = `query($ids:[ID!],$from:ISO8601DateTime,$to:ISO8601DateTime){
    boards(ids:$ids){ id activity_logs(from:$from,to:$to,limit:200){ entity event user_id created_at data } } }`;
  const data = await gql(env, query, { ids: boardIds.map(String), from, to });
  const out: ActivityLogEntry[] = [];
  for (const b of data?.boards ?? []) {
    const boardId = Number(b.id);
    for (const log of b.activity_logs ?? []) {
      out.push({ boardId, entity: log.entity, event: log.event, userId: log.user_id, createdAt: log.created_at, data: log.data });
    }
  }
  return out;
}

/** One page of items for a board (100/page). Pass `cursor` from the previous call to continue. */
export async function fetchItems(env: Env, boardId: number, cursor?: string | null): Promise<ItemsPage> {
  const query = `query($board:[ID!],$cursor:String){ boards(ids:$board){ items_page(limit:100,cursor:$cursor){
    cursor items{ ${ITEM_FIELDS} } } } }`;
  const data = await gql(env, query, { board: [String(boardId)], cursor: cursor ?? null });
  const page = data?.boards?.[0]?.items_page;
  const items: MondayItem[] = (page?.items ?? []).map((it: any) => ({
    ...it,
    column_values: normalizeCols(it.column_values ?? []),
  }));
  return { cursor: page?.cursor ?? null, items };
}

/** Create a new item on a board. Returns the full item shape (same fields as
 * fetchItem) in one round-trip, ready for upsertItem(). `opts.maxRetries`
 * defaults to gql()'s 4 — pass a lower cap for synchronous, user-waited
 * callers (createRecord.ts, duplicateOportunidad.ts) so a rate-limit hit
 * doesn't stack up to 4 exponential-backoff retries on top of the user
 * staring at a spinner; same reasoning as createSubitem below
 * (Efraín, 2026-07-30 — "crear oportunidad se tarda mucho"). */
export async function createItem(
  env: Env,
  boardId: number,
  itemName: string,
  columnValues: Record<string, unknown>,
  opts?: { maxRetries?: number; groupId?: string },
): Promise<MondayItem> {
  const query = `mutation($b:ID!,$n:String!,$cv:JSON,$g:String){ create_item(board_id:$b,item_name:$n,column_values:$cv,create_labels_if_missing:true,group_id:$g){ ${ITEM_FIELDS} } }`;
  const data = await gql(env, query, { b: String(boardId), n: itemName, cv: JSON.stringify(columnValues), g: opts?.groupId ?? null }, opts);
  const raw = data?.create_item;
  return { ...raw, column_values: normalizeCols(raw.column_values ?? []) };
}

/** Mueve un item a otro grupo del mismo board — mismo patrón que deleteItem
 * (mutación angosta, sin refetch propio; el llamador decide si refresca). */
export async function moveItemToGroup(env: Env, itemId: number, groupId: string): Promise<void> {
  const query = `mutation($id:ID!,$g:String!){ move_item_to_group(item_id:$id,group_id:$g){ id } }`;
  await gql(env, query, { id: String(itemId), g: groupId });
}

/** Delete an item (works for subitems too). The mirror row is NOT touched here —
 * callers follow up with refetchItemTree, which purges subitems gone from Monday. */
export async function deleteItem(env: Env, itemId: number): Promise<void> {
  const query = `mutation($id:ID!){ delete_item(item_id:$id){ id } }`;
  await gql(env, query, { id: String(itemId) });
}

/** Create a subitem under a parent item. Same full item shape back.
 * maxRetries capped at 1 (not the default 4) — this is a synchronous, user-
 * waited call ("+ Agregar línea"); a rate-limit hit with the default backoff
 * can add 10s+ per attempt, so we bound the worst case instead of stacking
 * up to 4 retries (Efraín, 2026-07-20 — reported ~15s adds). */
export async function createSubitem(
  env: Env,
  parentItemId: number,
  itemName: string,
  columnValues: Record<string, unknown>,
): Promise<MondayItem> {
  const query = `mutation($p:ID!,$n:String!,$cv:JSON){ create_subitem(parent_item_id:$p,item_name:$n,column_values:$cv,create_labels_if_missing:true){ ${ITEM_FIELDS} } }`;
  const data = await gql(env, query, { p: String(parentItemId), n: itemName, cv: JSON.stringify(columnValues) }, { maxRetries: 1 });
  const raw = data?.create_subitem;
  return { ...raw, column_values: normalizeCols(raw.column_values ?? []) };
}

export interface MondayUpdateAsset { id: string; name: string; file_extension: string }

export interface MondayUpdate {
  id: string;
  text_body: string;
  created_at: string;
  creator: { name: string } | null;
  assets: MondayUpdateAsset[];
  // Threaded replies (e.g. a Monday-native "responder" on someone else's comment)
  // — same shape as a top-level update, so callers can flatten them into one feed.
  replies?: MondayUpdate[];
  // Solo se llena cuando alguien lo ve DENTRO de Monday.com (nunca por una
  // lectura vía API, que es como el portal sirve el feed) — boards.ts lo
  // fusiona con worker/lib/updateSeen.ts para cubrir ambas superficies.
  viewers?: { user: { name: string } | null }[];
}

const UPDATE_FIELDS = `id text_body created_at creator{name} assets{id name file_extension} viewers{user{name}}`;
// Monday's `Reply` type (unlike `Update`) has no `assets` field in API 2025-04 — replies can't carry attachments.
const REPLY_FIELDS = `id text_body created_at creator{name} viewers{user{name}}`;

/** Updates (comments) on an item, newest first, each with its own replies thread
 * (Monday keeps replies nested under their parent update, not as siblings). */
export async function fetchUpdates(env: Env, itemId: number): Promise<MondayUpdate[]> {
  const query = `query($id:[ID!]){ items(ids:$id){ updates(limit:50){ ${UPDATE_FIELDS} replies{ ${REPLY_FIELDS} } } } }`;
  const data = await gql(env, query, { id: [String(itemId)] });
  return data?.items?.[0]?.updates ?? [];
}

export interface MentionInput { id: number; nombre: string }

const MONDAY_DOMAIN = 'https://mexicanaproteccion.monday.com'; // single-tenant workspace, fixed

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Monday's `body` field is HTML — a real @-mention (the kind that fires a
// notification) has to be this exact anchor shape, verified live against the
// account's own create_update output (class/data-mention-* are what its
// renderer keys off, not just the @name text). We splice it in for each
// mention marker (`@Full Name`) the composer left in the escaped text; any
// marker that got mangled by editing just falls back to plain "@Name" text.
function buildUpdateBody(text: string, mentions: MentionInput[]): string {
  let body = escapeHtml(text);
  // Longest name first — this account has prefix collisions (e.g. "Efrain Ponce"
  // vs "Efrain Ponce Salinas"), so the shorter marker must not consume part of
  // a longer one still waiting to be matched.
  const sorted = [...mentions].sort((a, b) => b.nombre.length - a.nombre.length);
  for (const m of sorted) {
    const marker = `@${escapeHtml(m.nombre)}`;
    const tag = `<a class="user_mention_editor router" href="${MONDAY_DOMAIN}/users/${m.id}" data-mention-type="User" data-mention-id="${m.id}" target="_blank" rel="noopener noreferrer">${marker}</a>`;
    body = body.replace(marker, tag);
  }
  return body;
}

/** Post an update (comment) on an item — the portal's channel for solicitudes
 * de pago y avisos, so they land where the rest of the team already works.
 * `mentions` (optional) tags teammates so Monday notifies them directly. */
export async function createUpdate(env: Env, itemId: number, body: string, mentions: MentionInput[] = []): Promise<MondayUpdate> {
  const query = `mutation($id:ID!,$b:String!){ create_update(item_id:$id,body:$b){ id text_body created_at creator{name} } }`;
  const finalBody = mentions.length ? buildUpdateBody(body, mentions) : body;
  const data = await gql(env, query, { id: String(itemId), b: finalBody });
  return data?.create_update;
}

export interface MondayUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  teams: { name: string }[];
}

/** Non-guest users with their teams — feeds the admin Settings import. */
export async function fetchUsers(env: Env): Promise<MondayUser[]> {
  const query = `query{ users(kind:non_guests,limit:200){ id name email phone teams{name} } }`;
  const data = await gql(env, query);
  return data?.users ?? [];
}

/** Un usuario puntual por id (DocuSeal necesita su email para armar el
 * submitter) — sin pagear fetchUsers' página completa de 200 solo para
 * resolver a uno. `null` si el id no existe o no trae email. */
export async function fetchUserById(env: Env, userId: number): Promise<{ id: string; name: string; email: string } | null> {
  const query = `query($ids:[ID!]!){ users(ids:$ids){ id name email } }`;
  const data = await gql(env, query, { ids: [String(userId)] });
  const user = data?.users?.[0];
  return user?.email ? { id: String(user.id), name: user.name, email: user.email } : null;
}

/** Notificación NATIVA de Monday (la campanita) sobre un item — a diferencia de
 * createUpdate (comentario visible), esta es privada para `userId`. Usada por
 * flujos que necesitan avisarle a alguien aunque no abra el portal (p.ej.
 * "ningún producto tiene precio" en worker/lib/cotizacion.ts). Best-effort por
 * convención del caller — esta función sí propaga el error. */
export async function createNotification(env: Env, userId: number, targetItemId: number, text: string): Promise<void> {
  const query = `mutation($userId:ID!,$targetId:ID!,$text:String!){ create_notification(user_id:$userId,target_id:$targetId,text:$text,target_type:Project){ text } }`;
  await gql(env, query, { userId: String(userId), targetId: String(targetItemId), text });
}

/** Single item by id (used by refetchItem — webhook/refresh never trust the payload). */
export async function fetchItem(env: Env, itemId: number): Promise<MondayItem | null> {
  const query = `query($id:[ID!]){ items(ids:$id){ ${ITEM_FIELDS} } }`;
  const data = await gql(env, query, { id: [String(itemId)] });
  const raw = data?.items?.[0];
  if (!raw) return null;
  return { ...raw, column_values: normalizeCols(raw.column_values ?? []) };
}

/** Uploads a file to a file-type column — Monday's dedicated multipart endpoint
 * (v2/file), separate from the JSON /v2 endpoint every other mutation uses.
 * public_url is a presigned S3 link that expires in ~1h — fine for the upload
 * response's immediate preview, but callers must re-resolve it later via
 * fetchAssetPublicUrls rather than caching this one. */
export async function addFileToColumn(
  env: Env,
  itemId: number,
  columnId: string,
  file: Blob,
  filename: string,
): Promise<{ id: string; name: string; publicUrl: string }> {
  const form = new FormData();
  form.append(
    'query',
    `mutation($file: File!){ add_file_to_column(item_id:${itemId}, column_id:"${columnId}", file:$file){ id name public_url } }`,
  );
  form.append('variables[file]', file, filename);
  const res = await fetch('https://api.monday.com/v2/file', {
    method: 'POST',
    headers: { Authorization: env.MONDAY_API_KEY, 'API-Version': API_VERSION },
    body: form,
  });
  const json: any = await res.json();
  if (json.errors) throw new Error(`Monday file upload error: ${JSON.stringify(json.errors)}`);
  const a = json.data.add_file_to_column;
  return { id: a.id, name: a.name, publicUrl: a.public_url };
}

/** Attaches a file to an existing update (comment) — Monday's `add_file_to_update`
 * mutation, same v2/file multipart endpoint as addFileToColumn. The update
 * itself must already exist (create it first via createUpdate). */
export async function addFileToUpdate(
  env: Env,
  updateId: string,
  file: Blob,
  filename: string,
): Promise<{ id: string; name: string; publicUrl: string }> {
  const form = new FormData();
  form.append(
    'query',
    `mutation($file: File!){ add_file_to_update(update_id:${updateId}, file:$file){ id name public_url } }`,
  );
  form.append('variables[file]', file, filename);
  const res = await fetch('https://api.monday.com/v2/file', {
    method: 'POST',
    headers: { Authorization: env.MONDAY_API_KEY, 'API-Version': API_VERSION },
    body: form,
  });
  const json: any = await res.json();
  if (json.errors) throw new Error(`Monday file upload error: ${JSON.stringify(json.errors)}`);
  const a = json.data.add_file_to_update;
  return { id: a.id, name: a.name, publicUrl: a.public_url };
}

/** Fresh presigned public_url per asset id (batch) — resolve on demand, not at
 * write time, since the S3 link Monday hands back expires in ~1h. */
export async function fetchAssetPublicUrls(env: Env, assetIds: string[]): Promise<Map<string, string>> {
  if (assetIds.length === 0) return new Map();
  const query = `query($ids:[ID!]!){ assets(ids:$ids){ id public_url } }`;
  const data = await gql(env, query, { ids: assetIds });
  const out = new Map<string, string>();
  for (const a of data?.assets ?? []) out.set(String(a.id), a.public_url);
  return out;
}

/** Item + ALL its subitems in one round-trip — for flows where cmp-tallas
 * rewrites the subitems wholesale (import_tallas) or snapshots columns on them
 * (validar_costeo) and the mirror must catch up immediately. */
export async function fetchItemWithSubitems(
  env: Env,
  itemId: number,
): Promise<{ item: MondayItem; subitems: MondayItem[] } | null> {
  const query = `query($id:[ID!]){ items(ids:$id){ ${ITEM_FIELDS} subitems{ ${ITEM_FIELDS} } } }`;
  const data = await gql(env, query, { id: [String(itemId)] });
  const raw = data?.items?.[0];
  if (!raw) return null;
  const norm = (it: any): MondayItem => ({ ...it, column_values: normalizeCols(it.column_values ?? []) });
  return { item: norm(raw), subitems: (raw.subitems ?? []).map(norm) };
}
