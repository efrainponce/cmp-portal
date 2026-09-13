// worker/wa/preferencias.ts — Qué recibe cada número por WhatsApp (plan
// docs/plan-wa-cartera.md §7, Efraín 2026-09-12: "una opción para no recibir
// las actualizaciones o por número saber cuáles recibir o no").
//
// Una fila por correo (el teléfono se resuelve por identity, como todo):
//   1 resumen   — el mensaje matutino (opt-in: apagado hasta que lo prendan)
//   2 cierre    — la línea "Para cerrar hoy" + botón "Cerrar esa"
//   3 avisos    — menciones / costeo incompleto / firma por WhatsApp
//                 (worker/wa/notify.ts; hoy se mandaban siempre → default prendido)
//   4 hora      — hora en punto CDMX del resumen (7–12)
//   5 sabado    — incluir sábados
//   pausa_hasta — "pausa": apaga 1 y 2 hasta esa fecha (o hasta "reanudar")
//   todo_apagado— "parar": apaga TODO lo proactivo, avisos incluidos (Meta lo
//                 exige para mensajes iniciados por el negocio); el bot sigue
//                 contestando si la persona escribe.
// Cada cambio queda en wa_preferencias_log (quién, desde dónde, antes → después).
// Las notificaciones del portal (campana) no cambian: esto es solo WhatsApp.
import type { Env } from '../env';

export interface Preferencias {
  email: string;
  resumen: boolean;
  cierre: boolean;
  avisos: boolean;
  hora: number;
  sabado: boolean;
  pausaHasta: string | null;
  todoApagado: boolean;
  updatedAt: string | null;
}

export const PREF_DEFAULT: Omit<Preferencias, 'email' | 'updatedAt'> = {
  resumen: false, cierre: false, avisos: true, hora: 8, sabado: false, pausaHasta: null, todoApagado: false,
};

export const HORA_MIN = 7;
export const HORA_MAX = 12;

let tablasListas = false;

export async function ensurePreferenciasTables(env: Env): Promise<void> {
  if (tablasListas) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wa_preferencias (
      email        TEXT PRIMARY KEY,
      resumen      INTEGER NOT NULL DEFAULT 0,
      cierre       INTEGER NOT NULL DEFAULT 0,
      avisos       INTEGER NOT NULL DEFAULT 1,
      hora         INTEGER NOT NULL DEFAULT 8,
      sabado       INTEGER NOT NULL DEFAULT 0,
      pausa_hasta  TEXT,
      todo_apagado INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wa_preferencias_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      campo      TEXT NOT NULL,
      antes      TEXT,
      despues    TEXT,
      por        TEXT NOT NULL,       -- correo de quien cambió (la persona o un admin)
      origen     TEXT NOT NULL,       -- whatsapp | admin
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_wa_pref_log_email ON wa_preferencias_log(email, created_at)'),
  ]);
  tablasListas = true;
}

interface Row {
  email: string; resumen: number; cierre: number; avisos: number; hora: number; sabado: number;
  pausa_hasta: string | null; todo_apagado: number; updated_at: string;
}

const deRow = (r: Row): Preferencias => ({
  email: r.email, resumen: !!r.resumen, cierre: !!r.cierre, avisos: !!r.avisos, hora: r.hora, sabado: !!r.sabado,
  pausaHasta: r.pausa_hasta, todoApagado: !!r.todo_apagado, updatedAt: r.updated_at,
});

export async function getPreferencias(env: Env, email: string): Promise<Preferencias> {
  await ensurePreferenciasTables(env);
  const row = await env.DB.prepare('SELECT * FROM wa_preferencias WHERE email = ?').bind(email).first<Row>();
  return row ? deRow(row) : { email, ...PREF_DEFAULT, updatedAt: null };
}

export async function listPreferencias(env: Env): Promise<Map<string, Preferencias>> {
  await ensurePreferenciasTables(env);
  const { results } = await env.DB.prepare('SELECT * FROM wa_preferencias').all<Row>();
  return new Map((results ?? []).map(r => [r.email, deRow(r)]));
}

export type CampoPref = 'resumen' | 'cierre' | 'avisos' | 'hora' | 'sabado' | 'pausaHasta' | 'todoApagado';
const COLUMNA: Record<CampoPref, string> = {
  resumen: 'resumen', cierre: 'cierre', avisos: 'avisos', hora: 'hora', sabado: 'sabado', pausaHasta: 'pausa_hasta', todoApagado: 'todo_apagado',
};

export class PreferenciaError extends Error {}

/** Cambia UN campo y deja la fila del log. `por` = quién lo cambió (la
 * persona desde su chat, o un admin desde el portal). */
export async function setPreferencia(
  env: Env, email: string, campo: CampoPref, valor: boolean | number | string | null,
  quien: { por: string; origen: 'whatsapp' | 'admin' },
): Promise<Preferencias> {
  const actual = await getPreferencias(env, email);
  let nuevo: number | string | null;
  if (campo === 'hora') {
    const h = Number(valor);
    if (!Number.isInteger(h) || h < HORA_MIN || h > HORA_MAX) throw new PreferenciaError(`La hora debe ser entre ${HORA_MIN} y ${HORA_MAX}.`);
    nuevo = h;
  } else if (campo === 'pausaHasta') {
    nuevo = valor === null || valor === '' ? null : String(valor);
  } else {
    nuevo = valor ? 1 : 0;
  }
  const antes = actual[campo];
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO wa_preferencias (email, resumen, cierre, avisos, hora, sabado, pausa_hasta, todo_apagado, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET ${COLUMNA[campo]} = excluded.${COLUMNA[campo]}, updated_at = excluded.updated_at`,
    ).bind(
      email,
      campo === 'resumen' ? nuevo : actual.resumen ? 1 : 0,
      campo === 'cierre' ? nuevo : actual.cierre ? 1 : 0,
      campo === 'avisos' ? nuevo : actual.avisos ? 1 : 0,
      campo === 'hora' ? nuevo : actual.hora,
      campo === 'sabado' ? nuevo : actual.sabado ? 1 : 0,
      campo === 'pausaHasta' ? nuevo : actual.pausaHasta,
      campo === 'todoApagado' ? nuevo : actual.todoApagado ? 1 : 0,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO wa_preferencias_log (email, campo, antes, despues, por, origen, created_at) VALUES (?,?,?,?,?,?,?)`,
    ).bind(email, campo, antes === null ? null : String(antes), nuevo === null ? null : String(nuevo), quien.por, quien.origen, now),
  ]);
  return getPreferencias(env, email);
}

// ── Decisiones de envío ───────────────────────────────────────────────────────

const enPausa = (p: Preferencias, ahora: Date) => !!p.pausaHasta && new Date(p.pausaHasta).getTime() > ahora.getTime();

/** ¿Le mandamos un aviso importante (mención, costeo, firma) por WhatsApp? */
export function puedeRecibirAviso(p: Preferencias): boolean {
  return p.avisos && !p.todoApagado;
}

/** ¿Le toca el resumen matutino ahora? `motivo` explica el no (queda en
 * wa_resumen aunque no se mande). `horaLocal`/`diaSemana` en CDMX
 * (0 = domingo). Ventana: su hora y las dos siguientes (por si el cron se
 * saltó una corrida). */
export function tocaResumen(p: Preferencias, horaLocal: number, diaSemana: number, ahora: Date): { toca: boolean; motivo?: string } {
  if (p.todoApagado) return { toca: false, motivo: 'todo apagado (parar)' };
  if (!p.resumen) return { toca: false, motivo: 'resumen apagado' };
  if (enPausa(p, ahora)) return { toca: false, motivo: `en pausa hasta ${p.pausaHasta!.slice(0, 10)}` };
  if (diaSemana === 0) return { toca: false, motivo: 'domingo' };
  if (diaSemana === 6 && !p.sabado) return { toca: false, motivo: 'sábado apagado' };
  if (horaLocal < p.hora || horaLocal > p.hora + 2) return { toca: false, motivo: `fuera de hora (${p.hora}:00)` };
  return { toca: true };
}

// ── Menú y comandos de texto (sin modelo) ─────────────────────────────────────

const ok = (b: boolean) => b ? '✅' : '⛔';

export function renderMenu(p: Preferencias, ahora = new Date()): string {
  const pausa = enPausa(p, ahora) ? `\n⏸ En pausa hasta ${p.pausaHasta!.slice(0, 10)} (escribe *reanudar*)` : '';
  const parar = p.todoApagado ? '\n🔕 Todo apagado (escribe *reanudar* para volver a recibir)' : '';
  return [
    '*Qué te llega por WhatsApp*',
    `1. Resumen matutino ${ok(p.resumen)}`,
    `2. Propuesta de cierre ${ok(p.cierre)}`,
    `3. Avisos importantes (menciones, costeo, firma) ${ok(p.avisos)}`,
    `4. Hora del resumen: ${p.hora}:00`,
    `5. Sábados ${ok(p.sabado)}`,
    '',
    'Responde el número para cambiarlo. También: *pausa* (1 y 2 hasta que digas *reanudar*), *pausa 2 semanas*, *parar* (todo).',
  ].join('\n') + pausa + parar;
}

const PALABRAS_MENU = new Set(['ajustes', 'ajuste', 'config', 'configuracion', 'configuración', 'opciones', 'preferencias', 'notificaciones']);
const PALABRAS_PARAR = new Set(['parar', 'stop', 'baja', 'darme de baja', 'no molestar', 'cancelar suscripcion', 'cancelar suscripción']);
const PALABRAS_REANUDAR = new Set(['reanudar', 'continuar', 'seguir', 'activar', 'prender']);

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export type ComandoPref =
  | { tipo: 'menu' }
  | { tipo: 'parar' }
  | { tipo: 'reanudar' }
  | { tipo: 'pausa'; dias: number | null }
  | { tipo: 'opcion'; n: 1 | 2 | 3 | 4 | 5 }
  | { tipo: 'hora'; hora: number };

/** Interpreta un texto como comando de preferencias. `menuAbierto` = la
 * persona acaba de ver el menú (un "3" suelto es una opción, no un item de
 * la cartera); `esperandoHora` = se le preguntó la hora. */
export function parseComandoPref(texto: string, ctx: { menuAbierto: boolean; esperandoHora: boolean }): ComandoPref | null {
  const t = norm(texto);
  if (PALABRAS_MENU.has(t)) return { tipo: 'menu' };
  if (PALABRAS_PARAR.has(t)) return { tipo: 'parar' };
  if (PALABRAS_REANUDAR.has(t)) return { tipo: 'reanudar' };
  const pausa = /^pausa(?:r)?(?:\s+(\d+)\s*(dia|dias|semana|semanas|mes|meses))?$/.exec(t);
  if (pausa) {
    if (!pausa[1]) return { tipo: 'pausa', dias: null };
    const n = Number(pausa[1]);
    const u = pausa[2];
    const dias = u.startsWith('semana') ? n * 7 : u.startsWith('mes') ? n * 30 : n;
    return { tipo: 'pausa', dias: Math.min(Math.max(dias, 1), 365) };
  }
  if (ctx.esperandoHora) {
    const h = /^(\d{1,2})(?::00)?\s*(?:am|hrs|h)?$/.exec(t);
    if (h) return { tipo: 'hora', hora: Number(h[1]) };
  }
  if (ctx.menuAbierto && /^[1-5]$/.test(t)) return { tipo: 'opcion', n: Number(t) as 1 | 2 | 3 | 4 | 5 };
  return null;
}

/** Aplica el comando y arma la respuesta fija. Devuelve también qué quedó
 * pendiente (menú abierto / esperando hora) para el router. */
export async function aplicarComandoPref(
  env: Env, email: string, cmd: ComandoPref, ahora = new Date(),
): Promise<{ respuesta: string; pendiente: 'menu' | 'hora' | null }> {
  const quien = { por: email, origen: 'whatsapp' as const };
  const pie = '\nEscribe *ajustes* cuando quieras cambiarlo.';
  // Tras cambiar una opción el menú sigue abierto 10 min: se puede responder
  // otro número sin volver a escribir "ajustes".
  const sigue = '\n¿Otro cambio? Responde el número (1–5) o escribe cualquier otra cosa para seguir.';
  switch (cmd.tipo) {
    case 'menu':
      return { respuesta: renderMenu(await getPreferencias(env, email), ahora), pendiente: 'menu' };
    case 'parar':
      await setPreferencia(env, email, 'todoApagado', true, quien);
      return { respuesta: 'Listo: ya no te mando nada por mi cuenta (ni resumen ni avisos). Si me escribes, te contesto igual. Escribe *reanudar* para volver a recibirlos.', pendiente: null };
    case 'reanudar': {
      await setPreferencia(env, email, 'todoApagado', false, quien);
      await setPreferencia(env, email, 'pausaHasta', null, quien);
      const p = await getPreferencias(env, email);
      return { respuesta: `Listo, reanudado. Resumen matutino ${p.resumen ? 'prendido' : 'apagado'}, avisos ${p.avisos ? 'prendidos' : 'apagados'}.${pie}`, pendiente: null };
    }
    case 'pausa': {
      const hasta = cmd.dias ? new Date(ahora.getTime() + cmd.dias * 86_400_000).toISOString() : '2999-12-31T00:00:00.000Z';
      await setPreferencia(env, email, 'pausaHasta', hasta, quien);
      const cuando = cmd.dias ? `hasta el ${hasta.slice(0, 10)}` : 'hasta que escribas *reanudar*';
      return { respuesta: `Listo: pauso el resumen matutino y la propuesta de cierre ${cuando}. Los avisos importantes siguen.${pie}`, pendiente: null };
    }
    case 'hora': {
      try {
        await setPreferencia(env, email, 'hora', cmd.hora, quien);
      } catch (err) {
        if (err instanceof PreferenciaError) return { respuesta: `${err.message} ¿A qué hora lo quieres?`, pendiente: 'hora' };
        throw err;
      }
      return { respuesta: `Listo: el resumen te llega a las ${cmd.hora}:00.${pie}`, pendiente: null };
    }
    case 'opcion': {
      const p = await getPreferencias(env, email);
      switch (cmd.n) {
        case 1: {
          const v = !p.resumen;
          await setPreferencia(env, email, 'resumen', v, quien);
          return { respuesta: v ? `Listo: te llega el resumen matutino a las ${p.hora}:00.${sigue}` : `Listo: ya no te llega el resumen matutino.${sigue}`, pendiente: 'menu' };
        }
        case 2: {
          const v = !p.cierre;
          await setPreferencia(env, email, 'cierre', v, quien);
          return { respuesta: v ? `Listo: en el resumen te propongo una oportunidad para cerrar cada día.${sigue}` : `Listo: ya no te propongo cierres.${sigue}`, pendiente: 'menu' };
        }
        case 3: {
          const v = !p.avisos;
          await setPreferencia(env, email, 'avisos', v, quien);
          return { respuesta: v ? `Listo: te llegan los avisos importantes por WhatsApp.${sigue}` : `Listo: los avisos importantes ya solo se ven en el portal.${sigue}`, pendiente: 'menu' };
        }
        case 4:
          return { respuesta: `¿A qué hora quieres el resumen? Responde con la hora en punto (entre ${HORA_MIN} y ${HORA_MAX}), por ejemplo "9".`, pendiente: 'hora' };
        case 5: {
          const v = !p.sabado;
          await setPreferencia(env, email, 'sabado', v, quien);
          return { respuesta: v ? `Listo: el resumen también sale los sábados.${sigue}` : `Listo: sin resumen los sábados.${sigue}`, pendiente: 'menu' };
        }
      }
    }
  }
  return { respuesta: renderMenu(await getPreferencias(env, email), ahora), pendiente: 'menu' };
}
