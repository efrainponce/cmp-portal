// worker/lib/rosterCache.ts — cache D1 del roster de usuarios de Monday.
// /api/users (el @-tagging de Actualizaciones) se abre decenas de veces al día
// y el roster cambia casi nunca: cachear la respuesta de fetchUsers en D1
// elimina una llamada a Monday por apertura. Tabla creada lazy con el mismo
// patrón que board_state (worker/sync/reconcile.ts) — sin migración manual.
import type { Env } from '../env';
import { fetchUsers, type MondayUser } from './monday';

const CREATE = `CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`;

const KEY = 'monday_users';

/** Roster de Monday con TTL. Si Monday falla y hay copia vieja en cache, se
 * sirve la copia (stale-if-error) — mejor un roster de ayer que un 502.
 *
 * Con `waitUntil` es además stale-while-revalidate: vencido el TTL, contesta
 * YA con la copia y la refresca en segundo plano. Sin eso, a quien le tocaba
 * el vencimiento esperaba la llamada a Monday entera: medido en ux_event
 * (2026-09-23), `GET /api/users` promediaba 7.7 s para Compras, máx 15 s, en
 * algo que cambia casi nunca. Sin `waitUntil` (admin, alta de registros) se
 * sigue esperando el dato fresco. */
export async function cachedFetchUsers(env: Env, ttlMs: number, waitUntil?: (p: Promise<unknown>) => void): Promise<MondayUser[]> {
  await env.DB.prepare(CREATE).run();
  const row = await env.DB
    .prepare('SELECT value, updated_at FROM api_cache WHERE key = ?')
    .bind(KEY)
    .first<{ value: string; updated_at: string }>();

  const fresh = row && Date.now() - Date.parse(row.updated_at) < ttlMs;
  if (fresh) {
    try { return JSON.parse(row.value) as MondayUser[]; } catch { /* cache corrupto — refetch */ }
  }

  if (row && waitUntil) {
    let copia: MondayUser[] | null = null;
    try { copia = JSON.parse(row.value) as MondayUser[]; } catch { /* cache corrupto — refetch en línea */ }
    if (copia) {
      waitUntil(refrescarRoster(env).catch(() => { /* se reintenta en la siguiente lectura */ }));
      return copia;
    }
  }

  try {
    return await refrescarRoster(env);
  } catch (err) {
    if (row) {
      try { return JSON.parse(row.value) as MondayUser[]; } catch { /* sigue el throw */ }
    }
    throw err;
  }
}

async function refrescarRoster(env: Env): Promise<MondayUser[]> {
  const users = await fetchUsers(env);
  await env.DB
    .prepare(`INSERT INTO api_cache (key, value, updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(KEY, JSON.stringify(users), new Date().toISOString())
    .run();
  return users;
}
