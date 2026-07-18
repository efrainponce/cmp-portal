// worker/lib/r2.ts — helpers mínimos sobre el binding FILES (bucket
// "mexicanadeproteccion"). Solo archivos que el portal mismo sube (documento,
// embellecimiento) — lo que genera cmp-tallas sigue viviendo en Monday.
import type { Env } from '../env';

export function oportunidadFileKey(oppId: number, categoria: string, filename: string): string {
  return `oportunidades/${oppId}/${categoria}/${filename}`;
}

export async function putFile(env: Env, key: string, file: Blob, contentType?: string): Promise<void> {
  await env.FILES.put(key, file, { httpMetadata: { contentType: contentType || file.type || 'application/octet-stream' } });
}

export async function getFile(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.FILES.get(key);
}
