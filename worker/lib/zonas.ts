// worker/lib/zonas.ts — zonas de ventas: un líder ve, además de lo suyo, las
// oportunidades de los miembros de su zona (worker/schema.sql `zonas`).
//
// Desde 2026-09-15 el líder también ESCRIBE lo de su zona (Efraín: Ricardo
// intentó editar dos proyectos de César y recibió "not found" — "si puede
// editar lo de sus compañeros por favor"). Del 2026-07-30 a esa fecha solo
// leía: el write path pide scope 'own' (worker/lib/outbox.ts -> dal.getItem) y
// 'own' era estrictamente lo propio. Hoy 'own' = propio + viewer.write_user_ids,
// que trae la zona entera para líder y auxiliar. Fuera de la zona sigue el 404
// (nunca 403, para no filtrar de quién es). Un vendedor que no lidera ninguna
// zona conserva exactamente el scope de antes.
//
// Sin jerarquía: la consulta es de UN nivel. Si un líder es miembro de otra zona,
// su líder lo ve a él pero no a su equipo — no hay cadena que recorrer.
//
// AUXILIARES (Efraín, 2026-09-15: Paola Facundo como "Auxiliar de Ventas" de la
// zona de Ricardo — "es un rol de líder, con permisos de escritura, puede
// cambiar lo que sea necesario"): una zona puede tener, además del líder, N
// auxiliares que LEEN y ESCRIBEN lo mismo que el líder (lo suyo + miembros +
// el líder). No es un rol nuevo de identity (sigue siendo
// vendedor/compras/admin/almacen: la columna vis/w de shared/visibility.ts no
// cambia); es otra persona actuando como dueña de la zona. La atribución
// (accion_log, Vendedor de lo que crea) sigue siendo la suya, no la del dueño.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';

// Zona privada "Efrain" (Efraín, 2026-08-12): caso especial, NO un mecanismo
// genérico de "zona privada" — solo esta zona por nombre queda oculta a todo
// admin salvo la whitelist de abajo. Sus miembros viven en zona_miembros como
// cualquier otra zona (son las personas dueñas de las filas que se ocultan);
// lo especial es a quién SÍ se le muestra pese a ser admin. Antes de esto
// "admin: everything, always" (worker/lib/dal.ts) no tenía excepciones — esta
// es la única, y solo alcanza a Oportunidades/Proyectos.
const ZONA_PRIVADA_NOMBRE = 'Efrain';
// Arrancó con tres personas (Efraín, 2026-08-12), por CORREO y no por
// monday_user_id: el CEO (sus dos correos, un solo id de Monday) + Elisa
// Vallado + Efrain Ponce Salinas (hijo del CEO, mantiene el portal — pidió
// verla él mismo por si hay errores; también sus dos correos).
//
// 2026-08-21 entran dos más, "con el mismo acceso que Elisa" (Efraín): Pamela
// Ricalde "PAM" (compras@, admin) y Emily Martínez "EMY" (cotizaciones4@,
// compras). Lo que lo destapó: OPP-0946 cambió de Vendedor a Efrain Ponce y
// desapareció del portal para PAM, que seguía siendo la Responsable compras
// —hasta le llegaban sus notificaciones, ver notify.ts— y se fue a trabajarla
// a Monday.
//
// OJO con EMY: esta whitelist solo levanta la excepción de "admin ve todo"
// (hiddenOwnerIdsFor ni mira a los no-admins). Con rol 'compras' su lectura la
// sigue acotando comprasScopeFor —solo las oportunidades donde ELLA es la
// Responsable compras—, así que el tab Zona Efrain le enseña un subconjunto,
// no la zona entera. Para que la vea completa como Elisa tendría que ser
// admin: es otra decisión y no se toma sola.
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
  'compras@mexicanadeproteccion.com',        // Pamela Ricalde "PAM" — admin
  'cotizaciones4@mexicanadeproteccion.com',  // Emily Martínez "EMY" — compras
]);
export const ZONA_PRIVADA_BOARDS: ReadonlySet<BoardSlug> =
  new Set<BoardSlug>(['oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub']);

export function isZonaPrivadaAdminPermitido(email: string | null | undefined): boolean {
  return !!email && ZONA_PRIVADA_ADMINS_PERMITIDOS.has(email.trim().toLowerCase());
}

/** ¿Nace nativo (solo D1) el Contacto o Institución que da de alta este
 * correo? Lo que captura la whitelist nace nativo sin preguntar (Efraín,
 * 2026-08-18: "que sea algo normal") — salvo `native: false` explícito, que
 * manda el alta DENTRO de una oportunidad de Monday (CreateOportunidadModal):
 * una oportunidad real no puede ligar nada nativo (assertNoNativeLink) y
 * tronaría al guardarla. Fuera de la whitelist, nunca por esta vía. */
export function catalogoNaceNativo(email: string | null | undefined, native?: boolean): boolean {
  return native !== false && isZonaPrivadaAdminPermitido(email);
}

export interface Zona {
  id: number;
  nombre: string;
  liderEmail: string | null;
  miembros: string[];      // emails de identity
  auxiliares: string[];    // emails de identity — leen como el líder
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
 * nunca crea tablas (ver resolveZonaScope, que falla cerrado). */
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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS zona_auxiliares (
      zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
      email   TEXT NOT NULL REFERENCES identity(email) ON DELETE CASCADE,
      PRIMARY KEY (zona_id, email)
    )`),
  ]);
  tablesReady = true;
}

/** Alcance de zona del viewer, resuelto en UNA consulta por request:
 *  - `readIds`: monday_user_ids cuyas filas puede LEER — el suyo, más los
 *    miembros de las zonas que lidera, más (si es auxiliar de una zona) los
 *    miembros Y el líder de esa zona.
 *  - `writeIds`: los que además puede ESCRIBIR. Desde 2026-09-15 es lo mismo
 *    que `readIds` (líder y auxiliar editan su zona: "si puede editar lo de sus
 *    compañeros por favor"); se conservan separados porque el DAL distingue
 *    'read' de 'own' y mañana puede volver a haber una zona de solo lectura.
 *
 * Se resuelve por monday_user_id y no por email para que una persona con dos
 * filas de identity (login de trabajo + gmail personal, mismo id de Monday)
 * tenga el mismo alcance con cualquiera de los dos.
 *
 * Falla cerrado: si las tablas todavía no existen en esta base, el viewer se
 * queda con su scope de siempre en vez de tumbar toda la lectura. */
export interface ZonaScope {
  readIds: number[];
  writeIds: number[];
}

export async function resolveZonaScope(env: Env, viewer: Identity): Promise<ZonaScope> {
  const own = viewer.monday_user_id;
  try {
    const res = await env.DB
      .prepare(`SELECT DISTINCT m.monday_user_id AS id, 'lider' AS via
                FROM zonas z
                JOIN identity lider ON lider.email = z.lider_email
                JOIN zona_miembros zm ON zm.zona_id = z.id
                JOIN identity m ON m.email = zm.email AND m.active = 1
                WHERE lider.monday_user_id = ?1
                UNION
                SELECT DISTINCT m.monday_user_id AS id, 'auxiliar' AS via
                FROM zona_auxiliares za
                JOIN identity aux ON aux.email = za.email
                JOIN zona_miembros zm ON zm.zona_id = za.zona_id
                JOIN identity m ON m.email = zm.email AND m.active = 1
                WHERE aux.monday_user_id = ?1
                UNION
                SELECT DISTINCT lider.monday_user_id AS id, 'auxiliar' AS via
                FROM zona_auxiliares za
                JOIN identity aux ON aux.email = za.email
                JOIN zonas z ON z.id = za.zona_id
                JOIN identity lider ON lider.email = z.lider_email AND lider.active = 1
                WHERE aux.monday_user_id = ?1`)
      .bind(own)
      .all<{ id: number; via: 'lider' | 'auxiliar' }>();
    const rows = (res.results ?? []).filter(r => Number.isFinite(r.id));
    return {
      readIds: [...new Set([own, ...rows.map(r => r.id)])],
      writeIds: [...new Set([own, ...rows.map(r => r.id)])],
    };
  } catch {
    return { readIds: [own], writeIds: [own] };
  }
}

/** Campos de scope que viajan en el viewer (worker/mw/identity.ts, worker/wa/
 * store.ts, worker/wa/resumen.ts): los tres los arman igual. */
export async function zonaScopeFields(env: Env, viewer: Identity): Promise<Pick<Identity, 'scope_user_ids' | 'write_user_ids' | 'hidden_owner_ids'>> {
  const [scope, hidden] = await Promise.all([resolveZonaScope(env, viewer), hiddenOwnerIdsFor(env, viewer)]);
  return { scope_user_ids: scope.readIds, write_user_ids: scope.writeIds, hidden_owner_ids: hidden };
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

/** monday_user_ids que ESTE viewer no debe ver (worker/lib/dal.ts los excluye
 * de scopeFor/etagFor). Aplica a admin y, desde 2026-09-21, a compras (que ya
 * lee a todo el equipo). [] para los demás roles y para la whitelist — la
 * mayoría de los requests, así que no le pega a D1 sin necesidad. */
export async function hiddenOwnerIdsFor(env: Env, viewer: Identity): Promise<number[]> {
  if ((viewer.role !== 'admin' && viewer.role !== 'compras') || isZonaPrivadaAdminPermitido(viewer.email)) return [];
  return zonaPrivadaMemberIds(env);
}

export async function listZonas(env: Env): Promise<Zona[]> {
  await ensureZonaTables(env);
  const [zonas, miembros, auxiliares] = await Promise.all([
    env.DB.prepare('SELECT id, nombre, lider_email FROM zonas ORDER BY nombre')
      .all<{ id: number; nombre: string; lider_email: string | null }>(),
    env.DB.prepare('SELECT zona_id, email FROM zona_miembros ORDER BY email')
      .all<{ zona_id: number; email: string }>(),
    env.DB.prepare('SELECT zona_id, email FROM zona_auxiliares ORDER BY email')
      .all<{ zona_id: number; email: string }>(),
  ]);
  const agrupa = (rows: { zona_id: number; email: string }[] | undefined) => {
    const byZona = new Map<number, string[]>();
    for (const row of rows ?? []) {
      const list = byZona.get(row.zona_id) ?? [];
      list.push(row.email);
      byZona.set(row.zona_id, list);
    }
    return byZona;
  };
  const miembrosPorZona = agrupa(miembros.results);
  const auxiliaresPorZona = agrupa(auxiliares.results);
  return (zonas.results ?? []).map(z => ({
    id: z.id,
    nombre: z.nombre,
    liderEmail: z.lider_email,
    miembros: miembrosPorZona.get(z.id) ?? [],
    auxiliares: auxiliaresPorZona.get(z.id) ?? [],
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
  return { id: row!.id, nombre: clean, liderEmail: null, miembros: [], auxiliares: [] };
}

/** Reemplaza el estado completo de la zona (mismo criterio que setBoardAccess:
 * el cliente manda el conjunto final, no un diff). */
export async function updateZona(
  env: Env,
  id: number,
  patch: { nombre?: string; liderEmail?: string | null; miembros?: string[]; auxiliares?: string[] },
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

  if (patch.auxiliares !== undefined) {
    const clean = [...new Set(patch.auxiliares.map(e => e.trim()).filter(Boolean))];
    for (const email of clean) await assertIdentityExists(env, email);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM zona_auxiliares WHERE zona_id = ?').bind(id),
      ...clean.map(email => env.DB.prepare('INSERT INTO zona_auxiliares (zona_id, email) VALUES (?, ?)').bind(id, email)),
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
    env.DB.prepare('DELETE FROM zona_auxiliares WHERE zona_id = ?').bind(id),
    env.DB.prepare('DELETE FROM zonas WHERE id = ?').bind(id),
  ]);
}
