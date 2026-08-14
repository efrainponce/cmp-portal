// worker/lib/updateSeen.ts — "ojitos" del portal en Actualizaciones: quién ya
// vio cada update/reply (worker/schema.sql `update_seen`). Portal-side only —
// el `viewers` nativo de Monday no se llena por lecturas vía API, así que este
// registro cubre lo que Monday no puede ver; worker/routes/boards.ts fusiona
// ambas fuentes al armar el feed.
import type { Env } from '../env';

let tablesReady = false;

async function ensureUpdateSeenTable(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS update_seen (
    update_id    TEXT NOT NULL,
    viewer_email TEXT NOT NULL REFERENCES identity(email) ON DELETE CASCADE,
    seen_at      TEXT NOT NULL,
    PRIMARY KEY (update_id, viewer_email)
  )`).run();
  tablesReady = true;
}

/** Marca cada update/reply como visto por el viewer. Idempotente — no
 * reescribe `seen_at` si ya estaba marcado. */
export async function markUpdatesSeen(env: Env, updateIds: string[], viewerEmail: string): Promise<void> {
  if (updateIds.length === 0) return;
  await ensureUpdateSeenTable(env);
  const now = new Date().toISOString();
  await env.DB.batch(
    updateIds.map(id =>
      env.DB.prepare(
        `INSERT INTO update_seen (update_id, viewer_email, seen_at) VALUES (?, ?, ?)
         ON CONFLICT (update_id, viewer_email) DO NOTHING`,
      ).bind(id, viewerEmail, now),
    ),
  );
}

/** Nombres (o email si no hay nombre) de quien vio cada update, agrupados por id. */
export async function seenByFor(env: Env, updateIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (updateIds.length === 0) return map;
  await ensureUpdateSeenTable(env);
  const placeholders = updateIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT us.update_id AS update_id, COALESCE(i.nombre, us.viewer_email) AS nombre
     FROM update_seen us LEFT JOIN identity i ON i.email = us.viewer_email
     WHERE us.update_id IN (${placeholders})`,
  ).bind(...updateIds).all<{ update_id: string; nombre: string }>();
  for (const row of rows.results ?? []) {
    const list = map.get(row.update_id) ?? [];
    list.push(row.nombre);
    map.set(row.update_id, list);
  }
  return map;
}
