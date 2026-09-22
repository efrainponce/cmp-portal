// Cliente de /api/muestras (Solicitudes de muestra, 2026-09-21). Reusa apiFetch
// por el manejo de Access y el header de impersonación. Contrato en
// shared/muestras.ts.
import { apiFetch } from './apiClient';
import type {
  CrearMuestraRequest, MuestraEstado, MuestraPadre, MuestraSolicitudDTO, MuestraSolicitudInput,
} from '../../shared/muestras';

type Ok = { ok: boolean; error?: string };

async function mutate<T extends Ok>(path: string, init: RequestInit, que: string): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => ({ ok: false, error: 'respuesta inválida' })) as T;
  if (!res.ok) {
    body.ok = false;
    if (!body.error || body.error === 'not found') body.error = res.status === 404 ? 'No tienes permiso de editar aquí.' : `No se pudo ${que} (${res.status}).`;
  }
  return body;
}

const json = (data: unknown, method = 'POST'): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export async function listMuestras(): Promise<MuestraSolicitudDTO[]> {
  const res = await apiFetch('/muestras');
  if (!res.ok) throw new Error(`No se pudieron cargar las solicitudes (${res.status}).`);
  return ((await res.json()) as { solicitudes: MuestraSolicitudDTO[] }).solicitudes;
}

export async function getMuestrasDe(padre: MuestraPadre, itemId: string): Promise<{ solicitudes: MuestraSolicitudDTO[]; editable: boolean }> {
  const res = await apiFetch(`/muestras/de/${padre}/${encodeURIComponent(itemId)}`);
  if (!res.ok) throw new Error(`No se pudieron cargar las muestras (${res.status}).`);
  return res.json();
}

export const crearMuestra = (input: CrearMuestraRequest) =>
  mutate<Ok & { id?: string }>('/muestras', json(input), 'crear la solicitud');
export const editarMuestra = (id: string, input: MuestraSolicitudInput) =>
  mutate<Ok>(`/muestras/${id}`, json(input, 'PUT'), 'guardar la solicitud');
export const cambiarEstadoMuestra = (id: string, estado: MuestraEstado) =>
  mutate<Ok>(`/muestras/${id}/estado`, json({ estado }, 'PUT'), 'cambiar el estado');
/** Borrador → enviada: publica la actualización en el item y avisa a Compras. */
export const enviarMuestra = (id: string) =>
  mutate<Ok>(`/muestras/${id}/enviar`, { method: 'POST' }, 'enviar la solicitud');
export const borrarMuestra = (id: string) =>
  mutate<Ok>(`/muestras/${id}`, { method: 'DELETE' }, 'borrar la solicitud');
