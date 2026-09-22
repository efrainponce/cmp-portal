// worker/lib/productoResumen.ts — resumen libre por producto+color (tab Ejecución del
// Proyecto), un texto por tarjeta además del comentario por talla (S_COMENTARIO en
// proyectos_sub). Nativo en D1: no hay columna de Monday para "resumen a nivel
// producto" y CLAUDE.md prohíbe inventar ids de columna — mismo patrón que
// producto_propuesto/estado_producto_historial (Efraín, 2026-08-06: "agrega uno
// global por producto" además del texto por talla que ya existía).
import type { Env } from '../env';

let tableReady = false;

async function ensureResumenTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS producto_resumen (
    proyecto_id INTEGER NOT NULL,
    producto    TEXT NOT NULL,
    color       TEXT NOT NULL,
    resumen     TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL,
    updated_by  TEXT,
    PRIMARY KEY (proyecto_id, producto, color)
  )`).run();
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_producto_resumen_proyecto ON producto_resumen(proyecto_id)',
  ).run();
  tableReady = true;
}

export interface ProductoResumenRow {
  producto: string;
  color: string;
  resumen: string;
  updated_at: string;
  updated_by: string | null;
}

/** Lectura para el tab "Ejecución" (GET /api/proyectos/:id/resumen-producto) — una
 * fila por producto+color que ya tenga resumen guardado; grupos sin resumen
 * simplemente no aparecen (el front los trata como texto vacío). */
export async function listProductoResumen(env: Env, proyectoId: number): Promise<ProductoResumenRow[]> {
  await ensureResumenTable(env);
  const { results } = await env.DB.prepare(
    `SELECT producto, color, resumen, updated_at, updated_by
     FROM producto_resumen WHERE proyecto_id = ?`,
  ).bind(proyectoId).all<ProductoResumenRow>();
  return results ?? [];
}

/** Resúmenes de VARIOS proyectos en una pasada (PDF de estatus por zona/vendedor),
 * de 80 en 80 por el tope de binds de D1. Llave del mapa: proyecto_id. */
export async function listProductoResumenMany(env: Env, proyectoIds: number[]): Promise<Map<number, ProductoResumenRow[]>> {
  const out = new Map<number, ProductoResumenRow[]>();
  if (proyectoIds.length === 0) return out;
  await ensureResumenTable(env);
  for (let i = 0; i < proyectoIds.length; i += 80) {
    const lote = proyectoIds.slice(i, i + 80);
    const { results } = await env.DB.prepare(
      `SELECT proyecto_id, producto, color, resumen, updated_at, updated_by
       FROM producto_resumen WHERE proyecto_id IN (${lote.map(() => '?').join(',')})`,
    ).bind(...lote).all<ProductoResumenRow & { proyecto_id: number }>();
    for (const r of results ?? []) {
      if (!out.has(r.proyecto_id)) out.set(r.proyecto_id, []);
      out.get(r.proyecto_id)!.push(r);
    }
  }
  return out;
}

/** Upsert del resumen de un producto+color — compras/admin, mismo gate que
 * S_COMENTARIO por talla (shared/visibility.ts, grupo AC), aplicado en la ruta. */
export async function upsertProductoResumen(env: Env, args: {
  proyectoId: number; producto: string; color: string; resumen: string; actorEmail: string;
}): Promise<void> {
  await ensureResumenTable(env);
  await env.DB.prepare(
    `INSERT INTO producto_resumen (proyecto_id, producto, color, resumen, updated_at, updated_by)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(proyecto_id, producto, color)
     DO UPDATE SET resumen = excluded.resumen, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(args.proyectoId, args.producto, args.color, args.resumen, new Date().toISOString(), args.actorEmail).run();
}
