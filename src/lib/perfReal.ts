// src/lib/perfReal.ts — medición de rendimiento de USUARIOS REALES (2026-09-23).
// Clarity dejó ver que Compras en Mérida trabaja con internet muy lento, pero
// en `ux_event` su latencia salía igual que la de CDMX: el cronómetro de
// apiFetch para en los encabezados y la bajada del cuerpo no se veía. Esto
// mide lo que cada quien de verdad vive, con las APIs del propio navegador
// (Navigation/Resource Timing, LCP, INP, CLS, navigator.connection), para
// poder comprobar cada optimización y escoger la siguiente con datos.
// Reporte: scripts/perf-real.mjs.
//
// Reglas de forma (las mismas de src/lib/telemetry.ts, y por qué):
//  - CERO peticiones propias: todo sale como kind `perf` en el lote que la
//    telemetría ya manda.
//  - Resúmenes, no eventos: la lista poletea cada 5 s; un renglón por petición
//    ahogaría la tabla. Por ventana (la de la carga fría a los 60 s, luego cada
//    10 min con la pestaña visible, y al salir) va un renglón por endpoint
//    para las descargas completas y otro para los 304.
//  - Nunca rompe nada: todo en try/catch; un navegador sin la API solo deja
//    de reportar esa parte.
//  - Suplantación ("ver como"): no se graba — registrar() de telemetry.ts ya
//    lo tira y el worker también. La red medida sería la del admin, no la de
//    la persona suplantada.
import { useEffect, useRef } from 'react';
import { alSalir, uxPerf } from './telemetry';
import {
  acumularCls, calcularInp, clasificarRecurso, nuevoCls, resumirApi, resumirAssets,
  type ClaseAsset, type RecursoMedido,
} from './perfResumen';

/** La primera ventana cubre la carga fría. 60 s y no menos: en una conexión
 * lenta la lista tarda decenas de segundos, y una entrada de Resource Timing
 * solo existe cuando terminó de bajar — con una ventana corta la carga fría
 * se partiría en dos. */
const VENTANA_FRIA_MS = 60_000;
const VENTANA_MS = 10 * 60_000;
/** Tope de entradas en memoria por ventana (5 s de polling × 3 endpoints ×
 * 10 min ≈ 360): si algo se desboca, se deja de acumular, no crece sin fin. */
const MAX_PENDIENTES = 3000;

let instalado = false;
let fria = true;
let pendientesApi: Array<{ target: string; board?: string; r: RecursoMedido }> = [];
let pendientesAssets: Array<{ clase: ClaseAsset; r: RecursoMedido }> = [];
let lcp = 0;
let fcp = 0;
let cls = nuevoCls();
const interacciones = new Map<number, number>();
let vitalsEnviados = '';
/** ¿La pestaña estuvo oculta en algún momento? Un "tiempo hasta ver datos"
 * medido con la pestaña en segundo plano no dice nada de la red (el navegador
 * frena timers y pintado). performance.now() de la última vez que se ocultó. */
let ultimaOculta = -1;
let listaMedida = false;
let primerDrawer = true;

// Resource Timing no dice el MÉTODO de la petición, y `GET /items/:id` y
// `PATCH /items/:id` comparten URL. apiFetch anota aquí las que no son GET
// (perfNotarMetodo) y la entrada de Resource Timing se empareja por URL.
const metodos = new Map<string, string>();

/** Llamado desde apiFetch para cada petición que no es GET. */
export function perfNotarMetodo(url: string, metodo: string): void {
  try {
    const m = metodo.toUpperCase();
    if (m === 'GET' || m === 'HEAD') return;
    const abs = new URL(url, location.href).href;
    metodos.set(abs, m);
    if (metodos.size > 100) metodos.delete(metodos.keys().next().value as string);
  } catch { /* nunca estorba a la petición real */ }
}

function copiar(e: PerformanceResourceTiming): RecursoMedido {
  return {
    name: e.name,
    startTime: e.startTime,
    duration: e.duration,
    responseStart: e.responseStart,
    transferSize: e.transferSize ?? 0,
    encodedBodySize: e.encodedBodySize ?? 0,
    decodedBodySize: e.decodedBodySize ?? 0,
    responseStatus: (e as PerformanceResourceTiming & { responseStatus?: number }).responseStatus,
  };
}

function alRecurso(e: PerformanceResourceTiming): void {
  if (pendientesApi.length + pendientesAssets.length >= MAX_PENDIENTES) return;
  const metodo = metodos.get(e.name);
  if (metodo) metodos.delete(e.name);
  const c = clasificarRecurso(e.name, location.origin, metodo ?? 'GET');
  if (!c) return;
  if (c.tipo === 'api') pendientesApi.push({ target: c.target, board: c.board, r: copiar(e) });
  else pendientesAssets.push({ clase: c.clase, r: copiar(e) });
}

function observar(type: string, fn: (list: PerformanceObserverEntryList) => void, extra: Record<string, unknown> = {}): void {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    // `buffered`: trae lo que ya pasó antes de instalarse (el bundle arranca
    // después del HTML, de las fuentes y de la precarga de index.html).
    new PerformanceObserver(fn).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  } catch { /* navegador sin esa API */ }
}

function conexion(): { ect?: string; down?: number; rtt?: number } {
  try {
    const c = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection;
    if (!c) return {};
    return {
      ...(c.effectiveType ? { ect: c.effectiveType } : {}),
      ...(typeof c.downlink === 'number' ? { down: c.downlink } : {}),
      ...(typeof c.rtt === 'number' ? { rtt: c.rtt } : {}),
    };
  } catch { return {}; }
}

/** Una vez por carga de página: tiempos del documento + la conexión que el
 * navegador estima (Chrome). `down` en Mbps y `rtt` en ms, redondeados por
 * el propio navegador (no identifican a nadie). Son exactamente 8 llaves, el
 * tope de sanitizeMeta: una novena se perdería en silencio. */
function enviarCarga(): void {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return;
    const load = Math.round(nav.loadEventEnd || performance.now());
    uxPerf('perf:carga', {
      latencyMs: load,
      meta: {
        ttfb: Math.round(nav.responseStart),
        dcl: Math.round(nav.domContentLoadedEventEnd),
        load,
        tipo: nav.type,
        oculta: ultimaOculta >= 0,
        ...conexion(),
      },
    });
  } catch { /* nada */ }
}

function enviarVentana(): void {
  try {
    const api = pendientesApi;
    const assets = pendientesAssets;
    pendientesApi = [];
    pendientesAssets = [];
    const esFria = fria;
    fria = false;
    for (const r of resumirApi(api, esFria)) {
      uxPerf(r.target, { latencyMs: r.p50, boardSlug: r.board, meta: r.meta });
    }
    const a = resumirAssets(assets, esFria);
    if (a) uxPerf('perf:assets', { meta: { ...a } });

    // Vitals: solo si cambiaron desde el último envío. El reporte toma el
    // máximo por sesión (LCP, INP y CLS solo crecen).
    const inp = calcularInp([...interacciones.values()]);
    const vitals = {
      lcp: Math.round(lcp), fcp: Math.round(fcp), inp,
      cls: Math.round(cls.valor * 1000) / 1000, inter: interacciones.size,
    };
    const firma = JSON.stringify(vitals);
    if ((vitals.lcp || vitals.inp || vitals.cls) && firma !== vitalsEnviados) {
      vitalsEnviados = firma;
      uxPerf('perf:vitals', { latencyMs: vitals.lcp || undefined, meta: vitals });
    }
  } catch { /* nada */ }
}

/** Arranca la medición. Idempotente; se llama una vez desde main.tsx. */
export function instalarPerfReal(): void {
  if (instalado || typeof window === 'undefined' || typeof performance === 'undefined') return;
  instalado = true;
  try {
    if (document.visibilityState === 'hidden') ultimaOculta = 0;
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') ultimaOculta = performance.now();
    });

    observar('resource', (l) => { for (const e of l.getEntries()) alRecurso(e as PerformanceResourceTiming); });
    observar('largest-contentful-paint', (l) => {
      const es = l.getEntries();
      const ult = es[es.length - 1];
      if (ult) lcp = ult.startTime;
    });
    observar('paint', (l) => {
      for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') fcp = e.startTime;
    });
    observar('layout-shift', (l) => {
      for (const e of l.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!e.hadRecentInput) cls = acumularCls(cls, e.startTime, e.value);
      }
    });
    // INP: la duración de cada interacción es la del peor evento que la
    // compone (keydown+keyup, pointerdown+click…). Umbral 40 ms: lo más
    // rápido no cambia el resultado y así hay menos entradas.
    observar('event', (l) => {
      for (const e of l.getEntries() as Array<PerformanceEntry & { interactionId?: number }>) {
        const id = e.interactionId;
        if (!id) continue;
        if (interacciones.size >= 2000 && !interacciones.has(id)) continue;
        interacciones.set(id, Math.max(interacciones.get(id) ?? 0, e.duration));
      }
    }, { durationThreshold: 40 });

    const alCargar = () => setTimeout(enviarCarga, 0);
    if (document.readyState === 'complete') alCargar(); else addEventListener('load', alCargar, { once: true });

    setTimeout(() => {
      enviarVentana();
      setInterval(() => { if (document.visibilityState === 'visible') enviarVentana(); }, VENTANA_MS);
    }, Math.max(0, VENTANA_FRIA_MS - performance.now()));
    alSalir(enviarVentana);
  } catch { /* la medición jamás debe tumbar el portal */ }
}

/** Primera lista con datos en pantalla, en ms desde que arrancó la
 * navegación (incluye HTML, bundle, precarga y la respuesta). Solo la
 * primera de cada carga de página, y solo si la pestaña no se ocultó. */
export function perfListaLista(board: string): void {
  try {
    if (listaMedida) return;
    listaMedida = true;
    if (ultimaOculta >= 0) return;
    uxPerf('perf:datos:lista', { latencyMs: Math.round(performance.now()), boardSlug: board });
  } catch { /* nada */ }
}

/** Tiempo de abrir un drawer a tener su detalle en pantalla. `listo` = el
 * item pintado ya es el del `id` pedido (el drawer no se remonta al navegar
 * entre items; mientras llega, `item` es todavía el anterior). `enCache` se
 * evalúa al abrir: con el detalle en caché se pinta al instante y conviene
 * separarlo de las aperturas que sí esperan a la red. */
export function usePerfDrawer(board: string, id: string, listo: boolean, enCache: boolean): void {
  const abierto = useRef<{ id: string; t0: number; cache: boolean } | null>(null);
  useEffect(() => {
    abierto.current = { id, t0: performance.now(), cache: enCache };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    const a = abierto.current;
    if (!listo || !a || a.id !== id) return;
    abierto.current = null;
    try {
      const primera = primerDrawer;
      primerDrawer = false;
      if (ultimaOculta >= a.t0) return;
      const ahora = performance.now();
      uxPerf('perf:datos:drawer', {
        latencyMs: Math.round(ahora - a.t0),
        boardSlug: board,
        // `nav`: ms desde la navegación — en un enlace directo al drawer
        // (carga fría) es el tiempo total que la persona esperó.
        meta: { cache: a.cache, primera, nav: Math.round(ahora) },
      });
    } catch { /* nada */ }
  }, [id, listo, board]);
}
