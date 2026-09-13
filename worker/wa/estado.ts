// worker/wa/estado.ts — Estado del chat de WhatsApp que vive en D1 y NO en el
// historial del modelo (plan docs/plan-wa-cartera.md §6: "confirmaciones en
// código"). Cuatro cosas, todas con fila que cuenta lo que pasó:
//  - wa_pendiente: la confirmación abierta ("¿muevo PRO-640 a Cancelada?") o
//    el menú/hora que se está esperando. No se borra: queda resuelto_at +
//    respuesta (sí / no / expiró / reemplazado).
//  - wa_snooze: "hoy no" → esa oportunidad no se vuelve a proponer hasta la
//    fecha.
//  - wa_lista: la última lista numerada que vio la persona (cartera o resumen)
//    para que "3" y "3: nota" resuelvan sin modelo.
//  - wa_resumen: cada resumen matutino, mandado o NO (con motivo), con los ids
//    en orden, la candidata y el wamid.
import type { Env } from '../env';

let tablasListas = false;

export async function ensureEstadoTables(env: Env): Promise<void> {
  if (tablasListas) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wa_pendiente (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL,
      tipo        TEXT NOT NULL,       -- cerrar | menu | hora
      item_id     INTEGER,
      datos       TEXT,                -- JSON libre (etapa destino, etiqueta…)
      created_at  TEXT NOT NULL,
      expira_at   TEXT NOT NULL,
      resuelto_at TEXT,
      respuesta   TEXT                 -- si | no | expiro | reemplazado
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_wa_pendiente_email ON wa_pendiente(email, resuelto_at)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wa_snooze (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      item_id    INTEGER NOT NULL,
      hasta      TEXT NOT NULL,
      motivo     TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_wa_snooze_email ON wa_snooze(email, hasta)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wa_lista (
      email      TEXT PRIMARY KEY,
      item_ids   TEXT NOT NULL,        -- JSON [item_id…] en el orden mostrado
      origen     TEXT NOT NULL,        -- cartera | resumen | filtro:<categoria>
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wa_resumen (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT NOT NULL,
      fecha        TEXT NOT NULL,      -- YYYY-MM-DD en CDMX
      enviado      INTEGER NOT NULL,   -- 1 = salió a Meta
      motivo       TEXT,               -- por qué no (cartera vacía, apagado…) o el error
      item_ids     TEXT NOT NULL DEFAULT '[]',
      candidata_id INTEGER,
      wamid        TEXT,
      created_at   TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_resumen_dia ON wa_resumen(email, fecha)'),
  ]);
  tablasListas = true;
}

// ── Pendientes (confirmaciones / menú) ────────────────────────────────────────

export type TipoPendiente = 'cerrar' | 'menu' | 'hora';

export interface Pendiente {
  id: number;
  email: string;
  tipo: TipoPendiente;
  itemId: number | null;
  datos: Record<string, unknown>;
  createdAt: string;
  expiraAt: string;
}

const PENDIENTE_TTL_MS: Record<TipoPendiente, number> = {
  cerrar: 30 * 60_000,
  menu: 10 * 60_000,
  hora: 10 * 60_000,
};

/** Abre un pendiente; el anterior sin resolver queda "reemplazado". */
export async function crearPendiente(
  env: Env, email: string, tipo: TipoPendiente, opts: { itemId?: number | null; datos?: Record<string, unknown> } = {},
): Promise<void> {
  await ensureEstadoTables(env);
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare(`UPDATE wa_pendiente SET resuelto_at = ?, respuesta = 'reemplazado' WHERE email = ? AND resuelto_at IS NULL`)
      .bind(now.toISOString(), email),
    env.DB.prepare(`INSERT INTO wa_pendiente (email, tipo, item_id, datos, created_at, expira_at) VALUES (?,?,?,?,?,?)`)
      .bind(email, tipo, opts.itemId ?? null, JSON.stringify(opts.datos ?? {}), now.toISOString(), new Date(now.getTime() + PENDIENTE_TTL_MS[tipo]).toISOString()),
  ]);
}

/** El pendiente vivo de la persona; los vencidos se marcan "expiro" al pasar. */
export async function pendienteActivo(env: Env, email: string, ahora = new Date()): Promise<Pendiente | null> {
  await ensureEstadoTables(env);
  const row = await env.DB.prepare(
    `SELECT id, email, tipo, item_id, datos, created_at, expira_at FROM wa_pendiente
      WHERE email = ? AND resuelto_at IS NULL ORDER BY id DESC LIMIT 1`,
  ).bind(email).first<{ id: number; email: string; tipo: TipoPendiente; item_id: number | null; datos: string; created_at: string; expira_at: string }>();
  if (!row) return null;
  if (new Date(row.expira_at).getTime() <= ahora.getTime()) {
    await env.DB.prepare(`UPDATE wa_pendiente SET resuelto_at = ?, respuesta = 'expiro' WHERE id = ?`).bind(ahora.toISOString(), row.id).run();
    return null;
  }
  let datos: Record<string, unknown> = {};
  try { datos = JSON.parse(row.datos || '{}'); } catch { /* datos libres */ }
  return { id: row.id, email: row.email, tipo: row.tipo, itemId: row.item_id, datos, createdAt: row.created_at, expiraAt: row.expira_at };
}

export async function resolverPendiente(env: Env, id: number, respuesta: 'si' | 'no' | 'reemplazado'): Promise<void> {
  await env.DB.prepare(`UPDATE wa_pendiente SET resuelto_at = ?, respuesta = ? WHERE id = ? AND resuelto_at IS NULL`)
    .bind(new Date().toISOString(), respuesta, id).run();
}

/** El último cierre confirmado hace menos de `minutos` — para "motivo: …". */
export async function ultimoCierre(env: Env, email: string, minutos = 30): Promise<{ itemId: number; datos: Record<string, unknown> } | null> {
  await ensureEstadoTables(env);
  const desde = new Date(Date.now() - minutos * 60_000).toISOString();
  const row = await env.DB.prepare(
    `SELECT item_id, datos FROM wa_pendiente WHERE email = ? AND tipo = 'cerrar' AND respuesta = 'si' AND resuelto_at >= ? ORDER BY id DESC LIMIT 1`,
  ).bind(email, desde).first<{ item_id: number | null; datos: string }>();
  if (!row?.item_id) return null;
  let datos: Record<string, unknown> = {};
  try { datos = JSON.parse(row.datos || '{}'); } catch { /* libre */ }
  return { itemId: row.item_id, datos };
}

// ── Snooze ("hoy no") ─────────────────────────────────────────────────────────

export async function posponer(env: Env, email: string, itemId: number, dias: number, motivo: string): Promise<string> {
  await ensureEstadoTables(env);
  const hasta = new Date(Date.now() + dias * 86_400_000).toISOString();
  await env.DB.prepare(`INSERT INTO wa_snooze (email, item_id, hasta, motivo, created_at) VALUES (?,?,?,?,?)`)
    .bind(email, itemId, hasta, motivo, new Date().toISOString()).run();
  return hasta;
}

/** item_id → hasta (solo las vigentes). */
export async function pospuestas(env: Env, email: string, ahora = new Date()): Promise<Map<number, string>> {
  await ensureEstadoTables(env);
  const { results } = await env.DB.prepare(
    `SELECT item_id, MAX(hasta) AS hasta FROM wa_snooze WHERE email = ? AND hasta > ? GROUP BY item_id`,
  ).bind(email, ahora.toISOString()).all<{ item_id: number; hasta: string }>();
  return new Map((results ?? []).map(r => [r.item_id, r.hasta]));
}

// ── Lista numerada vigente ────────────────────────────────────────────────────

export async function guardarLista(env: Env, email: string, itemIds: number[], origen: string): Promise<void> {
  await ensureEstadoTables(env);
  await env.DB.prepare(
    `INSERT INTO wa_lista (email, item_ids, origen, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET item_ids = excluded.item_ids, origen = excluded.origen, updated_at = excluded.updated_at`,
  ).bind(email, JSON.stringify(itemIds), origen, new Date().toISOString()).run();
}

export async function listaVigente(env: Env, email: string): Promise<{ itemIds: number[]; origen: string; updatedAt: string } | null> {
  await ensureEstadoTables(env);
  const row = await env.DB.prepare('SELECT item_ids, origen, updated_at FROM wa_lista WHERE email = ?')
    .bind(email).first<{ item_ids: string; origen: string; updated_at: string }>();
  if (!row) return null;
  try {
    const ids = JSON.parse(row.item_ids) as number[];
    return { itemIds: Array.isArray(ids) ? ids : [], origen: row.origen, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

// ── Resumen matutino (registro) ───────────────────────────────────────────────

export interface ResumenRegistro {
  email: string;
  fecha: string;
  enviado: boolean;
  motivo?: string | null;
  itemIds?: number[];
  candidataId?: number | null;
  wamid?: string | null;
}

/** Una fila por persona y día; la primera que entra gana (idempotente). */
export async function registrarResumen(env: Env, r: ResumenRegistro): Promise<boolean> {
  await ensureEstadoTables(env);
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO wa_resumen (email, fecha, enviado, motivo, item_ids, candidata_id, wamid, created_at) VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(r.email, r.fecha, r.enviado ? 1 : 0, r.motivo ?? null, JSON.stringify(r.itemIds ?? []), r.candidataId ?? null, r.wamid ?? null, new Date().toISOString()).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function resumenDelDia(env: Env, email: string, fecha: string): Promise<{ enviado: boolean; itemIds: number[]; candidataId: number | null; motivo: string | null } | null> {
  await ensureEstadoTables(env);
  const row = await env.DB.prepare('SELECT enviado, item_ids, candidata_id, motivo FROM wa_resumen WHERE email = ? AND fecha = ?')
    .bind(email, fecha).first<{ enviado: number; item_ids: string; candidata_id: number | null; motivo: string | null }>();
  if (!row) return null;
  let ids: number[] = [];
  try { ids = JSON.parse(row.item_ids); } catch { /* vacío */ }
  return { enviado: !!row.enviado, itemIds: ids, candidataId: row.candidata_id, motivo: row.motivo };
}

/** Última vez que cada item fue propuesto como candidata (para no repetir). */
export async function propuestasRecientes(env: Env, email: string, dias: number): Promise<Map<number, string>> {
  await ensureEstadoTables(env);
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT candidata_id, MAX(created_at) AS at FROM wa_resumen
      WHERE email = ? AND enviado = 1 AND candidata_id IS NOT NULL AND created_at >= ? GROUP BY candidata_id`,
  ).bind(email, desde).all<{ candidata_id: number; at: string }>();
  return new Map((results ?? []).map(r => [r.candidata_id, r.at]));
}

/** Fecha local CDMX (YYYY-MM-DD), hora local y día de la semana (0=dom). */
export function localCdmx(ahora = new Date()): { fecha: string; hora: number; diaSemana: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(ahora);
  const get = (t: string) => partes.find(p => p.type === t)?.value ?? '';
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hora = Number(get('hour')) % 24;
  return { fecha: `${get('year')}-${get('month')}-${get('day')}`, hora, diaSemana: dias[get('weekday')] ?? 0 };
}
