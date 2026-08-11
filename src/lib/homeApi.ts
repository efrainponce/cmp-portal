// Pantalla "Inicio" — ETag polling clonado de useNotifications (src/lib/notificationsApi.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HomeResponse } from '../../shared/dto';
import { AccessError, apiFetch } from './apiClient';

export type { HomeResponse, HomePendienteDTO, HomeSectionDTO } from '../../shared/dto';

export async function enviarSeguimiento(itemId: string, mensaje: string): Promise<void> {
  const res = await apiFetch(`/oportunidades/${itemId}/seguimiento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensaje }),
  });
  if (!res.ok) throw new Error('seguimiento failed: ' + res.status);
}

export interface UseHomeResult {
  home: HomeResponse | null;
  refetch: () => void;
}

/** Polls GET /home cada 30s (menos urgente que notificaciones) usando
 * If-None-Match; pausa en pestaña oculta, recarga al volver visible. */
export function useHome(): UseHomeResult {
  const [home, setHome] = useState<HomeResponse | null>(null);
  const etagRef = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (document.hidden) return;
    try {
      const headers: Record<string, string> = {};
      if (etagRef.current) headers['If-None-Match'] = etagRef.current;
      const res = await apiFetch('/home', { headers });
      if (res.status === 304) return;
      if (!res.ok) throw new Error('home failed: ' + res.status);
      const etag = res.headers.get('ETag');
      if (etag) etagRef.current = etag;
      const json: HomeResponse = await res.json();
      setHome(json);
    } catch (e) {
      if (e instanceof AccessError) return; // sin sesión: no truena la UI
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { home, refetch: load };
}
