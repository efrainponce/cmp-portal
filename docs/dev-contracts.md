# Dev contracts — overnight build 2026-07-14

Non-negotiables for every module:
- **Short, lazy, modular files.** No file > ~150 lines. No new deps beyond `hono`.
- Imports across layers: `shared/*` is isomorphic (no Workers/DOM types). Worker code
  imports `../shared/...`; React code imports `../../shared/...` (path-relative, no aliases).
- Whitelist (`shared/visibility.ts`) is law: untagged column ⇒ never serialized, never written.
- Monday API version pinned `2024-10`. Never fabricate column ids — use `shared/` registries.
- Wrangler quirk: repo `.env` holds a limited CF token that hijacks wrangler auth.
  **Every wrangler command must add `--env-file=.dev.vars`** (OAuth works AND the worker gets its dev vars; `/dev/null` also fixes auth but silently strips MONDAY_API_KEY etc. from `wrangler dev`).

## File ownership (do not touch files owned by another module)

| Module | Owns |
|---|---|
| A sync | `worker/lib/monday.ts`, `worker/lib/canon.ts`, `worker/sync/*`, `scripts/*.mjs`, `shared/column-meta.gen.ts` |
| B api | `worker/index.ts`, `worker/mw/*`, `worker/lib/{dal,serialize,outbox,automations}.ts` |
| C ui | `src/**` only |

Foundation (read-only for all): `shared/{boards,types,visibility,dto}.ts`,
`worker/{env.ts,schema.sql}`, `wrangler.jsonc`.

## Module A exports (worker/sync/index.ts)

```ts
export function syncRoutes(app: Hono<{ Bindings: Env }>): void
// registers POST /api/sync/webhook/:token — challenge echo; verifies :token ===
// env.WEBHOOK_TOKEN; extracts {boardId,itemId|parentItemId}; debounce (skip if
// synced_at < 10s); REFETCH item from Monday (never trust payload); upsert; then
// echo-check pending outbox rows (see hash contract).
export function reconcileBoard(env: Env, slug: BoardSlug): Promise<{upserts:number;deletes:number}>
export function reconcileAll(env: Env): Promise<void>       // all 7 boards + prune deleted + sync_log
export function refetchItem(env: Env, boardId: number, itemId: number): Promise<void> // upsert one
export function confirmOutboxEcho(env: Env, boardId: number, itemId: number, freshColumns: MondayCol[]): Promise<void>
```

Upsert rules: `vendedor_ids` = JSON int array from the board's `authzCols` people columns
(parse `value` → `personsAndTeams[].id`); subitem boards store `parent_item_id`, `vendedor_ids='[]'`
(scoping joins parent). `content_hash` = md5-hex of raw sorted `columns` JSON (reconcile skip + ETag).
Columns stored as JSON array `[{id,type,text,value}]` exactly as returned.

## Hash / echo contract (worker/lib/canon.ts — A owns, B calls)

```ts
export function canonValue(type: string, colVal: {text:string|null,value:string|null} | string): string
// normalized scalar per column type — port of _scalar/_num_str from
// /Users/efrain/Documents/dev/cmp-tallas/api/sync_producto.py.
// Works on BOTH the write shape (raw string user sent) and the read shape
// (Monday {text,value}) so write-hash equals echo-hash.
export function writeHash(cols: Record<string,string>, types: Record<string,string>): string
// md5 over JSON {colId: canonValue} sorted keys
```

Echo flow: B inserts outbox row with `content_hash = writeHash(cols)` → sends mutation
(`change_multiple_column_values`, `create_labels_if_missing:true`) via ctx.waitUntil →
status `sent`. Webhook/refetch later calls `confirmOutboxEcho`: recompute writeHash from
the FRESH item's same colIds; equal ⇒ `confirmed`; different ⇒ `conflict` (mirror keeps
Monday's truth either way). Cron retries `pending|failed` rows (max 5 attempts).

## Module B — routes (worker/index.ts, Hono)

All /api/* (except webhook) behind: mw/access (Cf-Access-Jwt-Assertion verify against
ACCESS_TEAM_DOMAIN/ACCESS_AUD when ENVIRONMENT==='prod'; DEV_EMAIL — plus optional
`X-Dev-Email` header override — ONLY when not prod) → mw/identity (D1 lookup; unknown ⇒ 403).

| Route | Behavior |
|---|---|
| GET /api/me | MeDTO |
| GET /api/boards | `[{slug,title,cols: ColMeta[]}]` — cols filtered by role, order = VISIBILITY key order, meta from shared/column-meta.gen.ts |
| GET /api/boards/:slug/items | ListResponse; `?q=` name ILIKE; ETag = md5(max(synced_at)+count) ⇒ 304 on If-None-Match; vendedor scoping (below) |
| GET /api/boards/:slug/items/:id | ItemDetailDTO + children (via parent board's subitem slug); **404** (not 403) when not owned |
| PATCH /api/boards/:slug/items/:id | body WriteRequest; every col must pass `canWrite(slug,col,role)` else 403; optimistic: merge into mirror `columns` (text=value), outbox insert, waitUntil flush; ⇒ `{ok:true,pending:true}` |
| POST /api/boards/:slug/items/:id/refresh | rate-limit: skip if synced_at<30s; calls A.refetchItem |
| POST /api/oportunidades/:id/cotizacion | automations client → Vercel generate_cotizacion with X-CMP-Secret; 501 if CMP_TALLAS_BASE unset; refetch after |
| POST /api/oportunidades/:id/enviar-costeo | (2026-07-15) valida líneas en D1 (≥1 línea; producto asignado; cantidad>0; color no vacío y ∈ "Colores disponibles" `lookup_mkznm0h3` cuando hay lista) → 422 `{ok:false,errors[]}`; si pasa, deal_stage→"En costeo" vía outbox (trusted write, salta canWrite SOLO para esta columna fija) |
| POST /api/boards/oportunidades/items | (2026-07-15) creación desde el portal — CREATE_FIELDS.oportunidades (8 campos); CREATE_DEFAULTS stampa deal_stage="Nueva oportunidad" server-side (el cliente no puede mandarla) |
| GET /api/vendedores?role=compras | (2026-07-15) filtro por rol (vendedor default) — alimenta el select de Compras del form |
| GET/POST /api/boards/:slug/items/:id/updates | Monday item updates (comments) — live, never mirrored; scoped by the same getItem ownership check; POST backs Actualizaciones + payment-request buttons (2026-07-14) |
| GET /api/admin/identities, PUT /api/admin/identities/:email | admin-only roster CRUD (phone/role/active); 403 for non-admin (2026-07-14) |
| GET /api/admin/monday-users | admin-only Monday user directory (name/email/phone/teams) for Settings import (2026-07-14) |

Scoping (lib/dal.ts): role admin/compras ⇒ all rows. vendedor ⇒ boards with authzCols:
`EXISTS(json_each(vendedor_ids) = me)`; subitem boards: EXISTS parent row owned by me;
boards without authzCols (productos/instituciones/contactos): visible to all non-cliente.
DAL signatures take `viewer: Identity` — handlers cannot bypass.

Serializer (lib/serialize.ts): mirror row → ItemDTO using `readableCols(slug, role)`
only. ColVal = {text, value?, type}. Formula/mirror cols: use `text`/`display_value`.
`pendingWrite` = exists outbox row status pending|sent for item.

`export default { fetch: app.fetch, scheduled }` — scheduled: reconcileAll + outbox retry.
Non-/api routes fall through to env.ASSETS.fetch(request).

## Ahorro de llamadas a Monday (2026-07-15)

- **reconcileAll gated**: 1 query ligera (`boards{id updated_at}`) para los 7 boards;
  solo se pagina un board si su `updated_at` cambió vs `board_state` (D1) o si el
  último full pass tiene >24h. Estado en tabla `board_state` (schema.sql).
- **flushOutbox agrupado**: filas pendientes del mismo item se funden en UNA
  `change_multiple_column_values` + UN refetch (la fila más reciente gana por columna).
- **encodeColumnValue**: status = `{label}` singular; `{labels:[...]}` es SOLO dropdown
  (bug visto en vivo: status con shape de dropdown asigna un label arbitrario).
- Creación de líneas de oportunidad (WA bot) en paralelo con `Promise.all`.

## Module C — UI (src/**)

- `src/lib/api.ts`: typed fetch of the routes above; ETag-aware polling helper (5s,
  If-None-Match, 304 ⇒ skip render).
- Views (reuse existing tokens/ + components/ scaffold; state-based nav in Sidebar):
  Oportunidades (list→detail with líneas incl. Precio de Venta, tabs scaffold exists),
  Post-venta (=proyectos + subelementos, embellishment zones read-only),
  Costeo (oportunidades_sub cost columns grouped by Etapa Costeo — server already
  strips cols for non-authorized roles; render whatever cols come),
  Productos, Instituciones, Contactos (generic table with search).
- Generic `BoardTable` renders from `GET /api/boards` ColMeta + ItemDTO.cols — one
  component powers productos/instituciones/contactos; status chips use meta label colors.
- Editable fields: where `ColMeta.id` ∈ writable set returned by /api/boards
  (`w?:true` per col), inline edit → PATCH → show `guardado ✓ → sincronizado ✓`
  via pendingWrite polling. SyncIndicator "sincronizado hace X min" from syncedAt.
- Keep mock `src/data/oportunidades.ts` as dev fallback when /api unreachable.

## Local run

```
npm run build && npx wrangler dev --env-file=.dev.vars   # serves UI + API on :8787
```
D1 local: `npx wrangler d1 execute cmp-portal --local --file=worker/schema.sql --env-file=.dev.vars`;
hydration: `node --env-file=.env scripts/hydrate.mjs --exec`. Worker secrets/dev vars in `.dev.vars`
(MONDAY_API_KEY, WEBHOOK_TOKEN, ENVIRONMENT=dev, DEV_EMAIL). wrangler.jsonc ships ENVIRONMENT=prod →
a bare deploy is fail-closed (Access JWT required; DEV_EMAIL ignored).
