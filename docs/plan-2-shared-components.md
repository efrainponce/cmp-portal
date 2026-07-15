# Plan 2 — Shared components / module architecture

Status: **awaiting approval — do not implement yet**

## Shape of the system

**One repo, one Worker, one deploy.** The current scaffold (Vite + React app served as
Workers static assets via `wrangler.jsonc`) is already the right shape — note this is
Workers-with-assets, the successor to Cloudflare Pages, and we should stay on it rather
than moving to Pages (Pages is in maintenance mode; Access works the same in front of a
Worker).

Future modules — Compras, Client Portal — are **routes in this same app**, gated by role.
The WhatsApp intake is **routes on this same Worker** (`/wa/webhook`), not a separate
deployable, so it shares every server primitive with zero packaging machinery. We only
split into workspace packages if a genuinely separate deployable ever appears; until then,
monorepo tooling is cost without benefit.

```
cmp-portal/
├── shared/                      # isomorphic: imported by worker + UI
│   ├── column-map.ts            # GENERATED — board/column ids + visibility tags (see below)
│   ├── types.ts                 # Oportunidad, LineaProducto, EmbellecimientoSpec, Identity…
│   └── dto.ts                   # role-scoped DTO types the API returns
├── worker/
│   ├── index.ts                 # router (Hono)
│   ├── mw/access.ts             # Cloudflare Access JWT verification → email
│   ├── mw/identity.ts           # email/phone → {monday_user_id, role} from D1
│   ├── lib/monday.ts            # gql client: version pin, retry, complexity logging
│   ├── lib/serialize.ts         # column-map-driven whitelist serializers
│   ├── lib/dal.ts               # D1 repos (listForVendedor, getConLineas, …)
│   ├── lib/automations.ts       # typed client for Vercel cmp-tallas endpoints
│   └── sync/                    # webhook handler + cron reconciler (plan 1)
├── src/                         # React app
│   ├── tokens/ components/     # design system (already scaffolded from the mockup)
│   ├── lib/api.ts               # typed fetch client over our DTOs
│   └── modules/vendedor/        # module 1 screens — thin composition only
├── scripts/introspect-boards.ts # regenerates column-map, fails CI on drift
└── docs/monday-column-map.md    # human-readable version + whitelist (this review)
```

## The seven shared primitives

Every future module is a consumer of these; none may bypass them.

### 1. Auth — Cloudflare Access middleware (`mw/access.ts`)
Access (Google OAuth) sits in front of the whole Worker. The middleware **re-verifies** the
`Cf-Access-Jwt-Assertion` JWT on every request against the team's public keys + AUD tag
(defense in depth — never assume the edge did it), and yields the verified email. Local dev
uses an explicit `DEV_EMAIL` env override that refuses to activate in production.

### 2. Identity resolution (`mw/identity.ts`)
`{email | phone} → {monday_user_id, role}` from the D1 `identity` table (plan 1 schema).
Email comes from Access today; phone is the WhatsApp key tomorrow — same table, same
function, which is why phone is in the schema from day 1. Unknown identity → 403 with a
friendly "pide acceso" screen. Seeded by a script from `users { id name email }` (the
`resolve_vendedor` pattern in cmp-tallas), roles assigned manually.

### 3. Column map + visibility registry (`shared/column-map.ts`) — the whitelist as data
One generated file: every board, every column id, its type, and a visibility tag:

```ts
{ board: 'oportunidades_sub', id: 'numeric_mkzneg3d', title: 'Precio de Venta C/U',
  type: 'numbers', vis: ['vendedor'] }
{ board: 'oportunidades_sub', id: 'numeric_mm0bph99', title: 'Costo Distr. C/U',
  type: 'numbers', vis: [] }        // internal — no role ever sees it
```

`scripts/introspect-boards.ts` re-pulls board schemas and diffs against the committed map;
CI fails on drift, so **a new Monday column is invisible to every role until a human tags
it**. Fail-closed. The proposed tags are in `docs/monday-column-map.md` — **needs your
sign-off before implementation.**

### 4. Whitelist serializers (`lib/serialize.ts`)
The only code that turns a mirrored Monday item into an API response. Driven entirely by
the column map + the viewer's role — there is no hand-written "pick fields" code to get
wrong in module 2. Client Portal later = add a `'cliente'` tag to the map, done.

### 5. Data-access layer (`lib/dal.ts`)
D1 repos over the mirror (plan 1). Authz is *inside* the repo signatures —
`OportunidadRepo.listFor(mondayUserId)` — so a handler physically cannot ask for
someone else's rows. Non-owned detail requests return **404, not 403** (no existence leak).

### 6. Monday proxy client (`lib/monday.ts`)
Port of `_monday_gql` / `_cv` / `_cv_text` from cmp-tallas to TS: API version pinned to
`2024-10`, token from Worker secrets only, retry with backoff, complexity logged from the
response. Used **only** by the sync layer and introspection script. The browser can never
send GraphQL — stronger than whitelisting query shapes: the client speaks only our REST
DTOs, and the whitelist is enforced at serialization.

### 7. Automations client (`lib/automations.ts`)
Typed wrappers for the existing Vercel endpoints — `generateCotizacion(itemId, {dryRun})`
etc. — matching their observed contract (`POST {item_id}`, always-200 with
`{ok, skipped?, reason?}`). We trigger, never reimplement.

> **Security finding to fix alongside this:** the cmp-tallas endpoints currently accept
> unauthenticated POSTs — anyone with the URL can generate cotizaciones. The client will
> send an `X-CMP-Secret` header from day 1, and a ~5-line check should be added to each
> Vercel handler (separate small PR to cmp-tallas). Flagging for your approval.

## UI library

Keep growing what the mockup scaffold started: `tokens/` (colors, typography, effects) +
`components/` (core, layout, navigation, forms) as the app-agnostic kit, plus portal-domain
components built on it — `EtapaBadge` (label colors come from the column map's status
settings, i.e. Monday's own hex values), `PricingTable`, `OportunidadCard`, `SyncIndicator`
("sincronizado hace X min"), `EmbellecimientoZonas`. Module screens compose these and call
`lib/api.ts`; a module that needs new primitives contributes them down into the kit.

## Embellishments — structured from day 1 in the types

Monday already has discrete per-zone columns on Subelementos (Espalda, Frente derecho/
izquierdo, Mangas/costados, Etiquetas, Otros) — but they're free text inside each zone.
`shared/types.ts` defines the target structure now:

```ts
interface EmbellecimientoSpec {
  zona: 'espalda' | 'frente_derecho' | 'frente_izquierdo' | 'manga_derecha'
      | 'manga_izquierda' | 'etiqueta_fabricante' | 'etiqueta_propiedad' | 'otros';
  aplicacion: 'bordado' | 'serigrafia' | 'parche' | 'sublimado' | 'otro';
  contenido: string;            // texto o descripción del arte
  colores?: string[];
  dimensiones?: string;
  referenciaImagen?: string;    // asset id
}
```

Module 1 renders zones read-only from the existing columns. The future capture surface
(Compras module / WhatsApp) writes through this type — discrete fields, never a raw string —
serialized into the per-zone columns in a fixed format. The type existing now is what stops
module 3 from reinventing it as free text.

## Phase-1 API surface (all seller-scoped server-side)

| Route | Returns |
|---|---|
| `GET /api/me` | `{email, nombre, role}` |
| `GET /api/oportunidades` | list, whitelist-serialized, `WHERE vendedor_ids ∋ me` |
| `GET /api/oportunidades/:id` | detail + líneas with pricing; 404 if not mine |
| `POST /api/oportunidades/:id/refresh` | manual re-sync (rate-limited) |
| `POST /api/oportunidades/:id/cotizacion` | proxy to Vercel `generate_cotizacion` *(optional in phase 1 — confirm)* |

## What module N costs after this

Compras module = tag columns `'compras'` in the map + new screens + `listFor` variant.
Client portal = `'cliente'` tags + screens. WhatsApp = identity-by-phone (already built) +
`/wa/webhook` route reusing DAL + automations client. No new auth, no new data layer, no
new Monday code — which is the entire point.
