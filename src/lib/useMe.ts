// Shared GET /me cache — Sidebar needs the viewer's role to gate the
// Configuración entry; UserChip already fetches /me on its own, so this just
// keeps repeat callers (e.g. re-mounts) from re-requesting once cached.
import { useEffect, useState } from 'react';
import { getMe, type MeDTO } from './api';

let cached: MeDTO | null = null;
let inflight: Promise<MeDTO> | null = null;

function loadMe(): Promise<MeDTO> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = getMe()
      .then((me) => { cached = me; return me; })
      .catch((e) => { inflight = null; throw e; });
  }
  return inflight;
}

export function useMe(): MeDTO | null {
  const [me, setMe] = useState<MeDTO | null>(cached);
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    loadMe().then((m) => { if (!cancelled) setMe(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return me;
}
