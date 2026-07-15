# Plan 1 — Data layer / API-call minimization

Status: **approved 2026-07-13 ("launch the plans") — implemented overnight 2026-07-14**

## Recommendation in one line

Cloudflare **D1 as a read mirror of Monday**, hydrated by Monday webhooks (as invalidation
pokes, never trusted as data) plus a cron reconciliation sweep. The portal reads **only D1**;
page loads cost **zero Monday API calls**. No KV in phase 1. No Supabase.

## Why D1 over Supabase

| | D1 | Supabase |
|---|---|---|
| Access from Worker | Native binding, no network hop, no connection pool | HTTPS + service key over public internet |
| Secrets surface | None added (binding) | One more credential to leak/rotate |
| Cost at our scale | Free tier: 5 GB, 5M reads/day — we're ~2,000 rows total | Free tier OK but egress + cold Postgres for no benefit |
| Ops | Same `wrangler deploy`, same dashboard | Second vendor, second dashboard, second auth story |
| What we'd give up | Postgres features: RLS, realtime, pgvector | — |

We need none of the Postgres features: RLS is irrelevant because the Worker is the *only*
reader and enforces authz itself; realtime push is unnecessary for a read mirror where
seconds-to-minutes staleness is acceptable. The dataset (564 oportunidades + ~47 proyectos +
259 subelementos + 1,224 productos + subitem lines) is a few thousand rows — SQLite territory
by two orders of magnitude. **Stay on Cloudflare.**

KV is deferred: a D1 point-read from a binding is single-digit ms; adding a KV hot cache now
buys nothing and adds an invalidation problem. Revisit only if p95 latency says otherwise.

## Boards mirrored

| Board | ID | Items today |
|---|---|---|
| Oportunidades | 18395657596 | 564 |
| Oportunidades subitems (product lines — pricing lives here) | 18395657607 | ~1–10 per opp |
| Proyectos | 18395657594 | 47 |
| Subelementos de Proyectos (Proyectos subitems) | 18395657609 | 259 |
| Productos | 18395657591 | 1,224 |

## Schema (D1)

One generic mirror table instead of a table per board. This workspace's columns churn
constantly (visible in the board history); a generic mirror + code-level serializers keyed
off the column map (see plan 2) survives column additions without migrations.

```sql
CREATE TABLE items (
  board_id       INTEGER NOT NULL,
  item_id        INTEGER NOT NULL,
  parent_item_id INTEGER,            -- set for subitem boards
  name           TEXT NOT NULL,
  group_id       TEXT,
  vendedor_ids   TEXT NOT NULL DEFAULT '[]',  -- JSON array of monday user ids, extracted
                                              -- at upsert from deal_owner + secundarios /
                                              -- multiple_person_mm0hrnqq. THE authz column.
  monday_updated_at TEXT,
  synced_at      TEXT NOT NULL,
  columns        TEXT NOT NULL,      -- full raw column_values JSON (internal fields included;
                                     -- whitelist is applied at serialization, never here)
  PRIMARY KEY (board_id, item_id)
);
CREATE INDEX idx_items_parent ON items(parent_item_id);
CREATE INDEX idx_items_board  ON items(board_id);

CREATE TABLE identity (          -- single source, shared with future WhatsApp surface
  email          TEXT PRIMARY KEY,
  phone          TEXT UNIQUE,
  monday_user_id INTEGER NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('vendedor','compras','admin','cliente')),
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- 'webhook' | 'reconcile' | 'manual'
  board_id INTEGER, item_id INTEGER,
  ok INTEGER NOT NULL, detail TEXT, at TEXT NOT NULL
);
```

Seller list query: `WHERE board_id = ? AND EXISTS (SELECT 1 FROM json_each(items.vendedor_ids) WHERE value = ?)` — the authenticated monday_user_id is injected by the Worker, never taken from the client.

## Hydration

### Path A — webhooks (freshness: seconds)

Monday board webhooks on all five boards for `create_item`, `change_column_value`,
`change_name`, `item_deleted`, `create_subitem`, `change_subitem_column_value`
→ `POST /api/sync/webhook/<random-token>` on the Worker.

Security model: **the webhook is a poke, not a payload.** We answer the `challenge`
handshake, extract only `{boardId, itemId}` (or `parentItemId` for subitem events), and
**refetch the item from Monday ourselves** before upserting. A forged webhook can only make
us refresh true data. Defense: unguessable URL token + refetch-don't-trust. No signature
verification needed for board webhooks (that machinery is app-webhook-only).

Debounce: Monday fires one event per changed column, so a costeo session on one item can
fire 20 events in a minute. On receipt, skip refetch if `synced_at` is < 10 s old for that
item (cheap D1 check). No Durable Objects, no Queues — volumes don't justify them; upgrade
path exists if they ever do.

### Path B — cron reconciliation (safety net)

Wrangler cron trigger, **every 6 h**: walk each board with `items_page` (500/page,
`column_values` included), upsert everything, delete rows whose item_id no longer exists
(webhook `item_deleted` events are the flakiest — this is the backstop), write a `sync_log`
row with counts. Full sweep is ≤ ~10 GraphQL pages across all five boards.

### Path C — manual refresh (trust)

"Actualizar" button per oportunidad → refetch that one item + its subitems, rate-limited
(1 per item per 30 s). Cheap, and gives sellers confidence the number is current.

### After triggering an automation

When the portal triggers `generate_cotizacion` (Vercel), the Worker refetches the
oportunidad after the call returns (the endpoint is synchronous and updates Monday before
responding), so the new PDF link appears immediately.

## Staleness tolerance

Sellers read prices *after* CEO approval happens in Monday; the portal is not the approval
surface. Webhook path makes changes visible in ~2–5 s; worst case (missed webhook) is
bounded at 6 h by reconciliation; manual refresh bounds it at one click. Every screen shows
`sincronizado hace X min` from `synced_at` so staleness is visible, never silent.

## Monday complexity / rate-limit budget

Monday's budget is ~10M complexity points per minute per token (2024-10). Our worst minute:

| Source | Cost |
|---|---|
| Page loads | **0** — D1 only |
| Webhook burst (say 30 events/min after debounce → ~10 refetches) | ~10 single-item queries, trivial complexity each |
| 6-h reconcile sweep | ≤ ~10 `items_page` calls, spread over seconds |
| Nightly full + webhook overlap | still < 1–2 % of one minute's budget |

There is no realistic path to throttling. The token also stays clear for the existing
Vercel automations, which share it.

## Cache invalidation

There is none to manage: D1 *is* the cache, and it is written only by the sync paths above.
The client uses plain SWR (`stale-while-revalidate` against our own API) with short max-age;
no client cache ever needs busting because the API always serves current D1 state.

## Write path + content hashing (added 2026-07-14, from the sync_producto discussion)

The mirror gains a write path modeled on cmp-tallas' `sync_producto.py` hash guard:

```
UI edit → PATCH /api/... (~20 ms)
  ├─ validate against WRITABLE whitelist (visibility.ts `w` tags, per role)
  ├─ optimistic upsert into D1 + outbox row {cols, content_hash, status: pending}
  └─ respond → UI shows the value instantly (perceived 0 s)
     └─ ctx.waitUntil: flush outbox → Monday mutation → status: sent
        └─ webhook echo → refetch → canonical hash matches → confirmed ✓ (~2 s)
```

- **Echo suppression:** the outbox stores a hash of the *canonicalized* written values
  (`canon.ts` ports `_scalar`/`_num_str`); the webhook refetch recomputes the same hash
  from Monday's read shape over the same column ids. Match ⇒ our own write, confirmed.
- **Conflict detection:** mismatch ⇒ concurrent Monday edit; Monday wins in the mirror,
  the outbox row is marked `conflict` for UI surfacing.
- **Reconcile skip:** `items.content_hash` (raw columns JSON hash) lets the 6-h sweep
  skip untouched rows.
- **Near-live reads:** list endpoints emit an aggregate ETag; the client polls with
  If-None-Match every ~5 s — unchanged = 304 at ~zero cost.
- Failed Monday writes stay `pending` in the outbox (≤5 retries via cron);
  per-item UI state: guardado ✓ → sincronizado ✓ / ⚠ reintentando.

Boards mirrored grew from 5 to 7: + Instituciones **18395657597** (3,125 items) and
Contactos **18395657595** (650 items). "Post-venta" = Proyectos + Subelementos;
"Costeo" = the costing columns of Oportunidades subitems (role-gated view, not a board).

## What this unlocks later

Compras module, Client portal, and the WhatsApp surface all read the same mirror through
the same DAL — they add **zero** Monday API load. The WhatsApp intake writes will go through
the existing Vercel endpoints or scoped Worker mutations, not through the mirror.
