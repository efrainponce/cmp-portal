import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { InventarioCotizacionProductoDTO } from '../../shared/inventarioCotizacion';
import { getItem } from './dal';
import { putFile, oportunidadFileKey } from './r2';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let tableReady = false;

export class InventarioCotizacionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS inventario_cotizacion_producto (
      oportunidad_id INTEGER NOT NULL,
      producto_id TEXT NOT NULL,
      producto_nombre TEXT NOT NULL,
      imagen_mexico_key TEXT,
      imagen_usa_key TEXT,
      comentarios TEXT NOT NULL DEFAULT '',
      agregado_manualmente INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (oportunidad_id, producto_id)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_inventario_cotizacion_opp ON inventario_cotizacion_producto(oportunidad_id)'),
  ]);
  tableReady = true;
}

interface Row {
  producto_id: string; producto_nombre: string; imagen_mexico_key: string | null;
  imagen_usa_key: string | null; comentarios: string; agregado_manualmente: number;
}

const toDTO = (row: Row): InventarioCotizacionProductoDTO => ({
  productoId: row.producto_id,
  productoNombre: row.producto_nombre,
  imagenMexicoUrl: row.imagen_mexico_key ? `/api/files/${row.imagen_mexico_key}` : undefined,
  imagenUsaUrl: row.imagen_usa_key ? `/api/files/${row.imagen_usa_key}` : undefined,
  comentarios: row.comentarios,
  agregadoManualmente: !!row.agregado_manualmente,
});

async function ownOpportunity(env: Env, opportunityId: number, viewer: Identity): Promise<void> {
  const opp = await getItem(env, 'oportunidades', opportunityId, viewer, 'own');
  if (!opp) throw new InventarioCotizacionError(404, 'not found');
}

export async function listInventarioCotizacion(env: Env, opportunityId: number, viewer: Identity): Promise<InventarioCotizacionProductoDTO[]> {
  // Lectura respeta el mismo alcance de oportunidad que el drawer; los líderes
  // de zona pueden ver evidencia, pero no escribirla (el POST usa own).
  const opp = await getItem(env, 'oportunidades', opportunityId, viewer);
  if (!opp) throw new InventarioCotizacionError(404, 'not found');
  await ensureTable(env);
  const { results } = await env.DB.prepare(
    'SELECT producto_id, producto_nombre, imagen_mexico_key, imagen_usa_key, comentarios, agregado_manualmente FROM inventario_cotizacion_producto WHERE oportunidad_id = ? ORDER BY producto_nombre',
  ).bind(opportunityId).all<Row>();
  return (results ?? []).map(toDTO);
}

export async function saveInventarioCotizacion(
  env: Env, opportunityId: number, viewer: Identity,
  input: { productoId: string; productoNombre: string; comentarios: string; agregadoManualmente: boolean; mexico?: File; usa?: File },
): Promise<InventarioCotizacionProductoDTO> {
  await ownOpportunity(env, opportunityId, viewer);
  await ensureTable(env);
  const productoId = input.productoId.trim();
  const productoNombre = input.productoNombre.trim();
  if (!productoId || !productoNombre) throw new InventarioCotizacionError(400, 'producto requerido');
  if (input.comentarios.length > 4000) throw new InventarioCotizacionError(400, 'los comentarios no pueden exceder 4,000 caracteres');
  if ((input.mexico && input.mexico.size > MAX_IMAGE_BYTES) || (input.usa && input.usa.size > MAX_IMAGE_BYTES)) {
    throw new InventarioCotizacionError(400, 'cada imagen debe pesar máximo 8 MB');
  }
  const existing = await env.DB.prepare(
    'SELECT imagen_mexico_key, imagen_usa_key FROM inventario_cotizacion_producto WHERE oportunidad_id = ? AND producto_id = ?',
  ).bind(opportunityId, productoId).first<{ imagen_mexico_key: string | null; imagen_usa_key: string | null }>();
  const mexicoKey = input.mexico
    ? oportunidadFileKey(opportunityId, 'inventario-5-11', `${productoId}-mexico-${crypto.randomUUID()}-${input.mexico.name}`)
    : existing?.imagen_mexico_key ?? null;
  const usaKey = input.usa
    ? oportunidadFileKey(opportunityId, 'inventario-5-11', `${productoId}-usa-${crypto.randomUUID()}-${input.usa.name}`)
    : existing?.imagen_usa_key ?? null;
  if (input.mexico) await putFile(env, mexicoKey!, input.mexico);
  if (input.usa) await putFile(env, usaKey!, input.usa);
  await env.DB.prepare(`INSERT INTO inventario_cotizacion_producto
    (oportunidad_id, producto_id, producto_nombre, imagen_mexico_key, imagen_usa_key, comentarios, agregado_manualmente, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(oportunidad_id, producto_id) DO UPDATE SET
      producto_nombre = excluded.producto_nombre, imagen_mexico_key = excluded.imagen_mexico_key,
      imagen_usa_key = excluded.imagen_usa_key, comentarios = excluded.comentarios,
      agregado_manualmente = excluded.agregado_manualmente, updated_at = excluded.updated_at`,
  ).bind(opportunityId, productoId, productoNombre, mexicoKey, usaKey, input.comentarios.trim(), input.agregadoManualmente ? 1 : 0, new Date().toISOString()).run();
  return toDTO({ producto_id: productoId, producto_nombre: productoNombre, imagen_mexico_key: mexicoKey, imagen_usa_key: usaKey, comentarios: input.comentarios.trim(), agregado_manualmente: input.agregadoManualmente ? 1 : 0 });
}
