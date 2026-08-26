// worker/lib/r2.ts — helpers mínimos sobre el binding FILES (bucket
// "mexicanadeproteccion"). Solo archivos que el portal mismo sube (documento,
// embellecimiento) — lo que genera cmp-tallas sigue viviendo en Monday.
import type { Env } from '../env';

/** Key de un archivo del portal en R2.
 *
 * `assetId` (el id que Monday devuelve al subir) va AL FRENTE del nombre desde
 * el 2026-08-25: sin él, dos archivos distintos con el mismo nombre en la misma
 * categoría son el mismo objeto en R2 y el segundo pisa al primero en silencio
 * — Monday guarda los dos, el portal se queda con uno. En producción había 61
 * nombres repetidos en columnas que se espejan así.
 *
 * Se omite cuando no hay asset (items NATIVOS de Zona Efrain, que no existen en
 * Monday): ahí el key ya viene acotado por item y campo. Los archivos de ANTES
 * siguen viviendo en el key sin prefijo — `keyLegado` (worker/lib/portalFiles.ts)
 * es el que los rescata al leer. */
export function oportunidadFileKey(
  oppId: number, categoria: string, filename: string, assetId?: string | number | null,
): string {
  const id = assetId != null && String(assetId).trim() !== '' ? `${assetId}-` : '';
  return `oportunidades/${oppId}/${categoria}/${id}${filename}`;
}

/** Key de un archivo que cuelga del PROYECTO, no de una oportunidad.
 *
 * Existe desde que un Proyecto puede nacer SIN Oportunidad ligada (Efraín,
 * 2026-08-26 — ver shared/createFields.ts). Antes, todo archivo del post-venta
 * se guardaba bajo `oportunidades/<oppId>/…` y sin oppId simplemente NO se
 * copiaba a R2: el portal se quedaba con el link `protected_static` de Monday,
 * que pide sesión de Monday para abrirse. O sea que la OC de un proyecto hecho
 * desde cero no la podía abrir nadie del portal.
 *
 * Mismo formato y mismas reglas de prefijo que oportunidadFileKey — solo cambia
 * el primer segmento, y `/api/files` sirve los dos. */
export function proyectoFileKey(
  proyectoId: number, categoria: string, filename: string, assetId?: string | number | null,
): string {
  const id = assetId != null && String(assetId).trim() !== '' ? `${assetId}-` : '';
  return `proyectos/${proyectoId}/${categoria}/${id}${filename}`;
}

export async function putFile(env: Env, key: string, file: Blob, contentType?: string): Promise<void> {
  await env.FILES.put(key, file, { httpMetadata: { contentType: contentType || file.type || 'application/octet-stream' } });
}
