// worker/lib/telemetry.ts — ingesta y poda de `ux_event` (capa de interacción).
// El vocabulario y los saneadores viven en shared/telemetry.ts porque el cliente
// los usa para generar y este archivo para VALIDAR; aquí solo está el I/O.
//
// Separada de `activity_log` a propósito, y la separación NO es cosmética:
//  - `activity_log` es el espejo de lo que Monday registró — llega por poll
//    (worker/sync/delta.ts), con el tick de Monday, y NO distingue si el cambio
//    se hizo desde el portal o desde Monday.com (el portal escribe a Monday, así
//    que la vuelta por activity_logs las deja idénticas).
//  - `ux_event` es lo que el servidor no puede saber solo: qué intentó la
//    persona, cuánto esperó, si repitió el clic. Todo lo que hay aquí es, por
//    construcción, portal.
// La atribución portal-vs-Monday sobre activity_log se resuelve aparte, contra
// `outbox` — ver worker/lib/uxMetrics.ts.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import {
  UX_MAX_BATCH, UX_MAX_DT_MS, UX_RETENTION_DAYS,
  isValidTarget, isValidUxId, isUxKind, sanitizeMeta,
  type UxEventInput,
} from '../../shared/telemetry';

// 12 columnas por fila (id es autoincrement). D1 rechaza queries arriba de ~100
// parámetros ligados, así que el INSERT multi-fila se trocea a 7 filas = 84
// binds — mismo tope que ya paga listActivity (worker/lib/activityLog.ts).
const COLS_PER_ROW = 12;
const ROWS_PER_STATEMENT = 7;

// La poda borra por lotes: un DELETE de cientos de miles de filas de golpe se
// come la invocación. SQLite en D1 no acepta `DELETE ... LIMIT`, de ahí el
// subselect.
const PURGE_CHUNK = 5000;
const PURGE_MAX_CHUNKS = 20;

let tableReady = false;

/** Exportada porque el reporte (worker/lib/uxMetrics.ts) consulta `ux_event`
 * y puede correr ANTES de que entre el primer evento — en un despliegue nuevo
 * la tabla todavía no existe y la consulta tronaría. */
export async function ensureUxTable(env: Env): Promise<void> {
  return ensureTable(env);
}

async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ux_event (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL,
    user_id     INTEGER NOT NULL,
    role        TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    kind        TEXT    NOT NULL,
    target      TEXT    NOT NULL,
    corr        TEXT,
    board_slug  TEXT,
    item_id     INTEGER,
    column_id   TEXT,
    latency_ms  INTEGER,
    meta        TEXT
  )`).run();
  await env.DB.batch([
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ux_created ON ux_event(created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ux_user ON ux_event(user_id, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ux_cell ON ux_event(item_id, column_id, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ux_corr ON ux_event(corr)'),
  ]);
  tableReady = true;
}

interface UxRow {
  createdAt: string; userId: number; role: string; sessionId: string;
  kind: string; target: string; corr: string | null; boardSlug: string | null;
  itemId: number | null; columnId: string | null; latencyMs: number | null; meta: string | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
}

/** Valida un evento crudo del cliente y lo ancla al reloj del SERVIDOR.
 * Pura y exportada para poder probarla sin D1. Devuelve null si el evento no
 * pasa el vocabulario de shared/telemetry.ts — se descarta en silencio: un
 * evento malformado nunca debe tumbar el lote ni devolver error al cliente
 * (esto es telemetría, no una operación del negocio). */
export function toRow(
  raw: unknown, sessionId: string, viewer: Identity, flushedAtMs: number,
): UxRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<UxEventInput>;
  if (!isUxKind(e.kind) || !isValidTarget(e.target)) return null;

  // created_at = ahora − dt. El cliente NUNCA manda una fecha (ver UxEventInput):
  // así el orden intra-sesión queda al milisegundo sin depender de su reloj.
  const dt = Math.min(Math.max(num(e.dt) ?? 0, 0), UX_MAX_DT_MS);
  const createdAt = new Date(flushedAtMs - dt).toISOString();

  const latency = num(e.latencyMs);
  return {
    createdAt,
    // SIEMPRE del identity del servidor. Si el body trae user_id, se ignora:
    // sería falsificable y además saldría mal.
    userId: viewer.monday_user_id,
    role: viewer.role,
    sessionId,
    kind: e.kind,
    target: e.target,
    corr: isValidUxId(e.corr) ? e.corr : null,
    boardSlug: isValidTarget(e.boardSlug) ? e.boardSlug : null,
    itemId: num(e.itemId),
    columnId: isValidTarget(e.columnId) ? e.columnId : null,
    latencyMs: latency !== null && latency >= 0 ? latency : null,
    meta: sanitizeMeta(e.meta),
  };
}

/** Persiste un lote ya autenticado. Best-effort: nunca lanza — el llamador ya
 * respondió 204 y esto corre en waitUntil. Devuelve cuántas filas insertó. */
export async function ingestUxEvents(
  env: Env, viewer: Identity, sessionId: string, events: unknown[],
): Promise<number> {
  if (!isValidUxId(sessionId) || !Array.isArray(events) || events.length === 0) return 0;
  const flushedAtMs = Date.now();
  const rows = events
    .slice(0, UX_MAX_BATCH)
    .map(e => toRow(e, sessionId, viewer, flushedAtMs))
    .filter((r): r is UxRow => r !== null);
  if (rows.length === 0) return 0;

  try {
    await ensureTable(env);
    const statements = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
      const values = chunk.map(() => `(${Array(COLS_PER_ROW).fill('?').join(',')})`).join(',');
      const binds = chunk.flatMap(r => [
        r.createdAt, r.userId, r.role, r.sessionId, r.kind, r.target,
        r.corr, r.boardSlug, r.itemId, r.columnId, r.latencyMs, r.meta,
      ]);
      statements.push(env.DB.prepare(
        `INSERT INTO ux_event
          (created_at, user_id, role, session_id, kind, target, corr, board_slug, item_id, column_id, latency_ms, meta)
         VALUES ${values}`,
      ).bind(...binds));
    }
    // Un solo batch = un solo round-trip a D1 para todo el lote. La regla es que
    // la telemetría no agregue round-trips por request normal del portal: entra
    // en lotes, jamás por evento.
    await env.DB.batch(statements);
    return rows.length;
  } catch {
    return 0; // telemetría caída nunca debe verse desde el portal
  }
}

/** Poda a 90 días. Colgada del cron semanal que ya existe (worker/index.ts) —
 * la retención efectiva queda en ≤97 días, que para una ventana de 90 da igual
 * y evita meterle trabajo al cron de 15 min. */
export async function purgeUxEvents(env: Env): Promise<number> {
  try {
    await ensureTable(env);
    const cutoff = new Date(Date.now() - UX_RETENTION_DAYS * 86400_000).toISOString();
    let deleted = 0;
    for (let i = 0; i < PURGE_MAX_CHUNKS; i++) {
      const res = await env.DB.prepare(
        `DELETE FROM ux_event WHERE id IN (
           SELECT id FROM ux_event WHERE created_at < ? LIMIT ${PURGE_CHUNK})`,
      ).bind(cutoff).run();
      const n = res.meta.changes ?? 0;
      deleted += n;
      if (n < PURGE_CHUNK) break;
    }
    return deleted;
  } catch {
    return 0;
  }
}
