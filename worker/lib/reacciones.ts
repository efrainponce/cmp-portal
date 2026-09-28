// worker/lib/reacciones.ts — reacciones con emoji a comentarios del feed de
// Actualizaciones (Jorge, 2026-09-25, fase 3). SOLO en D1: no se mandan a
// Monday — por qué, y los tipos válidos, en shared/reacciones.ts.
//
// Una fila por (comentario, persona, tipo): poner la misma dos veces no
// duplica, y cada quien puede tener varias distintas en el mismo comentario.
// `item_id` es solo para auditar (el item que se tenía abierto al reaccionar);
// la lectura va por update_id, que la ruta ya validó contra el feed.
import type { Env } from '../env';
import type { ReaccionPortal } from '../../shared/reacciones';

let tableReady = false;

async function ensureReaccionTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS update_reaccion (
    update_id  TEXT NOT NULL,
    email      TEXT NOT NULL,
    nombre     TEXT NOT NULL,
    tipo       TEXT NOT NULL,
    item_id    INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY (update_id, email, tipo)
  )`).run();
  tableReady = true;
}

/** Reacciones del portal por comentario, para los ids que pinta el feed. */
export async function reaccionesDe(env: Env, updateIds: string[]): Promise<Map<string, ReaccionPortal[]>> {
  const map = new Map<string, ReaccionPortal[]>();
  if (updateIds.length === 0) return map;
  await ensureReaccionTable(env);
  // Mismo tope de ~100 parámetros por query que seenByFor (worker/lib/updateSeen.ts).
  for (let i = 0; i < updateIds.length; i += 90) {
    const chunk = updateIds.slice(i, i + 90);
    const rows = await env.DB.prepare(
      `SELECT update_id, email, nombre, tipo FROM update_reaccion
       WHERE update_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created_at`,
    ).bind(...chunk).all<{ update_id: string; email: string; nombre: string; tipo: string }>();
    for (const r of rows.results ?? []) {
      const list = map.get(r.update_id) ?? [];
      list.push({ email: r.email, nombre: r.nombre, tipo: r.tipo });
      map.set(r.update_id, list);
    }
  }
  return map;
}

/** Pone (`activa`) o quita la reacción del viewer. Idempotente en los dos
 * sentidos: el front manda el estado final, no un "alternar", así un doble
 * clic o un reintento no la deja al revés. */
export async function ponerReaccion(
  env: Env,
  r: { updateId: string; itemId: number; email: string; nombre: string; tipo: string; activa: boolean },
): Promise<void> {
  await ensureReaccionTable(env);
  if (r.activa) {
    await env.DB.prepare(
      `INSERT INTO update_reaccion (update_id, email, nombre, tipo, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (update_id, email, tipo) DO NOTHING`,
    ).bind(r.updateId, r.email, r.nombre, r.tipo, r.itemId, new Date().toISOString()).run();
  } else {
    await env.DB.prepare(
      `DELETE FROM update_reaccion WHERE update_id = ? AND email = ? AND tipo = ?`,
    ).bind(r.updateId, r.email, r.tipo).run();
  }
}
