// Resolución de un key de /api/files → bytes, en un solo lugar (2026-07-25).
// Extraído de worker/routes/oportunidades.ts sin cambiar su comportamiento: la
// ruta sigue sirviendo desde R2 cuando el objeto existe y cayendo de vuelta al
// asset de Monday cuando no, y ahora worker/lib/documents.ts puede leer esos
// mismos bytes para sellarlos (SHA-256) sin duplicar el mapa de columnas.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { getItem, proyectoForOportunidad } from './dal';
import { parseFiles, splitZone } from './embellecimientoImagenes';
import { fetchAssetPublicUrls } from './monday';

// OC / cotización / contrato firmado por el cliente (board Proyectos).
export const PROYECTO_DOCUMENTO_COL = 'file_mm0hayh4';

// Documentos que genera cmp-tallas subiendo directo a Monday (nunca al portal,
// nunca dual-write) — el fallback de abajo es lo único que los mantiene
// funcionando vía /api/files. Las 3 primeras son columnas de la propia
// Oportunidad (itemId = oppId, sin lookup); tallas/oc viven en el Proyecto
// ligado, igual que 'documento'.
export const OPP_FILE_COLS: Record<string, string> = {
  'solicitud-costeo': 'file_mm0z6rze',
  'cotizacion-no-firmada': 'file_mm0fgrzq',
  'cotizacion-firmada': 'file_mm0zjras',
  'inventario': 'file_mm0hpefr',
};
export const PROYECTO_FILE_COLS: Record<string, string> = {
  'tallas': 'file_mm0hcrtz',
  'oc': 'file_mm0hj9pn',
};

// Tab Logística del Proyecto (2026-08-17): archivos por SUBITEM de
// proyectos_sub, no por Proyecto — el key lleva subitemId+field
// (worker/routes/oportunidades.ts POST /api/proyectos_sub/:id/logistica/:field).
// OJO: la llave 'guia-empresa' quedó con el nombre viejo. En Monday esa columna
// hoy se titula "Guia EMB o Cliente Final" (los títulos se intercambiaron con
// text_mm4pywyx; ver LogisticaSection.tsx, realineado el 2026-08-19). La llave es
// un identificador interno del API de subida — renombrarla rompería subidas en
// vuelo y no aporta nada al usuario, que ya ve el rótulo correcto.
export const LOGISTICA_FILE_COLS: Record<string, string> = {
  'guia-empresa': 'file_mm4pz90b',
  'evidencia-recoleccion': 'file_mm4pc4tj',
};

/** Categorías válidas de un key `oportunidades/{oppId}/{categoria}/…`. */
export function isKnownFileCategory(categoria: string): boolean {
  return categoria === 'documento' || categoria === 'embellecimiento' || categoria === 'logistica'
    || categoria in OPP_FILE_COLS || categoria in PROYECTO_FILE_COLS;
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** El mismo key como se guardaba ANTES del prefijo de assetId (2026-08-25), o
 * null si no lo trae. Sirve para leer los archivos viejos sin migrar nada.
 *
 * Ojo con el falso positivo: un archivo que de verdad se llame
 * "2026-08 informe.pdf" también matchea, y por eso el llamador prueba SIEMPRE
 * el key original primero y este después — nunca al revés. */
export function keyLegado(key: string): string | null {
  const corte = key.lastIndexOf('/');
  const base = key.slice(corte + 1);
  const m = /^(\d+)-(.+)$/.exec(base);
  return m ? key.slice(0, corte + 1) + m[2] : null;
}

/** Forma canónica de un key de archivo: sin escapar, como se guarda en R2 y
 * como se ve bien impreso en una constancia. Se aplica en la frontera (crear y
 * listar documentos) para que el mismo archivo tenga un solo source_id. */
export function normalizeFileKey(key: string): string {
  return safeDecode(key);
}

/** El mismo key llega en dos formas según la puerta por la que entra: por
 * `/api/files/...` Hono ya lo decodificó, y por el body JSON de /api/documents
 * viene tal como lo armó el frontend (con %C3%B3 y %20). Se comparan las dos
 * variantes en vez de asumir una, porque un archivo que de verdad se llame
 * "50%20.pdf" no debe romperse al decodificar de más. */
function matchesName(entryName: string, filename: string): boolean {
  return entryName === filename || entryName === safeDecode(filename);
}

/** Igual que `isKnownFileCategory` pero para el prefijo `proyectos/…`: un
 * Proyecto sin Oportunidad ligada guarda sus archivos colgados de sí mismo
 * (worker/lib/r2.ts proyectoFileKey, 2026-08-26). Son las columnas que viven en
 * el Proyecto o en sus líneas — nunca las de la Oportunidad. */
export function isKnownProyectoFileCategory(categoria: string): boolean {
  return categoria === 'documento' || categoria === 'logistica' || categoria in PROYECTO_FILE_COLS;
}

/** assetId detrás de un key `proyectos/<proyectoId>/<categoria>/…`. Mismo
 * scoping que la variante de oportunidades: se resuelve con dal.getItem, así
 * que un viewer que no ve el Proyecto tampoco ve sus archivos. */
async function resolveMondayAssetProyecto(env: Env, parts: string[], viewer: Identity): Promise<number | null> {
  const proyectoId = Number(parts[1]);
  if (!Number.isFinite(proyectoId)) return null;
  const categoria = parts[2];

  if (categoria === 'logistica') {
    const subitemId = Number(parts[3]);
    const field = parts[4];
    const colId = field ? LOGISTICA_FILE_COLS[field] : undefined;
    const filename = parts.slice(5).join('/');
    if (!Number.isFinite(subitemId) || !colId) return null;
    const row = await getItem(env, 'proyectos_sub', subitemId, viewer);
    if (!row || row.parent_item_id !== proyectoId) return null;
    return parseFiles(row.columns, colId).find(f => matchesName(f.name, filename))?.assetId ?? null;
  }

  const colId = categoria === 'documento' ? PROYECTO_DOCUMENTO_COL : PROYECTO_FILE_COLS[categoria];
  if (!colId) return null;
  const filename = parts.slice(3).join('/');
  const row = await getItem(env, 'proyectos', proyectoId, viewer);
  if (!row) return null;
  return parseFiles(row.columns, colId).find(f => matchesName(f.name, filename))?.assetId ?? null;
}

/** assetId de Monday detrás de un key de /api/files, respetando el scoping del
 * viewer (dal.getItem/proyectoForOportunidad). null = no existe o no lo puede ver. */
export async function resolveMondayAsset(env: Env, key: string, viewer: Identity): Promise<number | null> {
  const parts = key.split('/');
  if (parts[0] === 'proyectos') return resolveMondayAssetProyecto(env, parts, viewer);
  const oppId = Number(parts[1]);
  if (parts[0] !== 'oportunidades' || !Number.isFinite(oppId)) return null;
  const categoria = parts[2];

  if (categoria === 'documento') {
    const filename = parts.slice(3).join('/');
    const proyecto = await proyectoForOportunidad(env, oppId, viewer);
    if (!proyecto) return null;
    return parseFiles(proyecto.columns, PROYECTO_DOCUMENTO_COL).find(f => matchesName(f.name, filename))?.assetId ?? null;
  }

  if (categoria === 'embellecimiento') {
    const lineaId = Number(parts[3]);
    const zone = parts[4];
    const filename = parts.slice(5).join('/');
    if (!Number.isFinite(lineaId)) return null;
    const row = await getItem(env, 'oportunidades_sub', lineaId, viewer);
    if (!row) return null;
    return parseFiles(row.columns)
      .map(f => ({ ...f, split: splitZone(f.name) }))
      .find(f => f.split?.zone === zone && matchesName(f.split.original, filename))?.assetId ?? null;
  }

  if (categoria === 'logistica') {
    const subitemId = Number(parts[3]);
    const field = parts[4];
    const filename = parts.slice(5).join('/');
    const colId = field ? LOGISTICA_FILE_COLS[field] : undefined;
    if (!Number.isFinite(subitemId) || !colId) return null;
    const row = await getItem(env, 'proyectos_sub', subitemId, viewer);
    if (!row) return null;
    return parseFiles(row.columns, colId).find(f => matchesName(f.name, filename))?.assetId ?? null;
  }

  if (categoria in OPP_FILE_COLS) {
    const filename = parts.slice(3).join('/');
    const row = await getItem(env, 'oportunidades', oppId, viewer);
    if (!row) return null;
    return parseFiles(row.columns, OPP_FILE_COLS[categoria]).find(f => matchesName(f.name, filename))?.assetId ?? null;
  }

  if (categoria in PROYECTO_FILE_COLS) {
    const filename = parts.slice(3).join('/');
    const proyecto = await proyectoForOportunidad(env, oppId, viewer);
    if (!proyecto) return null;
    return parseFiles(proyecto.columns, PROYECTO_FILE_COLS[categoria]).find(f => matchesName(f.name, filename))?.assetId ?? null;
  }

  return null;
}

/** Bytes de un asset de Monday (link firmado vigente, resuelto al momento). */
export async function fetchAssetBytes(env: Env, assetId: number): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const urls = await fetchAssetPublicUrls(env, [String(assetId)]);
  const url = urls.get(String(assetId));
  if (!url) return null;
  const upstream = await fetch(url);
  if (!upstream.ok) return null;
  return {
    bytes: new Uint8Array(await upstream.arrayBuffer()),
    contentType: upstream.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/** Bytes de un key de /api/files: R2 primero, Monday como fallback. */
export async function readPortalFile(
  env: Env, key: string, viewer: Identity,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  // R2 guarda el nombre SIN escapar (ver oportunidadFileKey), así que si el key
  // llegó codificado se prueba también su forma decodificada.
  const legado = keyLegado(key);
  const object = await env.FILES.get(key)
    ?? await env.FILES.get(safeDecode(key))
    // Archivos subidos antes del prefijo de assetId: viven en el key sin él.
    ?? (legado ? await env.FILES.get(legado) ?? await env.FILES.get(safeDecode(legado)) : null);
  if (object) {
    return {
      bytes: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
    };
  }
  // Último recurso: los bytes vivos de Monday. Se prueba el key tal cual y
  // después sin el prefijo, porque el nombre real es el que empata contra la
  // columna.
  const assetId = await resolveMondayAsset(env, key, viewer)
    ?? (legado ? await resolveMondayAsset(env, legado, viewer) : null);
  if (assetId == null) return null;
  return await fetchAssetBytes(env, assetId);
}
