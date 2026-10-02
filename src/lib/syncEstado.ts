// Estado de sincronización que pinta la burbuja (SyncBurbuja, 2026-10-02).
// Efraín: "a veces hacen algo y piensan que simplemente está fallando y hacen
// refresh súper seguido". Una escritura lenta (generar cotización, mandar a
// costeo: varios segundos contra Monday) no daba ninguna señal fuera del botón,
// y un F5 a media escritura la corta. apiFetch avisa aquí de TODA escritura
// hecha por la persona (no las de fondo: telemetría, "visto", campana) y de
// cualquier respuesta/caída de red; la burbuja solo lee.

export interface SyncSnapshot {
  /** Escrituras en vuelo. */
  activas: number;
  /** Cuándo arrancó la escritura en vuelo más vieja (ms epoch), o null. */
  desde: number | null;
  /** Resultado de la última escritura terminada. */
  ultimo: { ok: boolean; at: number } | null;
  /** La última petición (lectura o escritura) no llegó al servidor. */
  sinRed: boolean;
}

/** Escrituras que la persona no hizo a propósito: no deben encender la burbuja. */
const DE_FONDO = [/^\/telemetry\//, /\/updates\/seen$/, /^\/notifications\//];
export const esEscrituraDeFondo = (path: string) => DE_FONDO.some((r) => r.test(path.split('?')[0]));

let estado: SyncSnapshot = { activas: 0, desde: null, ultimo: null, sinRed: false };
const inicios = new Map<number, number>();
let nextId = 1;
const listeners = new Set<(s: SyncSnapshot) => void>();

function set(next: Partial<SyncSnapshot>) {
  estado = { ...estado, ...next };
  for (const l of listeners) l(estado);
}

export const syncSnapshot = () => estado;
export function suscribirSync(fn: (s: SyncSnapshot) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Empieza una escritura; la función que regresa la cierra (una sola vez). */
export function inicioEscritura(ahora = Date.now()): (ok: boolean) => void {
  const id = nextId++;
  inicios.set(id, ahora);
  set({ activas: inicios.size, desde: Math.min(...inicios.values()) });
  return (ok: boolean) => {
    if (!inicios.delete(id)) return;
    set({
      activas: inicios.size,
      desde: inicios.size ? Math.min(...inicios.values()) : null,
      ultimo: { ok, at: Date.now() },
    });
  };
}

export function marcarRed(hayRed: boolean) {
  if (estado.sinRed === !hayRed) return;
  set({ sinRed: !hayRed });
}

export type Fase = 'oculta' | 'guardando' | 'lento' | 'guardado' | 'fallo' | 'sinRed';

/** A partir de cuántos ms "Guardando…" pasa a "no recargues". */
export const LENTO_MS = 4000;
const GUARDADO_MS = 2500;
const FALLO_MS = 6000;

/** Qué enseñar. Puro, para poder anclarlo en tests. */
export function faseDe(s: SyncSnapshot, ahora: number): Fase {
  if (s.sinRed) return 'sinRed';
  if (s.activas > 0) return s.desde != null && ahora - s.desde >= LENTO_MS ? 'lento' : 'guardando';
  if (s.ultimo) {
    const hace = ahora - s.ultimo.at;
    if (!s.ultimo.ok && hace < FALLO_MS) return 'fallo';
    if (s.ultimo.ok && hace < GUARDADO_MS) return 'guardado';
  }
  return 'oculta';
}
