// Refresco en vivo del detalle abierto (drawer de Oportunidad / Proyecto).
// La lista poletea cada 5 s (usePoll), pero el drawer se cargaba UNA vez al
// abrir y se quedaba con ese snapshot hasta reabrir o picar "Actualizar" —
// medido por Astra en prod (2026-09-12): sync_log sin fallas ni backlog, o sea
// D1 ya tenía los cambios y la pantalla no. Como compras y ventas pasan el día
// DENTRO de una oportunidad, ahí es donde "Monday tarda en actualizarse".
// Cada tick relee el espejo D1 (GET con ETag: 304 sin cuerpo si nada cambió).
import { hasActiveWrites } from './readConsistency';

export const DETAIL_POLL_MS = 5_000;

/** Cuándo NO refrescar: pestaña oculta, escritura en vuelo, la persona está
 * tecleando en un campo, o hay un modal/menú abierto (un re-render debajo del
 * modal puede cerrarlo o perder lo capturado). Los modales del portal llevan
 * role="dialog" (components/core/Modal.tsx) y los menús role="menu". */
export function pauseLiveRefresh(): boolean {
  return document.hidden || hasActiveWrites()
    || !!document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')
    || !!document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]');
}

/** Una sola petición en vuelo a la vez; volver a la pestaña o enfocar la
 * ventana refresca de inmediato. Devuelve el `stop`. */
export function startLiveRefresh(load: () => Promise<unknown>, paused = pauseLiveRefresh): () => void {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || running || paused()) return;
    running = true;
    try { await load(); } catch { /* un tropiezo transitorio deja el detalle actual en pantalla */ }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, DETAIL_POLL_MS);
  const resume = () => { void tick(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('focus', resume);
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('focus', resume);
  };
}
