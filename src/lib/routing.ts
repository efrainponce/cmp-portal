// Ruteo mínimo por History API — sin react-router. La app siempre corrió como
// un solo estado en memoria (activeBoard/openId); esto solo lo refleja en la
// URL como /boardKey/itemId/tab para poder compartir links directos a una
// oportunidad (o proyecto) y hasta a la pestaña abierta. El worker sirve
// index.html para cualquier ruta (SPA fallback en wrangler.jsonc), así que
// navegar directo a /costeo/12345 o /ejecucion/12345/cotizacion ya funciona.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardKey } from '../app/Sidebar';

const VALID_BOARDS = new Set<BoardKey>([
  'home', 'anuncios',
  'oportunidades', 'oportunidades_web', 'costeo', 'validacion', 'doctallas', 'ordenescompra', 'ejecucion', 'logistica',
  'productos', 'instituciones', 'contactos', 'proveedores', 'inventario', 'settings', 'zona_efrain',
  'analisis', 'zona_efrain_proy',
]);

interface Route {
  board: BoardKey;
  itemId: string | null;
  /** Tercer segmento: la pestaña del drawer. Sin validar aquí — cada drawer
   * conoce su propio set y cae a su defaultTab si no lo reconoce. */
  tab: string | null;
}

export function parsePath(pathname: string): Route {
  const [, boardSeg, itemSeg, tabSeg] = pathname.split('/');
  const board = VALID_BOARDS.has(boardSeg as BoardKey) ? (boardSeg as BoardKey) : 'oportunidades';
  return {
    board,
    itemId: itemSeg ? decodeURIComponent(itemSeg) : null,
    tab: itemSeg && tabSeg ? decodeURIComponent(tabSeg) : null,
  };
}

/** /board/item/tab — el tab solo aparece si hay item. */
export function routePath(board: string, itemId: string | null, tab?: string | null): string {
  if (!itemId) return `/${board}`;
  const base = `/${board}/${encodeURIComponent(itemId)}`;
  return tab ? `${base}/${encodeURIComponent(tab)}` : base;
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname));
  // navigate/setTab leen la ruta vigente sin re-crearse en cada render.
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    const onPopState = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((board: BoardKey, itemId: string | null = null, tab: string | null = null) => {
    const path = routePath(board, itemId, tab);
    if (path !== window.location.pathname) window.history.pushState(null, '', path);
    setRoute({ board, itemId, tab });
  }, []);

  // Cambiar de pestaña dentro del drawer solo reescribe la URL (replaceState):
  // si empujara historial, el botón "Atrás" del navegador recorrería pestañas
  // en vez de cerrar el drawer, que es lo que hace hoy. Tampoco toca el estado
  // de React — el drawer ya es el dueño de su pestaña activa; esto solo deja
  // la URL copiable. El popstate vuelve a leer la ruta desde el pathname.
  const setTab = useCallback((tab: string | null) => {
    const { board, itemId } = routeRef.current;
    if (!itemId) return;
    const path = routePath(board, itemId, tab);
    if (path !== window.location.pathname) window.history.replaceState(null, '', path);
  }, []);

  return { board: route.board, itemId: route.itemId, tab: route.tab, navigate, setTab };
}
