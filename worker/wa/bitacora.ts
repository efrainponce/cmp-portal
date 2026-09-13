// worker/wa/bitacora.ts — Bitácora del agente (Efraín, 2026-09-12: "necesitamos
// log de todo, todo se guarda en algún lado ¿verdad?"). No se guardaba: el
// historial `wa_conversations` es memoria de trabajo (se recorta a 24 h / 40
// mensajes) y `accion_log` es middleware de las mutaciones HTTP del portal —
// el webhook de Meta no pasa por ahí como acción de una persona. Nada
// registraba los mensajes ENTRANTES, qué tool corrió el modelo ni cuánto costó
// cada llamada.
//
// Dos tablas, mismas reglas de forma que accion_log:
//  - `wa_entrante`: una fila por mensaje que llega (texto o botón), con quién
//    lo atendió (router:<comando> | agente | rechazado:<motivo>), la
//    respuesta, la latencia y el error si lo hubo. Texto completo: es lo que
//    el vendedor dijo de su cliente y es lo que se va a querer leer después.
//  - `agente_evento`: una fila por LLAMADA al modelo (tokens, costo) y una por
//    TOOL que corrió (input y resultado resumidos). Cubre WhatsApp y la burbuja
//    del portal, que tampoco lo tenía.
// Sin muestreo, best-effort (nunca tumba ni retrasa la respuesta), retención
// 400 días (la poda cuelga del cron semanal, worker/index.ts).
import type { Env } from '../env';

export type Canal = 'whatsapp' | 'portal';

let tablasListas = false;

export async function ensureBitacoraTables(env: Env): Promise<void> {
  if (tablasListas) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wa_entrante (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      wamid        TEXT,
      telefono     TEXT NOT NULL,
      email        TEXT,
      tipo         TEXT NOT NULL,      -- text | button | interactive | otro
      texto        TEXT NOT NULL,
      atendido_por TEXT NOT NULL,      -- router:<comando> | agente | rechazado:<motivo>
      respuesta    TEXT,
      latencia_ms  INTEGER,
      error        TEXT,
      created_at   TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_wa_entrante_email ON wa_entrante(email, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_wa_entrante_created ON wa_entrante(created_at)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS agente_evento (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      canal         TEXT NOT NULL,     -- whatsapp | portal
      email         TEXT NOT NULL,
      tipo          TEXT NOT NULL,     -- llamada | tool
      modelo        TEXT,
      tokens_in     INTEGER,
      tokens_out    INTEGER,
      tokens_cache  INTEGER,           -- leídos de caché
      costo_usd     REAL,
      tool          TEXT,
      input         TEXT,              -- resumido a 300
      resultado     TEXT,              -- resumido a 300
      is_error      INTEGER NOT NULL DEFAULT 0,
      ms            INTEGER,
      created_at    TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_agente_evento_email ON agente_evento(email, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_agente_evento_created ON agente_evento(created_at)'),
  ]);
  tablasListas = true;
}

const corto = (s: unknown, n = 300): string | null => {
  if (s == null) return null;
  const t = typeof s === 'string' ? s : JSON.stringify(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export interface EntranteInput {
  wamid?: string | null;
  telefono: string;
  email?: string | null;
  tipo: string;
  texto: string;
  atendidoPor: string;
  respuesta?: string | null;
  latenciaMs?: number | null;
  error?: string | null;
}

export async function registrarEntrante(env: Env, e: EntranteInput): Promise<void> {
  try {
    await ensureBitacoraTables(env);
    await env.DB.prepare(
      `INSERT INTO wa_entrante (wamid, telefono, email, tipo, texto, atendido_por, respuesta, latencia_ms, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      e.wamid ?? null, e.telefono, e.email ?? null, e.tipo, e.texto.slice(0, 4000), e.atendidoPor.slice(0, 80),
      e.respuesta ? e.respuesta.slice(0, 4000) : null, e.latenciaMs ?? null, e.error ? e.error.slice(0, 500) : null,
      new Date().toISOString(),
    ).run();
  } catch (err) {
    console.warn(`[wa/bitacora] entrante no registrado: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Precios de Haiku 4.5 por millón de tokens (platform.claude.com, 2026-09):
 * entrada $1, salida $5, lectura de caché $0.10, escritura de caché $1.25. Es
 * una estimación para la bitácora, no la factura. */
export const PRECIO_HAIKU = { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 };

export interface Uso {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costoUsd(u: Uso, p = PRECIO_HAIKU): number {
  const m = (n: number | null | undefined, precio: number) => ((n ?? 0) / 1_000_000) * precio;
  const total = m(u.input_tokens, p.in) + m(u.output_tokens, p.out)
    + m(u.cache_read_input_tokens, p.cacheRead) + m(u.cache_creation_input_tokens, p.cacheWrite);
  return Math.round(total * 1_000_000) / 1_000_000;
}

export interface AgenteEventoInput {
  canal: Canal;
  email: string;
  tipo: 'llamada' | 'tool';
  modelo?: string;
  uso?: Uso;
  tool?: string;
  input?: unknown;
  resultado?: unknown;
  isError?: boolean;
  ms?: number;
}

export async function registrarAgenteEvento(env: Env, e: AgenteEventoInput): Promise<void> {
  try {
    await ensureBitacoraTables(env);
    await env.DB.prepare(
      `INSERT INTO agente_evento (canal, email, tipo, modelo, tokens_in, tokens_out, tokens_cache, costo_usd, tool, input, resultado, is_error, ms, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      e.canal, e.email, e.tipo, e.modelo ?? null,
      e.uso?.input_tokens ?? null, e.uso?.output_tokens ?? null, e.uso?.cache_read_input_tokens ?? null,
      e.uso ? costoUsd(e.uso) : null,
      e.tool ?? null, corto(e.input), corto(e.resultado), e.isError ? 1 : 0, e.ms ?? null,
      new Date().toISOString(),
    ).run();
  } catch (err) {
    console.warn(`[wa/bitacora] evento no registrado: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const BITACORA_RETENCION_DIAS = 400;

/** Poda semanal (cron de backup, worker/index.ts). Nunca lanza. */
export async function purgeBitacora(env: Env): Promise<void> {
  try {
    await ensureBitacoraTables(env);
    const corte = new Date(Date.now() - BITACORA_RETENCION_DIAS * 86_400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM wa_entrante WHERE created_at < ?').bind(corte),
      env.DB.prepare('DELETE FROM agente_evento WHERE created_at < ?').bind(corte),
    ]);
  } catch (err) {
    console.warn(`[wa/bitacora] poda falló: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface LineaTiempo {
  at: string;
  fuente: 'enviado' | 'entrante' | 'llamada' | 'tool' | 'resumen';
  resumen: string;
  detalle: Record<string, unknown>;
}

/** Línea de tiempo de UNA persona (GET /api/admin/wa/bitacora y
 * scripts/wa-bitacora.mjs): lo que le mandamos, lo que contestó, quién lo
 * atendió, qué corrió el modelo y qué costó. Tope de 300 filas por fuente. */
export async function lineaDeTiempo(env: Env, email: string, desde: string): Promise<LineaTiempo[]> {
  await ensureBitacoraTables(env);
  const out: LineaTiempo[] = [];
  const enviados = await env.DB.prepare(
    `SELECT tipo, titulo, estado, error, created_at, entregado_at, leido_at FROM wa_mensaje
      WHERE email = ? AND created_at >= ? ORDER BY created_at LIMIT 300`,
  ).bind(email, desde).all<{ tipo: string; titulo: string | null; estado: string; error: string | null; created_at: string; entregado_at: string | null; leido_at: string | null }>();
  for (const r of enviados.results ?? []) {
    out.push({ at: r.created_at, fuente: 'enviado', resumen: `[${r.tipo}] ${r.estado}: ${r.titulo ?? ''}`, detalle: { ...r } });
  }
  const entrantes = await env.DB.prepare(
    `SELECT tipo, texto, atendido_por, respuesta, latencia_ms, error, created_at FROM wa_entrante
      WHERE email = ? AND created_at >= ? ORDER BY created_at LIMIT 300`,
  ).bind(email, desde).all<{ tipo: string; texto: string; atendido_por: string; respuesta: string | null; latencia_ms: number | null; error: string | null; created_at: string }>();
  for (const r of entrantes.results ?? []) {
    out.push({ at: r.created_at, fuente: 'entrante', resumen: `"${r.texto.slice(0, 120)}" → ${r.atendido_por}${r.error ? ' ✗ ' + r.error : ''}`, detalle: { ...r } });
  }
  const eventos = await env.DB.prepare(
    `SELECT canal, tipo, modelo, tokens_in, tokens_out, tokens_cache, costo_usd, tool, input, resultado, is_error, ms, created_at FROM agente_evento
      WHERE email = ? AND created_at >= ? ORDER BY created_at LIMIT 300`,
  ).bind(email, desde).all<{ canal: string; tipo: string; modelo: string | null; tokens_in: number | null; tokens_out: number | null; tokens_cache: number | null; costo_usd: number | null; tool: string | null; input: string | null; resultado: string | null; is_error: number; ms: number | null; created_at: string }>();
  for (const r of eventos.results ?? []) {
    const resumen = r.tipo === 'llamada'
      ? `${r.canal} llamada ${r.modelo ?? ''}: ${r.tokens_in ?? 0}+${r.tokens_cache ?? 0}c → ${r.tokens_out ?? 0} tokens, $${(r.costo_usd ?? 0).toFixed(4)}`
      : `${r.canal} tool ${r.tool}${r.is_error ? ' ✗' : ''}: ${r.input ?? ''}`;
    out.push({ at: r.created_at, fuente: r.tipo === 'llamada' ? 'llamada' : 'tool', resumen, detalle: { ...r } });
  }
  try {
    const resumenes = await env.DB.prepare(
      `SELECT fecha, enviado, motivo, item_ids, created_at FROM wa_resumen WHERE email = ? AND created_at >= ? ORDER BY created_at LIMIT 100`,
    ).bind(email, desde).all<{ fecha: string; enviado: number; motivo: string | null; item_ids: string; created_at: string }>();
    for (const r of resumenes.results ?? []) {
      out.push({ at: r.created_at, fuente: 'resumen', resumen: `resumen ${r.fecha}: ${r.enviado ? 'enviado' : 'NO enviado'}${r.motivo ? ' (' + r.motivo + ')' : ''}`, detalle: { ...r } });
    }
  } catch { /* la tabla nace con el primer resumen */ }
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/** Gasto del modelo por persona en un rango — para la revisión de salud y
 * el admin. */
export async function costoPorPersona(env: Env, desde: string): Promise<Array<{ email: string; llamadas: number; costo_usd: number }>> {
  await ensureBitacoraTables(env);
  const { results } = await env.DB.prepare(
    `SELECT email, COUNT(*) AS llamadas, COALESCE(SUM(costo_usd), 0) AS costo_usd FROM agente_evento
      WHERE tipo = 'llamada' AND created_at >= ? GROUP BY email ORDER BY costo_usd DESC`,
  ).bind(desde).all<{ email: string; llamadas: number; costo_usd: number }>();
  return results ?? [];
}
