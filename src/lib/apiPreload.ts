// Recoge las respuestas que el script inline de index.html ya pidió antes de
// que existiera el bundle. Ver el comentario largo allá para el porqué.
//
// Reglas para poder usar una precarga (si alguna no se cumple, apiFetch hace
// el request normal — nunca se sirve algo distinto de lo que se pidió):
//  - mismo path exacto, incluida la query;
//  - método GET;
//  - sin headers que cambien la respuesta, salvo If-None-Match IDÉNTICO al que
//    mandó la precarga (desde 2026-10-08 index.html precarga el request
//    incremental de la lista guardada, src/lib/listaGuardada.ts, con su ETag:
//    un 304 de esa precarga sí es la respuesta a lo que pide la app). Un
//    If-None-Match distinto, o sin él cuando la precarga lo llevó, no sirve;
//  - una sola vez: el body de una Response se consume, así que en cuanto se
//    entrega se saca del mapa.

type MapaPrecarga = Record<string, Promise<Response>>;

function mapa(): MapaPrecarga | null {
  const w = window as unknown as { __cmpPrecarga?: MapaPrecarga };
  return w.__cmpPrecarga ?? null;
}

/** If-None-Match con que salió cada precarga (index.html), por URL. */
function etagsPrecarga(): Record<string, string> {
  const w = window as unknown as { __cmpPrecargaEtag?: Record<string, string> };
  return w.__cmpPrecargaEtag ?? {};
}

/** ¿La respuesta precargada es intercambiable con la que pide `init`? Content-Type
 * en un GET no cambia nada; If-None-Match tiene que ser el mismo que llevó la
 * precarga; cualquier otro header la descarta. */
export function headersCompatibles(init: RequestInit | undefined, etagPrecarga: string | undefined): boolean {
  let inm: string | undefined;
  if (init?.headers) {
    const h = new Headers(init.headers);
    for (const [k, v] of h.entries()) {
      const kl = k.toLowerCase();
      if (kl === 'content-type') continue;
      if (kl === 'if-none-match') { inm = v; continue; }
      return false;
    }
  }
  return inm === etagPrecarga;
}

/** Devuelve la respuesta precargada para `url` si sirve, y la consume. */
export function tomarPrecarga(url: string, init?: RequestInit): Promise<Response> | null {
  const m = mapa();
  if (!m) return null;
  const metodo = (init?.method ?? 'GET').toUpperCase();
  if (metodo !== 'GET') return null;
  const p = m[url];
  if (!p) return null;
  if (!headersCompatibles(init, etagsPrecarga()[url])) return null;
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
