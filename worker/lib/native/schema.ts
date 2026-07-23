// worker/lib/native/schema.ts — Bootstrap lazy del modelo nativo (plan 3).
// Copia ejecutable de worker/schema-native.sql. Se corre la primera vez que algo
// nativo toca D1 en un isolate (mismo patrón que rosterCache/api_cache y board_state),
// así el despliegue no cambia. IF NOT EXISTS = idempotente y barato.
import type { Env } from '../../env';

// Sentencias en orden. D1 `exec` corre una por una; se mantiene el mismo texto que
// worker/schema-native.sql (esa es la copia canónica/revisable — si cambias una,
// cambia la otra).
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS records (
     entity TEXT NOT NULL, id INTEGER NOT NULL,
     monday_board_id INTEGER, monday_item_id INTEGER, parent_id INTEGER,
     title TEXT NOT NULL, stage TEXT, folio TEXT, amount REAL,
     owner_ids TEXT NOT NULL DEFAULT '[]', fields TEXT NOT NULL DEFAULT '{}',
     source TEXT NOT NULL DEFAULT 'monday' CHECK (source IN ('monday','native')),
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
     PRIMARY KEY (entity, id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_records_parent ON records(entity, parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_records_stage  ON records(entity, stage)`,
  `CREATE INDEX IF NOT EXISTS idx_records_monday ON records(monday_item_id)`,
  `CREATE TABLE IF NOT EXISTS record_relations (
     from_entity TEXT NOT NULL, from_id INTEGER NOT NULL, rel TEXT NOT NULL,
     to_entity TEXT NOT NULL, to_id INTEGER NOT NULL,
     PRIMARY KEY (from_entity, from_id, rel, to_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_relations_to ON record_relations(to_entity, to_id)`,
  `CREATE TABLE IF NOT EXISTS record_activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, record_id INTEGER NOT NULL,
     kind TEXT NOT NULL, author TEXT, body TEXT, meta TEXT, created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_record ON record_activity(entity, record_id, id)`,
  `CREATE TABLE IF NOT EXISTS record_files (
     id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, record_id INTEGER NOT NULL,
     field TEXT NOT NULL, r2_key TEXT NOT NULL, name TEXT, uploaded_by TEXT, created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_files_record ON record_files(entity, record_id)`,
  `CREATE TABLE IF NOT EXISTS native_counters (name TEXT PRIMARY KEY, next INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO native_counters (name, next) VALUES ('record_id', 900000000001)`,
];

// Una sola vez por isolate: evita re-ejecutar el DDL en cada request.
let ensured = false;

/** Crea el esquema nativo si falta. Idempotente. Llamar antes de cualquier acceso
 *  nativo a D1 (proyección o API paralela). */
export async function ensureNativeSchema(env: Env): Promise<void> {
  if (ensured) return;
  for (const stmt of DDL) {
    // D1 `exec` espera una sola sentencia por llamada; se colapsan saltos de línea.
    await env.DB.exec(stmt.replace(/\s+/g, ' ').trim());
  }
  ensured = true;
}

/** Reserva el siguiente id nativo para un registro nacido NATIVO (create dormido).
 *  Atómico vía UPDATE ... RETURNING. */
export async function nextNativeId(env: Env): Promise<number> {
  const row = await env.DB
    .prepare(`UPDATE native_counters SET next = next + 1 WHERE name = 'record_id' RETURNING next - 1 AS id`)
    .first<{ id: number }>();
  if (!row) throw new Error('native_counters no inicializado');
  return row.id;
}
