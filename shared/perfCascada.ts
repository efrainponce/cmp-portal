// shared/perfCascada.ts — la CASCADA (waterfall) de una carga de página real,
// recurso por recurso (2026-10-08). Los resúmenes de `ux_event` (perfReal.ts)
// dicen cuánto tardó cada endpoint y cuántos KB de JS bajaron, pero no en qué
// ORDEN ni qué esperó a qué: en Mérida, con internet muy lento, eso es lo que
// decide qué optimizar. Va en TODAS las cargas (no muestreada): son ~decenas al
// día y en cada una importa el caso lento, que una muestra se saltaría.
//
// Vive en shared/ por la misma razón que shared/telemetry.ts: el navegador
// GENERA y el worker VALIDA con exactamente las mismas reglas. Guardarraíl: solo
// rutas con los identificadores colapsados (`/api/boards/oportunidades/items/:id`,
// sin query), solo el host de otros orígenes, números y slugs. Idea y forma de
// tratto-design-system (src/ds/features/uso/perf.ts), con más detalle por
// recurso (espera hasta el primer byte, bytes del cuerpo) y los hitos de la carga.

/** Tope de recursos por cascada. La carga fría del portal baja ~35 archivos y
 * la lista sondea cada 5 s: 300 cubren una carga lentísima completa. */
export const CASCADA_MAX_RECURSOS = 300;
/** Hasta dónde se sigue la carga: lo que EMPEZÓ antes de esto (ms desde la
 * navegación). En Mérida la primera lista ha tardado > 60 s. */
export const CASCADA_MAX_MS = 180_000;
/** Cuerpo máximo aceptado (JSON). sendBeacon corta en 64 KB por pestaña. */
export const CASCADA_MAX_BYTES = 48_000;

/** Un recurso. Todos los tiempos en ms desde el inicio de la navegación.
 *  n nombre normalizado · i initiatorType · s inicio · w espera hasta el
 *  primer byte (DNS+conexión+servidor) · d duración total (hasta el último
 *  byte) · b bytes por la red (0 = caché) · e cuerpo comprimido (0 con b>0 =
 *  304) · m método si no es GET. */
export interface RecursoCascada { n: string; i: string; s: number; w: number; d: number; b: number; e: number; m?: string }

/** Los hitos de la carga, para dibujar sobre la cascada dónde vio algo la
 * persona. `lista` = primera lista con datos, solo si aterrizó en ella. */
export interface HitosCarga {
  ttfb?: number; fcp?: number; lcp?: number; dcl?: number; load?: number; lista?: number;
}

export interface CascadaCarga {
  /** Primer segmento de la ruta con la que cargó ('inicio' si la raíz). */
  pantalla: string;
  nav?: string;
  /** La pestaña se ocultó durante la carga (los tiempos no son de red). */
  oculta: boolean;
  ect?: string; down?: number; rtt?: number;
  hitos: HitosCarga;
  recursos: RecursoCascada[];
}

const SEG_API_RE = /^[a-z][a-z_-]{0,31}$/;
const SEG_ARCHIVO_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const HOST_RE = /^[a-z0-9.-]{1,80}(:\d{1,5})?$/;
const SLUG_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const ECT = ['slow-2g', '2g', '3g', '4g'];
const METODOS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;

/** Path sin query con los identificadores colapsados a `:id`. En /api solo
 * sobreviven palabras sin dígitos; en los assets, nombres de archivo con su
 * hash de build (sin corridas de 4+ dígitos ni arrobas). */
export function normalizarRuta(path: string): string {
  const limpio = path.split(/[?#]/)[0];
  const api = limpio.startsWith('/api/');
  return limpio.split('/').map((seg, i) => {
    if (i === 0 || seg === '') return seg;
    if (api) return SEG_API_RE.test(seg) ? seg : ':id';
    return SEG_ARCHIVO_RE.test(seg) && !/\d{4,}/.test(seg) ? seg : ':id';
  }).join('/').slice(0, 120) || '/';
}

/** URL de Resource Timing → lo que viaja: del mismo origen su ruta
 * normalizada, de otro SOLO el host (`//www.clarity.ms`). */
export function nombreRecurso(url: string, origen: string): string | null {
  try {
    const u = new URL(url, origen);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return null;
    if (u.origin !== new URL(origen).origin) return HOST_RE.test(u.host) ? `//${u.host}` : null;
    return normalizarRuta(u.pathname);
  } catch { return null; }
}

/** ¿[inicio, fin] se encima con alguno de los periodos? Para tirar lo que
 * corrió con la pestaña oculta / la laptop dormida, o la interacción que
 * abrió un confirm() (ese tiempo es la persona leyendo, no la página). */
export function encima(inicio: number, fin: number, periodos: readonly (readonly [number, number])[]): boolean {
  return periodos.some(([a, b]) => inicio <= b && fin >= a);
}

function entero(v: unknown, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : undefined;
}

function recurso(raw: unknown): RecursoCascada | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.n !== 'string') return null;
  const n = r.n.startsWith('//')
    ? (HOST_RE.test(r.n.slice(2)) ? r.n : null)
    : r.n.startsWith('/') ? normalizarRuta(r.n) : null;
  const s = entero(r.s, 600_000);
  const d = entero(r.d, 600_000);
  if (!n || s === undefined || d === undefined) return null;
  const m = (METODOS as readonly unknown[]).includes(r.m) ? r.m as string : undefined;
  return {
    n, i: typeof r.i === 'string' && SLUG_RE.test(r.i) ? r.i : 'other',
    s, w: Math.min(entero(r.w, 600_000) ?? 0, d), d,
    b: entero(r.b, 1e9) ?? 0, e: entero(r.e, 1e9) ?? 0,
    ...(m ? { m } : {}),
  };
}

/** Valida una cascada cruda del cliente. null = se descarta en silencio
 * (telemetría: nunca tumba nada). */
export function validarCascada(raw: unknown): CascadaCarga | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (!Array.isArray(c.recursos)) return null;
  const recursos = c.recursos.slice(0, CASCADA_MAX_RECURSOS).map(recurso).filter((r): r is RecursoCascada => r !== null);
  if (recursos.length === 0) return null;
  const h = (c.hitos && typeof c.hitos === 'object' ? c.hitos : {}) as Record<string, unknown>;
  const hitos: HitosCarga = {};
  for (const k of ['ttfb', 'fcp', 'lcp', 'dcl', 'load', 'lista'] as const) {
    const v = entero(h[k], 600_000);
    if (v !== undefined && v > 0) hitos[k] = v;
  }
  return {
    pantalla: typeof c.pantalla === 'string' && SLUG_RE.test(c.pantalla) ? c.pantalla : 'otra',
    ...(typeof c.nav === 'string' && SLUG_RE.test(c.nav) ? { nav: c.nav } : {}),
    oculta: c.oculta === true,
    ...(typeof c.ect === 'string' && ECT.includes(c.ect) ? { ect: c.ect } : {}),
    ...(typeof c.down === 'number' && Number.isFinite(c.down) && c.down >= 0 ? { down: Math.min(c.down, 10_000) } : {}),
    ...(entero(c.rtt, 60_000) !== undefined ? { rtt: entero(c.rtt, 60_000) } : {}),
    hitos,
    recursos,
  };
}
