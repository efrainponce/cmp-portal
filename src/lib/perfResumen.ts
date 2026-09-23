// src/lib/perfResumen.ts — la parte PURA de la medición de rendimiento real
// (src/lib/perfReal.ts): clasificar cada recurso que bajó el navegador y
// resumirlo en unos cuantos números por ventana. Aparte del cableado con el
// DOM para poder probarla sin navegador (perfResumen.test.ts): todo son
// números y strings, justo lo que el typecheck no revisa.
//
// Por qué Resource Timing y no el cronómetro de apiFetch (2026-09-23): el
// cronómetro de `uxApiLatency` para en `await fetch`, o sea cuando llegan los
// ENCABEZADOS. La bajada del cuerpo —lo que de verdad le cuesta a una conexión
// lenta, como la de Compras en Mérida— no se veía: Mérida y CDMX salían con la
// misma latencia. `duration` de Resource Timing sí cuenta hasta el último byte.
import { BOARDS } from '../../shared/boards';
import { routeSlug } from '../../shared/telemetry';

/** Lo que se usa de un PerformanceResourceTiming (copiado a un objeto plano
 * para no retener las entradas del navegador en memoria). */
export interface RecursoMedido {
  name: string;
  startTime: number;
  duration: number;
  responseStart: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  /** Solo Chrome ≥109. Sin él, el 304 se infiere (ver esNoModificado). */
  responseStatus?: number;
}

export type ClaseAsset = 'js' | 'css' | 'font' | 'img' | 'otro';

export type Clasificacion =
  | { tipo: 'api'; target: string; board?: string }
  | { tipo: 'asset'; clase: ClaseAsset }
  | null;

/** Recurso → endpoint normalizado (el mismo slug que `ux_event` ya usa para la
 * latencia, `api:get:boards:slug:items`) o clase de asset estático. Devuelve
 * null para lo que no se mide:
 *  - otro origen (Clarity, Google): sin Timing-Allow-Origin el navegador
 *    reporta tamaños en 0 y se contarían como "vino de caché";
 *  - la propia telemetría (medirla la haría crecer sola);
 *  - rutas de Access (`/cdn-cgi/`). */
export function clasificarRecurso(url: string, origen: string, metodo = 'GET'): Clasificacion {
  let u: URL;
  try { u = new URL(url, origen); } catch { return null; }
  if (u.origin !== origen) return null;
  const path = u.pathname;
  if (path.startsWith('/api/')) {
    if (path.startsWith('/api/telemetry')) return null;
    const sinApi = path.slice(4);
    const segs = sinApi.split('/').filter(Boolean);
    const iBoards = segs.indexOf('boards');
    const posible = iBoards >= 0 ? segs[iBoards + 1]?.toLowerCase() : undefined;
    const board = posible && Object.prototype.hasOwnProperty.call(BOARDS, posible) ? posible : undefined;
    return { tipo: 'api', target: routeSlug(metodo, sinApi), ...(board ? { board } : {}) };
  }
  if (path.startsWith('/cdn-cgi/')) return null;
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'js' || ext === 'mjs') return { tipo: 'asset', clase: 'js' };
  if (ext === 'css') return { tipo: 'asset', clase: 'css' };
  if (ext === 'woff2' || ext === 'woff' || ext === 'ttf' || ext === 'otf') return { tipo: 'asset', clase: 'font' };
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif', 'ico'].includes(ext)) return { tipo: 'asset', clase: 'img' };
  return { tipo: 'asset', clase: 'otro' };
}

/** ¿El servidor contestó 304 (nada cambió)? Con `responseStatus` es exacto. Sin
 * él (Safari/Firefox viejos): hubo tráfico pero cero bytes de cuerpo — un 304
 * de un fetch con If-None-Match manual llega así. */
export function esNoModificado(r: RecursoMedido): boolean {
  if (typeof r.responseStatus === 'number' && r.responseStatus > 0) return r.responseStatus === 304;
  return r.transferSize > 0 && r.encodedBodySize === 0;
}

/** Percentil por rango más cercano sobre un arreglo YA ordenado ascendente. */
export function percentil(ordenado: number[], p: number): number {
  if (ordenado.length === 0) return 0;
  const i = Math.min(ordenado.length - 1, Math.max(0, Math.ceil(p * ordenado.length) - 1));
  return ordenado[i];
}

/** Resumen de un endpoint en una ventana. Las llaves son las de `meta`
 * (≤ 8, solo números/booleanos — shared/telemetry.ts sanitizeMeta). */
export interface ResumenApi {
  target: string;
  board?: string;
  /** p50 de la duración COMPLETA (petición → último byte), en ms. */
  p50: number;
  meta: { n: number; nm: boolean; p50: number; p75: number; max: number; ttfb: number; bytes: number; fria: boolean };
}

/** Agrupa por endpoint+board+(¿304?). Los 304 van en SU PROPIO renglón
 * (`nm: true`, "no modificado"): mezclados con las descargas completas, una
 * ventana de polling (1 descarga + 100 revalidaciones) daría un p50 que es
 * puro 304 y la bajada real de la lista desaparecería — justo lo que se quiere
 * ver. Separados, el renglón `nm: false` es la bajada de verdad y la tasa de
 * 304 sale de sumar `n` de ambos.
 * `ttfb` es el p50 de responseStart−startTime (lo que ya medía apiFetch); la
 * diferencia contra `p50` es la bajada del cuerpo. `bytes` = suma de
 * transferSize (lo que viajó por la red, comprimido y con encabezados). */
export function resumirApi(
  items: Array<{ target: string; board?: string; r: RecursoMedido }>, fria: boolean,
): ResumenApi[] {
  const grupos = new Map<string, { target: string; board?: string; nm: boolean; rs: RecursoMedido[] }>();
  for (const it of items) {
    const nm = esNoModificado(it.r);
    const k = `${it.target}|${it.board ?? ''}|${nm}`;
    let g = grupos.get(k);
    if (!g) { g = { target: it.target, board: it.board, nm, rs: [] }; grupos.set(k, g); }
    g.rs.push(it.r);
  }
  const out: ResumenApi[] = [];
  for (const g of grupos.values()) {
    const dur = g.rs.map(r => r.duration).sort((a, b) => a - b);
    const ttfb = g.rs.map(r => Math.max(0, r.responseStart - r.startTime)).sort((a, b) => a - b);
    const p50 = Math.round(percentil(dur, 0.5));
    out.push({
      target: g.target,
      ...(g.board ? { board: g.board } : {}),
      p50,
      meta: {
        n: g.rs.length,
        nm: g.nm,
        p50,
        p75: Math.round(percentil(dur, 0.75)),
        max: Math.round(dur[dur.length - 1]),
        ttfb: Math.round(percentil(ttfb, 0.5)),
        bytes: Math.round(g.rs.reduce((a, r) => a + (r.transferSize || 0), 0)),
        fria,
      },
    });
  }
  return out;
}

export interface ResumenAssets { n: number; cache: number; bytes: number; js: number; css: number; font: number; max: number; fria: boolean }

/** Totales de estáticos en una ventana. `cache` = los que no tocaron la red
 * (transferSize 0 con cuerpo): el hash del nombre de Vite los vuelve eternos,
 * así que en una carga repetida deberían ser casi todos. */
export function resumirAssets(items: Array<{ clase: ClaseAsset; r: RecursoMedido }>, fria: boolean): ResumenAssets | null {
  if (items.length === 0) return null;
  const s: ResumenAssets = { n: items.length, cache: 0, bytes: 0, js: 0, css: 0, font: 0, max: 0, fria };
  for (const { clase, r } of items) {
    const t = r.transferSize || 0;
    if (t === 0 && r.decodedBodySize > 0) s.cache++;
    s.bytes += t;
    if (clase === 'js') s.js += t;
    else if (clase === 'css') s.css += t;
    else if (clase === 'font') s.font += t;
    s.max = Math.max(s.max, r.duration);
  }
  s.bytes = Math.round(s.bytes); s.js = Math.round(s.js); s.css = Math.round(s.css);
  s.font = Math.round(s.font); s.max = Math.round(s.max);
  return s;
}

/** INP a la manera de web-vitals: la peor interacción, ignorando 1 de cada 50
 * (en una sesión larga, un solo tropiezo no debe definir la experiencia). */
export function calcularInp(duraciones: number[]): number {
  if (duraciones.length === 0) return 0;
  const desc = [...duraciones].sort((a, b) => b - a);
  return Math.round(desc[Math.min(desc.length - 1, Math.floor(desc.length / 50))]);
}

/** CLS con "ventanas de sesión" (la definición vigente): brincos a menos de
 * 1 s entre sí y dentro de 5 s suman juntos; CLS = la peor ventana. Una
 * pestaña abierta 8 horas no acumula un CLS absurdo por sumar todo el día. */
export interface EstadoCls { valor: number; ventana: number; inicio: number; ultimo: number }

export function nuevoCls(): EstadoCls { return { valor: 0, ventana: 0, inicio: -Infinity, ultimo: -Infinity }; }

export function acumularCls(s: EstadoCls, t: number, valor: number): EstadoCls {
  const continua = t - s.ultimo < 1000 && t - s.inicio < 5000;
  const ventana = continua ? s.ventana + valor : valor;
  const inicio = continua ? s.inicio : t;
  return { valor: Math.max(s.valor, ventana), ventana, inicio, ultimo: t };
}
