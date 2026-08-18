// worker/lib/zonas.ts — zonas de ventas: un líder ve, además de lo suyo, las
// oportunidades de los miembros de su zona (worker/schema.sql `zonas`).
//
// Solo ensancha la LECTURA. La escritura sigue siendo estrictamente propia: el
// write path pide scope 'own' (worker/lib/outbox.ts -> dal.getItem), así que el
// líder recibe 404 al intentar escribir sobre una oportunidad ajena — nunca 403,
// para no filtrar de quién es. Un vendedor que no lidera ninguna zona conserva
// exactamente el scope de antes.
//
// Sin jerarquía: la consulta es de UN nivel. Si un líder es miembro de otra zona,
// su líder lo ve a él pero no a su equipo — no hay cadena que recorrer.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';

// Zona privada "Efrain" (Efraín, 2026-08-12): caso especial, NO un mecanismo
// genérico de "zona privada" — solo esta zona por nombre queda oculta a todo
// admin salvo los dos de abajo. Sus miembros viven en zona_miembros como
// cualquier otra zona (son las personas dueñas de las filas que se ocultan);
// lo especial es a quién SÍ se le muestra pese a ser admin. Antes de esto
// "admin: everything, always" (worker/lib/dal.ts) no tenía excepciones — esta
// es la única, y solo alcanza a Oportunidades/Proyectos.
const ZONA_PRIVADA_NOMBRE = 'Efrain';
// Las MISMAS tres personas de siempre (Efraín, 2026-08-12), ahora por CORREO y
// no por monday_user_id: el CEO (sus dos correos, un solo id de Monday) + Elisa
// Vallado + Efrain Ponce Salinas (hijo del CEO, mantiene el portal — pidió
// verla él mismo por si hay errores; también sus dos correos).
//
// Por qué el correo y no el id (2026-08-18): "Actuar en Monday como"
// (worker/routes/admin.ts) presta un monday_user_id a un usuario nuevo, y con
// eso un vendedor dado de alta con el id de un permitido HEREDABA la zona
// entera — tab de Zona Efrain, alta de registros ahí dentro y las
// notificaciones reservadas a la whitelist. El correo sí es la persona.
const ZONA_PRIVADA_ADMINS_PERMITIDOS = new Set<string>([
  'efrainponce@mexicanadeproteccion.com',
  'efrain.ponce@mexicanadeproteccion.com',
  'administracion@mexicanadeproteccion.com',
  'salinasefrain@mexicanadeproteccion.com',
  'efrain.ponces@gmail.com',
]);
export const ZONA_PRIVADA_BOARDS: ReadonlySet<BoardSlug> =
  new Set<BoardSlug>(['oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub']);

export function isZonaPrivadaAdminPermitido(email: string | null | undefined): boolean {
  return !!email && ZONA_PRIVADA_ADMINS_PERMITIDOS.has(email.trim().toLowerCase());
}

export interface Zona {
  id: number;
  nombre: string;
  liderEmail: string | null;
  miembros: string[];      // emails de identity
}

export class ZonaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let tablesReady = false;

/** Mismo patrón que ensureDocumentTables: la feature funciona sin aplicar
 * schema.sql a mano. Solo la llaman las rutas de admin — el camino de lectura
 * nunca crea tablas (ver readableUserIds, que falla cerrado). */
export async function ensureZonaTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS zonas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT NOT NULL UNIQUE,
      lider_email TEXT REFERENCES identity(email) ON DELETE SET NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS zona_miembros (
      zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
      email   TEXT NOT NULL REFERENCES identity(email) ON DELETE CASCADE,
      PRIMARY KEY (zona_id, email)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_zona_miembros_email ON zona_miembros(email)'),
  ]);
  tablesReady = true;
}

/** monday_user_ids cuyas filas puede LEER el viewer: el suyo, más los de los
 * miembros de las zonas que lidera. Se resuelve por monday_user_id y no por
 * email para que un líder con dos filas de identity (login de trabajo + gmail
 * personal, mismo id de Monday) lidere igual con cualquiera de los dos.
 *
 * Falla cerrado: si las tablas todavía no existen en esta base, el viewer se
 * queda con su scope de siempre en vez de tumbar toda la lectura. */
export async function readableUserIds(env: Env, viewer: Identity): Promise<number[]> {
  const own = [viewer.monday_user_id];
  try {
    const res = await env.DB
      .prepare(`SELECT DISTINCT m.monday_user_id AS id
                FROM zonas z
                JOIN identity lider ON lider.email = z.lider_email
                JOIN zona_miembros zm ON zm.zona_id = z.id
                JOIN identity m ON m.email = zm.email AND m.active = 1
                WHERE lider.monday_user_id = ?`)
      .bind(viewer.monday_user_id)
      .all<{ id: number }>();
    const ids = (res.results ?? []).map(r => r.id).filter(Number.isFinite);
    return [...new Set([...own, ...ids])];
  } catch {
    return own;
  }
}

/** monday_user_ids de los miembros de la zona privada 'Efrain' (sea cual sea el
 * viewer) — las personas cuyas oportunidades/proyectos se ocultan. Falla
 * cerrado: sin tablas todavía, no hay nadie que ocultar. */
export async function zonaPrivadaMemberIds(env: Env): Promise<number[]> {
  try {
    const res = await env.DB
      .prepare(`SELECT DISTINCT m.monday_user_id AS id
                FROM zonas z
                JOIN zona_miembros zm ON zm.zona_id = z.id
                JOIN identity m ON m.email = zm.email AND m.active = 1
                WHERE z.nombre = ? COLLATE NOCASE`)
      .bind(ZONA_PRIVADA_NOMBRE)
      .all<{ id: number }>();
    return (res.results ?? []).map(r => r.id).filter(Number.isFinite);
  } catch {
    return [];
  }
}

/** monday_user_ids que ESTE viewer admin no debe ver (worker/lib/dal.ts los
 * excluye de scopeFor/etagFor). [] para todo no-admin y para los dos admins
 * permitidos — la mayoría de los requests, así que no le pega a D1 sin
 * necesidad. */
export async function hiddenOwnerIdsFor(env: Env, viewer: Identity): Promise<number[]> {
  if (viewer.role !== 'admin' || isZonaPrivadaAdminPermitido(viewer.email)) return [];
  return zonaPrivadaMemberIds(env);
}

export async function listZonas(env: Env): Promise<Zona[]> {
  await ensureZonaTables(env);
  const [zonas, miembros] = await Promise.all([
    env.DB.prepare('SELECT id, nombre, lider_email FROM zonas ORDER BY nombre')
      .all<{ id: number; nombre: string; lider_email: string | null }>(),
    env.DB.prepare('SELECT zona_id, email FROM zona_miembros ORDER BY email')
      .all<{ zona_id: number; email: string }>(),
  ]);
  const byZona = new Map<number, string[]>();
  for (const row of miembros.results ?? []) {
    const list = byZona.get(row.zona_id) ?? [];
    list.push(row.email);
    byZona.set(row.zona_id, list);
  }
  return (zonas.results ?? []).map(z => ({
    id: z.id,
    nombre: z.nombre,
    liderEmail: z.lider_email,
    miembros: byZona.get(z.id) ?? [],
  }));
}

async function assertIdentityExists(env: Env, email: string): Promise<void> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM identity WHERE email = ?').bind(email).first<{ ok: number }>();
  if (!row) throw new ZonaError(400, `'${email}' no está en el roster del portal`);
}

export async function createZona(env: Env, nombre: string): Promise<Zona> {
  await ensureZonaTables(env);
  const clean = nombre.trim();
  if (!clean) throw new ZonaError(400, 'la zona necesita nombre');
  const dup = await env.DB.prepare('SELECT 1 AS ok FROM zonas WHERE nombre = ? COLLATE NOCASE').bind(clean).first();
  if (dup) throw new ZonaError(409, `ya existe una zona '${clean}'`);
  const row = await env.DB
    .prepare('INSERT INTO zonas (nombre, lider_email) VALUES (?, NULL) RETURNING id')
    .bind(clean)
    .first<{ id: number }>();
  return { id: row!.id, nombre: clean, liderEmail: null, miembros: [] };
}

/** Reemplaza el estado completo de la zona (mismo criterio que setBoardAccess:
 * el cliente manda el conjunto final, no un diff). */
export async function updateZona(
  env: Env,
  id: number,
  patch: { nombre?: string; liderEmail?: string | null; miembros?: string[] },
): Promise<void> {
  await ensureZonaTables(env);
  const zona = await env.DB.prepare('SELECT id FROM zonas WHERE id = ?').bind(id).first<{ id: number }>();
  if (!zona) throw new ZonaError(404, 'zona no encontrada');

  if (patch.nombre !== undefined) {
    const clean = patch.nombre.trim();
    if (!clean) throw new ZonaError(400, 'la zona necesita nombre');
    const dup = await env.DB
      .prepare('SELECT 1 AS ok FROM zonas WHERE nombre = ? COLLATE NOCASE AND id <> ?')
      .bind(clean, id)
      .first();
    if (dup) throw new ZonaError(409, `ya existe una zona '${clean}'`);
    await env.DB.prepare('UPDATE zonas SET nombre = ? WHERE id = ?').bind(clean, id).run();
  }

  if (patch.liderEmail !== undefined) {
    if (patch.liderEmail) await assertIdentityExists(env, patch.liderEmail);
    await env.DB.prepare('UPDATE zonas SET lider_email = ? WHERE id = ?').bind(patch.liderEmail || null, id).run();
  }

  if (patch.miembros !== undefined) {
    const clean = [...new Set(patch.miembros.map(e => e.trim()).filter(Boolean))];
    for (const email of clean) await assertIdentityExists(env, email);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM zona_miembros WHERE zona_id = ?').bind(id),
      ...clean.map(email => env.DB.prepare('INSERT INTO zona_miembros (zona_id, email) VALUES (?, ?)').bind(id, email)),
    ]);
  }
}

export async function deleteZona(env: Env, id: number): Promise<void> {
  await ensureZonaTables(env);
  // Sin ON DELETE CASCADE efectivo: D1 no trae foreign_keys=ON por defecto, así
  // que los miembros se borran a mano para no dejar filas huérfanas que
  // reaparecerían si un id de zona se reutiliza.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM zona_miembros WHERE zona_id = ?').bind(id),
    env.DB.prepare('DELETE FROM zonas WHERE id = ?').bind(id),
  ]);
}
