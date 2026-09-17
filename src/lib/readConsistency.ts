// Consistencia de lecturas de fondo vs escrituras en vuelo (Astra, 2026-09-12;
// terminado 2026-09-16). El refresco en vivo de los drawers (liveRefresh.ts)
// relee el espejo D1 cada 5 s; una lectura que ARRANCÓ antes de que un PATCH
// aterrizara en el espejo trae el snapshot viejo y, aplicada después, "regresa"
// el cambio en pantalla (mismo bug que loadSeqRef en OpportunityDrawer, pero
// entre un GET de fondo y un write). `revision` sube al empezar y al terminar
// cada escritura; una lectura se aplica solo si la revisión no cambió mientras
// estuvo en vuelo y no hay escrituras pendientes. apiFetch llama beginWrite
// en todo método que no sea GET/HEAD.
let revision = 0;
let writes = 0;
export const readRevision = () => revision;
export const hasActiveWrites = () => writes > 0;
export const readIsCurrent = (at: number) => at === revision && writes === 0;
export function beginWrite(): () => void {
  revision++;
  writes++;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    writes--;
    revision++;
  };
}
