import { useEffect, useRef } from 'react';
import { pauseLiveRefresh, startLiveRefresh } from './liveRefresh';

/** Relee `load` cada DETAIL_POLL_MS mientras `key` no cambie (ver liveRefresh.ts).
 * `paused` extra del llamador (p.ej. mientras el drawer ya está verificando con
 * Monday). Las refs evitan reiniciar el intervalo en cada render. */
export function useLiveRefresh(key: string, load: () => Promise<unknown>, paused = false): void {
  const latest = useRef({ load, paused });
  latest.current = { load, paused };
  useEffect(() => startLiveRefresh(
    () => latest.current.load(),
    () => latest.current.paused || pauseLiveRefresh(),
  ), [key]);
}
