// worker/lib/anuncios.ts — Anuncios del portal (Efraín, 2026-08-17): comunicados
// que publican los admins (Elisa y el CEO) y lee todo el equipo en su propia
// pantalla. Nativo en D1: no hay board de Monday detrás ni nada que espejar — el
// comunicado es del portal, no del CRM, así que no pasa por outbox ni por el mirror.
//
// Audiencia = roles Y zonas (worker/lib/zonas.ts), ambas opcionales: lista vacía
// significa "todos". La pertenencia a zona se resuelve por monday_user_id y no por
// email — misma razón que zonas.readableUserIds: una persona puede tener dos filas
// de identity (login de trabajo + gmail personal) con el mismo id de Monday.
//
// Un admin SIEMPRE ve todos los anuncios, aunque no sean para su rol/zona: es quien
// los administra (la audiencia se le muestra como etiqueta en la tarjeta). Las
// tablas se crean LAZY en runtime, mismo patrón que documents/zonas.
import type { Env } from '../env';
import type { Identity, Role } from '../../shared/types';
import type { AnuncioDTO, AnuncioSeveridad } from '../../shared/dto';

export class AnuncioError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ROLES: Role[] = ['vendedor', 'compras', 'admin', 'almacen'];
const MAX_TITULO = 120;
const MAX_CUERPO = 4000;

export interface AnuncioInput {
  titulo: string;
  cuerpo: string;
  severidad: AnuncioSeveridad;
  roles: Role[];        // [] = todos los roles
  zonaIds: number[];    // [] = todas las zonas
}

interface AnuncioRow {
  id: string;
  titulo: string;
  cuerpo: string;
  severidad: AnuncioSeveridad;
  roles: string;
  zona_ids: string;
  autor_email: string;
  autor_nombre: string;
  archivado: number;
  wa_enviados: number;
  created_at: string;
  updated_at: string;
  visto: number;
}

let tablesReady = false;

export async function ensureAnuncioTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS anuncios (
      id           TEXT PRIMARY KEY,
      titulo       TEXT NOT NULL,
      cuerpo       TEXT NOT NULL,
      severidad    TEXT NOT NULL DEFAULT 'normal' CHECK (severidad IN ('normal','importante')),
      roles        TEXT NOT NULL DEFAULT '[]',
      zona_ids     TEXT NOT NULL DEFAULT '[]',
      autor_email  TEXT NOT NULL,
      autor_nombre TEXT NOT NULL,
      archivado    INTEGER NOT NULL DEFAULT 0,
      wa_enviados  INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_anuncios_created ON anuncios(created_at)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS anuncio_visto (
      anuncio_id   TEXT NOT NULL,
      viewer_email TEXT NOT NULL,
      seen_at      TEXT NOT NULL,
      PRIMARY KEY (anuncio_id, viewer_email)
    )`),
  ]);
  tablesReady = true;
}

function parseIdList(json: string): number[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}

function parseRoleList(json: string): Role[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.filter((r): r is Role => ROLES.includes(r as Role)) : [];
  } catch { return []; }
}

function toDTO(row: AnuncioRow): AnuncioDTO {
  return {
    id: row.id,
    titulo: row.titulo,
    cuerpo: row.cuerpo,
    severidad: row.severidad,
    roles: parseRoleList(row.roles),
    zonaIds: parseIdList(row.zona_ids),
    autorEmail: row.autor_email,
    autorNombre: row.autor_nombre,
    archivado: !!row.archivado,
    waEnviados: row.wa_enviados,
    visto: !!row.visto,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Ids de las zonas donde cae el viewer, sea como miembro o como líder. Falla
 * cerrado: sin tablas de zonas todavía, [] — el viewer solo ve los anuncios sin
 * zona (que son "para todos"), nunca de más. */
async function zonaIdsDelViewer(env: Env, viewer: Identity): Promise<number[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT z.id AS id
         FROM zonas z
         LEFT JOIN zona_miembros zm ON zm.zona_id = z.id
         LEFT JOIN identity mi ON mi.email = zm.email AND mi.active = 1
         LEFT JOIN identity li ON li.email = z.lider_email AND li.active = 1
        WHERE mi.monday_user_id = ? OR li.monday_user_id = ?`,
    ).bind(viewer.monday_user_id, viewer.monday_user_id).all<{ id: number }>();
    return (results ?? []).map(r => r.id).filter(Number.isFinite);
  } catch {
    return [];
  }
}

/** Regla de audiencia, pura y exportada para anclarla en pruebas: las dos
 * dimensiones se cumplen A LA VEZ y una lista vacía significa "todos" en esa
 * dimensión. Un anuncio {roles:['vendedor'], zonaIds:[3]} es para los vendedores
 * DE la zona 3, no para "vendedores o zona 3". */
export function anuncioAlcanzaA(
  audiencia: { roles: Role[]; zonaIds: number[] }, role: Role, zonasViewer: number[],
): boolean {
  if (audiencia.roles.length > 0 && !audiencia.roles.includes(role)) return false;
  if (audiencia.zonaIds.length > 0 && !audiencia.zonaIds.some(id => zonasViewer.includes(id))) return false;
  return true;
}

function alcanzaAlViewer(dto: AnuncioDTO, viewer: Identity, zonasViewer: number[]): boolean {
  return anuncioAlcanzaA(dto, viewer.role, zonasViewer);
}

export interface AnunciosListado {
  anuncios: AnuncioDTO[];
  noLeidos: number;
}

/** Lista scoped al viewer. El admin recibe además los archivados (los administra);
 * cualquier otro rol solo ve los vigentes que le tocan por rol+zona. */
export async function listAnuncios(env: Env, viewer: Identity): Promise<AnunciosListado> {
  await ensureAnuncioTables(env);
  const [{ results }, zonasViewer] = await Promise.all([
    env.DB.prepare(
      `SELECT a.*, (v.viewer_email IS NOT NULL) AS visto
         FROM anuncios a
         LEFT JOIN anuncio_visto v ON v.anuncio_id = a.id AND v.viewer_email = ?
        ORDER BY a.created_at DESC
        LIMIT 100`,
    ).bind(viewer.email).all<AnuncioRow>(),
    zonaIdsDelViewer(env, viewer),
  ]);

  const esAdmin = viewer.role === 'admin';
  const anuncios = (results ?? [])
    .map(toDTO)
    .filter(a => (esAdmin ? true : !a.archivado && alcanzaAlViewer(a, viewer, zonasViewer)));

  // El badge del sidebar cuenta solo lo que de verdad le toca leer al viewer:
  // un admin no arrastra en el contador los archivados ni los dirigidos a otros.
  const noLeidos = anuncios.filter(
    a => !a.visto && !a.archivado && alcanzaAlViewer(a, viewer, zonasViewer),
  ).length;

  return { anuncios, noLeidos };
}

function validar(input: Partial<AnuncioInput>): void {
  if (input.titulo !== undefined) {
    if (!input.titulo.trim()) throw new AnuncioError(400, 'el anuncio necesita título');
    if (input.titulo.length > MAX_TITULO) throw new AnuncioError(400, `el título no puede pasar de ${MAX_TITULO} caracteres`);
  }
  if (input.cuerpo !== undefined) {
    if (!input.cuerpo.trim()) throw new AnuncioError(400, 'el anuncio necesita mensaje');
    if (input.cuerpo.length > MAX_CUERPO) throw new AnuncioError(400, `el mensaje no puede pasar de ${MAX_CUERPO} caracteres`);
  }
  if (input.severidad !== undefined && input.severidad !== 'normal' && input.severidad !== 'importante') {
    throw new AnuncioError(400, 'severidad inválida');
  }
  if (input.roles !== undefined && input.roles.some(r => !ROLES.includes(r))) {
    throw new AnuncioError(400, 'rol inválido en la audiencia');
  }
  if (input.zonaIds !== undefined && input.zonaIds.some(id => !Number.isFinite(id))) {
    throw new AnuncioError(400, 'zona inválida en la audiencia');
  }
}

export async function createAnuncio(env: Env, viewer: Identity, input: AnuncioInput): Promise<AnuncioDTO> {
  await ensureAnuncioTables(env);
  validar(input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const roles = [...new Set(input.roles)];
  const zonaIds = [...new Set(input.zonaIds)];

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO anuncios (id, titulo, cuerpo, severidad, roles, zona_ids, autor_email, autor_nombre, archivado, wa_enviados, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,0,0,?,?)`,
    ).bind(
      id, input.titulo.trim(), input.cuerpo.trim(), input.severidad,
      JSON.stringify(roles), JSON.stringify(zonaIds),
      viewer.email, viewer.nombre ?? viewer.email, now, now,
    ),
    // El autor no se lo notifica a sí mismo: nace visto para él.
    env.DB.prepare('INSERT OR IGNORE INTO anuncio_visto (anuncio_id, viewer_email, seen_at) VALUES (?,?,?)')
      .bind(id, viewer.email, now),
  ]);

  return {
    id, titulo: input.titulo.trim(), cuerpo: input.cuerpo.trim(), severidad: input.severidad,
    roles, zonaIds, autorEmail: viewer.email, autorNombre: viewer.nombre ?? viewer.email,
    archivado: false, waEnviados: 0, visto: true, createdAt: now, updatedAt: now,
  };
}

export async function updateAnuncio(env: Env, id: string, patch: Partial<AnuncioInput>): Promise<void> {
  await ensureAnuncioTables(env);
  validar(patch);
  const row = await env.DB.prepare('SELECT id FROM anuncios WHERE id = ?').bind(id).first<{ id: string }>();
  if (!row) throw new AnuncioError(404, 'anuncio no encontrado');

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.titulo !== undefined) { sets.push('titulo = ?'); binds.push(patch.titulo.trim()); }
  if (patch.cuerpo !== undefined) { sets.push('cuerpo = ?'); binds.push(patch.cuerpo.trim()); }
  if (patch.severidad !== undefined) { sets.push('severidad = ?'); binds.push(patch.severidad); }
  if (patch.roles !== undefined) { sets.push('roles = ?'); binds.push(JSON.stringify([...new Set(patch.roles)])); }
  if (patch.zonaIds !== undefined) { sets.push('zona_ids = ?'); binds.push(JSON.stringify([...new Set(patch.zonaIds)])); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?'); binds.push(new Date().toISOString());

  await env.DB.prepare(`UPDATE anuncios SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
}

/** Archivar en vez de borrar: el comunicado sale de la vista del equipo pero
 * queda en el historial del admin (quién dijo qué y cuándo). */
export async function setArchivado(env: Env, id: string, archivado: boolean): Promise<void> {
  await ensureAnuncioTables(env);
  const res = await env.DB.prepare('UPDATE anuncios SET archivado = ?, updated_at = ? WHERE id = ?')
    .bind(archivado ? 1 : 0, new Date().toISOString(), id).run();
  if (!res.meta.changes) throw new AnuncioError(404, 'anuncio no encontrado');
}

export async function deleteAnuncio(env: Env, id: string): Promise<void> {
  await ensureAnuncioTables(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM anuncio_visto WHERE anuncio_id = ?').bind(id),
    env.DB.prepare('DELETE FROM anuncios WHERE id = ?').bind(id),
  ]);
}

export async function marcarVisto(env: Env, id: string, email: string): Promise<void> {
  await ensureAnuncioTables(env);
  await env.DB.prepare('INSERT OR IGNORE INTO anuncio_visto (anuncio_id, viewer_email, seen_at) VALUES (?,?,?)')
    .bind(id, email, new Date().toISOString()).run();
}

export async function registrarWaEnviados(env: Env, id: string, n: number): Promise<void> {
  await env.DB.prepare('UPDATE anuncios SET wa_enviados = ? WHERE id = ?').bind(n, id).run();
}

export interface DestinatarioWa { email: string; phone: string }

/** Identidades activas CON teléfono que caen en la audiencia, para el envío de
 * WhatsApp. Excluye al autor (ya sabe lo que publicó). Mismo criterio de
 * audiencia que alcanzaAlViewer, pero resuelto en SQL contra todo el roster. */
export async function destinatariosWa(
  env: Env, audiencia: { roles: Role[]; zonaIds: number[] }, autorEmail: string,
): Promise<DestinatarioWa[]> {
  const { results } = await env.DB.prepare(
    `SELECT email, phone, role, monday_user_id FROM identity WHERE active = 1 AND phone IS NOT NULL AND phone <> ''`,
  ).all<{ email: string; phone: string; role: Role; monday_user_id: number }>();
  let rows = (results ?? []).filter(r => r.email !== autorEmail);

  if (audiencia.roles.length > 0) rows = rows.filter(r => audiencia.roles.includes(r.role));

  if (audiencia.zonaIds.length > 0) {
    const placeholders = audiencia.zonaIds.map(() => '?').join(',');
    const { results: enZona } = await env.DB.prepare(
      `SELECT DISTINCT p.monday_user_id AS id
         FROM zonas z
         LEFT JOIN zona_miembros zm ON zm.zona_id = z.id
         LEFT JOIN identity p ON (p.email = zm.email OR p.email = z.lider_email) AND p.active = 1
        WHERE z.id IN (${placeholders}) AND p.monday_user_id IS NOT NULL`,
    ).bind(...audiencia.zonaIds).all<{ id: number }>();
    const ids = new Set((enZona ?? []).map(r => r.id));
    rows = rows.filter(r => ids.has(r.monday_user_id));
  }

  return rows.map(r => ({ email: r.email, phone: r.phone }));
}
