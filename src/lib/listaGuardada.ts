// src/lib/listaGuardada.ts — las listas sobreviven a RECARGAR la pestaña
// (2026-10-08, plan de Core Web Vitals, pasos 1 y 2). Medido en producción con
// la red de Mérida (0.7 Mbps): la lista de Oportunidades son 156 KB que se
// re-bajaban en CADA carga aunque nada hubiera cambiado (~2.2 s solo de
// bajada), y la precarga de index.html no le servía a admin (su vista
// extendida pide más columnas, así que la lista se bajaba dos veces).
//
// Cómo funciona:
//  - Cada lista que llega completa se guarda (Cache API, igual que el catálogo
//    de apiClient.ts) junto con su ETag y su marca de agua.
//  - Al volver a montar la lista —o al recargar— se lee la copia y el PRIMER
//    request ya sale incremental (`since` + If-None-Match): el worker contesta
//    304 sin cuerpo o solo lo que cambió.
//  - `index.html` precarga EXACTAMENTE ese request (URL + ETag guardados en
//    localStorage por ruta), así que en una recarga sale a los ~0.5 s en vez de
//    esperar al bundle, y para admin ya es la URL con sus columnas.
//
// Reglas de seguridad (Efraín aprobó guardar la lista en el navegador):
//  - Una copia guardada solo se usa cuando /api/me confirmó que es el MISMO
//    correo que la guardó. El ETag ya lleva correo y rol (worker/lib/dal.ts),
//    pero una respuesta incremental se FUSIONA con la copia: con la de otra
//    persona saldrían columnas que no le tocan (utilidades).
//  - Otro correo en el mismo navegador, o cerrar sesión → se borra todo.
//  - Con "ver como" ni se lee ni se guarda.
//  - La copia guardada (de una recarga) no se pinta hasta que el worker la
//    confirma (304) o la actualiza; la de memoria (misma pestaña, ya
//    confirmada en esta sesión) se pinta al instante mientras revalida.
//
// Sin imports de api.ts/useMe.ts a propósito (evita ciclos): useMe avisa el
// correo con `fijarCorreo`.
import type { ListResponse } from '../../shared/dto';
import { getImpersonateTarget } from './impersonation';

const CACHE = 'cmp-listas-v1';
/** Índice en localStorage: de quién son las copias, qué bases hay guardadas y,
 * por ruta, qué request precargar. Lo lee el script inline de index.html. */
export const PRECARGA_KEY = 'cmp:precarga';
/** Copias más viejas que esto no se usan (la incremental traería casi todo). */
const MAX_EDAD_MS = 7 * 24 * 3600_000;
const ESPERA_CORREO_MS = 5000;

export interface ListaGuardada {
  /** `/boards/<slug>/items?cols=…&totales=1` (sin since/tv) — la llave. */
  base: string;
  etag: string;
  since?: string;
  tv?: string;
  json: ListResponse;
  at: number;
}

interface Indice {
  email: string;
  /** Base → el request que sigue para su copia (lo que index.html precarga). */
  urls: Record<string, { url: string; etag: string }>;
  /** Ruta (1er segmento) → base de su lista principal. Aparte de `urls`
   * porque varias rutas comparten base (los boards de etapa leen la misma
   * lista): si cada ruta guardara su URL, la de una ruta quedaría vieja en
   * cuanto la otra actualizara la copia. */
  rutas: Record<string, string>;
}

const memoria = new Map<string, ListaGuardada>();
let correo: string | null = null;
let alLlegarCorreo: Array<(e: string | null) => void> = [];

function leerIndice(): Indice | null {
  try {
    const raw = localStorage.getItem(PRECARGA_KEY);
    if (!raw) return null;
    const i = JSON.parse(raw) as Indice;
    return i && typeof i.email === 'string' && i.urls && i.rutas ? i : null;
  } catch { return null; }
}

function escribirIndice(i: Indice): void {
  try { localStorage.setItem(PRECARGA_KEY, JSON.stringify(i)); } catch { /* cuota llena: sin precarga */ }
}

function apagado(): boolean {
  try { return getImpersonateTarget() !== null || typeof localStorage === 'undefined'; } catch { return true; }
}

function cacheKey(base: string): string {
  return `/__cmp/lista?base=${encodeURIComponent(base)}`;
}

/** El request que sigue para una copia: lo que pide usePoll y lo que precarga
 * index.html. Debe calcar `queryLista` (src/lib/api.ts): se arma allá. */
export type ArmarUrl = (since?: string, tv?: string) => string;

/** useMe avisa quién es el viewer. Otro correo que el de las copias → se
 * borran todas antes de que nadie las lea. */
export function fijarCorreo(email: string): void {
  const e = email.toLowerCase();
  correo = e;
  const i = leerIndice();
  if (i && i.email !== e) void borrarListasGuardadas();
  const fns = alLlegarCorreo;
  alLlegarCorreo = [];
  fns.forEach(fn => fn(e));
}

function esperarCorreo(): Promise<string | null> {
  if (correo) return Promise.resolve(correo);
  return new Promise((resolve) => {
    alLlegarCorreo.push(resolve);
    setTimeout(() => resolve(null), ESPERA_CORREO_MS);
  });
}

/** ¿Hay copia de esta base? Síncrono: si no hay, la lista ni espera a /me. */
export function hayListaGuardada(base: string): boolean {
  if (apagado()) return false;
  if (memoria.has(base)) return true;
  return !!leerIndice()?.urls[base];
}

/** La copia de `base`, solo si es del mismo correo. `enMemoria` = ya
 * confirmada en esta pestaña (se puede pintar al instante). */
export async function leerListaGuardada(base: string): Promise<{ lista: ListaGuardada; enMemoria: boolean } | null> {
  if (apagado()) return null;
  const mem = memoria.get(base);
  if (mem) return { lista: mem, enMemoria: true };
  const e = await esperarCorreo();
  const i = leerIndice();
  if (!e || !i || i.email !== e || !i.urls[base]) return null;
  try {
    if (typeof caches === 'undefined') return null;
    const res = await (await caches.open(CACHE)).match(cacheKey(base));
    if (!res) return null;
    const l = await res.json() as ListaGuardada;
    if (!l || l.base !== base || typeof l.etag !== 'string' || !l.json || !Array.isArray(l.json.items)) return null;
    if (Date.now() - l.at > MAX_EDAD_MS) return null;
    return { lista: l, enMemoria: false };
  } catch {
    return null;
  }
}

const pendientes = new Map<string, number>();

/** Guarda la lista recién confirmada por el worker. En memoria al instante;
 * al navegador con un respiro (la lista cambia en ráfagas). `ruta` = 1er
 * segmento de la URL si esta lista es la principal de la pantalla (lo que
 * index.html precarga al recargar ahí). */
export function guardarLista(l: Omit<ListaGuardada, 'at'>, armarUrl: ArmarUrl, ruta: string | null): void {
  if (apagado() || !correo) return;
  const lista: ListaGuardada = { ...l, at: Date.now() };
  memoria.set(l.base, lista);
  const previo = pendientes.get(l.base);
  if (previo) clearTimeout(previo);
  pendientes.set(l.base, window.setTimeout(() => {
    pendientes.delete(l.base);
    const email = correo;
    if (!email || apagado() || typeof caches === 'undefined') return;
    void caches.open(CACHE)
      .then(c => c.put(cacheKey(l.base), new Response(JSON.stringify(lista), { headers: { 'Content-Type': 'application/json' } })))
      .then(() => {
        // El índice DESPUÉS de la copia: si la copia no se escribió, la
        // precarga no debe pedir un incremental que nadie va a poder fusionar.
        if (correo !== email || apagado()) return;
        const i = leerIndice();
        const idx: Indice = i && i.email === email ? i : { email, urls: {}, rutas: {} };
        idx.urls[l.base] = { url: '/api' + armarUrl(lista.since, lista.tv), etag: lista.etag };
        if (ruta !== null) idx.rutas[ruta] = l.base;
        escribirIndice(idx);
      })
      .catch(() => { /* es una optimización: si no cabe, no pasa nada */ });
  }, 2000));
}

/** Cerrar sesión / cambio de persona: fuera copias, índice y memoria. */
export async function borrarListasGuardadas(): Promise<void> {
  memoria.clear();
  pendientes.forEach(t => clearTimeout(t));
  pendientes.clear();
  try { localStorage.removeItem(PRECARGA_KEY); } catch { /* nada */ }
  try { if (typeof caches !== 'undefined') await caches.delete(CACHE); } catch { /* nada */ }
}
