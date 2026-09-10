// worker/lib/errores.ts — Registro de las excepciones REALES, para diagnóstico
// (2026-09-10, Efraín: "haz lo necesario para tener telemetría o algo que
// puedas ver cuando las cosas no funcionan correctamente").
//
// Antes 31 rutas atrapaban el error y respondían "internal error" sin dejar
// rastro del porqué: accion_log guardaba el texto "internal error" y el error
// de verdad se perdía. Todo lo que NO es un error de negocio (los 400/404/409
// esperados, que cada ruta ya contesta con su mensaje) pasa por aquí: queda en
// `sync_log` (kind 'error', ok=0) con el mensaje, las primeras líneas de la
// pila, la ruta y quién. Lo leen el reporte de salud (worker/lib/salud.ts),
// `node scripts/salud.mjs` y el cron de alertas (worker/lib/errorAlerts.ts).
// Los errores de JavaScript del front entran por el mismo lado
// (POST /api/telemetry/error), con origen "front …".
import type { Context } from 'hono';
import type { Env } from '../env';
import { jsonStatus } from './http';

const MAX_DETALLE = 1800;

/** Mensaje + las 3 primeras líneas de la pila, en una sola línea. */
export function describirError(err: unknown): string {
  if (err instanceof Error) {
    const pila = (err.stack ?? '').split('\n').slice(1, 4).map(l => l.trim()).filter(Boolean).join(' ← ');
    return `${err.name}: ${err.message}${pila ? ` [${pila}]` : ''}`;
  }
  return String(err);
}

/** Asienta el error. Nunca lanza: registrar jamás debe romper al que llama. */
export async function registrarError(
  env: Env, origen: string, err: unknown, extra: { quien?: string; boardId?: number; itemId?: number } & Record<string, unknown> = {},
): Promise<void> {
  try {
    const { boardId, itemId, ...resto } = extra;
    const extraTxt = Object.keys(resto).length > 0 ? ` ${JSON.stringify(resto)}` : '';
    const detalle = `${origen}: ${describirError(err)}${extraTxt}`.slice(0, MAX_DETALLE);
    await env.DB.prepare(
      `INSERT INTO sync_log (kind, board_id, item_id, ok, detail, at) VALUES ('error', ?, ?, 0, ?, ?)`,
    ).bind(boardId ?? null, itemId ?? null, detalle, new Date().toISOString()).run();
  } catch { /* sin D1 no hay dónde anotarlo; la respuesta sigue su curso */ }
}

/** El 500 de una ruta, dejando rastro del error real (en waitUntil: sin
 * agregar latencia). `body` es lo que ya contestaba la ruta. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function errorInterno(c: Context<{ Bindings: Env }, any, any>, err: unknown, body: unknown = { error: 'internal error' }): Response {
  let quien: string | undefined;
  try { quien = c.get('viewer')?.email; } catch { /* ruta sin identity */ }
  const tarea = registrarError(c.env, `${c.req.method} ${c.req.path}`, err, quien ? { quien } : {});
  try { c.executionCtx.waitUntil(tarea); } catch { void tarea; }
  return jsonStatus(body, 500);
}
