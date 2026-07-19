// worker/lib/boardAccess.ts — DAL para role_board_access (worker/schema.sql). Un solo
// declutter del nav por equipo (shared/boardAccess.ts); la protección real de datos
// sigue viviendo en shared/visibility.ts + worker/lib/dal.ts.
import type { Env } from '../env';
import type { Role } from '../../shared/types';
import { BOARD_KEYS, DEFAULT_BOARD_ACCESS, TEAM_ROLES, isConfigurableBoardKey } from '../../shared/boardAccess';

interface AccessRow { role: string; board_key: string }

/** boardKeys que el rol puede ver en el sidebar. admin: bypass total, nunca lee la tabla
 * (así nunca se puede dejar sin acceso por accidente desde la UI de admin). */
export async function getBoardAccess(env: Env, role: Role): Promise<string[]> {
  if (role === 'admin') return [...BOARD_KEYS];
  const res = await env.DB.prepare('SELECT board_key FROM role_board_access WHERE role = ?').bind(role).all<AccessRow>();
  return (res.results ?? []).map(r => r.board_key);
}

/** Mapa completo equipo -> boardKeys, para la matriz del admin. */
export async function listAllBoardAccess(env: Env): Promise<Record<Role, string[]>> {
  const res = await env.DB.prepare('SELECT role, board_key FROM role_board_access').all<AccessRow>();
  const out: Record<Role, string[]> = { vendedor: [], compras: [], almacen: [], admin: [...BOARD_KEYS] };
  for (const row of res.results ?? []) {
    if (row.role in out) (out as Record<string, string[]>)[row.role].push(row.board_key);
  }
  return out;
}

export class BoardAccessError extends Error {}

/** Reemplaza el whitelist completo de un equipo. 'admin' no es editable. */
export async function setBoardAccess(env: Env, role: Role, boardKeys: string[]): Promise<void> {
  if (!TEAM_ROLES.includes(role)) throw new BoardAccessError(`role '${role}' no es editable`);
  const clean = [...new Set(boardKeys)].filter(isConfigurableBoardKey);
  if (clean.length !== boardKeys.length) throw new BoardAccessError('boardKey inválido');

  await env.DB.batch([
    env.DB.prepare('DELETE FROM role_board_access WHERE role = ?').bind(role),
    ...clean.map(k => env.DB.prepare('INSERT INTO role_board_access (role, board_key) VALUES (?, ?)').bind(role, k)),
  ]);
}

export { DEFAULT_BOARD_ACCESS };
