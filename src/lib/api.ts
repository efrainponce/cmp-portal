// ETag-aware polling hooks built on top of ./apiClient. Fall back to mock
// data (Oportunidades only) when /api is unreachable so the UI still demos
// with the worker stopped.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListResponse } from '../../shared/dto';
import { mockList } from './mockFallback';
import {
  AccessError, apiFetch, getBoards, mockBoardMeta, type BoardMeta, type BoardSlug,
} from './apiClient';

export * from './apiClient';

export type PollStatus = 'loading' | 'ready' | 'denied' | 'offline';

/** Query string de la lista de items. Existe como función aparte (y con test)
 * porque la precarga de index.html tiene que armar EXACTAMENTE la misma URL
 * para que coincidan.
 *
 * Ojo con las comas: `URLSearchParams` las escapa a `%2C`, y con eso la URL de
 * la app dejaba de coincidir con la precargada — la lista se bajaba DOS veces
 * y la optimización salía contraproducente (medido). Los ids de columna de
 * Monday son [a-z0-9_], así que van crudos sin ambigüedad. */
export function queryLista(q: string, colsParam: string | null, totales = false, fresh = false): string {
  const partes: string[] = [];
  if (q) partes.push('q=' + encodeURIComponent(q));
  if (colsParam !== null) partes.push('cols=' + colsParam);
  if (totales) partes.push('totales=1');
  // `fresh=1` va SOLO en el botón "Actualizar", nunca en el poll de 5 s: hace
  // que el worker espere un latido del delta sync (una lectura a Monday) antes
  // de contestar. La precarga de index.html no lo manda, así que tampoco entra
  // en la URL que tiene que coincidir con la precargada.
  if (fresh) partes.push('fresh=1');
  return partes.length ? '?' + partes.join('&') : '';
}

/** Proyección para los selectores de catálogo (`usePoll(slug, q, SOLO_NOMBRE)`):
 * NINGUNA columna, solo los campos propios del item (`id`, `name`).
 *
 * Los pickers de Productos / Instituciones / Contactos / Proveedores pintan
 * únicamente `item.name`, pero arrancan con búsqueda vacía y pedían el board
 * ENTERO — medido: Productos son 1.86 MB (260 KB gz) por 1247 items, y encima
 * se re-pedía cada 5 s mientras el modal estuviera abierto. Sin columnas baja
 * a 42 KB. */
export const SOLO_NOMBRE: readonly string[] = [];

export interface PollResult {
  status: PollStatus;
  data: ListResponse | null;
  offlineMock: boolean;
  refetch: () => void;
  /** Botón "Actualizar": pide la lista con `?fresh=1`, o sea obliga al worker a
   * leer Monday (latido del delta sync) antes de contestar, en vez de servir el
   * espejo D1 como hace el poll normal. */
  refrescar: () => Promise<void>;
  refrescando: boolean;
}

/** Fetches the item list for `slug`, then re-polls every 5s using If-None-Match
 * (a 304 leaves state untouched). Falls back to mock data for `oportunidades`
 * when the request fails outright (worker not running).
 *
 * `cols` = las columnas que la vista realmente pinta. El worker manda SOLO esas
 * (ver ?cols= en la ruta GET /items) — Oportunidades trae ~34 por item y la
 * lista usa 8, lo que hacía que cada refresco bajara 2.15 MB. Omitirlo trae
 * todas las columnas legibles, que es lo que necesitan las vistas genéricas.
 * Nunca amplía permisos: el server intersecta contra shared/visibility.ts. */
export function usePoll(slug: BoardSlug, q = '', cols?: readonly string[], totales = false): PollResult {
  const [status, setStatus] = useState<PollStatus>('loading');
  const [data, setData] = useState<ListResponse | null>(null);
  const [offlineMock, setOfflineMock] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const etagRef = useRef<string | undefined>(undefined);
  // true en cuanto hay algo que pintar — al cambiar `q` NO se regresa a
  // "loading" ni se dispara el request de inmediato: la lista actual sigue
  // visible (el filtro client-side ya reacciona por tecla) y el server search
  // llega con un debounce corto.
  const hasDataRef = useRef(false);

  // Se serializa para poder usarlo como dep estable: un array literal en el
  // call site cambia de identidad en cada render y reiniciaría el polling.
  // null = sin proyección (todas las columnas); '' = ninguna columna.
  const colsParam = cols ? cols.join(',') : null;

  const load = useCallback(async (fresh = false) => {
    // Pestaña oculta: no gastes requests — al volver, el listener de
    // visibilitychange de abajo recarga de inmediato. Un "Actualizar" explícito
    // sí pasa: lo pidió alguien que está mirando.
    if (document.hidden && !fresh) return;
    try {
      const params = queryLista(q, colsParam, totales, fresh);
      const headers: Record<string, string> = {};
      if (etagRef.current) headers['If-None-Match'] = etagRef.current;
      const res = await apiFetch(`/boards/${slug}/items${params}`, { headers });
      if (res.status === 304) { setStatus('ready'); return; }
      if (!res.ok) throw new Error('list failed: ' + res.status);
      const json: ListResponse = await res.json();
      etagRef.current = json.etag;
      hasDataRef.current = true;
      setData(json);
      setOfflineMock(false);
      setStatus('ready');
    } catch (e) {
      if (e instanceof AccessError) { setStatus('denied'); return; }
      // Los mocks son SOLO para desarrollo (ver mockFallback.ts: existen para que el
      // board demuestre con el worker apagado). En producción NO deben usarse: si la
      // API falla, mostrar oportunidades inventadas sin ningún aviso es peor que
      // mostrar el estado de error — y `offlineMock` no se pinta en ninguna parte de
      // la UI, así que nadie se enteraba. Con `import.meta.env.DEV` en false, el
      // bundler además saca del build los ~15 KB de datos de demo.
      const fallback = import.meta.env.DEV ? mockList(slug, q) : null;
      // (el mock no proyecta columnas: es solo el modo offline de demo)
      if (fallback) {
        hasDataRef.current = true;
        setData(fallback);
        setOfflineMock(true);
        setStatus('ready');
      } else {
        setStatus('offline');
      }
    }
  }, [slug, q, colsParam, totales]);

  useEffect(() => {
    etagRef.current = undefined;
    // Solo el primer load (sin nada que pintar) muestra "loading"; los cambios
    // de búsqueda mantienen la lista y llegan con debounce de 300 ms.
    if (!hasDataRef.current) setStatus('loading');
    const debounce = window.setTimeout(() => { void load(); }, hasDataRef.current ? 300 : 0);
    const timer = window.setInterval(() => { void load(); }, 5000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const refrescar = useCallback(async () => {
    setRefrescando(true);
    try { await load(true); } finally { setRefrescando(false); }
  }, [load]);

  return { status, data, offlineMock, refetch: () => { void load(); }, refrescar, refrescando };
}

// /api/boards es metadata de columnas por rol — no cambia durante la sesión.
// Cachear la promesa a nivel módulo evita un fetch por cada componente que
// monta useBoards (cada lista + el drawer) y hace esos montajes instantáneos.
let boardsPromise: Promise<BoardMeta[]> | null = null;
function getBoardsCached(): Promise<BoardMeta[]> {
  if (!boardsPromise) {
    boardsPromise = getBoards().catch((e) => {
      boardsPromise = null; // no cachear fallas — el siguiente mount reintenta
      throw e;
    });
  }
  return boardsPromise;
}

/** GET /api/boards, falling back to mock column metadata (oportunidades+sub) offline. */
export function useBoards(): { status: PollStatus; boards: BoardMeta[] } {
  const [status, setStatus] = useState<PollStatus>('loading');
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  useEffect(() => {
    let cancelled = false;
    getBoardsCached()
      .then((b) => { if (!cancelled) { setBoards(b); setStatus('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AccessError) { setStatus('denied'); return; }
        if (!import.meta.env.DEV) { setStatus('offline'); return; }
        setBoards(mockBoardMeta());
        setStatus('ready');
      });
    return () => { cancelled = true; };
  }, []);
  return { status, boards };
}
