// worker/lib/accionLog.ts — bitácora de INTENTOS de escritura del portal.
//
// Por qué existe (Efraín, 2026-08-20): "el CEO le dio validar precios a unas
// oportunidades y no se envió la info a Monday… no veo ningún log". Contestar
// eso tomó media hora de arqueología entre cuatro fuentes, y ninguna podía
// contestarlo sola, porque las cuatro cuentan lo que SÍ pasó:
//   - `outbox`      → escrituras que se aceptaron y salieron a Monday.
//   - `sync_log`    → la ida y vuelta con Monday (y los 500 de app.onError).
//   - `activity_log`→ espejo de lo que Monday registró.
//   - `ux_event`    → clics, muestreados los GET, y NADA mientras se suplanta.
// Faltaba el negativo: quién pidió qué y se fue con un 403, un 400, un 404 o un
// "no cambió nada". Ese es justo el caso en que no queda rastro en ningún lado
// y es justo el que alguien reporta como "el portal no hizo nada".
//
// Tres reglas de forma:
//  1. Solo MUTACIONES (POST/PATCH/PUT/DELETE). Los GET son el 99% del tráfico
//     —la lista poletea cada 5s— y su latencia ya se mide muestreada en
//     `ux_event`. Aquí una fila por intento, sin muestreo: si se muestrea, no
//     sirve para auditar a UNA persona en UNA tarde, que es todo el punto.
//  2. Nunca agrega latencia ni tumba la petición: el INSERT va en waitUntil y
//     cualquier error se traga (ver worker/mw/accionLog.ts).
//  3. Registra a las DOS personas cuando hay suplantación: `email` es quien
//     realmente actuó (el admin) y `actua_como` el suplantado. `ux_event` tira
//     el lote completo en ese caso —a propósito, mide adopción— y `outbox`
//     guarda solo al suplantado, así que hoy una acción hecha "viendo como
//     alguien" es indistinguible de una suya.
import type { Env } from '../env';

// 400 días: la pregunta que este log contesta ("¿qué hizo fulano el día que
// se rompió tal cosa?") aparece semanas después, y una fila por mutación es
// barata — el portal hace decenas al día, no millones (24 el 2026-08-20).
export const ACCION_RETENTION_DAYS = 400;

// El detalle guarda el motivo del rechazo tal cual lo devolvió la ruta. Se
// trunca porque algunos 400 traen la lista entera de columnas válidas.
const MAX_DETALLE = 400;

// Misma poda por lotes que ux_event: SQLite en D1 no acepta `DELETE … LIMIT`.
const PURGE_CHUNK = 5000;
const PURGE_MAX_CHUNKS = 20;

let tableReady = false;

export interface AccionRow {
  /** Quien REALMENTE actuó: el admin, aunque esté suplantando. */
  email: string;
  /** Suplantado, o null si no hay suplantación. */
  actuaComo: string | null;
  /** Rol con el que corrió la petición (el del suplantado, si aplica). */
  role: string;
  metodo: string;
  ruta: string;
  status: number;
  ms: number;
  detalle: string | null;
}

async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS accion_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    actua_como TEXT,
    role       TEXT    NOT NULL,
    metodo     TEXT    NOT NULL,
    ruta       TEXT    NOT NULL,
    status     INTEGER NOT NULL,
    ok         INTEGER NOT NULL,
    ms         INTEGER NOT NULL,
    detalle    TEXT
  )`).run();
  await env.DB.batch([
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_accion_at ON accion_log(at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_accion_email ON accion_log(email, at)'),
    // La consulta típica es "todo lo que le pasó a esta oportunidad": la ruta
    // trae el id (…/items/12856153888), así que se busca por LIKE sobre `ruta`
    // y este índice al menos acota por fecha primero.
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_accion_ok ON accion_log(ok, at)'),
  ]);
  tableReady = true;
}

export async function logAccion(env: Env, row: AccionRow): Promise<void> {
  try {
    await ensureTable(env);
    await env.DB.prepare(
      `INSERT INTO accion_log (at, email, actua_como, role, metodo, ruta, status, ok, ms, detalle)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      new Date().toISOString(), row.email, row.actuaComo, row.role,
      row.metodo, row.ruta, row.status, row.status < 400 ? 1 : 0, row.ms,
      row.detalle ? row.detalle.slice(0, MAX_DETALLE) : null,
    ).run();
  } catch {
    // Una bitácora jamás debe tumbar la acción que está registrando.
  }
}

/** Poda por retención. Se cuelga del cron diario, no del de 15 min: es un
 * DELETE por rango que no tiene por qué correr 96 veces al día. */
export async function purgeAccionLog(env: Env): Promise<void> {
  try {
    await ensureTable(env);
    const corte = new Date(Date.now() - ACCION_RETENTION_DAYS * 86400_000).toISOString();
    for (let i = 0; i < PURGE_MAX_CHUNKS; i++) {
      const res = await env.DB.prepare(
        `DELETE FROM accion_log WHERE id IN (SELECT id FROM accion_log WHERE at < ? LIMIT ${PURGE_CHUNK})`,
      ).bind(corte).run();
      if (!res.meta.changes) return;
    }
  } catch {
    // Igual que arriba: si la poda falla, el cron sigue con lo suyo.
  }
}
