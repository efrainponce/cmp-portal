import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { colorInventario, fechaInventario, inventarioAlDia, type InventarioCotizacionProductoDTO, type InventarioVersionDTO } from '../../shared/inventarioCotizacion';
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
  // Fecha de cada foto (Pam, 2026-09-25: el inventario cambia a diario y hay
  // que saber de qué día es). Tablas previas se migran con el ALTER; si la
  // columna ya existe D1 tira error y se ignora.
  for (const col of ['imagen_mexico_at TEXT', 'imagen_usa_at TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE inventario_511 ADD COLUMN ${col}`).run();
    } catch { /* ya existe */ }
  }
  // Historial: cada guardado agrega el estado completo de la tarjeta y nunca se
  // reescribe — las "versiones por fecha" del tab salen de aquí. Las fotos
  // reemplazadas siguen en R2 (cada subida lleva su propia llave).
  const historialExiste = await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inventario_511_version'").first();
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS inventario_511_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      oportunidad_id INTEGER NOT NULL,
      producto_id TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      producto_nombre TEXT NOT NULL,
      imagen_mexico_key TEXT,
      imagen_mexico_at TEXT,
      imagen_usa_key TEXT,
      imagen_usa_at TEXT,
      comentarios TEXT NOT NULL DEFAULT '',
      agregado_manualmente INTEGER NOT NULL DEFAULT 0,
      guardado_at TEXT NOT NULL,
      guardado_por TEXT
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_inventario_511_version_opp ON inventario_511_version(oportunidad_id)'),
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
  // Lo capturado antes del historial entra como su primera versión, fechada en
  // su último guardado (no hay mejor dato de cuándo se subió cada foto).
  if (!historialExiste) {
    await env.DB.prepare(`INSERT INTO inventario_511_version
      (oportunidad_id, producto_id, color, producto_nombre, imagen_mexico_key, imagen_mexico_at, imagen_usa_key, imagen_usa_at, comentarios, agregado_manualmente, guardado_at)
      SELECT oportunidad_id, producto_id, color, producto_nombre,
        imagen_mexico_key, CASE WHEN imagen_mexico_key IS NULL THEN NULL ELSE COALESCE(imagen_mexico_at, updated_at) END,
        imagen_usa_key, CASE WHEN imagen_usa_key IS NULL THEN NULL ELSE COALESCE(imagen_usa_at, updated_at) END,
        comentarios, agregado_manualmente, updated_at
      FROM inventario_511`).run();
  }
  tableReady = true;
}

interface Row {
  producto_id: string; color: string; producto_nombre: string; imagen_mexico_key: string | null;
  imagen_mexico_at: string | null; imagen_usa_key: string | null; imagen_usa_at: string | null;
  comentarios: string; agregado_manualmente: number;
}
interface VersionRow extends Row { guardado_at: string; guardado_por: string | null }

const COLS = 'producto_id, color, producto_nombre, imagen_mexico_key, imagen_mexico_at, imagen_usa_key, imagen_usa_at, comentarios, agregado_manualmente';

const toDTO = (row: Row): InventarioCotizacionProductoDTO => ({
  productoId: row.producto_id,
  productoNombre: row.producto_nombre,
  color: row.color,
  imagenMexicoUrl: row.imagen_mexico_key ? `/api/files/${row.imagen_mexico_key}` : undefined,
  imagenUsaUrl: row.imagen_usa_key ? `/api/files/${row.imagen_usa_key}` : undefined,
  imagenMexicoFecha: row.imagen_mexico_key ? row.imagen_mexico_at ?? undefined : undefined,
  imagenUsaFecha: row.imagen_usa_key ? row.imagen_usa_at ?? undefined : undefined,
  comentarios: row.comentarios,
  agregadoManualmente: !!row.agregado_manualmente,
});

const toVersionDTO = (row: VersionRow): InventarioVersionDTO => ({
  ...toDTO(row), guardadoAt: row.guardado_at, guardadoPor: row.guardado_por ?? undefined,
});

// Versión de un DTO → llaves de R2 (el PDF de un día pasado lee las fotos de
// ese día, que siguen en R2 aunque ya se hayan reemplazado).
const keyDeUrl = (url?: string) => (url?.startsWith('/api/files/') ? url.slice('/api/files/'.length) : null);

async function ownOpportunity(env: Env, opportunityId: number, viewer: Identity): Promise<void> {
  const opp = await getItem(env, 'oportunidades', opportunityId, viewer, 'own');
  if (!opp) throw new InventarioCotizacionError(404, 'not found');
}

async function historial(env: Env, opportunityId: number): Promise<InventarioVersionDTO[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${COLS}, guardado_at, guardado_por FROM inventario_511_version WHERE oportunidad_id = ? ORDER BY guardado_at, id`,
  ).bind(opportunityId).all<VersionRow>();
  return (results ?? []).map(toVersionDTO);
}

export async function listInventarioCotizacion(
  env: Env, opportunityId: number, viewer: Identity,
): Promise<{ productos: InventarioCotizacionProductoDTO[]; historial: InventarioVersionDTO[] }> {
  // Lectura respeta el mismo alcance de oportunidad que el drawer; los líderes
  // de zona pueden ver evidencia, pero no escribirla (el POST usa own).
  const opp = await getItem(env, 'oportunidades', opportunityId, viewer);
  if (!opp) throw new InventarioCotizacionError(404, 'not found');
  await ensureTable(env);
  const { results } = await env.DB.prepare(
    `SELECT ${COLS} FROM inventario_511 WHERE oportunidad_id = ? ORDER BY producto_nombre, color`,
  ).bind(opportunityId).all<Row>();
  return { productos: (results ?? []).map(toDTO), historial: await historial(env, opportunityId) };
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
): Promise<{ producto: InventarioCotizacionProductoDTO; version: InventarioVersionDTO }> {
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
    const r = await env.DB.prepare(`UPDATE inventario_511 SET color = ?
      WHERE oportunidad_id = ? AND producto_id = ? AND color = ''
        AND NOT EXISTS (SELECT 1 FROM inventario_511 WHERE oportunidad_id = ? AND producto_id = ? AND color = ?)`,
    ).bind(color, opportunityId, productoId, opportunityId, productoId, color).run();
    // Su historial se va con él: si no, los días pasados mostrarían una tarjeta
    // "sin color" huérfana junto a la del color.
    if (r.meta.changes) {
      await env.DB.prepare(`UPDATE inventario_511_version SET color = ? WHERE oportunidad_id = ? AND producto_id = ? AND color = ''`)
        .bind(color, opportunityId, productoId).run();
    }
  }
  const existing = await env.DB.prepare(
    'SELECT imagen_mexico_key, imagen_mexico_at, imagen_usa_key, imagen_usa_at, updated_at FROM inventario_511 WHERE oportunidad_id = ? AND producto_id = ? AND color = ?',
  ).bind(opportunityId, productoId, color).first<{ imagen_mexico_key: string | null; imagen_mexico_at: string | null; imagen_usa_key: string | null; imagen_usa_at: string | null; updated_at: string }>();
  const ahora = new Date().toISOString();
  const slug = color ? `${productoId}-${color.replace(/[^A-Z0-9]+/g, '_')}` : productoId;
  const mexicoKey = input.mexico
    ? oportunidadFileKey(opportunityId, 'inventario-5-11', `${slug}-mexico-${crypto.randomUUID()}-${input.mexico.name}`)
    : existing?.imagen_mexico_key ?? null;
  const usaKey = input.usa
    ? oportunidadFileKey(opportunityId, 'inventario-5-11', `${slug}-usa-${crypto.randomUUID()}-${input.usa.name}`)
    : existing?.imagen_usa_key ?? null;
  // Foto nueva = fecha de hoy; la que se queda conserva la suya (las de antes
  // de esta columna, su último guardado).
  const mexicoAt = input.mexico ? ahora : mexicoKey ? existing?.imagen_mexico_at ?? existing?.updated_at ?? null : null;
  const usaAt = input.usa ? ahora : usaKey ? existing?.imagen_usa_at ?? existing?.updated_at ?? null : null;
  if (input.mexico) await putFile(env, mexicoKey!, input.mexico);
  if (input.usa) await putFile(env, usaKey!, input.usa);
  const comentarios = input.comentarios.trim();
  const row: Row = {
    producto_id: productoId, color, producto_nombre: productoNombre,
    imagen_mexico_key: mexicoKey, imagen_mexico_at: mexicoAt, imagen_usa_key: usaKey, imagen_usa_at: usaAt,
    comentarios, agregado_manualmente: input.agregadoManualmente ? 1 : 0,
  };
  const valores = [opportunityId, productoId, color, productoNombre, mexicoKey, mexicoAt, usaKey, usaAt, comentarios, row.agregado_manualmente, ahora] as const;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO inventario_511
      (oportunidad_id, producto_id, color, producto_nombre, imagen_mexico_key, imagen_mexico_at, imagen_usa_key, imagen_usa_at, comentarios, agregado_manualmente, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(oportunidad_id, producto_id, color) DO UPDATE SET
        producto_nombre = excluded.producto_nombre, imagen_mexico_key = excluded.imagen_mexico_key,
        imagen_mexico_at = excluded.imagen_mexico_at, imagen_usa_key = excluded.imagen_usa_key,
        imagen_usa_at = excluded.imagen_usa_at, comentarios = excluded.comentarios,
        agregado_manualmente = excluded.agregado_manualmente, updated_at = excluded.updated_at`,
    ).bind(...valores),
    env.DB.prepare(`INSERT INTO inventario_511_version
      (oportunidad_id, producto_id, color, producto_nombre, imagen_mexico_key, imagen_mexico_at, imagen_usa_key, imagen_usa_at, comentarios, agregado_manualmente, guardado_at, guardado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...valores, viewer.email),
  ]);
  return { producto: toDTO(row), version: toVersionDTO({ ...row, guardado_at: ahora, guardado_por: viewer.email }) };
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
  /** YYYY-MM-DD: el inventario como estaba ese día (versión pasada del tab). */
  dia?: string,
): Promise<{ bytes: Uint8Array; oppName: string }> {
  const opp = await getItem(env, 'oportunidades', opportunityId, viewer);
  if (!opp) throw new InventarioCotizacionError(404, 'not found');
  if (productos.length === 0) throw new InventarioCotizacionError(422, 'no hay productos para exportar');
  if (productos.length > INVENTARIO_PDF_MAX_PRODUCTOS) throw new InventarioCotizacionError(400, `máximo ${INVENTARIO_PDF_MAX_PRODUCTOS} productos por PDF`);
  await ensureTable(env);
  let guardados: Map<string, Row>;
  if (dia) {
    const alDia = inventarioAlDia(await historial(env, opportunityId), dia);
    guardados = new Map(alDia.map(v => [`${v.productoId}|${v.color}`, {
      producto_id: v.productoId, color: v.color, producto_nombre: v.productoNombre,
      imagen_mexico_key: keyDeUrl(v.imagenMexicoUrl), imagen_mexico_at: v.imagenMexicoFecha ?? null,
      imagen_usa_key: keyDeUrl(v.imagenUsaUrl), imagen_usa_at: v.imagenUsaFecha ?? null,
      comentarios: v.comentarios, agregado_manualmente: v.agregadoManualmente ? 1 : 0,
    }]));
  } else {
    const { results } = await env.DB.prepare(
      `SELECT ${COLS} FROM inventario_511 WHERE oportunidad_id = ?`,
    ).bind(opportunityId).all<Row>();
    guardados = new Map((results ?? []).map(r => [`${r.producto_id}|${r.color}`, r]));
  }
  const subida = (at: string | null | undefined) => (at ? ` · subido el ${fechaInventario(at)}` : '');

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
    blocks.push({ kind: 'image', titulo: `Inventario MEX${mex ? subida(row?.imagen_mexico_at) : ''}`, imagen: mex });
    blocks.push({ kind: 'image', titulo: `Inventario USA${usa ? subida(row?.imagen_usa_at) : ''}`, imagen: usa });
    const comentarios = row?.comentarios.trim();
    blocks.push({ kind: 'text', text: 'COMENTARIOS', size: 7.5, bold: true, color: '#98a1ae' });
    blocks.push({ kind: 'text', text: comentarios || 'Sin comentarios.', color: comentarios ? undefined : '#98a1ae' });
  }

  const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Mexico_City' });
  const bytes = renderDocument({
    title: 'Inventario 5.11',
    subtitle: dia ? `${opp.name ?? ''} · inventario al ${fechaInventario(dia)}` : opp.name ?? '',
    docId: `INV-${opportunityId}`,
    generatedAt: hoy,
    logo: base64ToBytes(LOGO_JPG_BASE64),
    hideGeneratedByLine: true,
  }, blocks);
  return { bytes, oppName: opp.name ?? '' };
}
