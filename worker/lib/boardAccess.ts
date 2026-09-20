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

// Menú POR PERSONA (Efraín, 2026-09-19): PAM y Elisa son admin y el bypass de
// arriba les pinta los 14 boards; piden un menú como el de Compras (Elisa, además,
// con Validación Costeo). Es SOLO el sidebar de /api/me: los gates reales
// (inventario, oc_lista, documentos) siguen llamando a getBoardAccess por ROL,
// así que recortarle el menú a un admin nunca le da un 403 ni le quita datos — y
// por lo mismo el menú personal no puede AGREGAR un board que el rol no tenga.
// Sin renglones = el menú del rol (Efraín: "yo tengo que poder ver todo").
interface PersonaRow { email: string; board_key: string }

const normEmail = (email: string) => email.trim().toLowerCase();

/** Boards del sidebar de ESTA persona: su menú personal si tiene, si no el del rol.
 * Tolera que la tabla todavía no exista (migración sin aplicar): cae al rol. */
export async function getNavBoards(env: Env, viewer: { email: string; role: Role }): Promise<string[]> {
  const delRol = await getBoardAccess(env, viewer.role);
  try {
    const res = await env.DB.prepare('SELECT board_key FROM identity_board_access WHERE email = ?')
      .bind(normEmail(viewer.email)).all<PersonaRow>();
    const propios = (res.results ?? []).map(r => r.board_key);
    return propios.length ? delRol.filter(k => propios.includes(k)) : delRol;
  } catch {
    return delRol;
  }
}

/** Mapa correo -> boardKeys de quienes tienen menú personal, para Configuración. */
export async function listPersonaBoardAccess(env: Env): Promise<Record<string, string[]>> {
  const res = await env.DB.prepare('SELECT email, board_key FROM identity_board_access').all<PersonaRow>();
  const out: Record<string, string[]> = {};
  for (const row of res.results ?? []) (out[row.email] ??= []).push(row.board_key);
  return out;
}

/** Reemplaza el menú personal. Lista vacía = quitarlo (vuelve al menú de su rol). */
export async function setPersonaBoardAccess(env: Env, email: string, boardKeys: string[]): Promise<void> {
  const clean = [...new Set(boardKeys)].filter(isConfigurableBoardKey);
  if (clean.length !== boardKeys.length) throw new BoardAccessError('boardKey inválido');
  const key = normEmail(email);
  const existe = await env.DB.prepare('SELECT 1 FROM identity WHERE lower(email) = ?').bind(key).first();
  if (!existe) throw new BoardAccessError('usuario desconocido');

  await env.DB.batch([
    env.DB.prepare('DELETE FROM identity_board_access WHERE email = ?').bind(key),
    ...clean.map(k => env.DB.prepare('INSERT INTO identity_board_access (email, board_key) VALUES (?, ?)').bind(key, k)),
  ]);
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
