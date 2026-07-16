-- D1 mirror schema (plan 1 + write-path outbox). Idempotent.
CREATE TABLE IF NOT EXISTS items (
  board_id       INTEGER NOT NULL,
  item_id        INTEGER NOT NULL,
  parent_item_id INTEGER,
  name           TEXT NOT NULL,
  group_id       TEXT,
  vendedor_ids   TEXT NOT NULL DEFAULT '[]',
  monday_updated_at TEXT,
  synced_at      TEXT NOT NULL,
  content_hash   TEXT NOT NULL DEFAULT '',
  columns        TEXT NOT NULL,
  PRIMARY KEY (board_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_items_board  ON items(board_id);

CREATE TABLE IF NOT EXISTS identity (
  email          TEXT PRIMARY KEY,
  phone          TEXT UNIQUE,
  nombre         TEXT,
  monday_user_id INTEGER NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('vendedor','compras','admin','cliente')),
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS outbox (   -- portal->Monday writes: optimistic D1 first
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id     INTEGER NOT NULL,
  item_id      INTEGER NOT NULL,
  cols         TEXT NOT NULL,         -- JSON {colId: value} as sent to Monday
  content_hash TEXT NOT NULL,         -- canonical hash of the written state (echo check)
  author_email TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','sent','confirmed','conflict','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_item ON outbox(board_id, item_id, status);

CREATE TABLE IF NOT EXISTS wa_conversations (  -- WhatsApp bot: one row per phone
  phone      TEXT PRIMARY KEY,                 -- normalized (last 10 digits)
  messages   TEXT NOT NULL DEFAULT '[]',       -- Anthropic MessageParam[] JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_processed (      -- WhatsApp webhook dedupe (Meta retries)
  msg_id TEXT PRIMARY KEY,
  at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_conversations (  -- Portal chat bubble: one row per user
  email      TEXT PRIMARY KEY,
  messages   TEXT NOT NULL DEFAULT '[]',              -- Anthropic MessageParam[] JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_state (  -- reconcile gate: skip boards whose updated_at didn't move
  board_id          INTEGER PRIMARY KEY,
  monday_updated_at TEXT NOT NULL,
  reconciled_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- webhook|reconcile|manual|outbox
  board_id INTEGER, item_id INTEGER,
  ok INTEGER NOT NULL, detail TEXT, at TEXT NOT NULL
);

-- Inventario (2026-07-15): native D1 feature, no Monday board behind it — quantity-based,
-- fungible stock (no unit serialization), see shared/inventory.ts for the DTOs/rules.
CREATE TABLE IF NOT EXISTS warehouses (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL DEFAULT 'bodega' CHECK(type IN ('bodega','person')),
  location TEXT,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL CHECK(type IN ('Entrada','Salida','Transferencia','Consolidación')),
  product_name    TEXT NOT NULL,
  quantity        REAL NOT NULL CHECK(quantity >= 0),
  origin_id       INTEGER REFERENCES warehouses(id),
  destination_id  INTEGER REFERENCES warehouses(id),
  captured_by     TEXT NOT NULL,
  folio           TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Entrada: solo destino. Salida: solo origen. Transferencia: ambos (una sola fila,
  -- nunca dos). Consolidación: corrección de conteo físico, bidireccional — exactamente
  -- uno de los dos (destino = ajuste al alza, origen = ajuste a la baja; quantity siempre
  -- guarda la magnitud, nunca negativo — la dirección la da cuál columna se usó).
  CHECK (
    CASE type
      WHEN 'Entrada'       THEN origin_id IS NULL     AND destination_id IS NOT NULL
      WHEN 'Salida'        THEN origin_id IS NOT NULL AND destination_id IS NULL
      WHEN 'Transferencia' THEN origin_id IS NOT NULL AND destination_id IS NOT NULL
      WHEN 'Consolidación' THEN (origin_id IS NOT NULL) <> (destination_id IS NOT NULL)
    END
  )
);
CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at);
CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_name);

-- Per-movement +/- rows; callers SUM(inbound) grouped by (product_name, warehouse_id)
-- to get net stock (worker/lib/inventory.ts:listStock).
CREATE VIEW IF NOT EXISTS stock AS
SELECT
  product_name,
  destination_id  AS warehouse_id,
  SUM(quantity)   AS inbound
FROM movements
WHERE destination_id IS NOT NULL
GROUP BY product_name, destination_id

UNION ALL

SELECT
  product_name,
  origin_id       AS warehouse_id,
  -SUM(quantity)  AS inbound
FROM movements
WHERE origin_id IS NOT NULL
GROUP BY product_name, origin_id;

-- Cotización versions (2026-07-15): historial de líneas de producto superadas por una
-- oportunidad. La vigente NUNCA se lee de aquí — se arma en caliente desde `items`
-- (mirror de Monday); esta tabla solo archiva instantáneas de versiones anteriores
-- (worker/lib/quoteVersions.ts). Vive solo en D1, no se sincroniza a Monday.
CREATE TABLE IF NOT EXISTS cotizacion_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL,        -- Oportunidad
  version    INTEGER NOT NULL,        -- 1, 2, 3… por oportunidad
  label      TEXT NOT NULL,           -- "V1", "V2"…
  folio      TEXT,                    -- folio_cotizacion cuando aplica (hoy solo V1)
  total_fmt  TEXT,
  products   TEXT NOT NULL,           -- snapshot JSON, ver quoteVersions.ts QuoteLine[]
  created_at TEXT NOT NULL,
  UNIQUE (item_id, version)
);
CREATE INDEX IF NOT EXISTS idx_cotversions_item ON cotizacion_versions(item_id);

-- Seed: sales team members who carry samples, as "person" warehouses (confirmed against
-- active identity rows 2026-07-15: Nicolas Rosas Gonzalez, Ray Rodriguez, RUBEN ZEUS
-- CORDERO NUÑEZ, César Emilio Díaz Trujillo, Livia A. Val Rguez). Idempotent re-run guard
-- since this file has no unique constraint on (name,type) to hang INSERT OR IGNORE off of.
INSERT INTO warehouses (name, type) SELECT 'Nicolás', 'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Nicolás' AND type = 'person');
INSERT INTO warehouses (name, type) SELECT 'Ray',     'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Ray'     AND type = 'person');
INSERT INTO warehouses (name, type) SELECT 'Zeus',    'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Zeus'    AND type = 'person');
INSERT INTO warehouses (name, type) SELECT 'Cesar',   'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Cesar'   AND type = 'person');
INSERT INTO warehouses (name, type) SELECT 'Liv',     'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Liv'     AND type = 'person');

-- Cache genérico de respuestas de APIs externas (2026-07-16). Hoy solo guarda el
-- roster de usuarios de Monday para /api/users y /api/admin/monday-users
-- (worker/lib/rosterCache.ts). Se crea lazy en runtime (CREATE TABLE IF NOT
-- EXISTS, mismo patrón que board_state) — está aquí solo como documentación.
CREATE TABLE IF NOT EXISTS api_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
