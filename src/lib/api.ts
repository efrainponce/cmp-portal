// ETag-aware polling hooks built on top of ./apiClient. Fall back to mock
// data (Oportunidades only) when /api is unreachable so the UI still demos
// with the worker stopped.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemDTO, ListResponse } from '../../shared/dto';
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
export function queryLista(q: string, colsParam: string | null, totales = false, fresh = false, since?: string, tv?: string): string {
  const partes: string[] = [];
  if (q) partes.push('q=' + encodeURIComponent(q));
  if (colsParam !== null) partes.push('cols=' + colsParam);
  if (totales) partes.push('totales=1');
  // `fresh=1` va SOLO en el botón "Actualizar", nunca en el poll de 5 s: hace
  // que el worker espere un latido del delta sync (una lectura a Monday) antes
  // de contestar. La precarga de index.html no lo manda, así que tampoco entra
  // en la URL que tiene que coincidir con la precargada.
  if (fresh) partes.push('fresh=1');
  // `since=<marca>` = respuesta incremental (ver `fusionarIncremental`). Solo
  // va en los re-polls: el primer request (el que la precarga de index.html
  // tiene que calcar) nunca lo lleva.
  if (since) partes.push('since=' + encodeURIComponent(since));
  // `tv=` = versión de los totales que ya tenemos (solo con `since`): el
  // server los omite o recorta según cambiaron o no.
  if (since && totales && tv) partes.push('tv=' + encodeURIComponent(tv));
  return partes.length ? '?' + partes.join('&') : '';
}

/** Marca de agua para el poll incremental: el `syncedAt` más reciente de lo
 * que el cliente ya tiene. El worker manda solo lo que se sincronizó desde
 * ahí (`>=`, ver worker/routes/boards.ts). */
export function marcaDeAgua(items: ItemDTO[]): string | undefined {
  let max: string | undefined;
  for (const it of items) if (it.syncedAt && (!max || it.syncedAt > max)) max = it.syncedAt;
  return max;
}

/**
 * Arma la lista completa a partir de una respuesta incremental y la lista
 * anterior. Puro y con test (api.test.ts). Devuelve null si el server nombra
 * un id que el cliente no tiene y tampoco vino en `items` (p.ej. cambió el
 * alcance del viewer): ahí toca pedir la lista completa.
 *
 * Lo importante es la IDENTIDAD: el renglón que no cambió es el MISMO objeto
 * que antes, así el `memo` de Row (StageBoardList) corta el re-render de raíz
 * y una máquina lenta ya no re-pinta 628 filas porque alguien tocó una. Los
 * totales igual: se conserva el objeto anterior cuando las cifras son
 * idénticas. `pendingWrite` se re-aplica desde `pendingIds` porque cambia sin
 * mover `syncedAt` (el echo del outbox no toca la fila).
 */
export function fusionarIncremental(prev: ListResponse, resp: ListResponse): ListResponse | null {
  const inc = resp.incremental;
  if (!inc) return resp;
  const previos = new Map(prev.items.map((it) => [it.id, it]));
  const nuevos = new Map(resp.items.map((it) => [it.id, it]));
  const pendientes = new Set(inc.pendingIds);
  const items: ItemDTO[] = [];
  for (const id of inc.ids) {
    const it = nuevos.get(id) ?? previos.get(id);
    if (!it) return null;
    const pend = pendientes.has(id);
    items.push(!!it.pendingWrite === pend ? it : { ...it, pendingWrite: pend });
  }
  // Totales: 'igual' → los de antes tal cual; 'parcial' → los de antes con
  // los que vinieron encima; 'completo' → los que vinieron. En todos los
  // casos, una oportunidad cuyas cifras no cambiaron conserva su objeto.
  let totales: ListResponse['totales'];
  if (inc.totales === 'igual') totales = prev.totales;
  else if (resp.totales) {
    const base = inc.totales === 'parcial' && prev.totales ? { ...prev.totales } : {};
    for (const [id, t] of Object.entries(resp.totales)) {
      const ant = prev.totales?.[id];
      base[id] = ant && mismosTotales(ant, t) ? ant : t;
    }
    totales = base;
  }
  const out: ListResponse = { board: resp.board, items, total: resp.total, etag: resp.etag };
  if (totales) out.totales = totales;
  if (inc.totales === 'igual') out.totalesVersion = prev.totalesVersion;
  else if (resp.totalesVersion) out.totalesVersion = resp.totalesVersion;
  return out;
}

function mismosTotales(a: object, b: object): boolean {
  const ra = a as Record<string, unknown>; const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra); const kb = Object.keys(rb);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (ra[k] !== rb[k]) return false;
  return true;
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

// Cadencia del poll. La lista de trabajo cada 5 s; los pickers de catálogo
// (los que piden SOLO_NOMBRE) cada 60 s: un proveedor o institución nuevos
// no llegan cada minuto, y un picker abierto —o el detalle de una línea con
// su picker de proveedor, uno por línea expandida— mandaba 12 req/min cada
// uno por nada (2026-09-02).
const LIST_POLL_MS = 5000;
const PICKER_POLL_MS = 60_000;

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
  // Lo último que se pintó + su marca de agua, para el poll incremental.
  const dataRef = useRef<ListResponse | null>(null);
  const sinceRef = useRef<string | undefined>(undefined);
  // true en cuanto hay algo que pintar — al cambiar `q` NO se regresa a
  // "loading" ni se dispara el request de inmediato: la lista actual sigue
  // visible (el filtro client-side ya reacciona por tecla) y el server search
  // llega con un debounce corto.
  const hasDataRef = useRef(false);

  // Se serializa para poder usarlo como dep estable: un array literal en el
  // call site cambia de identidad en cada render y reiniciaría el polling.
  // null = sin proyección (todas las columnas); '' = ninguna columna.
  const colsParam = cols ? cols.join(',') : null;
  // Booleano y no `cols` en las deps de abajo: un array literal en un call
  // site cambiaría de identidad en cada render y reiniciaría el polling.
  const esPicker = cols === SOLO_NOMBRE;

  const load = useCallback(async (fresh = false, completa = false) => {
    // Pestaña oculta: no gastes requests — al volver, el listener de
    // visibilitychange de abajo recarga de inmediato. Un "Actualizar" explícito
    // sí pasa: lo pidió alguien que está mirando.
    if (document.hidden && !fresh) return;
    try {
      // Incremental solo cuando ya hay lista con ETag: el primer request va
      // completo (y calca la URL de la precarga de index.html).
      const since = !completa && etagRef.current && dataRef.current ? sinceRef.current : undefined;
      const params = queryLista(q, colsParam, totales, fresh, since, since ? dataRef.current?.totalesVersion : undefined);
      const headers: Record<string, string> = {};
      if (etagRef.current) headers['If-None-Match'] = etagRef.current;
      const res = await apiFetch(`/boards/${slug}/items${params}`, { headers });
      if (res.status === 304) { setStatus('ready'); return; }
      if (!res.ok) throw new Error('list failed: ' + res.status);
      let json: ListResponse = await res.json();
      if (json.incremental) {
        const fusion = dataRef.current ? fusionarIncremental(dataRef.current, json) : null;
        // El server nombró algo que no tenemos: pide la lista completa.
        if (!fusion) { await load(fresh, true); return; }
        json = fusion;
      }
      etagRef.current = json.etag;
      sinceRef.current = marcaDeAgua(json.items);
      dataRef.current = json;
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
    dataRef.current = null;
    sinceRef.current = undefined;
    // Solo el primer load (sin nada que pintar) muestra "loading"; los cambios
    // de búsqueda mantienen la lista y llegan con debounce de 300 ms.
    if (!hasDataRef.current) setStatus('loading');
    const debounce = window.setTimeout(() => { void load(); }, hasDataRef.current ? 300 : 0);
    const timer = window.setInterval(() => { void load(); }, esPicker ? PICKER_POLL_MS : LIST_POLL_MS);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, esPicker]);

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
