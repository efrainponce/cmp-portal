// Carpeta de Google Drive de una Oportunidad o un Proyecto (tab Documentación,
// 2026-09-15) — worker/routes/drive.ts. Archivo aparte de apiClient.ts a
// propósito: son 3 llamadas y no tocan el resto del cliente.
import { apiFetch } from './apiClient';
import type { DriveCarpetaResponse, DriveSincronizarResponse } from '../../shared/dto';

export type DriveKind = 'oportunidad' | 'proyecto';
const SLUG: Record<DriveKind, string> = { oportunidad: 'oportunidades', proyecto: 'proyectos' };

async function leer<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? fallback);
  return body as T;
}

export async function getDriveCarpeta(kind: DriveKind, itemId: string): Promise<DriveCarpetaResponse> {
  const res = await apiFetch(`/${SLUG[kind]}/${itemId}/drive`);
  return leer(res, 'No se pudo leer la carpeta de Drive.');
}

export async function crearDriveCarpetaProyecto(proyectoId: string): Promise<{ ok: true; carpeta: { id: string; url: string; nombre: string } }> {
  const res = await apiFetch(`/proyectos/${proyectoId}/drive`, { method: 'POST' });
  return leer(res, 'No se pudo crear la carpeta de Drive.');
}

export async function sincronizarDriveCarpeta(kind: DriveKind, itemId: string): Promise<DriveSincronizarResponse> {
  const res = await apiFetch(`/${SLUG[kind]}/${itemId}/drive/sincronizar`, { method: 'POST' });
  return leer(res, 'No se pudieron sincronizar los documentos.');
}
