// worker/lib/ocImagenes.ts — la foto de producto que sale IMPRESA en la Orden
// de Compra con imágenes (Efraín, 2026-08-24).
//
// El porqué: el mismo SKU llega con variantes que el texto no distingue —un
// chaleco con broches y uno con velcro comparten modelo y descripción— y el
// proveedor termina fabricando el equivocado. La OC con imágenes pone la foto
// grande para que no haya duda.
//
// De dónde sale la foto: primero la que ALGUIEN SUBIÓ desde el portal para ese
// SKU; si no hay, la del catálogo de Airtable ("Imagen producto"), que se copia
// a R2 la primera vez. La copia NO es un capricho: las URLs de attachment de
// Airtable EXPIRAN a las pocas horas, así que guardar la liga en vez de los
// bytes daría OCs con huecos a los dos días.
//
// La foto vive por SKU y se reusa en todas las OC ("estaría genial poder
// guardarla y volverla a usar", Efraín) — no por proyecto ni por línea. Las OC
// ya emitidas no cambian aunque después se reemplace la foto: el PDF se guarda
// como archivo, no se re-renderiza.
//
// Nada de esto toca Monday, así que no le aplican las guardas de
// worker/lib/archivoBorrado.ts (esas son para columnas `file`, que sí son 1-1
// con Monday). Reemplazar una foto NO borra la anterior de R2 — el objeto es
// direccionable por su sha256 y se queda; preferimos basura barata en R2 antes
// que un borrado que nadie pidió.
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import type { RawCol } from './serialize';
import { fetchAirtableImageUrl } from './airtable';
import { pngToPdfImage, isPng, type PdfImageData } from './pdf/png';
import { jpegImage } from './pdf/writer';

/** Productos (18395657591) — mismos ids que worker/lib/airtable.ts. */
const PRODUCTO_SKU_COL = 'product_and_service_sku';
const PRODUCTO_AIRTABLE_ID_COL = 'text_mkzmgvc7';

/** Tope de subida. Una foto de catálogo son cientos de KB; 5 MB ya es un
 * escaneo enorme y solo sirve para inflar el PDF. */
export const OC_IMAGEN_MAX_BYTES = 5 * 1024 * 1024;

/** Solo JPEG y PNG: son los dos formatos que el motor de PDF sabe embeber
 * (worker/lib/pdf/writer.ts y worker/lib/pdf/png.ts). Un WEBP se aceptaría y
 * después saldría como placeholder, que es peor que rechazarlo aquí. */
export const OC_IMAGEN_TIPOS = ['image/jpeg', 'image/png'] as const;

/** Cuántas fotos se jalan de Airtable en UNA generación de PDF. El resto queda
 * para la siguiente (ya con las anteriores en caché): el Worker tiene
 * presupuesto de subrequests y una OC de 30 productos nuevos lo agotaría. */
const MAX_AIRTABLE_POR_CORRIDA = 10;

export class OcImagenError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface OcImagenMeta {
  sku: string;
  origen: 'airtable' | 'subida';
  contentType: string;
  bytes: number;
  updatedAt: string;
  updatedBy: string;
}

let tableReady = false;

async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_imagen (
    sku          TEXT PRIMARY KEY,
    r2_key       TEXT NOT NULL,
    content_type TEXT NOT NULL,
    origen       TEXT NOT NULL,
    sha256       TEXT NOT NULL,
    bytes        INTEGER NOT NULL,
    updated_at   TEXT NOT NULL,
    updated_by   TEXT NOT NULL
  )`).run();
  tableReady = true;
}

/** Llave canónica del SKU: es la misma foto sin importar cómo lo escribieron en
 * la línea. Pura — anclada en test. */
export function skuKey(sku: string): string {
  return sku.trim().toUpperCase();
}

/** Un SKU utilizable como llave: sin espacios raros ni caracteres que después
 * habría que escapar en un LIKE de SQLite o en un key de R2. Los SKUs reales
 * del catálogo son alfanuméricos con guiones. Pura. */
export function isSkuUsable(sku: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._\-]{0,59}$/.test(sku.trim());
}

function r2KeyFor(sku: string, sha: string, contentType: string): string {
  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  return `oc-imagenes/${skuKey(sku)}/${sha}.${ext}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Tipo REAL por firma de bytes, no por lo que dijo el navegador: un archivo
 * renombrado a .jpg saldría como placeholder en el PDF sin explicación. Pura. */
export function sniffTipo(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (isPng(bytes)) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return null;
}

async function upsert(
  env: Env, sku: string, bytes: Uint8Array, contentType: string,
  origen: 'airtable' | 'subida', email: string,
): Promise<OcImagenMeta> {
  await ensureTable(env);
  const sha = await sha256Hex(bytes);
  const key = r2KeyFor(sku, sha, contentType);
  await env.FILES.put(key, bytes as BufferSource, { httpMetadata: { contentType } });
  const at = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO oc_imagen (sku, r2_key, content_type, origen, sha256, bytes, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sku) DO UPDATE SET
       r2_key = excluded.r2_key, content_type = excluded.content_type,
       origen = excluded.origen, sha256 = excluded.sha256, bytes = excluded.bytes,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(skuKey(sku), key, contentType, origen, sha, bytes.length, at, email).run();
  return { sku: skuKey(sku), origen, contentType, bytes: bytes.length, updatedAt: at, updatedBy: email };
}

interface Registro { sku: string; r2_key: string; content_type: string; origen: string; bytes: number; updated_at: string; updated_by: string }

async function registrosDe(env: Env, skus: string[]): Promise<Map<string, Registro>> {
  await ensureTable(env);
  const keys = [...new Set(skus.map(skuKey).filter(Boolean))];
  const out = new Map<string, Registro>();
  // Troceado a 50: D1 topa alrededor de 100 binds por query (ver
  // docs/dev-contracts.md) y una OC puede traer muchos SKUs distintos.
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const { results } = await env.DB.prepare(
      `SELECT sku, r2_key, content_type, origen, bytes, updated_at, updated_by
         FROM oc_imagen WHERE sku IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<Registro>();
    for (const r of results ?? []) out.set(r.sku, r);
  }
  return out;
}

/** Id de Airtable del producto del catálogo con ese SKU, leyendo el mirror de
 * D1. El LIKE acota (el SKU aparece literal en el JSON de columnas) y la
 * verificación real se hace parseando: LIKE por sí solo daría falsos positivos
 * con SKUs que son prefijo de otros. */
async function airtableIdDeSku(env: Env, sku: string): Promise<string> {
  if (!isSkuUsable(sku)) return '';
  const { results } = await env.DB.prepare(
    `SELECT columns FROM items WHERE board_id = ? AND columns LIKE ? LIMIT 25`,
  ).bind(BOARDS.productos.id, `%"${sku.trim()}"%`).all<{ columns: string }>();

  for (const row of results ?? []) {
    let cols: RawCol[];
    try { cols = JSON.parse(row.columns || '[]'); } catch { continue; }
    const propio = cols.find(c => c.id === PRODUCTO_SKU_COL)?.text ?? '';
    if (skuKey(propio) !== skuKey(sku)) continue;
    const airtableId = (cols.find(c => c.id === PRODUCTO_AIRTABLE_ID_COL)?.text ?? '').trim();
    if (airtableId) return airtableId;
  }
  return '';
}

/** Baja la foto del catálogo de Airtable y la deja en R2. Devuelve null —sin
 * lanzar— si el producto no tiene record, no tiene imagen, o Airtable falla:
 * misma degradación silenciosa que la cotización (worker/lib/airtable.ts). */
export async function jalarDeAirtable(env: Env, sku: string): Promise<OcImagenMeta | null> {
  const airtableId = await airtableIdDeSku(env, sku);
  if (!airtableId) return null;
  // `large` y no `full`: el thumbnail grande de Airtable ronda los 500px, que a
  // 3.7 pulgadas de ancho imprime de sobra, y el `full` puede traer 3000px que
  // solo inflan el PDF y el CPU de descompresión.
  const url = await fetchAirtableImageUrl(env, airtableId, 'large');
  if (!url) return null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > OC_IMAGEN_MAX_BYTES) return null;
    const tipo = sniffTipo(bytes);
    if (!tipo) return null;
    return await upsert(env, sku, bytes, tipo, 'airtable', 'airtable');
  } catch {
    return null;
  }
}

/** Foto que subió una persona desde el portal — gana sobre la de Airtable y se
 * reusa en las OC siguientes. */
export async function guardarImagenSubida(
  env: Env, sku: string, bytes: Uint8Array, email: string,
): Promise<OcImagenMeta> {
  if (!isSkuUsable(sku)) throw new OcImagenError(400, 'SKU inválido');
  if (bytes.length === 0) throw new OcImagenError(400, 'archivo vacío');
  if (bytes.length > OC_IMAGEN_MAX_BYTES) throw new OcImagenError(413, 'la imagen pasa de 5 MB');
  const tipo = sniffTipo(bytes);
  if (!tipo) throw new OcImagenError(400, 'solo JPG o PNG');
  return upsert(env, sku, bytes, tipo, 'subida', email);
}

/** Vuelve a la foto del catálogo: re-jala de Airtable y pisa la subida. */
export async function restablecerDesdeAirtable(env: Env, sku: string): Promise<OcImagenMeta | null> {
  if (!isSkuUsable(sku)) throw new OcImagenError(400, 'SKU inválido');
  return jalarDeAirtable(env, sku);
}

/** Estado de la foto de cada SKU, para pintar las miniaturas del tab. No baja
 * nada de Airtable: solo dice qué hay guardado. */
export async function listarImagenes(env: Env, skus: string[]): Promise<OcImagenMeta[]> {
  const registros = await registrosDe(env, skus);
  return [...registros.values()].map(r => ({
    sku: r.sku,
    origen: r.origen === 'subida' ? 'subida' : 'airtable',
    contentType: r.content_type,
    bytes: r.bytes,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

/** Bytes de la foto de un SKU (para servirla como miniatura en el portal). */
export async function leerImagen(
  env: Env, sku: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const registros = await registrosDe(env, [sku]);
  const reg = registros.get(skuKey(sku));
  if (!reg) return null;
  const obj = await env.FILES.get(reg.r2_key);
  if (!obj) return null;
  return { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: reg.content_type };
}

/** Decodifica al formato que embebe el PDF. JPEG entra tal cual; PNG se
 * convierte (worker/lib/pdf/png.ts). Null ⇒ placeholder gris. */
async function aPdfImage(bytes: Uint8Array, contentType: string): Promise<PdfImageData | null> {
  if (contentType === 'image/png' || isPng(bytes)) return pngToPdfImage(bytes);
  return jpegImage(bytes);
}

/** Fotos listas para el PDF, por SKU. Lo que ya está en R2 se lee; lo que falta
 * se intenta jalar de Airtable (acotado a MAX_AIRTABLE_POR_CORRIDA) y queda
 * cacheado para la próxima. Un SKU sin foto simplemente no aparece en el mapa —
 * la ficha sale con el placeholder gris, nunca con error. */
export async function cargarImagenesParaPdf(
  env: Env, skus: string[],
): Promise<Map<string, PdfImageData>> {
  const unicos = [...new Set(skus.map(skuKey).filter(Boolean))];
  const registros = await registrosDe(env, unicos);

  const faltantes = unicos.filter(s => !registros.has(s)).slice(0, MAX_AIRTABLE_POR_CORRIDA);
  for (const sku of faltantes) {
    const meta = await jalarDeAirtable(env, sku);
    if (meta) {
      const nuevos = await registrosDe(env, [sku]);
      const reg = nuevos.get(sku);
      if (reg) registros.set(sku, reg);
    }
  }

  const out = new Map<string, PdfImageData>();
  for (const [sku, reg] of registros) {
    const obj = await env.FILES.get(reg.r2_key);
    if (!obj) continue;
    const img = await aPdfImage(new Uint8Array(await obj.arrayBuffer()), reg.content_type);
    if (img) out.set(sku, img);
  }
  return out;
}
