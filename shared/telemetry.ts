// shared/telemetry.ts — contrato front↔worker de la capa de INTERACCIÓN (tabla
// `ux_event`). Vive en shared/ y no en src/ porque el servidor tiene que VALIDAR
// con exactamente las mismas reglas con que el cliente GENERA: si el vocabulario
// viviera solo del lado del cliente, la única barrera contra que un día se cuele
// el nombre de un cliente en `target` sería la buena memoria de quien edite.
//
// Qué mide y por qué existe (2026-08-17, para la renovación de Monday de feb-2027):
// `activity_log` ya espeja lo que Monday REGISTRÓ (qué cambió, quién, cuándo).
// Lo que el servidor no puede saber solo es lo que la persona INTENTÓ: si clicó
// y no pasó nada, cuánto esperó, si repitió el clic, cuánto tardó en guardar.
// Eso es lo único que va aquí.
//
// GUARDARRAÍL DURO: esto mide personas. Nunca guarda texto capturado por el
// usuario, nombres de cliente ni valores de campo — solo identificadores,
// slugs de control y tiempos. Las funciones de abajo (isValidTarget /
// sanitizeMeta / routeSlug) son la forma EJECUTABLE de esa regla, no una
// convención: un nombre de cliente no pasa los regex. El reporte por defecto
// es agregado (worker/lib/uxMetrics.ts); el desglose por persona es material
// de diagnóstico aparte.

import { BOARDS } from './boards';

/** Tipos de evento. `click`+`ack` van correlacionados por `corr` (ver UxEventInput). */
export type UxKind = 'click' | 'ack' | 'edit' | 'nav' | 'error';

export const UX_KINDS: readonly UxKind[] = ['click', 'ack', 'edit', 'nav', 'error'];

/** Tope de eventos por POST. El cliente trocea; la ruta rechaza lotes mayores. */
export const UX_MAX_BATCH = 200;

/** `dt` se clampa a 30 min: un beacon de `pagehide` puede llegar tarde, pero un
 * `dt` absurdo movería el evento a una fecha inventada. */
export const UX_MAX_DT_MS = 30 * 60 * 1000;

/** Retención del grueso de los eventos (click/ack/nav/error): 90 días. La poda
 * corre en el cron semanal que ya existe. */
export const UX_RETENTION_DAYS = 90;

/** Retención de los `edit`, MÁS LARGA a propósito. No es un capricho de
 * "guardemos más por si acaso": los `edit` son el rastro con que se atribuye
 * cada fila de `activity_log` a portal o a Monday (worker/lib/uxMetrics.ts), y
 * `activity_log` no se poda. Si los `edit` se borraran a los 90 días, las
 * ediciones viejas del portal empezarían a contarse como Monday SOLAS y en
 * silencio — un análisis hecho en feb-2027 sobre sep-2026 vería la herramienta
 * equivocada. Son de bajo volumen (uno por columna escrita, ~cientos al día
 * contra decenas de miles de eventos de latencia), así que 400 días no pesan. */
export const UX_EDIT_RETENTION_DAYS = 400;

/** Slug de control estable. Minúsculas, sin espacios, sin acentos: `drawer:mandar-costeo`.
 * Deliberadamente NO acepta mayúsculas, punto, arroba ni espacio — con eso, ni un
 * nombre de item ni un correo pueden pasar por aquí aunque alguien lo intente. */
export const UX_TARGET_RE = /^[a-z][a-z0-9:_-]{0,63}$/;

const UX_ID_RE = /^[a-z0-9][a-z0-9-]{7,39}$/;   // session_id / corr (uuid o similar)
const META_KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
const META_VALUE_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;
const MAX_META_KEYS = 8;

export interface UxEventInput {
  /** Milisegundos ANTES del flush en que ocurrió el evento (reloj monótono del
   * cliente, `performance.now()`). No se manda una fecha: el servidor ancla con
   * su propio reloj (`created_at = ahora − dt`), así el orden intra-sesión queda
   * exacto al milisegundo —que es lo que necesita el par clic→acuse— sin
   * depender del reloj del navegador ni poder falsificarse a una fecha ajena. */
  dt: number;
  kind: UxKind;
  target: string;
  /** Correlación clic↔acuse. Sin esto el emparejamiento sería "el clic más
   * cercano anterior", que se vuelve ambiguo JUSTO cuando hay dos clics
   * seguidos — el caso que la métrica de clic-sin-acuse existe para medir. */
  corr?: string;
  boardSlug?: string;
  itemId?: number;
  columnId?: string;
  /** Solo en `ack` y `error`: ms entre el clic/petición y la respuesta. */
  latencyMs?: number;
  meta?: Record<string, unknown>;
}

export interface UxBatch {
  sessionId: string;
  events: UxEventInput[];
}

export function isValidTarget(target: unknown): target is string {
  return typeof target === 'string' && UX_TARGET_RE.test(target);
}

export function isValidUxId(value: unknown): value is string {
  return typeof value === 'string' && UX_ID_RE.test(value);
}

export function isUxKind(value: unknown): value is UxKind {
  return typeof value === 'string' && (UX_KINDS as readonly string[]).includes(value);
}

/** Deja pasar SOLO números, booleanos y slugs cortos; descarta todo lo demás
 * (incluidos objetos y arreglos anidados). Devuelve el JSON a guardar, o null
 * si no quedó nada. Es la contención estructural del guardarraíl: aquí es donde
 * moriría un `{cliente: "Hospital General"}` metido para depurar. */
export function sanitizeMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const out: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_META_KEYS) break;
    if (!META_KEY_RE.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && META_VALUE_RE.test(value)) out[key] = value;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

// Segmento "literal" de una ruta: palabra en minúsculas, corta, sin dígitos.
// Todo lo demás (ids numéricos, uuids, folios, correos, tokens) se colapsa a
// `id` — la lista de rutas del portal es cerrada y toda cae en esta forma, así
// que el default seguro no pierde nada y evita que una ruta futura con un
// identificador en el path filtre el identificador al slug.
const PATH_LITERAL_RE = /^[a-z][a-z-]{0,23}$/;

/** URL de `apiFetch` (sin el prefijo /api) + método → slug estable de endpoint,
 * ej. `PATCH /boards/oportunidades/items/12345` → `api:patch:boards:slug:items:id`.
 * El board se colapsa a `slug` a propósito: viaja aparte en la columna
 * `board_slug`, y meterlo en el target multiplicaría los grupos de latencia
 * por 8 sin ganar nada. Query string y fragmento se tiran enteros. */
export function routeSlug(method: string, path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  const raw = clean.split('/').filter(Boolean);
  const parts = raw.map((seg, i) => {
    const lower = seg.toLowerCase();
    // El board se colapsa SOLO cuando va bajo /boards/ (la ruta genérica). En
    // las rutas de acción el mismo nombre es la ruta misma
    // (`/oportunidades/:id/enviar-costeo`) y colapsarlo ahí borraría de qué
    // acción hablamos — que es justo lo que el reporte de latencia necesita ver.
    if (i > 0 && raw[i - 1].toLowerCase() === 'boards'
        && Object.prototype.hasOwnProperty.call(BOARDS, lower)) return 'slug';
    return PATH_LITERAL_RE.test(lower) ? lower : 'id';
  });
  return ['api', method.toLowerCase(), ...parts].join(':').slice(0, 64);
}
