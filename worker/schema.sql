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
  role           TEXT NOT NULL CHECK (role IN ('vendedor','compras','admin','almacen')),
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
  kind TEXT NOT NULL,                 -- webhook|reconcile|manual|outbox|http
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

-- Ajustes de línea sin versión (2026-07-31, worker/lib/lineaAjustes.ts): "Ajustar
-- línea" (cambiar producto/color/embellecimiento/cantidad en el sitio, o dividir
-- una línea en dos) para retoques que NO cambian el precio — no pasa por costeo,
-- no toca deal_stage, funciona incluso con la Oportunidad Ganada. No es una
-- versión real: solo trazabilidad, rotulada V{version}.{subversion} en la UI.
-- Se crea lazy en runtime, mismo patrón que producto_propuesto — está aquí solo
-- como documentación.
CREATE TABLE IF NOT EXISTS cotizacion_ajustes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id          INTEGER NOT NULL,   -- Oportunidad
  version          INTEGER NOT NULL,   -- versión mayor vigente al momento del ajuste
  subversion       INTEGER NOT NULL,   -- 1, 2, 3… por (item_id, version)
  linea_id         INTEGER NOT NULL,   -- subitem que quedó con el cambio
  linea_origen_id  INTEGER,            -- si fue "dividir", el subitem del que se partió
  resumen          TEXT NOT NULL,
  campos_antes     TEXT NOT NULL,
  campos_despues   TEXT NOT NULL,
  viewer_email     TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cotajustes_item_version ON cotizacion_ajustes(item_id, version);

-- Seed: sales team members who carry samples, as "person" warehouses (confirmed against
-- active identity rows 2026-07-15: Nicolas Rosas Gonzalez, Ray Rodriguez, RUBEN ZEUS
-- CORDERO NUÑEZ, César Emilio Díaz Trujillo, Livia A. Val Rguez). Idempotent re-run guard
-- since this file has no unique constraint on (name,type) to hang INSERT OR IGNORE off of.
INSERT INTO warehouses (name, type) SELECT 'Nicolás', 'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Nicolás' AND type = 'person');
INSERT INTO warehouses (name, type) SELECT 'Ray',     'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Ray'     AND type = 'person');
INSERT INTO warehouses (name, type) SELECT 'Zeus',    'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Zeus'    AND type = 'person');
INSERT INTO warehouses (name, type) SELECT 'Cesar',   'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Cesar'   AND type = 'person');
INSERT INTO warehouses (name, type) SELECT 'Liv',     'person' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Liv'     AND type = 'person');

-- Bodegas físicas (2026-07-18): Mérida y CDMX, primeros almacenes tipo 'bodega'.
INSERT INTO warehouses (name, type) SELECT 'Mérida', 'bodega' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'Mérida' AND type = 'bodega');
INSERT INTO warehouses (name, type) SELECT 'CDMX',   'bodega' WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'CDMX'   AND type = 'bodega');

-- Cache genérico de respuestas de APIs externas (2026-07-16). Hoy solo guarda el
-- roster de usuarios de Monday para /api/users y /api/admin/monday-users
-- (worker/lib/rosterCache.ts). Se crea lazy en runtime (CREATE TABLE IF NOT
-- EXISTS, mismo patrón que board_state) — está aquí solo como documentación.
CREATE TABLE IF NOT EXISTS api_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Accesos por equipo a boards del sidebar (2026-07-18, shared/boardAccess.ts). Presencia
-- de fila = acceso permitido; 'admin' no vive aquí (bypass hardcoded en
-- worker/lib/boardAccess.ts — nunca queda sin acceso por accidente desde la UI).
-- Esto solo declutters el nav: la protección real de datos sigue en
-- shared/visibility.ts (columnas) + worker/lib/dal.ts (scoping de renglones).
CREATE TABLE IF NOT EXISTS role_board_access (
  role       TEXT NOT NULL CHECK (role IN ('vendedor','compras','almacen')),
  board_key  TEXT NOT NULL,
  PRIMARY KEY (role, board_key)
);

-- Seed inicial — ver shared/boardAccess.ts DEFAULT_BOARD_ACCESS para el criterio.
INSERT OR IGNORE INTO role_board_access (role, board_key) VALUES
  ('vendedor', 'oportunidades'), ('vendedor', 'oportunidades_web'),
  ('vendedor', 'doctallas'), ('vendedor', 'ordenescompra'), ('vendedor', 'ejecucion'), ('vendedor', 'logistica'),
  ('vendedor', 'productos'), ('vendedor', 'instituciones'), ('vendedor', 'contactos'),
  ('compras', 'oportunidades'), ('compras', 'oportunidades_web'),
  ('compras', 'costeo'), ('compras', 'validacion'),
  ('compras', 'doctallas'), ('compras', 'ordenescompra'), ('compras', 'ejecucion'), ('compras', 'logistica'),
  ('compras', 'productos'), ('compras', 'instituciones'), ('compras', 'contactos'),
  ('compras', 'proveedores'), ('compras', 'inventario'),
  ('almacen', 'inventario');

-- Zonas de ventas (2026-07-30, worker/lib/zonas.ts). Ensanchan el scope de LECTURA del
-- líder: ve sus oportunidades y las de los miembros de su zona. La ESCRITURA no se
-- ensancha — el write path pide scope 'own' (worker/lib/dal.ts getItem opts.scope), así
-- que sobre una oportunidad ajena el líder recibe 404, igual que cualquier otro viewer.
-- Un vendedor sin zona (o que no la lidera) mantiene exactamente el scope de antes.
--
-- La membresía se guarda por email y NO por monday_user_id porque una misma persona
-- puede tener dos filas de identity (login de trabajo + gmail personal) con el mismo
-- monday_user_id; al leer se resuelve a ids de Monday, así ambos logins caen en la zona.
CREATE TABLE IF NOT EXISTS zonas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL UNIQUE,
  lider_email TEXT REFERENCES identity(email) ON DELETE SET NULL
);

-- Sin miembros = zona vacía: el líder solo se ve a sí mismo (comportamiento de hoy).
-- El líder no necesita fila aquí; su propio monday_user_id siempre entra al scope.
CREATE TABLE IF NOT EXISTS zona_miembros (
  zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
  email   TEXT NOT NULL REFERENCES identity(email) ON DELETE CASCADE,
  PRIMARY KEY (zona_id, email)
);
CREATE INDEX IF NOT EXISTS idx_zona_miembros_email ON zona_miembros(email);

-- Centro de notificaciones del portal (2026-07-22, worker/lib/notify.ts). Dos bandejas
-- por `severity`: 'importante' (te mencionaron, costeo incompleto) y 'actualizacion'
-- (la oportunidad cambió de etapa). Cada fila es personal: `recipient_email` apunta a
-- identity.email. `dedupe_key` UNIQUE + INSERT OR IGNORE = idempotente aunque el webhook
-- reintente o el reconcile re-corra. Vive solo en D1, no se espeja a Monday.
CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_email TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('importante','actualizacion')),
  kind            TEXT NOT NULL,     -- 'mention' | 'costeo_incompleto' | 'stage_change'
  title           TEXT NOT NULL,
  body            TEXT,
  board_key       TEXT,              -- deep link /{board_key}/{item_id} (src/lib/routing.ts)
  board_id        INTEGER,
  item_id         INTEGER,
  actor           TEXT,              -- nombre de quien lo causó (display)
  dedupe_key      TEXT NOT NULL,
  read_at         TEXT,              -- NULL = no leída
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notif_inbox ON notifications(recipient_email, read_at, id);

-- Documentos del portal + firma electrónica (2026-07-25, worker/lib/documents.ts).
-- Se crean LAZY en runtime (ensureDocumentTables, mismo patrón que api_cache), así
-- que la feature funciona sin aplicar este archivo a mano; están aquí como
-- documentación y para bases nuevas. Viven solo en D1: nada se espeja a Monday.
--
-- `data` es el snapshot de datos con el que se renderizó el PDF. El PDF firmado se
-- re-renderiza de ESE snapshot (nunca de una lectura fresca del mirror) para que lo
-- firmado no cambie bajo los pies del firmante, y `sha256` — la huella del PDF base
-- guardado en R2 (documentos/{id}/base.pdf) — es lo que ata la firma al contenido.
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,   -- uuid; también el prefijo del key en R2
  template_id  TEXT NOT NULL,      -- shared/documents.ts DOC_TEMPLATES
  title        TEXT NOT NULL,
  source_kind  TEXT NOT NULL,      -- 'oportunidad' | 'movimiento' | 'archivo'
  source_id    TEXT NOT NULL,      -- itemId | movementId | key de /api/files (normalizado)
  board_key    TEXT,               -- deep link /{board_key}/{item_id}
  folio        TEXT,
  data         TEXT NOT NULL,      -- snapshot JSON (DocData)
  sha256       TEXT NOT NULL,      -- huella del PDF base sellado
  bytes        INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_kind, source_id);

-- Una firma por persona por documento (UNIQUE): el trazo va a R2 y aquí queda la
-- evidencia de auditoría — identidad autenticada, consentimiento textual aceptado,
-- IP que puso Cloudflare, y el hash del PDF exacto que se firmó.
CREATE TABLE IF NOT EXISTS document_signatures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signer_name  TEXT NOT NULL,
  signer_role  TEXT NOT NULL,
  label        TEXT NOT NULL,      -- 'Entrega' / 'Recibe' / 'Elaboró' / 'Autorizó'…
  intent       TEXT NOT NULL,      -- SIGN_INTENT tal cual lo aceptó
  sha256       TEXT NOT NULL,
  image_key    TEXT,               -- R2: trazo JPEG (NULL = firmó sin trazo)
  ip           TEXT,
  user_agent   TEXT,
  signed_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_docsig_once ON document_signatures(document_id, signer_email);

-- Productos nuevos propuestos por Ventas (2026-07-30, worker/lib/productosPropuestos.ts,
-- tab "Nuevos productos" del drawer de Oportunidad). Nativo en D1: nombre+descripción+
-- imagen no encajan en ninguna columna existente de Monday y CLAUDE.md prohíbe inventar
-- ids de columna, así que no se sincroniza al mirror ni al outbox. Se crea LAZY en
-- runtime (mismo patrón que documents/api_cache) — está aquí solo como documentación.
CREATE TABLE IF NOT EXISTS producto_propuesto (
  id             TEXT PRIMARY KEY,   -- uuid
  oportunidad_id INTEGER NOT NULL,
  nombre         TEXT NOT NULL,
  descripcion    TEXT NOT NULL DEFAULT '',
  image_key      TEXT,               -- R2 key bajo oportunidades/{id}/productos-propuestos/
  created_by     TEXT NOT NULL,      -- identity.email de quien propuso
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_producto_propuesto_opp ON producto_propuesto(oportunidad_id);

-- Historial de "Estado del producto" (2026-08-05, worker/lib/estadoProducto.ts, tab
-- "Ejecución" del Proyecto). En vez de seguir agregando una columna de fecha en Monday
-- por cada estado nuevo que se quiera trackear (patrón usado hasta hoy: date_mm20y5t3,
-- date_mm21p1ex, etc. en proyectos_sub), el cambio de `color_mm0hqf79` se diffea en el
-- mismo chokepoint que ya usa maybeEmitProjectStatusChange (worker/sync/upsert.ts) y
-- queda aquí, agnóstico a cuántos estados existan. Corre para AMBOS orígenes (webhook
-- nativo de Monday y el upsert optimista que dispara worker/lib/outbox.ts tras un PATCH
-- del portal) — `changed_by` solo se conoce en el segundo caso. Se crea LAZY en runtime
-- (mismo patrón que documents/zonas) — está aquí solo como documentación.
CREATE TABLE IF NOT EXISTS estado_producto_historial (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_item_id   INTEGER NOT NULL,        -- proyectos_sub item id
  proyecto_id   INTEGER NOT NULL,        -- parent_item_id, para listar por proyecto sin join
  estado_previo TEXT,
  estado_nuevo  TEXT NOT NULL,
  changed_at    TEXT NOT NULL,           -- ISO, server-side (now())
  changed_by    TEXT,                    -- email del viewer; NULL si vino de Monday/reconcile
  comentario    TEXT
);
CREATE INDEX IF NOT EXISTS idx_estado_historial_proyecto ON estado_producto_historial(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_estado_historial_sub ON estado_producto_historial(sub_item_id);
