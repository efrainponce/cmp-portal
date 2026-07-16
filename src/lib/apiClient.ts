// Plain (non-hook) typed client for the worker API — see docs/dev-contracts.md.
import type { BoardSlug } from '../../shared/boards';
import type {
  AssistantChatRequest, AssistantChatResponse, AssistantHistoryResponse, AssistantMessage,
  ColMeta, ColVal, CreateResponse, EnviarCosteoResponse, IdentityDTO, ItemDTO, ItemDetailDTO,
  ListResponse, MeDTO, MentionUserDTO, MondayUserDTO, ProyectoActionResponse, ProyectoResponse,
  QuoteLineInput, QuoteLineSnapshot, QuoteVersionDTO, QuoteVersionRequest, QuoteVersionResponse, QuoteVersionsResponse,
  UpdateDTO, VendedorDTO, WriteResponse,
} from '../../shared/dto';
import { mockBoardMeta, mockItemDetail, mockPatch } from './mockFallback';

export type {
  BoardSlug, ColMeta, ColVal, IdentityDTO, ItemDTO, ItemDetailDTO, ListResponse, MeDTO, MentionUserDTO,
  MondayUserDTO, QuoteLineInput, QuoteLineSnapshot, QuoteVersionDTO, UpdateDTO, VendedorDTO,
};

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

/** Catálogo genérico de un board (usado para el picker de producto al agregar una
 * línea nueva en "Nueva versión"). */
export async function listItems(slug: BoardSlug, q?: string): Promise<ItemDTO[]> {
  const res = await apiFetch(`/boards/${slug}/items${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  if (!res.ok) throw new Error('GET items failed: ' + res.status);
  const body: ListResponse = await res.json();
  return body.items;
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

/** Pre-chequeo de solo lectura: deshabilita el botón "Mandar a costeo" y lista
 * lo que falta antes de que alguien pueda dar click. */
export async function checkCosteo(id: string): Promise<EnviarCosteoResponse> {
  const res = await apiFetch(`/oportunidades/${id}/costeo-check`);
  const body: EnviarCosteoResponse = await res.json();
  if (!res.ok && !body.errors) throw new Error('costeo-check failed: ' + res.status);
  return body;
}

/** Mandar a costeo — dispara el flujo real de cmp-tallas (validar_costeo): valida,
 * snapshotea costos, genera el PDF de solicitud y mueve la etapa a "En costeo".
 * 422 con errores legibles cuando algo falta. */
export async function enviarCosteo(id: string): Promise<EnviarCosteoResponse> {
  const res = await apiFetch(`/oportunidades/${id}/enviar-costeo`, { method: 'POST' });
  const body: EnviarCosteoResponse = await res.json();
  if (!res.ok && !body.errors) throw new Error('enviar a costeo failed: ' + res.status);
  return body;
}

/** Generar cotización — cmp-tallas genera PDFs con/sin precio, manda a firma
 * (DocuSeal) y mueve la etapa a "Cotización". */
export async function generarCotizacion(id: string): Promise<ProyectoActionResponse> {
  const res = await apiFetch(`/oportunidades/${id}/cotizacion`, { method: 'POST' });
  const body: ProyectoActionResponse = await res.json();
  if (!res.ok && !body.reason) throw new Error('generar cotización failed: ' + res.status);
  return body;
}

/** Historial de versiones de cotización; [] cuando aún no se generó ninguna. */
export async function getVersiones(id: string): Promise<QuoteVersionDTO[]> {
  const res = await apiFetch(`/oportunidades/${id}/versiones`);
  if (!res.ok) throw new Error('GET versiones failed: ' + res.status);
  const body: QuoteVersionsResponse = await res.json();
  return body.versions;
}

/** Envía un draft de líneas editado — el worker decide si algo cambió respecto a
 * la vigente; si sí, archiva la vigente actual como versión superada y escribe. */
export async function submitVersion(id: string, lines: QuoteLineInput[]): Promise<QuoteVersionResponse> {
  const res = await apiFetch(`/oportunidades/${id}/version`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines } satisfies QuoteVersionRequest),
  });
  const body: QuoteVersionResponse = await res.json();
  if (!res.ok && !body.error) throw new Error('submit version failed: ' + res.status);
  return body;
}

/** El Proyecto ligado a la oportunidad (con sus subitems de tallas); null si no existe. */
export async function getProyecto(oppId: string): Promise<ItemDetailDTO | null> {
  const res = await apiFetch(`/oportunidades/${oppId}/proyecto`);
  if (!res.ok) throw new Error('GET proyecto failed: ' + res.status);
  const body: ProyectoResponse = await res.json();
  return body.proyecto;
}

export type ProyectoAction = 'tallas-regenerar' | 'tallas-confirmar' | 'tallas-importar' | 'generar-oc';

/** Acciones de cmp-tallas sobre el Proyecto (tallas y órdenes de compra). */
export async function proyectoAction(proyectoId: string, action: ProyectoAction): Promise<ProyectoActionResponse> {
  const res = await apiFetch(`/proyectos/${proyectoId}/${action}`, { method: 'POST' });
  const body: ProyectoActionResponse = await res.json();
  if (!res.ok && !body.reason) throw new Error(`${action} failed: ` + res.status);
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

export async function postUpdate(slug: BoardSlug, id: string, body: string, mentions?: MentionUserDTO[]): Promise<UpdateDTO> {
  const res = await apiFetch(`/boards/${slug}/items/${id}/updates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, mentions }),
  });
  if (!res.ok) throw new Error('POST update failed: ' + res.status);
  return res.json();
}

/** Full Monday roster for @-tagging in Actualizaciones. */
export async function getMentionUsers(): Promise<MentionUserDTO[]> {
  const res = await apiFetch('/users');
  if (!res.ok) return [];
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

// Portal chat bubble — same Claude agent/tools as the WhatsApp bot, a second channel.
export type { AssistantMessage };

export async function getAssistantHistory(): Promise<AssistantMessage[]> {
  const res = await apiFetch('/assistant/messages');
  if (!res.ok) throw new Error('GET assistant history failed: ' + res.status);
  const body: AssistantHistoryResponse = await res.json();
  return body.messages;
}

export async function sendAssistantMessage(text: string): Promise<string> {
  const res = await apiFetch('/assistant/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text } satisfies AssistantChatRequest),
  });
  if (!res.ok) throw new Error('POST assistant message failed: ' + res.status);
  const body: AssistantChatResponse = await res.json();
  return body.reply;
}

export async function resetAssistant(): Promise<void> {
  const res = await apiFetch('/assistant/reset', { method: 'POST' });
  if (!res.ok) throw new Error('POST assistant reset failed: ' + res.status);
}

export { mockBoardMeta };
