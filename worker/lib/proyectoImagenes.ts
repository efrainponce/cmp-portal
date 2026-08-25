// worker/lib/proyectoImagenes.ts — imágenes EXTRA de un producto dentro de UN
// proyecto, para la OC con imágenes (Efraín, 2026-08-25: "poder AGREGAR
// imágenes a un producto, así como las imágenes de embellecimientos o renders"
// … "y que salga en la OC con imágenes" … "es solo por proyecto, no es para
// todo").
//
// Por qué viven en el PROYECTO y no por SKU como la foto del catálogo
// (worker/lib/ocImagenes.ts): un render con el bordado del cliente, la muestra
// aprobada por ESTE municipio o la foto del color exacto que se negoció aquí no
// tienen por qué aparecer en la OC del cliente siguiente. La foto del catálogo
// sigue siendo la que encabeza la ficha; esto se suma a ella.
//
// En el PDF cada imagen se lleva SU PROPIA ficha de media hoja, con la foto
// grande y el título "(imagen 2 de 3)" — decisión de Efraín sobre mostrarlas
// chiquitas en una tira: el proveedor tiene que poder VER el detalle, que es
// justo para lo que se sube un render.
//
// Los bytes viven en R2 y el registro en D1; nada de esto toca Monday (mismo
// criterio que ocImagenes.ts y que las notas de la OC).
import type { Env } from '../env';
import type { ProyectoImagenDTO } from '../../shared/dto';
import { sniffTipo, skuKey, isSkuUsable, OC_IMAGEN_MAX_BYTES } from './ocImagenes';
import { pngToPdfImage, type PdfImageData } from './pdf/png';
import { jpegImage } from './pdf/writer';

export class ProyectoImagenError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Tope por producto y proyecto. Cada imagen es una ficha de media hoja en el
 * PDF, así que 6 ya son 3 páginas de un solo producto — de ahí para arriba la
 * OC deja de leerse como una orden y empieza a ser un catálogo. */
export const MAX_POR_PRODUCTO = 6;
/** Mismo tope de tamaño que la foto del catálogo. */
export const IMAGEN_MAX_BYTES = OC_IMAGEN_MAX_BYTES;

let tableReady = false;

export async function ensureProyectoImagenTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS proyecto_imagen (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id  INTEGER NOT NULL,
      sku          TEXT NOT NULL,
      r2_key       TEXT NOT NULL,
      content_type TEXT NOT NULL,
      sha256       TEXT NOT NULL,
      bytes        INTEGER NOT NULL,
      nombre       TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      created_by   TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_proyimg_proyecto ON proyecto_imagen (proyecto_id, sku, id)'),
  ]);
  tableReady = true;
}

interface Row {
  id: number; proyecto_id: number; sku: string; r2_key: string;
  content_type: string; sha256: string; bytes: number;
  nombre: string; created_at: string; created_by: string;
}

function toDTO(r: Row): ProyectoImagenDTO {
  return {
    id: String(r.id),
    sku: r.sku,
    nombre: r.nombre,
    contentType: r.content_type,
    bytes: r.bytes,
    subidaPor: r.created_by,
    subidaEn: r.created_at,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Nombre legible y acotado: es lo que se imprime como etiqueta de la ficha en
 * el PDF, así que no puede venir con saltos de línea ni 300 caracteres. */
export function limpiarNombre(nombre: string, fallback: string): string {
  const limpio = nombre
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')       // la extensión no le dice nada a nadie
    .replace(/[-_]+/g, ' ')                    // "render-frente.png" → "render frente"
    .replace(/\s+/g, ' ')
    .trim();
  return (limpio || fallback).slice(0, 60);
}

/** Sube una imagen más para un producto de ESTE proyecto. */
export async function agregarImagen(
  env: Env, proyectoId: number, sku: string, bytes: Uint8Array, nombre: string, email: string,
): Promise<ProyectoImagenDTO> {
  if (!isSkuUsable(sku)) throw new ProyectoImagenError(400, 'SKU inválido');
  if (bytes.length === 0) throw new ProyectoImagenError(400, 'archivo vacío');
  if (bytes.length > IMAGEN_MAX_BYTES) throw new ProyectoImagenError(413, 'la imagen pasa de 5 MB');
  // El tipo se decide por la FIRMA de los bytes, no por lo que dijo el
  // navegador: un .webp renombrado a .jpg saldría como hueco gris en el PDF sin
  // ninguna explicación (mismo criterio que ocImagenes.sniffTipo).
  const tipo = sniffTipo(bytes);
  if (!tipo) throw new ProyectoImagenError(400, 'solo JPG o PNG');

  await ensureProyectoImagenTable(env);
  const key = skuKey(sku);
  const cuantas = await env.DB
    .prepare('SELECT count(*) AS n FROM proyecto_imagen WHERE proyecto_id = ? AND sku = ?')
    .bind(proyectoId, key).first<{ n: number }>();
  if ((cuantas?.n ?? 0) >= MAX_POR_PRODUCTO) {
    throw new ProyectoImagenError(400,
      `Ya hay ${MAX_POR_PRODUCTO} imágenes de este producto en el proyecto — quita alguna antes de subir otra.`);
  }

  const sha = await sha256Hex(bytes);
  const ext = tipo === 'image/png' ? 'png' : 'jpg';
  // El key lleva un sufijo único, NO solo el sha: dos filas con los mismos
  // bytes (la misma foto subida dos veces, o para dos productos) compartirían
  // objeto, y al quitar una la otra se quedaba sin bytes — miniatura rota en
  // la tira y hueco gris en el PDF, sin ningún error de por medio. Visto en la
  // prueba local del 2026-08-25.
  const r2Key = `oc-imagenes/proyecto/${proyectoId}/${key}/${sha}-${crypto.randomUUID()}.${ext}`;
  await env.FILES.put(r2Key, bytes as BufferSource, { httpMetadata: { contentType: tipo } });

  const ahora = new Date().toISOString();
  const limpio = limpiarNombre(nombre, `Imagen ${key}`);
  const res = await env.DB.prepare(
    `INSERT INTO proyecto_imagen (proyecto_id, sku, r2_key, content_type, sha256, bytes, nombre, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`,
  ).bind(proyectoId, key, r2Key, tipo, sha, bytes.length, limpio, ahora, email).first<Row>();
  if (!res) throw new ProyectoImagenError(500, 'no se pudo guardar la imagen');
  return toDTO(res);
}

/** Todas las imágenes extra del proyecto, en orden de subida. */
export async function listarImagenesProyecto(env: Env, proyectoId: number): Promise<ProyectoImagenDTO[]> {
  await ensureProyectoImagenTable(env);
  const { results } = await env.DB
    .prepare('SELECT * FROM proyecto_imagen WHERE proyecto_id = ? ORDER BY sku, id')
    .bind(proyectoId).all<Row>();
  return (results ?? []).map(toDTO);
}

export async function leerImagenProyecto(
  env: Env, proyectoId: number, imagenId: number,
): Promise<{ bytes: Uint8Array; contentType: string; nombre: string } | null> {
  await ensureProyectoImagenTable(env);
  const row = await env.DB
    .prepare('SELECT * FROM proyecto_imagen WHERE proyecto_id = ? AND id = ?')
    .bind(proyectoId, imagenId).first<Row>();
  if (!row) return null;
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return null;
  return { bytes: new Uint8Array(await obj.arrayBuffer()), contentType: row.content_type, nombre: row.nombre };
}

/** Quita una imagen del proyecto. Solo quien la subió o un admin (mismo
 * criterio que worker/lib/archivoBorrado.ts: en Monday todo aparece subido por
 * el token de servicio, así que el registro propio es quien sabe de quién es).
 * Aquí no hay nada 1-1 con Monday que respaldar: los bytes solo viven en R2 y
 * se van con la fila. */
export async function borrarImagenProyecto(
  env: Env, proyectoId: number, imagenId: number, email: string, esAdmin: boolean,
): Promise<void> {
  await ensureProyectoImagenTable(env);
  const row = await env.DB
    .prepare('SELECT * FROM proyecto_imagen WHERE proyecto_id = ? AND id = ?')
    .bind(proyectoId, imagenId).first<Row>();
  if (!row) throw new ProyectoImagenError(404, 'not found');
  if (!esAdmin && row.created_by !== email) {
    throw new ProyectoImagenError(403, `Esa imagen la subió ${row.created_by} — solo esa persona o un admin puede quitarla.`);
  }
  await env.DB.prepare('DELETE FROM proyecto_imagen WHERE proyecto_id = ? AND id = ?').bind(proyectoId, imagenId).run();
  // Los bytes solo se borran si NINGUNA otra fila los referencia. El key nuevo
  // ya es único por fila, pero las que se crearon antes de ese arreglo (o de
  // cualquier futuro camino que reuse un objeto) siguen pudiendo compartirlo, y
  // dejar sin imagen a una fila viva es peor que dejar un huérfano en R2.
  const otras = await env.DB
    .prepare('SELECT count(*) AS n FROM proyecto_imagen WHERE r2_key = ?')
    .bind(row.r2_key).first<{ n: number }>();
  if ((otras?.n ?? 0) === 0) {
    // El objeto se va DESPUÉS de la fila: si esto falla, queda un archivo
    // huérfano (barato) en vez de un registro apuntando a bytes que ya no están.
    try { await env.FILES.delete(row.r2_key); } catch { /* huérfano tolerable */ }
  }
}

export interface ExtraParaPdf {
  /** Etiqueta que va bajo el título de la ficha ("Render bordado frente"). */
  nombre: string;
  imagen: PdfImageData;
}

/** Imágenes del proyecto listas para el PDF, por SKU. Una que no se pueda
 * decodificar simplemente no viaja — la OC sale igual, nunca con error. */
export async function cargarExtrasParaPdf(
  env: Env, proyectoId: number, skus: string[],
): Promise<Map<string, ExtraParaPdf[]>> {
  const quiero = new Set(skus.map(skuKey).filter(Boolean));
  const out = new Map<string, ExtraParaPdf[]>();
  if (quiero.size === 0) return out;

  await ensureProyectoImagenTable(env);
  const { results } = await env.DB
    .prepare('SELECT * FROM proyecto_imagen WHERE proyecto_id = ? ORDER BY sku, id')
    .bind(proyectoId).all<Row>();

  for (const row of results ?? []) {
    if (!quiero.has(row.sku)) continue;
    const obj = await env.FILES.get(row.r2_key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const img = row.content_type === 'image/png' ? await pngToPdfImage(bytes) : jpegImage(bytes);
    if (!img) continue;
    const lista = out.get(row.sku) ?? [];
    lista.push({ nombre: row.nombre, imagen: img });
    out.set(row.sku, lista);
  }
  return out;
}
