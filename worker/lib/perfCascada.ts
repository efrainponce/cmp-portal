// worker/lib/perfCascada.ts — ingesta y poda de `perf_cascada`: la cascada
// recurso por recurso de cada carga de página real (contrato y validación en
// shared/perfCascada.ts; la genera src/lib/perfReal.ts; la lee
// scripts/perf-cascada.mjs). Aparte de `ux_event` porque es un arreglo de
// cientos de recursos y el meta de ux_event, a propósito, solo acepta 8
// números/slugs.
//
// Va con el CORREO del servidor, no solo el monday_user_id: "Actuar en Monday
// como" presta el id, y para saber si una cascada es de Mérida hay que saber
// de quién es. El correo sale del identity, nunca del cuerpo.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { UX_RETENTION_DAYS } from '../../shared/telemetry';
import { validarCascada } from '../../shared/perfCascada';

let tableReady = false;

async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS perf_cascada (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL,
      email       TEXT    NOT NULL,
      role        TEXT    NOT NULL,
      session_id  TEXT    NOT NULL,
      pantalla    TEXT    NOT NULL,
      oculta      INTEGER NOT NULL,
      ect         TEXT,
      down_mbps   REAL,
      rtt_ms      INTEGER,
      hitos       TEXT    NOT NULL,
      recursos    TEXT    NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_perf_cascada_at ON perf_cascada(created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_perf_cascada_email ON perf_cascada(email, created_at)'),
  ]);
  tableReady = true;
}

/** Best-effort: corre en waitUntil después del 204, nunca lanza. */
export async function ingestCascada(env: Env, viewer: Identity, sessionId: string, raw: unknown): Promise<boolean> {
  const c = validarCascada(raw);
  if (!c || !viewer.email) return false;
  try {
    await ensureTable(env);
    await env.DB.prepare(
      `INSERT INTO perf_cascada (created_at, email, role, session_id, pantalla, oculta, ect, down_mbps, rtt_ms, hitos, recursos)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      new Date().toISOString(), viewer.email.toLowerCase(), viewer.role, sessionId.slice(0, 64), c.pantalla,
      c.oculta ? 1 : 0, c.ect ?? null, c.down ?? null, c.rtt ?? null,
      JSON.stringify({ ...c.hitos, ...(c.nav ? { nav: c.nav } : {}) }), JSON.stringify(c.recursos),
    ).run();
    return true;
  } catch {
    return false;
  }
}

/** Poda: misma retención que ux_event (90 días), en el cron semanal. */
export async function purgeCascadas(env: Env): Promise<number> {
  try {
    await ensureTable(env);
    const corte = new Date(Date.now() - UX_RETENTION_DAYS * 86400_000).toISOString();
    const res = await env.DB.prepare('DELETE FROM perf_cascada WHERE created_at < ?').bind(corte).run();
    return res.meta.changes ?? 0;
  } catch {
    return 0;
  }
}
