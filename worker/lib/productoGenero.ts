// worker/lib/productoGenero.ts — checkbox "Género M/F" por producto de catálogo,
// nativo en D1: no hay columna de Monday para esto (Efraín, 2026-08-13: "dejemoslo
// solo en D1, no vale la pena" crear una columna) — mismo patrón que
// producto_resumen.ts. Solo afecta lo que se manda a Airtable (worker/lib/
// airtable.ts syncTallasPortal): cuando está marcado, Tallas se expande con
// prefijo M-/F- antes de escribirse en "Tallas Portal"; en Monday/portal la
// lista de tallas se ve igual, sin prefijo.
import type { Env } from '../env';

let tableReady = false;

async function ensureGeneroTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS producto_genero (
    producto_id INTEGER PRIMARY KEY,
    genero_mf   INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL,
    updated_by  TEXT
  )`).run();
  tableReady = true;
}

export async function getGeneroMF(env: Env, productoId: number): Promise<boolean> {
  await ensureGeneroTable(env);
  const row = await env.DB.prepare(
    `SELECT genero_mf FROM producto_genero WHERE producto_id = ?`,
  ).bind(productoId).first<{ genero_mf: number }>();
  return !!row?.genero_mf;
}

/** Todo el mapa producto_id→género de una sola vez — el catálogo completo lo carga
 * el front en un solo fetch (mismo momento que listItems('productos')), no tiene
 * sentido pedirlo por producto uno por uno. */
export async function listGeneroMF(env: Env): Promise<Record<string, boolean>> {
  await ensureGeneroTable(env);
  const { results } = await env.DB.prepare(
    `SELECT producto_id, genero_mf FROM producto_genero WHERE genero_mf = 1`,
  ).all<{ producto_id: number; genero_mf: number }>();
  const out: Record<string, boolean> = {};
  for (const r of results ?? []) out[String(r.producto_id)] = true;
  return out;
}

export async function setGeneroMF(env: Env, productoId: number, generoMF: boolean, actorEmail: string): Promise<void> {
  await ensureGeneroTable(env);
  await env.DB.prepare(
    `INSERT INTO producto_genero (producto_id, genero_mf, updated_at, updated_by)
     VALUES (?,?,?,?)
     ON CONFLICT(producto_id) DO UPDATE SET
       genero_mf = excluded.genero_mf, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(productoId, generoMF ? 1 : 0, new Date().toISOString(), actorEmail).run();
}
