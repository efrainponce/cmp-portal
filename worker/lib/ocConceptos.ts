// Caché de productos/conceptos capturados A MANO en las líneas de OC (Efraín,
// 2026-09-21: "crear en D1 un cache de lo que se pone aquí para poder buscar
// las cosas que se ponen y que no están en el catálogo"). Cada alta de línea
// manual (`POST /api/proyectos/:id/lineas`) deja aquí su renglón; el modal de
// "Crear orden de compra" lo ofrece como sugerencia junto al catálogo.
//
// Una fila por producto+SKU: volver a capturarlo sube `usos` y deja los datos
// de la última vez (costo/proveedor cambian con el tiempo). Tolera que falte
// la tabla (migración sin aplicar): no guarda y no sugiere, nunca tumba el alta.
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';

export interface OcConcepto {
  producto: string;
  sku: string | null;
  color: string | null;
  talla: string | null;
  unidad: string | null;
  costo: number | null;
  moneda: string | null;
  proveedorId: string | null;
  proveedorName: string | null;
  usos: number;
}

const clavePart = (s: string | undefined | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function claveConcepto(producto: string, sku?: string | null): string {
  return `${clavePart(producto)}|${clavePart(sku)}`;
}

const vacioANull = (s: string | undefined) => (s?.trim() ? s.trim() : null);

export async function recordOcConcepto(env: Env, c: {
  producto: string; sku?: string; color?: string; talla?: string; unidad?: string;
  costo?: number; moneda?: string; proveedorId?: string; email: string;
}): Promise<void> {
  const producto = c.producto.trim();
  if (!clavePart(producto)) return;
  let proveedorName: string | null = null;
  const proveedorId = c.proveedorId && Number.isFinite(Number(c.proveedorId)) ? Number(c.proveedorId) : null;
  try {
    if (proveedorId !== null) {
      const prov = await env.DB.prepare('SELECT name FROM items WHERE board_id = ? AND item_id = ?')
        .bind(BOARDS.proveedores.id, proveedorId).first<{ name: string }>();
      proveedorName = prov?.name ?? null;
    }
    // COALESCE: un alta que no trae color/costo no borra el que ya se conocía.
    await env.DB.prepare(`
      INSERT INTO oc_concepto (clave, producto, sku, color, talla, unidad, costo, moneda, proveedor_id, proveedor_name, usos, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (clave) DO UPDATE SET
        producto = excluded.producto,
        sku = COALESCE(excluded.sku, oc_concepto.sku),
        color = COALESCE(excluded.color, oc_concepto.color),
        talla = COALESCE(excluded.talla, oc_concepto.talla),
        unidad = COALESCE(excluded.unidad, oc_concepto.unidad),
        costo = COALESCE(excluded.costo, oc_concepto.costo),
        moneda = COALESCE(excluded.moneda, oc_concepto.moneda),
        proveedor_id = COALESCE(excluded.proveedor_id, oc_concepto.proveedor_id),
        proveedor_name = COALESCE(excluded.proveedor_name, oc_concepto.proveedor_name),
        usos = oc_concepto.usos + 1,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).bind(
      claveConcepto(producto, c.sku), producto, vacioANull(c.sku), vacioANull(c.color), vacioANull(c.talla),
      vacioANull(c.unidad), c.costo !== undefined && Number.isFinite(c.costo) ? c.costo : null, vacioANull(c.moneda),
      proveedorId, proveedorName, c.email, new Date().toISOString(),
    ).run();
  } catch (err) {
    console.warn('oc_concepto: no se guardó', err);
  }
}

interface Row {
  producto: string; sku: string | null; color: string | null; talla: string | null; unidad: string | null;
  costo: number | null; moneda: string | null; proveedor_id: number | null; proveedor_name: string | null; usos: number;
}

/** Lo más reciente primero; el filtrado por tecla lo hace el front (son pocos
 * cientos y así la búsqueda es la misma flexible del catálogo). */
export async function listOcConceptos(env: Env, limit = 1000): Promise<OcConcepto[]> {
  try {
    const res = await env.DB.prepare(
      'SELECT producto, sku, color, talla, unidad, costo, moneda, proveedor_id, proveedor_name, usos FROM oc_concepto ORDER BY updated_at DESC LIMIT ?',
    ).bind(limit).all<Row>();
    return (res.results ?? []).map(r => ({
      producto: r.producto, sku: r.sku, color: r.color, talla: r.talla, unidad: r.unidad,
      costo: r.costo, moneda: r.moneda,
      proveedorId: r.proveedor_id !== null ? String(r.proveedor_id) : null,
      proveedorName: r.proveedor_name, usos: r.usos,
    }));
  } catch {
    return [];
  }
}
