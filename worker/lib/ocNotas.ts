// worker/lib/ocNotas.ts — "Notas al proveedor" de una Orden de Compra: el
// texto libre que Compras le deja al proveedor y que sale IMPRESO en el PDF de
// la OC (Efraín, 2026-08-19: "un campo de texto en las Órdenes de Compra para
// dejar notas al proveedor, que aparezcan impresas en el documento final").
//
// Vive en D1 y no en Monday porque la nota es POR PROVEEDOR y en Monday no hay
// dónde: la única columna de comentarios de OC (`text_mm4c74f8`, Proyecto) es
// una sola para todo el Proyecto, y un Proyecto normalmente reparte sus líneas
// entre varios proveedores — una nota dirigida a uno saldría impresa en la OC
// de todos. Esa columna se conserva como FALLBACK (proyectos que ya la traen
// llena siguen imprimiendo lo mismo) y como puente para cmp-tallas, que lee de
// ahí y no acepta la nota por request (docs/cmp-tallas-endpoint-map.md).
import type { Env } from '../env';

/** Tope de captura — la nota es un párrafo para el proveedor, no un anexo; el
 * bloque del PDF envuelve pero no pagina aparte. */
export const OC_NOTA_MAX = 1200;

let tableReady = false;

async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_nota (
    proyecto_id  INTEGER NOT NULL,
    proveedor_id TEXT NOT NULL,
    nota         TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    updated_by   TEXT NOT NULL,
    PRIMARY KEY (proyecto_id, proveedor_id)
  )`).run();
  tableReady = true;
}

/** Todas las notas de un Proyecto, por id de proveedor — una sola query para
 * pintar las N tarjetas del tab (mismo criterio que el activity log). */
export async function getOcNotas(env: Env, proyectoId: number): Promise<Record<string, string>> {
  await ensureTable(env);
  const { results } = await env.DB
    .prepare('SELECT proveedor_id, nota FROM oc_nota WHERE proyecto_id = ?')
    .bind(proyectoId)
    .all<{ proveedor_id: string; nota: string }>();
  return Object.fromEntries((results ?? []).map(r => [r.proveedor_id, r.nota]));
}

/** Nota de UN proveedor (cadena vacía si no hay). La usan los generadores de
 * PDF, que trabajan de a una OC. */
export async function getOcNota(env: Env, proyectoId: number, proveedorId: string): Promise<string> {
  await ensureTable(env);
  const row = await env.DB
    .prepare('SELECT nota FROM oc_nota WHERE proyecto_id = ? AND proveedor_id = ?')
    .bind(proyectoId, proveedorId)
    .first<{ nota: string }>();
  return row?.nota ?? '';
}

/** Guarda (o borra, si queda vacía) la nota de un proveedor. */
export async function setOcNota(
  env: Env, proyectoId: number, proveedorId: string, nota: string, email: string,
): Promise<string> {
  await ensureTable(env);
  const limpia = nota.trim().slice(0, OC_NOTA_MAX);
  if (!limpia) {
    await env.DB.prepare('DELETE FROM oc_nota WHERE proyecto_id = ? AND proveedor_id = ?')
      .bind(proyectoId, proveedorId).run();
    return '';
  }
  await env.DB.prepare(
    `INSERT INTO oc_nota (proyecto_id, proveedor_id, nota, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(proyecto_id, proveedor_id) DO UPDATE SET
       nota = excluded.nota, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(proyectoId, proveedorId, limpia, new Date().toISOString(), email).run();
  return limpia;
}
