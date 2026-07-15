// Plain (non-hook) typed client for the worker API — see docs/dev-contracts.md.
import type { BoardSlug } from '../../shared/boards';
import type {
  ColMeta, ColVal, CreateResponse, EnviarCosteoResponse, IdentityDTO, ItemDTO, ItemDetailDTO,
  ListResponse, MeDTO, MondayUserDTO, UpdateDTO, VendedorDTO, WriteResponse,
} from '../../shared/dto';
import { mockBoardMeta, mockItemDetail, mockPatch } from './mockFallback';

export type { BoardSlug, ColMeta, ColVal, IdentityDTO, ItemDTO, ItemDetailDTO, ListResponse, MeDTO, MondayUserDTO, UpdateDTO, VendedorDTO };

export interface BoardMeta { slug: BoardSlug; title: string; cols: ColMeta[] }

/** Thrown for 401/403 so callers can show a friendly "pide acceso" state. */
export class AccessError extends Error {
  statusCode: 401 | 403;
  constructor(statusCode: 401 | 403) {
    super('access denied');
    this.statusCode = statusCode;
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch('/api' + path, { credentials: 'same-origin', ...init });
  if (res.status === 401 || res.status === 403) throw new AccessError(res.status);
  return res;
}

export async function getMe(): Promise<MeDTO> {
  const res = await apiFetch('/me');
  if (!res.ok) throw new Error('GET /me failed: ' + res.status);
  return res.json();
}

export async function getBoards(): Promise<BoardMeta[]> {
  const res = await apiFetch('/boards');
  if (!res.ok) throw new Error('GET /boards failed: ' + res.status);
  return res.json();
}

export async function getItem(slug: BoardSlug, id: string): Promise<ItemDetailDTO> {
  const res = await apiFetch(`/boards/${slug}/items/${id}`);
  if (!res.ok) throw new Error('GET item failed: ' + res.status);
  return res.json();
}

export async function patchItem(slug: BoardSlug, id: string, cols: Record<string, string>): Promise<WriteResponse> {
  try {
    const res = await apiFetch(`/boards/${slug}/items/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cols }),
    });
    if (!res.ok) throw new Error('PATCH item failed: ' + res.status);
    return res.json();
  } catch (e) {
    if (e instanceof AccessError || slug !== 'oportunidades') throw e;
    mockPatch(id, cols); // offline demo: keep the edit locally
    return { ok: true, pending: true };
  }
}

export async function createItem(slug: BoardSlug, name: string, cols: Record<string, string>): Promise<CreateResponse> {
  const res = await apiFetch(`/boards/${slug}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, cols }),
  });
  const body: CreateResponse = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'create failed: ' + res.status);
  return body;
}

export async function getVendedores(role: 'vendedor' | 'compras' = 'vendedor'): Promise<VendedorDTO[]> {
  const res = await apiFetch(`/vendedores?role=${role}`);
  if (!res.ok) return [];
  return res.json();
}

/** Mandar a costeo — el servidor valida las líneas (producto, cantidad, color de
 * la lista) y responde 422 con errores legibles cuando algo falta. */
export async function enviarCosteo(id: string): Promise<EnviarCosteoResponse> {
  const res = await apiFetch(`/oportunidades/${id}/enviar-costeo`, { method: 'POST' });
  const body: EnviarCosteoResponse = await res.json();
  if (!res.ok && !body.errors) throw new Error('enviar a costeo failed: ' + res.status);
  return body;
}

export async function refreshItem(slug: BoardSlug, id: string): Promise<{ ok: boolean }> {
  const res = await apiFetch(`/boards/${slug}/items/${id}/refresh`, { method: 'POST' });
  if (!res.ok) throw new Error('refresh failed: ' + res.status);
  return res.json();
}

export async function getItemDetail(slug: BoardSlug, id: string): Promise<{ item: ItemDetailDTO; offlineMock: boolean }> {
  try {
    const item = await getItem(slug, id);
    return { item, offlineMock: false };
  } catch (e) {
    if (e instanceof AccessError) throw e;
    const mock = mockItemDetail(slug, id);
    if (mock) return { item: mock, offlineMock: true };
    throw e;
  }
}

export function colForBoard(boards: BoardMeta[], slug: BoardSlug): ColMeta[] {
  return boards.find((b) => b.slug === slug)?.cols ?? [];
}

export async function getUpdates(slug: BoardSlug, id: string): Promise<UpdateDTO[]> {
  const res = await apiFetch(`/boards/${slug}/items/${id}/updates`);
  if (!res.ok) throw new Error('GET updates failed: ' + res.status);
  return res.json();
}

export async function postUpdate(slug: BoardSlug, id: string, body: string): Promise<UpdateDTO> {
  const res = await apiFetch(`/boards/${slug}/items/${id}/updates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error('POST update failed: ' + res.status);
  return res.json();
}

// Admin-only Settings: identity roster + Monday user directory for import.
export async function getIdentities(): Promise<IdentityDTO[]> {
  const res = await apiFetch('/admin/identities');
  if (!res.ok) throw new Error('GET identities failed: ' + res.status);
  return res.json();
}

export async function putIdentity(email: string, patch: Partial<IdentityDTO>): Promise<void> {
  const res = await apiFetch(`/admin/identities/${encodeURIComponent(email)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('PUT identity failed: ' + res.status);
}

export async function getMondayUsers(): Promise<MondayUserDTO[]> {
  const res = await apiFetch('/admin/monday-users');
  if (!res.ok) throw new Error('GET monday-users failed: ' + res.status);
  return res.json();
}

export { mockBoardMeta };
