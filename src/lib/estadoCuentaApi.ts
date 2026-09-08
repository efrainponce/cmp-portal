// Cliente de /api/proyectos/:id/estado-cuenta* y /api/estado-cuenta/resumen
// (board "Estado de Cuenta", 2026-09-08). Reusa apiFetch por el manejo de
// 401/403 de Access y por el header de impersonación, igual que los demás
// clientes de src/lib. El contrato vive en shared/dto.ts.
import { apiFetch } from './apiClient';
import type {
  AddAbonoRequest, AddAbonoResponse, AddEstadoCuentaRequest, AddEstadoCuentaResponse,
  EstadoCuentaArchivoDTO, EstadoCuentaConceptoDTO, EstadoCuentaResumenResponse, ListEstadoCuentaResponse,
  UpdateAbonoRequest, UpdateAbonoResponse,
} from '../../shared/dto';
import type { ResumenEstadoCuenta } from '../../shared/estadoCuenta';

type Ok = { ok: boolean; error?: string };

const ec = (proyectoId: string) => `/proyectos/${proyectoId}/estado-cuenta`;
const abonoPath = (proyectoId: string, conceptoId: string, abonoId: string) => `${ec(proyectoId)}/${conceptoId}/abonos/${abonoId}`;

async function mutate<T extends Ok>(path: string, init: RequestInit, que: string): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => ({ ok: false, error: 'respuesta inválida' })) as T;
  if (!res.ok && !body.error) body.error = `No se pudo ${que} (${res.status}).`;
  return body;
}

const json = (data: unknown, method = 'POST'): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const DEL: RequestInit = { method: 'DELETE' };

export async function getEstadoCuenta(proyectoId: string): Promise<EstadoCuentaConceptoDTO[]> {
  const res = await apiFetch(ec(proyectoId));
  if (!res.ok) throw new Error('GET estado-cuenta failed: ' + res.status);
  const body: ListEstadoCuentaResponse = await res.json();
  return body.conceptos;
}

export const addEstadoCuenta = (proyectoId: string, input: AddEstadoCuentaRequest) =>
  mutate<AddEstadoCuentaResponse>(ec(proyectoId), json(input), 'agregar el concepto');
export const removeEstadoCuenta = (proyectoId: string, conceptoId: string) =>
  mutate<Ok>(`${ec(proyectoId)}/${conceptoId}`, DEL, 'quitar el concepto');
export const addAbono = (proyectoId: string, conceptoId: string, input: AddAbonoRequest) =>
  mutate<AddAbonoResponse>(`${ec(proyectoId)}/${conceptoId}/abonos`, json(input), 'registrar el cobro');
/** Sobre todo, marcar un cobro programado como ya recibido. */
export const updateAbono = (proyectoId: string, conceptoId: string, abonoId: string, input: UpdateAbonoRequest) =>
  mutate<UpdateAbonoResponse>(abonoPath(proyectoId, conceptoId, abonoId), json(input, 'PATCH'), 'actualizar el cobro');
export const removeAbono = (proyectoId: string, conceptoId: string, abonoId: string) =>
  mutate<Ok>(abonoPath(proyectoId, conceptoId, abonoId), DEL, 'quitar el cobro');

/** URL del archivo (factura del concepto o comprobante del abono) — se le
 * pasa tal cual a FilePreviewModal. */
export function archivoConceptoUrl(proyectoId: string, conceptoId: string): string {
  return `/api${ec(proyectoId)}/${conceptoId}/archivo`;
}
export function archivoAbonoUrl(proyectoId: string, conceptoId: string, abonoId: string): string {
  return `/api${abonoPath(proyectoId, conceptoId, abonoId)}/archivo`;
}

/** Sube los bytes crudos; el nombre viaja en la query (mismo patrón que las
 * imágenes del proyecto). */
async function subirArchivo(path: string, file: File): Promise<Ok & { archivo?: EstadoCuentaArchivoDTO }> {
  return mutate(`${path}?nombre=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }, 'subir el archivo');
}
export const subirFactura = (proyectoId: string, conceptoId: string, file: File) =>
  subirArchivo(`${ec(proyectoId)}/${conceptoId}/archivo`, file);
export const subirComprobante = (proyectoId: string, conceptoId: string, abonoId: string, file: File) =>
  subirArchivo(`${abonoPath(proyectoId, conceptoId, abonoId)}/archivo`, file);

/** Descargas del estado de cuenta. Van por apiFetch y no por un <a href>
 * para que viaje el header de impersonación igual que en el resto del portal. */
async function blob(path: string, error: string): Promise<Blob> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(error);
  return res.blob();
}
export const estadoCuentaPdf = (proyectoId: string) => blob(`${ec(proyectoId)}/export.pdf`, 'No se pudo generar el PDF del estado de cuenta.');
export const estadoCuentaXlsx = (proyectoId: string) => blob(`${ec(proyectoId)}/export.xlsx`, 'No se pudo generar el Excel del estado de cuenta.');
/** TODOS los proyectos visibles en un Excel (un renglón por proyecto + detalle). */
export const carteraXlsx = () => blob('/estado-cuenta/export.xlsx', 'No se pudo generar el Excel de los proyectos.');

/** Baja un Blob como archivo. Revocar de inmediato cancela la descarga en
 * Safari; 30 s le sobran. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** El Estado de cuenta de cada proyecto visible, ya resumido por el worker —
 * lo que la lista del board suma por grupo. Un fetch al montar, no un poll. */
export async function getEstadoCuentaResumen(): Promise<Record<string, ResumenEstadoCuenta>> {
  const res = await apiFetch('/estado-cuenta/resumen');
  if (!res.ok) return {};
  const body: EstadoCuentaResumenResponse = await res.json();
  return body.resumen;
}
