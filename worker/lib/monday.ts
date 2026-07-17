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

/** POST a GraphQL query to Monday. Retries on 429/5xx (transport or field-level
 * rate limit) with backoff; throws on any other errors[]. */
export async function gql(
  env: Env,
  query: string,
  variables?: Record<string, unknown>,
): Promise<any> {
  const maxRetries = 4;
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
 * fetchItem) in one round-trip, ready for upsertItem(). */
export async function createItem(
  env: Env,
  boardId: number,
  itemName: string,
  columnValues: Record<string, unknown>,
): Promise<MondayItem> {
  const query = `mutation($b:ID!,$n:String!,$cv:JSON){ create_item(board_id:$b,item_name:$n,column_values:$cv,create_labels_if_missing:true){ ${ITEM_FIELDS} } }`;
  const data = await gql(env, query, { b: String(boardId), n: itemName, cv: JSON.stringify(columnValues) });
  const raw = data?.create_item;
  return { ...raw, column_values: normalizeCols(raw.column_values ?? []) };
}

/** Create a subitem under a parent item. Same full item shape back. */
export async function createSubitem(
  env: Env,
  parentItemId: number,
  itemName: string,
  columnValues: Record<string, unknown>,
): Promise<MondayItem> {
  const query = `mutation($p:ID!,$n:String!,$cv:JSON){ create_subitem(parent_item_id:$p,item_name:$n,column_values:$cv,create_labels_if_missing:true){ ${ITEM_FIELDS} } }`;
  const data = await gql(env, query, { p: String(parentItemId), n: itemName, cv: JSON.stringify(columnValues) });
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
}

/** Updates (comments) on an item, newest first. */
export async function fetchUpdates(env: Env, itemId: number): Promise<MondayUpdate[]> {
  const query = `query($id:[ID!]){ items(ids:$id){ updates(limit:50){ id text_body created_at creator{name} assets{id name file_extension} } } }`;
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
