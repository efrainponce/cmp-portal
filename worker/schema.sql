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
  kind TEXT NOT NULL,                 -- webhook|reconcile|delta|manual|outbox|http
  board_id INTEGER, item_id INTEGER,
  ok INTEGER NOT NULL, detail TEXT, at TEXT NOT NULL
);

-- Checkpoint genérico key/value para procesos de sync. Hoy solo lo usa el delta
-- sync (worker/sync/delta.ts) para `delta_last_polled_at`. Lazy en runtime,
-- mismo patrón que board_state — está aquí solo como documentación.
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Contador de calls a Monday por día (worker/lib/monday.ts gql()) — Efraín
-- preguntó si el delta sync + reconcile más frecuente se comen el tope diario
-- del plan; antes no había ni un número real. Lazy en runtime.
CREATE TABLE IF NOT EXISTS monday_api_usage (
  day   TEXT PRIMARY KEY,   -- YYYY-MM-DD (UTC)
  count INTEGER NOT NULL DEFAULT 0
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

-- Cotización virtual del Proyecto (2026-08-10, worker/lib/proyectoCotizacionVirtual.ts):
-- mismo espíritu que cotizacion_ajustes de arriba, pero para el drawer del
-- Proyecto (post-venta) — a diferencia de esa, esto NUNCA escribe a Monday. Es
-- un log de operaciones (editar/dividir) que se reproduce en caliente sobre las
-- líneas vigentes de la Oportunidad ligada; linea_id positivo = subitem real,
-- negativo = línea virtual (nació de un 'dividir' hecho aquí). Se crea lazy en
-- runtime, mismo patrón que cotizacion_ajustes/producto_propuesto — está aquí
-- solo como documentación.
CREATE TABLE IF NOT EXISTS proyecto_cotizacion_ajustes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  oportunidad_id   INTEGER NOT NULL,
  linea_id         INTEGER NOT NULL,
  linea_origen_id  INTEGER,
  modo             TEXT NOT NULL,
  subversion       INTEGER NOT NULL,
  campos           TEXT NOT NULL,
  resumen          TEXT NOT NULL,
  viewer_email     TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proycot_opp ON proyecto_cotizacion_ajustes(oportunidad_id);

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
  ('vendedor', 'doctallas'),
  ('vendedor', 'productos'), ('vendedor', 'instituciones'), ('vendedor', 'contactos'),
  ('compras', 'oportunidades'), ('compras', 'oportunidades_web'),
  ('compras', 'costeo'), ('compras', 'validacion'),
  ('compras', 'ordenescompra'), ('compras', 'ejecucion'), ('compras', 'logistica'),
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

-- Resumen libre por producto+color (2026-08-06, worker/lib/productoResumen.ts, tab
-- "Ejecución"), un texto global por tarjeta además del comentario por talla
-- (text_mm20gzsb en proyectos_sub). No hay columna de Monday a nivel producto+color
-- (el grupo es puramente una agrupación del cliente sobre subitems de talla), así
-- que vive nativo en D1, mismo patrón lazy-create que producto_propuesto/
-- estado_producto_historial — está aquí solo como documentación.
CREATE TABLE IF NOT EXISTS producto_resumen (
  proyecto_id INTEGER NOT NULL,
  producto    TEXT NOT NULL,
  color       TEXT NOT NULL,
  resumen     TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  updated_by  TEXT,
  PRIMARY KEY (proyecto_id, producto, color)
);
CREATE INDEX IF NOT EXISTS idx_producto_resumen_proyecto ON producto_resumen(proyecto_id);

-- Log de actividad por item (2026-08-14, worker/lib/activityLog.ts) — mirror
-- filtrado de activity_logs de Monday (Oportunidades+líneas, Productos), que
-- el delta sync ya pedía y tiraba tras usar solo pulse_id. `dedupe_key` es
-- propio (board+item+evento+columna+tick de Monday): `action_record_uuid` de
-- Monday no siempre viene en la respuesta, así que no sirve como UNIQUE. Se
-- crea LAZY en runtime (mismo patrón que estado_producto_historial) — está
-- aquí solo como documentación.
CREATE TABLE IF NOT EXISTS activity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id      INTEGER NOT NULL,
  item_id       INTEGER NOT NULL,
  event         TEXT NOT NULL,
  column_id     TEXT,
  column_title  TEXT,
  previous_text TEXT,
  new_text      TEXT,
  user_id       INTEGER,                     -- monday_user_id con el que se ACTÚA (puede ser prestado)
  actor_email   TEXT,                        -- quién editó de verdad (2026-08-18, ver activityLog.ts)
  created_at    TEXT NOT NULL,
  dedupe_key    TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_activity_log_item ON activity_log(board_id, item_id);

-- Seguimiento del vendedor sobre una oportunidad stale (2026-08-10, pantalla
-- "Inicio", worker/lib/home.ts insertSeguimiento). El mensaje SIEMPRE se postea
-- primero como Update real en Monday (worker/lib/monday.ts createUpdate) — esta
-- fila solo queda LIGADA por monday_update_id, nunca es un texto suelto por su
-- lado. Se crea LAZY en runtime (mismo patrón que estado_producto_historial) —
-- está aquí solo como documentación.
CREATE TABLE IF NOT EXISTS seguimientos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id           INTEGER NOT NULL,        -- oportunidades item id
  board_id          INTEGER NOT NULL,
  monday_update_id  INTEGER NOT NULL,        -- Update real en Monday, ya creado
  autor_email       TEXT NOT NULL,
  mensaje           TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seguimientos_item ON seguimientos(item_id);

-- Folio del costeo nativo (Fase 1, plan "salir de Monday", 2026-08-12,
-- worker/lib/costeo.ts nextCosteoSeq). Reemplaza el conteo de archivos en
-- file_mm10k65a que hacía cmp-tallas (frágil/racy): un contador por oportunidad,
-- incrementado en cada "Mandar a costeo" exitoso cuando COSTEO_NATIVE=1. Se crea
-- LAZY en runtime (mismo patrón que documents/seguimientos) — está aquí solo
-- como documentación.
CREATE TABLE IF NOT EXISTS costeo_folios (
  item_id  INTEGER PRIMARY KEY,     -- oportunidades item id
  seq      INTEGER NOT NULL DEFAULT 0
);

-- Folio de la cotización nativa (Fase 2, plan "salir de Monday", 2026-08-12,
-- worker/lib/cotizacion.ts nextCotizacionSeq). Mismo patrón que costeo_folios:
-- reemplaza el ledger de Google Sheets de cmp-tallas. Lazy en runtime.
CREATE TABLE IF NOT EXISTS cotizacion_folios (
  item_id  INTEGER PRIMARY KEY,     -- oportunidades item id
  seq      INTEGER NOT NULL DEFAULT 0
);

-- Folio de la relación de tallas nativa (Fase 3, plan "salir de Monday",
-- 2026-08-12, worker/lib/proyectoTallas.ts nextTallasSeq). Mismo patrón que
-- costeo_folios/cotizacion_folios. Lazy en runtime.
CREATE TABLE IF NOT EXISTS tallas_folios (
  item_id  INTEGER PRIMARY KEY,     -- proyectos item id
  seq      INTEGER NOT NULL DEFAULT 0
);

-- Folio GLOBAL "OC-n" (Fase 4, plan "salir de Monday", 2026-08-12,
-- worker/lib/oc.ts nextOcFolio) — a diferencia de costeo/cotizacion/tallas_folios
-- (por item), este es una sola fila: reemplaza el ledger de Sheets que contaba
-- TODAS las filas de TODOS los proyectos/proveedores. Lazy en runtime.
CREATE TABLE IF NOT EXISTS oc_folios (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  seq  INTEGER NOT NULL DEFAULT 0
);

-- Carpeta de Drive de una Oportunidad (Fase 5, plan "salir de Monday",
-- 2026-08-13, worker/lib/drive.ts getOrCreateDriveFolder) — cache de la carpeta
-- raíz + las 12 subcarpetas de licitación creadas en Drive, para que Fases 2-4
-- depositen sus PDFs sin volver a listar Drive. Lazy en runtime.
CREATE TABLE IF NOT EXISTS drive_folders (
  item_id          INTEGER PRIMARY KEY,  -- oportunidades item id
  root_folder_id   TEXT NOT NULL,
  subfolders_json  TEXT NOT NULL,        -- {"01. BASES": "id", ...}
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "Ojitos" de Actualizaciones (2026-08-14, worker/lib/updateSeen.ts) — quién ya vio
-- cada update/reply del feed. Monday trae su propio `viewers` en el update, pero solo
-- se llena cuando alguien lo ve DENTRO de Monday.com; una lectura vía nuestra API (que
-- es como el portal sirve el feed) nunca lo marca, así que el "visto" del portal se
-- lleva aparte aquí. El GET de updates fusiona esta tabla con el `viewers` nativo de
-- Monday para cubrir ambas superficies. `update_id` es el id de Monday (update o
-- reply, mismo espacio de ids) — no hace falta item_id, siempre se consulta por la
-- lista de ids que ya trajo el feed. Lazy en runtime.
CREATE TABLE IF NOT EXISTS update_seen (
  update_id    TEXT NOT NULL,
  viewer_email TEXT NOT NULL REFERENCES identity(email) ON DELETE CASCADE,
  seen_at      TEXT NOT NULL,
  PRIMARY KEY (update_id, viewer_email)
);

-- Anuncios del portal (2026-08-17, worker/lib/anuncios.ts) — comunicados que
-- publican los admins (Elisa y el CEO) y lee el equipo en /anuncios. Nativo en D1:
-- no hay board de Monday detrás, no pasa por outbox ni por el mirror. La audiencia
-- son DOS listas que se cumplen a la vez: `roles` (JSON Role[]) y `zona_ids` (JSON
-- de ids de `zonas`); lista vacía = "todos" en esa dimensión. Un admin ve todos los
-- anuncios sin importar audiencia — es quien los administra. Se archiva en vez de
-- borrar para no perder quién dijo qué. Se crean LAZY en runtime (mismo patrón que
-- documents/zonas) — están aquí solo como documentación.
CREATE TABLE IF NOT EXISTS anuncios (
  id           TEXT PRIMARY KEY,   -- uuid
  titulo       TEXT NOT NULL,
  cuerpo       TEXT NOT NULL,
  severidad    TEXT NOT NULL DEFAULT 'normal' CHECK (severidad IN ('normal','importante')),
  roles        TEXT NOT NULL DEFAULT '[]',   -- JSON Role[]; [] = todos los roles
  zona_ids     TEXT NOT NULL DEFAULT '[]',   -- JSON number[]; [] = todas las zonas
  autor_email  TEXT NOT NULL,
  autor_nombre TEXT NOT NULL,
  archivado    INTEGER NOT NULL DEFAULT 0,
  wa_enviados  INTEGER NOT NULL DEFAULT 0,   -- WhatsApp que salieron al publicar (casilla explícita)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anuncios_created ON anuncios(created_at);

-- "Visto" por persona (mismo patrón que update_seen): alimenta el badge de no
-- leídos del sidebar. Lo asienta la UI al desplegar el anuncio; el autor nace
-- visto para sí mismo al publicarlo.
CREATE TABLE IF NOT EXISTS anuncio_visto (
  anuncio_id   TEXT NOT NULL,
  viewer_email TEXT NOT NULL,
  seen_at      TEXT NOT NULL,
  PRIMARY KEY (anuncio_id, viewer_email)
);

-- Capa de INTERACCIÓN del portal (2026-08-17). Existe para poder comparar la
-- fricción del portal contra la línea base de Monday (138,794 eventos de
-- activity_logs, mar–ago 2026) en la renovación de feb-2027.
--
-- NO se mezcla con `activity_log` a propósito, y la separación no es cosmética:
-- `activity_log` espeja lo que Monday REGISTRÓ (qué cambió), esto es lo que el
-- servidor no puede saber solo (qué INTENTÓ la persona, cuánto esperó, si
-- repitió el clic). Todo lo que hay aquí es, por construcción, del portal; la
-- atribución portal-vs-Monday sobre activity_log se resuelve cruzando contra
-- `outbox` (ver worker/lib/uxMetrics.ts).
--
-- GUARDARRAÍL: esto mide personas. Nunca guarda texto capturado por el usuario,
-- nombres de cliente ni valores de campo — solo identificadores, slugs de
-- control y tiempos; los regex de shared/telemetry.ts son la contención
-- ejecutable de esa regla (con prueba en shared/telemetry.test.ts). El reporte
-- por defecto es agregado; el desglose por persona es diagnóstico aparte.
-- Retención: 90 días el grueso, pero los eventos kind='edit' viven 400 —
-- son el rastro con que se atribuye cada fila de activity_log a portal o a
-- Monday, y activity_log no se poda: borrarlos al mismo ritmo haría que las
-- ediciones viejas del portal se contaran como Monday solas. Poda en el cron
-- semanal (worker/index.ts).
-- Se crea LAZY en runtime (mismo patrón que activity_log) — está aquí solo
-- como documentación.
CREATE TABLE IF NOT EXISTS ux_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT    NOT NULL,   -- ISO UTC, anclado por el SERVIDOR (el cliente manda `dt`)
  user_id     INTEGER NOT NULL,   -- monday_user_id del identity del servidor, NUNCA del payload.
                                  -- Entero a propósito: joinable 1:1 contra activity_log.user_id.
  role        TEXT    NOT NULL,   -- rol al momento del evento; el reporte por defecto es POR ROL
  session_id  TEXT    NOT NULL,   -- uuid por pestaña (sessionStorage), no persiste entre sesiones
  kind        TEXT    NOT NULL,   -- click|ack|edit|nav|error
  target      TEXT    NOT NULL,   -- slug estable de control: ^[a-z][a-z0-9:_-]{0,63}$
  corr        TEXT,               -- correlación clic↔acuse (sin esto el 58/42 no se puede calcular)
  board_slug  TEXT,
  item_id     INTEGER,
  column_id   TEXT,
  latency_ms  INTEGER,            -- solo en kind='ack'/'error'
  meta        TEXT                -- JSON saneado: number|boolean|slug corto, nada más
);
CREATE INDEX IF NOT EXISTS idx_ux_created ON ux_event(created_at);
CREATE INDEX IF NOT EXISTS idx_ux_user    ON ux_event(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ux_cell    ON ux_event(item_id, column_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ux_corr    ON ux_event(corr);

-- Bitácora de INTENTOS de mutación del portal (2026-08-20, worker/lib/accionLog.ts
-- + worker/mw/accionLog.ts). Las otras cuatro fuentes (outbox, sync_log,
-- activity_log, ux_event) solo cuentan lo que SÍ pasó; ésta guarda el negativo:
-- quién pidió qué y se fue con un 403/400/404/500, que es justo lo que alguien
-- reporta como "el portal no hizo nada" y no dejaba rastro en ningún lado.
-- Nace de OPP-0933: "el CEO le dio validar precios y no se envió a Monday"
-- (resultó ser un botón de Monday.com, no del portal — pero contestarlo tomó
-- media hora de arqueología). Sin muestreo: una fila por mutación, GET fuera.
-- Se crea LAZY en runtime (mismo patrón que ux_event) — está aquí como documentación.
CREATE TABLE IF NOT EXISTS accion_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT    NOT NULL,   -- ISO UTC, reloj del servidor
  email      TEXT    NOT NULL,   -- quien REALMENTE actuó (el admin, aunque suplante)
  actua_como TEXT,               -- suplantado, o NULL — ux_event tira el lote entero en ese caso
  role       TEXT    NOT NULL,   -- rol con el que corrió (el del suplantado, si aplica)
  metodo     TEXT    NOT NULL,   -- POST|PATCH|PUT|DELETE (los GET no entran)
  ruta       TEXT    NOT NULL,   -- c.req.path, con los ids adentro
  status     INTEGER NOT NULL,
  ok         INTEGER NOT NULL,   -- status < 400
  ms         INTEGER NOT NULL,
  detalle    TEXT                -- motivo del rechazo tal cual lo devolvió la ruta (solo en error)
);
CREATE INDEX IF NOT EXISTS idx_accion_at    ON accion_log(at);
CREATE INDEX IF NOT EXISTS idx_accion_email ON accion_log(email, at);
CREATE INDEX IF NOT EXISTS idx_accion_ok    ON accion_log(ok, at);

-- Comentarios ("updates") de un item NATIVO de Zona Efrain (2026-08-17,
-- worker/lib/nativeUpdates.ts). Un item con id sintético (shared/nativeId.ts) no
-- existe en Monday: `create_update` contra él truena y `updates` sale vacío, así que
-- tanto el composer de Actualizaciones como los mensajes automáticos (cotización,
-- OC, costeo, tallas) se perdían en silencio. Esta tabla es su feed equivalente y se
-- sirve con el MISMO shape que un update de Monday (worker/lib/monday.ts
-- MondayUpdate), para que las rutas no tengan que saber de qué lado está el item.
-- `id` numérico como texto (no uuid) a propósito: las rutas validan /^\d+$/, el
-- "visto" vive en update_seen y `seguimientos.monday_update_id` es INTEGER. Sin
-- hilos (replies solo existen dentro de Monday.com). Los adjuntos viven en R2 y
-- quedan listados en `attachments` — no hay asset de Monday que resolver. Se crea
-- LAZY en runtime (mismo patrón que documents/zonas/anuncios) — está aquí solo como
-- documentación.
CREATE TABLE IF NOT EXISTS native_updates (
  id           TEXT PRIMARY KEY,   -- numérico como texto, piso NATIVE_ID_FLOOR
  board_id     INTEGER NOT NULL,
  item_id      INTEGER NOT NULL,
  author_email TEXT,               -- NULL = lo posteó el sistema, no una persona
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL,      -- texto plano (Monday guarda HTML; aquí nadie lo renderiza)
  created_at   TEXT NOT NULL,
  attachments  TEXT NOT NULL DEFAULT '[]'  -- JSON [{id,name,ext,key}] con el key de R2
);
CREATE INDEX IF NOT EXISTS idx_native_updates_item ON native_updates(item_id, created_at DESC);

-- Respaldo de lo borrado desde el portal (worker/lib/itemBorrado.ts): el
-- renglón completo —nombre y todas las columnas— se guarda aquí ANTES de
-- borrarlo en Monday y en `items`, para poder recrearlo si algo se fue por
-- error. También es el contador del tope de borrados por hora y por persona.
CREATE TABLE IF NOT EXISTS item_borrado (
  board_id       INTEGER NOT NULL,
  item_id        INTEGER NOT NULL,
  parent_item_id INTEGER,
  name           TEXT,
  columns        TEXT,
  deleted_at     TEXT NOT NULL,
  by_email       TEXT,
  PRIMARY KEY (board_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_item_borrado_email_fecha ON item_borrado (by_email, deleted_at);
