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
 * sirve la copia (stale-if-error) — mejor un roster de ayer que un 502. */
export async function cachedFetchUsers(env: Env, ttlMs: number): Promise<MondayUser[]> {
  await env.DB.prepare(CREATE).run();
  const row = await env.DB
    .prepare('SELECT value, updated_at FROM api_cache WHERE key = ?')
    .bind(KEY)
    .first<{ value: string; updated_at: string }>();

  const fresh = row && Date.now() - Date.parse(row.updated_at) < ttlMs;
  if (fresh) {
    try { return JSON.parse(row.value) as MondayUser[]; } catch { /* cache corrupto — refetch */ }
  }

  try {
    const users = await fetchUsers(env);
    await env.DB
      .prepare(`INSERT INTO api_cache (key, value, updated_at) VALUES (?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .bind(KEY, JSON.stringify(users), new Date().toISOString())
      .run();
    return users;
  } catch (err) {
    if (row) {
      try { return JSON.parse(row.value) as MondayUser[]; } catch { /* sigue el throw */ }
    }
    throw err;
  }
}
