// Ruteo mínimo por History API — sin react-router. La app siempre corrió como
// un solo estado en memoria (activeBoard/openId); esto solo lo refleja en la
// URL como /boardKey/itemId para poder compartir links directos a una
// oportunidad. El worker sirve index.html para cualquier ruta (SPA fallback
// en wrangler.jsonc), así que navegar directo a /costeo/12345 ya funciona.
import { useCallback, useEffect, useState } from 'react';
import type { BoardKey } from '../app/Sidebar';

const VALID_BOARDS = new Set<BoardKey>([
  'oportunidades', 'costeo', 'validacion', 'doctallas', 'ordenescompra', 'logistica',
  'productos', 'instituciones', 'contactos', 'inventario', 'settings',
]);

interface Route {
  board: BoardKey;
  itemId: string | null;
}

function parsePath(pathname: string): Route {
  const [, boardSeg, itemSeg] = pathname.split('/');
  const board = VALID_BOARDS.has(boardSeg as BoardKey) ? (boardSeg as BoardKey) : 'oportunidades';
  return { board, itemId: itemSeg ? decodeURIComponent(itemSeg) : null };
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((board: BoardKey, itemId: string | null = null) => {
    const path = itemId ? `/${board}/${encodeURIComponent(itemId)}` : `/${board}`;
    if (path !== window.location.pathname) window.history.pushState(null, '', path);
    setRoute({ board, itemId });
  }, []);

  return { board: route.board, itemId: route.itemId, navigate };
}
