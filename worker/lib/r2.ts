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

export async function putFile(env: Env, key: string, file: Blob, contentType?: string): Promise<void> {
  await env.FILES.put(key, file, { httpMetadata: { contentType: contentType || file.type || 'application/octet-stream' } });
}
