// Recoge las respuestas que el script inline de index.html ya pidió antes de
// que existiera el bundle. Ver el comentario largo allá para el porqué.
//
// Reglas para poder usar una precarga (si alguna no se cumple, apiFetch hace
// el request normal — nunca se sirve algo distinto de lo que se pidió):
//  - mismo path exacto, incluida la query;
//  - método GET;
//  - sin headers que cambien la respuesta (If-None-Match sobre todo: la
//    precarga no lo mandó, así que su respuesta es un 200 completo y no puede
//    hacer las veces de un 304 condicional);
//  - una sola vez: el body de una Response se consume, así que en cuanto se
//    entrega se saca del mapa.

type MapaPrecarga = Record<string, Promise<Response>>;

function mapa(): MapaPrecarga | null {
  const w = window as unknown as { __cmpPrecarga?: MapaPrecarga };
  return w.__cmpPrecarga ?? null;
}

/** Headers que hacen que la respuesta NO sea intercambiable con la precargada. */
function tieneHeadersQueImportan(init?: RequestInit): boolean {
  if (!init?.headers) return false;
  const h = new Headers(init.headers);
  // Content-Type en un GET no cambia la respuesta; el resto sí puede.
  for (const [k] of h.entries()) {
    if (k.toLowerCase() !== 'content-type') return true;
  }
  return false;
}

/** Devuelve la respuesta precargada para `url` si sirve, y la consume. */
export function tomarPrecarga(url: string, init?: RequestInit): Promise<Response> | null {
  const m = mapa();
  if (!m) return null;
  const metodo = (init?.method ?? 'GET').toUpperCase();
  if (metodo !== 'GET') return null;
  if (tieneHeadersQueImportan(init)) return null;
  const p = m[url];
  if (!p) return null;
  delete m[url];
  // Si la precarga falló (red, 401 de Access…), se descarta y el llamador
  // hace el request normal por su cuenta.
  return p.then((res) => {
    if (!res.ok && res.status !== 304) throw new Error('precarga no utilizable: ' + res.status);
    return res;
  });
}

/** Tira todo lo precargado. Se usa cuando la app arranca en un modo donde esas
 * respuestas no aplican (p. ej. suplantación activa). */
export function descartarPrecarga(): void {
  const w = window as unknown as { __cmpPrecarga?: MapaPrecarga };
  delete w.__cmpPrecarga;
}
