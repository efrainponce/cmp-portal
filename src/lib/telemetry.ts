// src/lib/telemetry.ts — capa de interacción del portal (tabla `ux_event`).
// Mide FRICCIÓN para poder comparar el portal contra la línea base de Monday
// en la renovación de feb-2027. El vocabulario (slugs válidos, saneador de
// meta, routeSlug) vive en shared/telemetry.ts porque el worker valida con las
// mismas reglas — ver la cabecera de ese archivo para el guardarraíl.
//
// Tres reglas de forma, y ninguna es negociable:
//  1. NUNCA bloquea la UI: todo es síncrono en memoria, el envío va aparte.
//  2. NUNCA rompe nada si falla: todo envuelto en try/catch, el error se traga.
//     Si la telemetría se cae, el portal ni se entera.
//  3. NUNCA manda un evento por su cuenta: acumula y sale en lote (~5s / 20
//     eventos / al cerrar la pestaña), por el presupuesto de subrequests del
//     Worker.
import { getImpersonateTarget } from './impersonation';
import { routeSlug, type UxEventInput, type UxKind } from '../../shared/telemetry';

const FLUSH_MS = 5000;
const FLUSH_AT = 20;
const MAX_BUFFER = 200;          // tope de shared/telemetry.ts (UX_MAX_BATCH)
const SESSION_KEY = 'cmp:uxSession';

// El polling de la lista corre cada 5s (src/lib/api.ts) — a ~4,300 requests
// por usuario-día, medir latencia en TODOS los GET metería ~86k filas diarias
// y ahogaría la tabla. Las mutaciones se miden completas (son las que necesita
// el clic-sin-acuse de todos modos) y los GET van muestreados: con 2% quedan
// ~85 muestras por usuario-día y clase de endpoint, de sobra para p50/p90.
const GET_SAMPLE_RATE = 0.02;

interface Pendiente extends Omit<UxEventInput, 'dt'> { at: number }

let buffer: Pendiente[] = [];
let timer: number | null = null;
let listenersReady = false;

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* sigue al fallback */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Una sesión por PESTAÑA (sessionStorage, no localStorage): el tiempo por
 * tarea y el par clic→acuse solo tienen sentido dentro de una pestaña viva.
 * No persiste entre sesiones ni identifica a nadie — el `user_id` real lo pone
 * el servidor desde el identity, nunca este archivo. */
function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) { id = uuid(); sessionStorage.setItem(SESSION_KEY, id); }
    return id;
  } catch {
    return uuid();
  }
}

/** Suplantación: mientras un admin ve el portal "como" otra persona, no se
 * graba nada. Sus clics se le atribuirían a esa persona y ensuciarían adopción
 * y tiempo por tarea — es diagnóstico, no trabajo real de nadie. El worker
 * vuelve a filtrarlo por su cuenta (worker/routes/telemetry.ts); esto solo
 * evita el viaje. */
function apagada(): boolean {
  try { return getImpersonateTarget() !== null; } catch { return true; }
}

function ahora(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

function enviar(): void {
  if (buffer.length === 0) return;
  const lote = buffer;
  buffer = [];
  try {
    const flushedAt = ahora();
    const payload = JSON.stringify({
      sessionId: sessionId(),
      // Se manda `dt` (ms ANTES del flush), no una fecha: el servidor ancla con
      // su propio reloj. Así el orden intra-sesión queda exacto al milisegundo
      // sin depender del reloj del navegador.
      events: lote.map(({ at, ...resto }): UxEventInput => ({ ...resto, dt: Math.max(0, Math.round(flushedAt - at)) })),
    });
    const url = '/api/telemetry';
    // sendBeacon sobrevive al cierre de la pestaña, que es justo cuando más
    // importa (el último clic antes de irse es el más frustrado).
    const beacon = navigator.sendBeacon?.(url, new Blob([payload], { type: 'application/json' }));
    if (!beacon) {
      void fetch(url, {
        method: 'POST', body: payload, keepalive: true,
        credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      }).catch(() => { /* telemetría caída — se pierde el lote, no pasa nada */ });
    }
  } catch { /* nunca debe verse desde el portal */ }
}

function programar(): void {
  if (!listenersReady) {
    listenersReady = true;
    try {
      // `visibilitychange` a oculto y `pagehide` son los dos momentos reales de
      // salida en móvil; `beforeunload` no dispara confiablemente en iOS.
      addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviar(); });
      addEventListener('pagehide', () => enviar());
    } catch { /* SSR/test sin DOM */ }
  }
  if (timer !== null) return;
  try {
    timer = window.setTimeout(() => { timer = null; enviar(); }, FLUSH_MS);
  } catch { timer = null; }
}

function registrar(kind: UxKind, target: string, extra: Partial<UxEventInput> = {}): void {
  try {
    if (apagada()) return;
    if (buffer.length >= MAX_BUFFER) return;   // tope duro: nunca crecer sin límite
    buffer.push({ at: ahora(), kind, target, ...extra });
    if (buffer.length >= FLUSH_AT) enviar(); else programar();
  } catch { /* jamás propagar a la UI */ }
}

// ── API pública ─────────────────────────────────────────────────────────────

/** Navegación: abrir el drawer, cambiar de tab. `drawer:open` + el primer
 * `edit` del mismo item y sesión son los dos extremos del "tiempo por tarea". */
export function uxNav(target: string, extra: Partial<UxEventInput> = {}): void {
  registrar('nav', target, extra);
}

/** Guardado confirmado por la persona. Es el canal de ATRIBUCIÓN: sin él, una
 * edición hecha en el portal es indistinguible de una hecha en Monday.com,
 * porque el portal escribe a Monday y la vuelta por activity_logs las deja
 * idénticas (ver worker/lib/uxMetrics.ts). */
export function uxEdit(extra: Partial<UxEventInput> & { itemId?: number; columnId?: string }): void {
  registrar('edit', 'edit:celda', extra);
}

/** Clic en un control de acción. Devuelve el `corr` con que se empareja su
 * acuse — el emparejamiento NO puede ser "el clic más cercano anterior": esa
 * heurística se vuelve ambigua justo cuando hay dos clics seguidos, que es el
 * caso que la métrica existe para medir. */
export function uxClick(target: string, extra: Partial<UxEventInput> = {}): string {
  const corr = uuid();
  registrar('click', target, { ...extra, corr });
  return corr;
}

export function uxAck(corr: string, target: string, latencyMs: number, extra: Partial<UxEventInput> = {}): void {
  registrar('ack', target, { ...extra, corr, latencyMs: Math.round(latencyMs) });
}

export function uxError(corr: string, target: string, latencyMs: number, extra: Partial<UxEventInput> = {}): void {
  registrar('error', target, { ...extra, corr, latencyMs: Math.round(latencyMs) });
}

// Acciones con una petición en vuelo, por target+item. Un segundo clic sobre
// algo que ya está trabajando ES la señal de fricción que se está midiendo
// (`meta.busy`), así que se registra aunque no dispare nada.
const enVuelo = new Set<string>();

/** Envuelve un botón de acción: registra el clic, corre `fn`, y registra el
 * acuse con la latencia real. Si ya hay una corrida en vuelo para el mismo
 * control, marca el clic como `busy` y NO vuelve a disparar. */
export async function uxAction<T>(
  target: string, extra: Partial<UxEventInput>, fn: () => Promise<T>,
): Promise<T | undefined> {
  const llave = `${target}:${extra.itemId ?? ''}`;
  const busy = enVuelo.has(llave);
  const corr = uxClick(target, { ...extra, meta: { ...(extra.meta ?? {}), busy } });
  if (busy) return undefined;

  enVuelo.add(llave);
  const t0 = ahora();
  try {
    const out = await fn();
    uxAck(corr, target, ahora() - t0, extra);
    return out;
  } catch (e) {
    uxError(corr, target, ahora() - t0, extra);
    throw e;
  } finally {
    enVuelo.delete(llave);
  }
}

/** Clic sobre un control OCUPADO o deshabilitado. Va aparte de `uxAction`
 * porque un `<button disabled>` no dispara `onClick`: sin esto el portal
 * reportaría 0% de clics repetidos —no por no tenerlos, sino por no poder
 * verlos— y la comparación contra el 58/42 de Monday no significaría nada. */
export function uxClickBusy(target: string, extra: Partial<UxEventInput> = {}): void {
  registrar('click', target, { ...extra, meta: { ...(extra.meta ?? {}), busy: true } });
}

/** Latencia por endpoint, desde el único punto de paso de todo el front
 * (apiFetch). Los GET van muestreados — ver GET_SAMPLE_RATE. */
export function uxApiLatency(method: string, path: string, latencyMs: number, ok: boolean): void {
  try {
    const esGet = method.toUpperCase() === 'GET';
    if (esGet && Math.random() >= GET_SAMPLE_RATE) return;
    registrar(ok ? 'ack' : 'error', routeSlug(method, path), {
      latencyMs: Math.round(latencyMs),
      meta: { sampled: esGet },
    });
  } catch { /* nunca debe romper una petición real */ }
}
