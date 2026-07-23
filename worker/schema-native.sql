-- worker/schema-native.sql — Modelo NATIVO (plan 3, "salir de Monday"). Paralelo al
-- mirror `items` de worker/schema.sql; NO lo reemplaza. Idempotente (IF NOT EXISTS).
-- DORMIDO: solo se puebla cuando NATIVE_SHADOW=1. Ver docs/plan-3-native-independence.md.
--
-- Se aplica lazy en runtime (worker/lib/native/schema.ts, mismo patrón que api_cache /
-- board_state), así el despliegue no cambia. Este archivo es la copia canónica/revisable.

-- Un registro de negocio, semántico (nombres de campo propios, no blobs de Monday).
CREATE TABLE IF NOT EXISTS records (
  entity          TEXT NOT NULL,                 -- NativeEntity (shared/native.ts)
  id              INTEGER NOT NULL,              -- id nativo; proyectado == monday_item_id
  monday_board_id INTEGER,                       -- procedencia (NULL si nació nativo)
  monday_item_id  INTEGER,                       -- puente al mirror (NULL si nació nativo)
  parent_id       INTEGER,                       -- padre nativo (opp de una línea, etc.)
  title           TEXT NOT NULL,
  stage           TEXT,                          -- caliente: etapa del pipeline
  folio           TEXT,                          -- caliente: folio de negocio
  amount          REAL,                          -- caliente: monto principal
  owner_ids       TEXT NOT NULL DEFAULT '[]',    -- JSON de monday_user_ids (authz)
  fields          TEXT NOT NULL DEFAULT '{}',    -- JSON {campoNativo: {t,n?,v?}}
  source          TEXT NOT NULL DEFAULT 'monday' -- 'monday' (proyectado) | 'native' (nació aquí)
                  CHECK (source IN ('monday','native')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (entity, id)
);
CREATE INDEX IF NOT EXISTS idx_records_parent ON records(entity, parent_id);
CREATE INDEX IF NOT EXISTS idx_records_stage  ON records(entity, stage);
CREATE INDEX IF NOT EXISTS idx_records_monday ON records(monday_item_id);

-- Enlaces explícitos entre registros (reemplaza board_relation/mirror de Monday).
CREATE TABLE IF NOT EXISTS record_relations (
  from_entity TEXT NOT NULL,
  from_id     INTEGER NOT NULL,
  rel         TEXT NOT NULL,                     -- 'contacto','producto','oportunidad',...
  to_entity   TEXT NOT NULL,
  to_id       INTEGER NOT NULL,
  PRIMARY KEY (from_entity, from_id, rel, to_id)
);
CREATE INDEX IF NOT EXISTS idx_relations_to ON record_relations(to_entity, to_id);

-- Log append-only: creación, cambios de campo/etapa, comentarios. Equivalente nativo
-- de los updates + activity_logs de Monday.
CREATE TABLE IF NOT EXISTS record_activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,
  record_id  INTEGER NOT NULL,
  kind       TEXT NOT NULL,                      -- 'create'|'field_change'|'stage_change'|'update'
  author     TEXT,
  body       TEXT,
  meta       TEXT,                               -- JSON opcional (before/after, etc.)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_record ON record_activity(entity, record_id, id);

-- Refs a archivos en R2 (equivalente nativo de las columnas file de Monday).
CREATE TABLE IF NOT EXISTS record_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,
  record_id   INTEGER NOT NULL,
  field       TEXT NOT NULL,                     -- campo nativo tipo file
  r2_key      TEXT NOT NULL,
  name        TEXT,
  uploaded_by TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_record ON record_files(entity, record_id);

-- Contador de ids para registros nacidos NATIVOS (camino de creación dormido). Se
-- arranca en un rango alto para no colisionar jamás con ids de item de Monday.
CREATE TABLE IF NOT EXISTS native_counters (
  name TEXT PRIMARY KEY,
  next INTEGER NOT NULL
);
INSERT OR IGNORE INTO native_counters (name, next) VALUES ('record_id', 900000000001);
