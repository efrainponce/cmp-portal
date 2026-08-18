// worker/lib/mime.ts — Content-Type por extensión de archivo.
//
// Monday sirve los assets de sus columnas de archivo como
// `application/octet-stream`, y en R2 guardamos lo que trajo el upload (que a
// veces viene vacío). Con ese tipo el navegador DESCARGA el archivo en vez de
// mostrarlo: por eso la imagen de referencia de un embellecimiento no se podía
// ver, solo bajar (Efraín, 2026-08-18).
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};
// `svg` NO está en la tabla a propósito: servirlo inline desde el mismo origen
// del portal dejaría correr script dentro de esa pestaña (misma sesión de
// Access). Se queda como octet-stream = descarga.

/** Extensión → Content-Type. Acepta un nombre de archivo o un key de R2
 * completo; cae a `fallback` para lo que no reconoce. */
export function contentTypeFor(nameOrKey: string, fallback = 'application/octet-stream'): string {
  const base = (nameOrKey.split('?')[0].split('/').pop() ?? '').toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot === -1) return fallback;
  return TYPES[base.slice(dot + 1)] ?? fallback;
}

/** true cuando el tipo que trae la fuente no dice nada útil y conviene
 * inferirlo de la extensión. */
export function isGenericType(type: string | null | undefined): boolean {
  const t = (type ?? '').split(';')[0].trim().toLowerCase();
  return t === '' || t === 'application/octet-stream' || t === 'binary/octet-stream';
}
