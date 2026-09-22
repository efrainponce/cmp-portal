import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { colorInventario, type InventarioCotizacionProductoDTO } from '../../shared/inventarioCotizacion';
import { getItem } from './dal';
import { putFile, oportunidadFileKey } from './r2';
import { renderDocument, type Block } from './pdf/layout';
import { pngToPdfImage, isPng, type PdfImageData } from './pdf/png';
import { jpegImage } from './pdf/writer';
import { LOGO_JPG_BASE64 } from './pdf/logo';

/** Tope de productos por PDF: cada uno lee hasta 2 fotos de R2. */
export const INVENTARIO_PDF_MAX_PRODUCTOS = 40;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let tableReady = false;

export class InventarioCotizacionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// La tabla original (`inventario_cotizacion_producto`) tenía la llave
// (oportunidad, producto) y no cabían dos colores del mismo SKU. SQLite no
// cambia una PK en sitio, así que la captura vive en `inventario_511` y la vieja
// se copia UNA vez — solo cuando la nueva no existía, para que un renglón que ya
// tomó su color no reviva como "sin color" en el siguiente arranque. La vieja se
// queda intacta como respaldo.
async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  const existe = await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inventario_511'").first();
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS inventario_511 (
      oportunidad_id INTEGER NOT NULL,
      producto_id TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      producto_nombre TEXT NOT NULL,
      imagen_mexico_key TEXT,
      imagen_usa_key TEXT,
      comentarios TEXT NOT NULL DEFAULT '',
      agregado_manualmente INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (oportunidad_id, producto_id, color)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_inventario_511_opp ON inventario_511(oportunidad_id)'),
  ]);
  if (!existe) {
    const vieja = await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inventario_cotizacion_producto'").first();
    if (vieja) {
      await env.DB.prepare(`INSERT OR IGNORE INTO inventario_511
        (oportunidad_id, producto_id, color, producto_nombre, imagen_mexico_key, imagen_usa_key, comentarios, agregado_manualmente, updated_at)
        SELECT oportunidad_id, producto_id, '', producto_nombre, imagen_mexico_key, imagen_usa_key, comentarios, agregado_manualmente, updated_at
        FROM inventario_cotizacion_producto`).run();
    }
  }
  tableReady = true;
}

interface Row {
  producto_id: string; color: string; producto_nombre: string; imagen_mexico_key: string | null;
  imagen_usa_key: string | null; comentarios: string; agregado_manualmente: number;
}

const COLS = 'producto_id, color, producto_nombre, imagen_mexico_key, imagen_usa_key, comentarios, agregado_manualmente';

const toDTO = (row: Row): InventarioCotizacionProductoDTO => ({
  productoId: row.producto_id,
  productoNombre: row.producto_nombre,
  color: row.color,
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
    `SELECT ${COLS} FROM inventario_511 WHERE oportunidad_id = ? ORDER BY producto_nombre, color`,
  ).bind(opportunityId).all<Row>();
  return (results ?? []).map(toDTO);
}

export async function saveInventarioCotizacion(
  env: Env, opportunityId: number, viewer: Identity,
  input: {
    productoId: string; productoNombre: string; color: string; comentarios: string; agregadoManualmente: boolean;
    /** Color del renglón que la tarjeta estaba MOSTRANDO. '' con `color` no
     * vacío = la tarjeta heredó la captura de antes del color y la reclama. */
    colorGuardado?: string;
    mexico?: File; usa?: File;
  },
): Promise<InventarioCotizacionProductoDTO> {
  await ownOpportunity(env, opportunityId, viewer);
  await ensureTable(env);
  const productoId = input.productoId.trim();
  const productoNombre = input.productoNombre.trim();
  const color = colorInventario(input.color);
  if (!productoId || !productoNombre) throw new InventarioCotizacionError(400, 'producto requerido');
  if (input.comentarios.length > 4000) throw new InventarioCotizacionError(400, 'los comentarios no pueden exceder 4,000 caracteres');
  if ((input.mexico && input.mexico.size > MAX_IMAGE_BYTES) || (input.usa && input.usa.size > MAX_IMAGE_BYTES)) {
    throw new InventarioCotizacionError(400, 'cada imagen debe pesar máximo 8 MB');
  }
  // Reclamar la captura sin color: se le pone el color de la tarjeta, solo si
  // ese color todavía no tiene renglón propio (nunca se pisa uno existente).
  if (color && input.colorGuardado === '') {
    await env.DB.prepare(`UPDATE inventario_511 SET color = ?
      WHERE oportunidad_id = ? AND producto_id = ? AND color = ''
        AND NOT EXISTS (SELECT 1 FROM inventario_511 WHERE oportunidad_id = ? AND producto_id = ? AND color = ?)`,
    ).bind(color, opportunityId, productoId, opportunityId, productoId, color).run();
  }
  const existing = await env.DB.prepare(
    'SELECT imagen_mexico_key, imagen_usa_key FROM inventario_511 WHERE oportunidad_id = ? AND producto_id = ? AND color = ?',
  ).bind(opportunityId, productoId, color).first<{ imagen_mexico_key: string | null; imagen_usa_key: string | null }>();
  const slug = color ? `${productoId}-${color.replace(/[^A-Z0-9]+/g, '_')}` : productoId;
  const mexicoKey = input.mexico
    ? oportunidadFileKey(opportunityId, 'inventario-5-11', `${slug}-mexico-${crypto.randomUUID()}-${input.mexico.name}`)
    : existing?.imagen_mexico_key ?? null;
  const usaKey = input.usa
    ? oportunidadFileKey(opportunityId, 'inventario-5-11', `${slug}-usa-${crypto.randomUUID()}-${input.usa.name}`)
    : existing?.imagen_usa_key ?? null;
  if (input.mexico) await putFile(env, mexicoKey!, input.mexico);
  if (input.usa) await putFile(env, usaKey!, input.usa);
  const comentarios = input.comentarios.trim();
  await env.DB.prepare(`INSERT INTO inventario_511
    (oportunidad_id, producto_id, color, producto_nombre, imagen_mexico_key, imagen_usa_key, comentarios, agregado_manualmente, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(oportunidad_id, producto_id, color) DO UPDATE SET
      producto_nombre = excluded.producto_nombre, imagen_mexico_key = excluded.imagen_mexico_key,
      imagen_usa_key = excluded.imagen_usa_key, comentarios = excluded.comentarios,
      agregado_manualmente = excluded.agregado_manualmente, updated_at = excluded.updated_at`,
  ).bind(opportunityId, productoId, color, productoNombre, mexicoKey, usaKey, comentarios, input.agregadoManualmente ? 1 : 0, new Date().toISOString()).run();
  return toDTO({ producto_id: productoId, color, producto_nombre: productoNombre, imagen_mexico_key: mexicoKey, imagen_usa_key: usaKey, comentarios, agregado_manualmente: input.agregadoManualmente ? 1 : 0 });
}

async function imagenPdf(env: Env, key: string | null): Promise<PdfImageData | null> {
  if (!key) return null;
  const obj = await env.FILES.get(key);
  if (!obj) return null;
  const bytes = new Uint8Array(await obj.arrayBuffer());
  // PNG fuera de alcance del decodificador (entrelazado, > 4 MP…) o un formato
  // que no es JPEG/PNG (webp, heic) ⇒ null ⇒ "Sin imagen" en vez de tronar.
  return isPng(bytes) ? pngToPdfImage(bytes) : jpegImage(bytes);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PDF del tab Inventario 5.11. Los productos (y su orden) los manda el tab —
 * los que salen solos de la cotización no tienen renglón en D1 hasta que alguien
 * les sube algo, y resolverlos aquí duplicaría la lógica de gridMeta. Fotos y
 * comentarios sí salen SIEMPRE de D1, nunca del cliente. */
export async function inventarioCotizacionPdf(
  env: Env, opportunityId: number, viewer: Identity,
  productos: { productoId: string; productoNombre: string; color: string; colorGuardado?: string }[],
): Promise<{ bytes: Uint8Array; oppName: string }> {
  const opp = await getItem(env, 'oportunidades', opportunityId, viewer);
  if (!opp) throw new InventarioCotizacionError(404, 'not found');
  if (productos.length === 0) throw new InventarioCotizacionError(422, 'no hay productos para exportar');
  if (productos.length > INVENTARIO_PDF_MAX_PRODUCTOS) throw new InventarioCotizacionError(400, `máximo ${INVENTARIO_PDF_MAX_PRODUCTOS} productos por PDF`);
  await ensureTable(env);
  const { results } = await env.DB.prepare(
    `SELECT ${COLS} FROM inventario_511 WHERE oportunidad_id = ?`,
  ).bind(opportunityId).all<Row>();
  const guardados = new Map((results ?? []).map(r => [`${r.producto_id}|${r.color}`, r]));

  const blocks: Block[] = [];
  for (const [i, p] of productos.entries()) {
    // La tarjeta dice qué renglón está mostrando (`colorGuardado`): puede ser
    // la captura sin color que heredó su primer color.
    const color = colorInventario(p.color);
    const row = guardados.get(`${p.productoId}|${colorInventario(p.colorGuardado ?? color)}`);
    const [mex, usa] = await Promise.all([imagenPdf(env, row?.imagen_mexico_key ?? null), imagenPdf(env, row?.imagen_usa_key ?? null)]);
    // Un producto por hoja: dos capturas a todo el ancho + comentarios llenan
    // media hoja, y partir un producto entre páginas se lee mal.
    if (i > 0) blocks.push({ kind: 'pageBreak' });
    const nombre = row?.producto_nombre || p.productoNombre;
    blocks.push({ kind: 'heading', text: color ? `${nombre} · ${color}` : nombre });
    blocks.push({ kind: 'image', titulo: 'Inventario MEX', imagen: mex });
    blocks.push({ kind: 'image', titulo: 'Inventario USA', imagen: usa });
    const comentarios = row?.comentarios.trim();
    blocks.push({ kind: 'text', text: 'COMENTARIOS', size: 7.5, bold: true, color: '#98a1ae' });
    blocks.push({ kind: 'text', text: comentarios || 'Sin comentarios.', color: comentarios ? undefined : '#98a1ae' });
  }

  const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Mexico_City' });
  const bytes = renderDocument({
    title: 'Inventario 5.11',
    subtitle: opp.name ?? '',
    docId: `INV-${opportunityId}`,
    generatedAt: hoy,
    logo: base64ToBytes(LOGO_JPG_BASE64),
    hideGeneratedByLine: true,
  }, blocks);
  return { bytes, oppName: opp.name ?? '' };
}
