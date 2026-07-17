// Breakpoint único móvil/desktop para toda la UI. Los estilos del portal son
// inline (no clases), así que la variación responsive se decide en JS con este
// hook en vez de media queries por componente.
import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
}
