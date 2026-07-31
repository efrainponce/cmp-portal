// Shared GET /me cache — Sidebar needs the viewer's role to gate the
// Configuración entry; UserChip already fetches /me on its own, so this just
// keeps repeat callers (e.g. re-mounts) from re-requesting once cached.
import { useEffect, useState } from 'react';
import { getMe, type MeDTO } from './api';

let cached: MeDTO | null = null;
let inflight: Promise<MeDTO> | null = null;
// Cada useMe() montado se suscribe aquí para poder empujarle el /me fresco
// tras refreshMe() (ej. PhoneGateScreen guardando el teléfono) sin que cada
// consumidor tenga que refetchear por su cuenta.
const listeners = new Set<(me: MeDTO) => void>();

function loadMe(): Promise<MeDTO> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = getMe()
      .then((me) => { cached = me; return me; })
      .catch((e) => { inflight = null; throw e; });
  }
  return inflight;
}

export function invalidateMeCache() {
  cached = null;
  inflight = null;
}

/** Refetch forzado de /me que además notifica a todo useMe() montado — usar tras
 * un cambio que el propio usuario hace sobre sí mismo (ver PhoneGateScreen). */
export async function refreshMe(): Promise<MeDTO> {
  invalidateMeCache();
  const me = await loadMe();
  listeners.forEach((fn) => fn(me));
  return me;
}

export function useMe(): MeDTO | null {
  const [me, setMe] = useState<MeDTO | null>(cached);
  useEffect(() => {
    listeners.add(setMe);
    if (!cached) loadMe().then(setMe).catch(() => {});
    return () => { listeners.delete(setMe); };
  }, []);
  return me;
}
