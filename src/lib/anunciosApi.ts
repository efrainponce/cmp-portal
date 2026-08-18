// Anuncios del portal — cliente + hook. ETag polling clonado de useNotifications
// (src/lib/notificationsApi.ts) pero a 60s: un comunicado no es urgente al
// segundo. Un solo poll alimenta la pantalla y el badge del sidebar.
import { useCallback, useEffect, useState } from 'react';
import type { AnuncioDTO, AnunciosResponse, CrearAnuncioRequest, CrearAnuncioResponse } from '../../shared/dto';
import { AccessError, apiFetch } from './apiClient';

export type { AnuncioDTO, AnuncioSeveridad, AnunciosResponse, CrearAnuncioRequest } from '../../shared/dto';

async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: string };
    return body.error || `${fallback}: ${res.status}`;
  } catch {
    return `${fallback}: ${res.status}`;
  }
}

export async function crearAnuncio(req: CrearAnuncioRequest): Promise<AnuncioDTO> {
  const res = await apiFetch('/anuncios', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await errorText(res, 'POST anuncio failed'));
  const json: CrearAnuncioResponse = await res.json();
  return json.anuncio;
}

export async function editarAnuncio(id: string, patch: Partial<CrearAnuncioRequest>): Promise<void> {
  const res = await apiFetch(`/anuncios/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorText(res, 'PATCH anuncio failed'));
}

export async function archivarAnuncio(id: string, archivado: boolean): Promise<void> {
  const res = await apiFetch(`/anuncios/${id}/archivar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archivado }),
  });
  if (!res.ok) throw new Error(await errorText(res, 'archivar anuncio failed'));
}

export async function borrarAnuncio(id: string): Promise<void> {
  const res = await apiFetch(`/anuncios/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errorText(res, 'DELETE anuncio failed'));
}

export async function marcarAnuncioVisto(id: string): Promise<void> {
  const res = await apiFetch(`/anuncios/${id}/visto`, { method: 'POST' });
  if (!res.ok) throw new Error('marcar visto failed: ' + res.status);
}

export interface UseAnunciosResult {
  anuncios: AnuncioDTO[];
  noLeidos: number;
  cargando: boolean;
  refetch: () => void;
  marcarVisto: (id: string) => Promise<void>;
}

// Store a nivel módulo (mismo patrón que useMe): la pantalla de Anuncios y el
// badge del sidebar están montados a la vez, y con un useState por hook el badge
// se quedaba pegado hasta el siguiente poll después de leer un anuncio. Así hay
// un solo poll para toda la app y un solo estado que ambos comparten.
let store: AnunciosResponse | null = null;
let etag: string | undefined;
const listeners = new Set<(s: AnunciosResponse | null) => void>();
let timer: number | undefined;

function setStore(next: AnunciosResponse | null) {
  store = next;
  listeners.forEach((fn) => fn(next));
}

async function load(): Promise<void> {
  if (document.hidden) return;
  try {
    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;
    const res = await apiFetch('/anuncios', { headers });
    if (res.status === 304) return;
    if (!res.ok) throw new Error('anuncios failed: ' + res.status);
    const nuevoEtag = res.headers.get('ETag');
    etag = nuevoEtag ?? undefined;
    setStore(await res.json() as AnunciosResponse);
  } catch (e) {
    if (e instanceof AccessError) return;   // sin sesión: no truena la UI
  }
}

function onVisible() { if (!document.hidden) load(); }

function subscribe(fn: (s: AnunciosResponse | null) => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    timer = window.setInterval(load, 60000);
    document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

/** Lista + contador de no leídos, a 60s (un comunicado no es urgente al segundo).
 * Todas las instancias montadas comparten el mismo poll y el mismo estado. */
export function useAnuncios(): UseAnunciosResult {
  const [data, setData] = useState<AnunciosResponse | null>(store);

  useEffect(() => {
    const unsub = subscribe(setData);
    load();
    return unsub;
  }, []);

  // Optimista: el badge baja al instante y el siguiente poll confirma (el ETag
  // ya entra `visto`, así que no se queda pegado en un 304).
  const marcarVisto = useCallback(async (id: string) => {
    const target = store?.anuncios.find((a) => a.id === id);
    if (store && target && !target.visto) {
      setStore({
        anuncios: store.anuncios.map((a) => (a.id === id ? { ...a, visto: true } : a)),
        noLeidos: Math.max(0, store.noLeidos - 1),
      });
    }
    etag = undefined;
    await marcarAnuncioVisto(id);
  }, []);

  return {
    anuncios: data?.anuncios ?? [],
    noLeidos: data?.noLeidos ?? 0,
    cargando: data === null,
    refetch: load,
    marcarVisto,
  };
}
