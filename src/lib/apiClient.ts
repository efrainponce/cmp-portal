// Plain (non-hook) typed client for the worker API — see docs/dev-contracts.md.
import type { BoardSlug } from '../../shared/boards';
import type {
  ActivityEntryDTO, ActivityResponse,
  AjusteDTO, AjustarLineaRequest, AjustarLineaResponse,
  AssistantChatRequest, AssistantChatResponse, AssistantHistoryResponse, AssistantMessage,
  BoardAccessDTO, ColMeta, ColVal, CostoDivergenciaDTO, CotizacionVirtualDTO, CreateResponse, DuplicarOportunidadRequest, DuplicarOportunidadResponse, DuplicarVersionResponse, EnviarCosteoResponse, IdentityDTO, ItemDTO, ItemDetailDTO,
  ListResponse, MeDTO, MentionUserDTO, MondayUserDTO, ProyectoActionResponse, ProyectoResponse,
  QuoteLineSnapshot, QuoteVersionDTO, QuoteVersionsResponse, SetInstitucionRequest, SetInstitucionResponse,
  TallaBoxInput, CapturarTallasResponse, CambiarProductoLineasRequest, CambiarProductoLineasResponse,
  CambioProductoDTO, CambiosProductoResponse, ProyectoImagenDTO, ProyectoImagenesResponse,
  EstadoHistorialEntryDTO, EstadoHistorialResponse,
  ProductoResumenDTO, ProductoResumenResponse, ProductoGeneroResponse,
  UpdateAttachmentDTO, UpdateDTO, VendedorDTO, WriteResponse, ZonaDTO,
} from '../../shared/dto';
import type { AddProposedProductResponse, ProposedProductDTO, ProposedProductsResponse } from '../../shared/productosPropuestos';
import { mockBoardMeta, mockItemDetail, mockPatch } from './mockFallback';
import { getImpersonateTarget } from './impersonation';
import { tomarPrecarga } from './apiPreload';
import { markSessionExpired } from './sessionState';
import { uxApiLatency, uxEdit } from './telemetry';
import { CATALOGO_COLS } from './productSearch';

export type {
  ActivityEntryDTO,
  AjusteDTO, BoardAccessDTO, BoardSlug, ColMeta, ColVal, CostoDivergenciaDTO, CotizacionVirtualDTO, IdentityDTO, ItemDTO, ItemDetailDTO, ListResponse, MeDTO, MentionUserDTO,
  MondayUserDTO, ProposedProductDTO, QuoteLineSnapshot, QuoteVersionDTO, TallaBoxInput, CapturarTallasResponse,
  CambiarProductoLineasRequest, CambiarProductoLineasResponse, CambioProductoDTO, ProyectoImagenDTO,
  EstadoHistorialEntryDTO, ProductoResumenDTO,
  UpdateAttachmentDTO, UpdateDTO, VendedorDTO, ZonaDTO,
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

// Cloudflare Access mantiene su propia sesión (independiente de con qué cuenta
// de Google esté logueado el navegador ahora mismo). Si esa sesión quedó
// pegada a un correo viejo, el 401/403 nunca se resuelve solo con reintentos
// normales — hay que tirar la cookie de Access con /cdn-cgi/access/logout y
// dejar que vuelva a correr el login de Google. OJO: encadenar además un
// logout de Google (accounts.google.com/logout) se probó y se descartó —
// cierra TODA la sesión de Google del navegador (Gmail, Drive, etc.), no solo
// la de este app; efecto colateral peor que el bug original. Si la cuenta de
// Google activa en el navegador es la incorrecta, la salida real es que el
// usuario cambie de cuenta a mano (o use una ventana de Incógnito) — este
// botón solo puede limpiar la cookie de Access. Se hace una sola vez por
// pestaña (sessionStorage) para no entrar en loop con un "pide acceso" real.
const ACCESS_TEAM_DOMAIN = 'mexicanaproteccion.cloudflareaccess.com';
const ACCESS_RETRY_KEY = 'cmp:accessRetried';

function isBehindAccess(): boolean {
  const h = window.location.hostname;
  return h.endsWith('.mexicanadeproteccion.com') || h.endsWith('.workers.dev');
}

function recoverFromAccessSession(): boolean {
  if (!isBehindAccess() || sessionStorage.getItem(ACCESS_RETRY_KEY)) return false;
  sessionStorage.setItem(ACCESS_RETRY_KEY, '1');
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout?returnTo=${returnTo}`;
  return true;
}

/** Cierra la sesión de Cloudflare Access (botón manual "Salir") y vuelve a la
 * raíz para disparar un login de Google fresco. Fuera de Access (dev local)
 * no hay sesión que cerrar — no hace nada. */
export function logout() {
  if (!isBehindAccess()) return;
  sessionStorage.removeItem(ACCESS_RETRY_KEY);
  const returnTo = encodeURIComponent(window.location.origin);
  window.location.href = `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout?returnTo=${returnTo}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const target = getImpersonateTarget();
  const headers = new Headers(init?.headers);
  if (target) headers.set('X-Impersonate-Email', target);
  const url = '/api' + path;
  // ¿Ya lo pidió el script inline de index.html antes de que existiera el
  // bundle? Solo aplica si es idéntico y sin suplantación (la precarga no
  // manda X-Impersonate-Email, así que traería datos del admin). Si algo no
  // cuadra, cae al fetch normal.
  const precargada = target ? null : tomarPrecarga(url, init);
  // Latencia real por endpoint (no existía ninguna medición). Aquí y no en cada
  // llamador porque apiFetch es el ÚNICO punto de paso de todo el front. Es
  // registro en memoria, no agrega ni una petición: sale en lote
  // (src/lib/telemetry.ts), y los GET van muestreados porque la lista poletea
  // cada 5s y medirlos todos ahogaría la tabla.
  const t0 = performance.now();
  const res = precargada
    ? await precargada.catch(() => fetch(url, { credentials: 'same-origin', ...init, headers }))
    : await fetch(url, { credentials: 'same-origin', ...init, headers });
  // La petición precargada arrancó antes que este cronómetro (script inline de
  // index.html), así que su latencia saldría absurdamente corta — no se mide.
  // `res.ok` NO alcanza para decidir si salió bien: es false para 304 Not
  // Modified, y el polling de listas va con ETag (src/lib/api.ts), así que el
  // camino más rápido y más frecuente del portal —"no cambió nada"— se estaba
  // grabando como `error`. Se descubrió el 2026-08-20 investigando por qué la
  // lista de oportunidades "fallaba" ~2,750 veces al día: no fallaba una sola
  // vez. Un 304 es un acuse, no un error.
  if (!precargada) uxApiLatency(init?.method ?? 'GET', path, performance.now() - t0, res.ok || res.status === 304);
  if (res.status === 401) {
    if (recoverFromAccessSession()) return new Promise<Response>(() => {});
    markSessionExpired();
    throw new AccessError(401);
  }
  if (res.status === 403) {
    // Solo el 403 de mw/identity.ts ("no encuentro este correo en la tabla
    // identity") es señal de sesión de Access desalineada; el resto de los
    // 403 del worker son "forbidden" por rol (usuario correcto, sin permiso
    // para esa acción) y deben mostrarse tal cual, no gatillar un re-login.
    const body: unknown = await res.clone().json().catch(() => null);
    const isIdentityMismatch = !!body && typeof body === 'object' && (body as { error?: string }).error === 'pide acceso';
    if (isIdentityMismatch) {
      if (recoverFromAccessSession()) return new Promise<Response>(() => {});
      markSessionExpired();
    }
    throw new AccessError(403);
  }
  sessionStorage.removeItem(ACCESS_RETRY_KEY);
  return res;
}

export async function getMe(): Promise<MeDTO> {
  const res = await apiFetch('/me');
  if (!res.ok) throw new Error('GET /me failed: ' + res.status);
  return res.json();
}

/** Autoregistro del propio teléfono (ver PhoneGateScreen) — 409 = ese número ya
 * está ligado a otra cuenta del portal. */
export async function putMyPhone(phone: string): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch('/me/phone', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo guardar el teléfono.' };
  return { ok: true };
}

export async function getBoards(): Promise<BoardMeta[]> {
  const res = await apiFetch('/boards');
  if (!res.ok) throw new Error('GET /boards failed: ' + res.status);
  return res.json();
}

// Catálogo de Productos cacheado por sesión.
//
// La pestaña Cotización lo pide con `listItems('productos')` cada vez que monta
// (y hasta DOS veces por montaje: las deps del efecto cambian cuando termina de
// cargar el item). Son 1247 productos con sus 19 columnas: 1.86 MB crudos,
// 260 KB comprimidos — POR APERTURA de oportunidad, en los boards donde la
// grid es editable o es Costeo. Cachear la promesa a nivel módulo deja una sola
// descarga por sesión.
//
// Se invalida en cuanto alguien escribe un producto (ver patchItem): la grid ya
// hace update optimista de su copia local, pero el caché tiene que soltar la
// versión vieja para que la siguiente apertura no la reviva.
let catalogoProductos: Promise<ItemDTO[]> | null = null;

export function getCatalogoProductos(): Promise<ItemDTO[]> {
  if (!catalogoProductos) {
    catalogoProductos = listItems('productos', undefined, CATALOGO_COLS).catch((e) => {
      catalogoProductos = null; // no cachear fallas — el siguiente intento reintenta
      throw e;
    });
  }
  return catalogoProductos;
}

export function invalidarCatalogoProductos(): void {
  catalogoProductos = null;
}

/** Catálogo genérico de un board (usado para el picker de producto al agregar una
 * línea nueva en "Nueva versión"). */
export async function listItems(slug: BoardSlug, q?: string, cols?: readonly string[]): Promise<ItemDTO[]> {
  const qs: string[] = [];
  if (q) qs.push(`q=${encodeURIComponent(q)}`);
  // Comas crudas: los ids de columna de Monday son [a-z0-9_] y así la URL
  // coincide con la que arma usePoll (ver queryLista en api.ts).
  if (cols) qs.push(`cols=${cols.join(',')}`);
  const res = await apiFetch(`/boards/${slug}/items${qs.length ? `?${qs.join('&')}` : ''}`);
  if (!res.ok) throw new Error('GET items failed: ' + res.status);
  const body: ListResponse = await res.json();
  return body.items;
}

// Último detalle servido por el worker, por item, con su ETag. Abrir una
// oportunidad hace DOS GETs a este endpoint (espejo + ?fresh=1 tras releer
// Monday) y casi siempre devuelven lo mismo; con esto el segundo contesta 304
// y nos ahorramos re-bajar el cuerpo (~138 KB en una oportunidad de 31
// líneas). No es un caché de lectura: el request SIEMPRE sale, solo evita el
// cuerpo cuando el contenido no cambió.
// Tope chico a propósito: cada entrada guarda el DTO completo (~138 KB en una
// oportunidad de 31 líneas) y esto corre en máquinas con poca RAM — sin tope,
// recorrer 50 oportunidades dejaría ~7 MB colgados. Map preserva orden de
// inserción, así que el más viejo es el primero.
const DETAIL_CACHE_MAX = 6;
const detailEtags = new Map<string, { etag: string; item: ItemDetailDTO }>();

function rememberDetail(key: string, entry: { etag: string; item: ItemDetailDTO }): void {
  detailEtags.delete(key); // re-insertar lo manda al final (más reciente)
  detailEtags.set(key, entry);
  while (detailEtags.size > DETAIL_CACHE_MAX) {
    const oldest = detailEtags.keys().next().value;
    if (oldest === undefined) break;
    detailEtags.delete(oldest);
  }
}

/** `fresh` fuerza al worker a releer el item y sus líneas de Monday antes de
 * responder — lo que se abre tiene que ser idéntico a Monday (Efraín 2026-07-30).
 * Cuesta un round-trip a Monday, así que solo lo piden aperturas/refrescos. */
export async function getItem(slug: BoardSlug, id: string, opts?: { fresh?: boolean }): Promise<ItemDetailDTO> {
  const key = `${slug}:${id}`;
  const known = detailEtags.get(key);
  const res = await apiFetch(`/boards/${slug}/items/${id}${opts?.fresh ? '?fresh=1' : ''}`, {
    headers: known ? { 'If-None-Match': known.etag } : undefined,
  });
  if (res.status === 304 && known) {
    // Sin cuerpo, pero la relectura SÍ ocurrió: el worker manda la hora real
    // en X-Synced-At para que el "sincronizado hace …" no se quede viejo.
    const syncedAt = res.headers.get('X-Synced-At');
    const item = syncedAt && syncedAt !== known.item.syncedAt
      ? { ...known.item, syncedAt }
      : known.item;
    rememberDetail(key, { etag: known.etag, item });
    return item;
  }
  if (!res.ok) throw new Error('GET item failed: ' + res.status);
  const item: ItemDetailDTO = await res.json();
  const etag = res.headers.get('ETag');
  if (etag) rememberDetail(key, { etag, item });
  else detailEtags.delete(key);
  return item;
}

export async function patchItem(slug: BoardSlug, id: string, cols: Record<string, string>): Promise<WriteResponse> {
  // Escribir un producto deja obsoleto el catálogo cacheado (getCatalogoProductos).
  if (slug === 'productos') invalidarCatalogoProductos();
  // Canal de ATRIBUCIÓN de la telemetría (una fila `edit` por columna escrita).
  // Va aquí, en el único write path del front, y no en cada llamador: sin él
  // una edición hecha en el portal es indistinguible de una hecha en Monday.com
  // —el portal escribe a Monday y la vuelta por activity_logs las deja
  // idénticas—, y la métrica de re-edición mediría las dos herramientas juntas
  // (ver worker/lib/uxMetrics.ts). SOLO viajan los ids de columna, nunca el
  // valor escrito.
  for (const columnId of Object.keys(cols)) {
    uxEdit({ boardSlug: slug, itemId: Number(id) || undefined, columnId });
  }
  try {
    const res = await apiFetch(`/boards/${slug}/items/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cols }),
    });
    if (!res.ok) throw new Error('PATCH item failed: ' + res.status);
    return res.json();
  } catch (e) {
    if (e instanceof AccessError || slug !== 'oportunidades') throw e;
    if (!import.meta.env.DEV) throw e;
    mockPatch(id, cols); // offline demo (solo dev): keep the edit locally
    return { ok: true, pending: true };
  }
}

export async function createItem(
  slug: BoardSlug, name: string, cols: Record<string, string>, opts: { native?: boolean } = {},
): Promise<CreateResponse> {
  const res = await apiFetch(`/boards/${slug}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, cols, native: opts.native }),
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

// "Actuar en Monday como" (worker/lib/dal.ts createNativeIdentity) puede dejar a
// dos personas DISTINTAS compartiendo un mismo monday_user_id (alguien sin
// asiento propio escribe bajo la cuenta de otra) — los pickers de Vendedor
// necesitan un `value` único por persona para no perder cuál de las dos quedó
// elegida, aunque ambas terminen escribiendo el mismo id a Monday (Efraín,
// 2026-08-12, caso Rodrigo). `email` es único por fila de identity.
export function vendedorKey(v: VendedorDTO): string {
  return `${v.id}::${v.email}`;
}
export function vendedorIdFromKey(key: string): string {
  return key.split('::')[0] ?? '';
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

/** Pre-chequeo de solo lectura: deshabilita "Mandar a Validación de costeo" y
 * lista qué productos les falta confirmación de Compras (descripción/tallas). */
export async function checkValidacion(id: string): Promise<EnviarCosteoResponse> {
  const res = await apiFetch(`/oportunidades/${id}/validacion-check`);
  const body: EnviarCosteoResponse = await res.json();
  if (!res.ok && !body.errors) throw new Error('validacion-check failed: ' + res.status);
  return body;
}

/** Mandar a Validación de costeo — avance manual de Compras (etapa 15→7),
 * sin flujo de cmp-tallas de por medio (no existe endpoint para este paso). */
export async function enviarValidacion(id: string): Promise<EnviarCosteoResponse> {
  const res = await apiFetch(`/oportunidades/${id}/enviar-validacion`, { method: 'POST' });
  const body: EnviarCosteoResponse = await res.json();
  if (!res.ok && !body.errors) throw new Error('enviar a validación failed: ' + res.status);
  return body;
}

/** Validar costeo — dirección aprueba el precio de venta (etapa 7 → 9 "Costeo
 * Confirmado"), paso previo a generar la cotización. Solo admin (403 para el
 * resto); 422 con los renglones sin Precio de Venta. */
export async function validarCosteo(id: string): Promise<EnviarCosteoResponse> {
  const res = await apiFetch(`/oportunidades/${id}/validar-costeo`, { method: 'POST' });
  const body: EnviarCosteoResponse = await res.json();
  if (!res.ok && !body.errors) throw new Error('validar costeo failed: ' + res.status);
  return body;
}

/** Duplicar — clona cabecera + líneas vigentes + embellecimiento a una
 * oportunidad nueva; `etapa` (clave de DEAL_STAGE_LABELS, default "4" Nueva
 * oportunidad si se omite) la elige quien duplica (DuplicarOportunidadModal).
 * Nunca versiones de cotización ni otros documentos. */
/** Institución elegida desde la oportunidad. El worker la escribe en el
 * CONTACTO ligado (la columna de la oportunidad es un espejo suyo) y devuelve
 * el nombre ya resuelto para pintarlo de inmediato. */
export async function setInstitucionOportunidad(id: string, institucionId: string): Promise<SetInstitucionResponse> {
  const res = await apiFetch(`/oportunidades/${id}/institucion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ institucionId } satisfies SetInstitucionRequest),
  });
  const body: SetInstitucionResponse = await res.json().catch(() => ({ ok: false }));
  if (!res.ok && !body.error) throw new Error('institucion failed: ' + res.status);
  return body;
}

export async function duplicarOportunidad(id: string, etapa?: string): Promise<DuplicarOportunidadResponse> {
  const res = await apiFetch(`/oportunidades/${id}/duplicar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ etapa } satisfies DuplicarOportunidadRequest),
  });
  const body: DuplicarOportunidadResponse = await res.json();
  if (!res.ok && !body.error) throw new Error('duplicar failed: ' + res.status);
  return body;
}

/** Ganar — Etapa a "Ganada" + crea el Proyecto ligado (tallas/OC viven ahí),
 * mismo mapeo que la automatización nativa de Monday que vivía atada a un
 * botón (Efraín, 2026-08-05: ganar desde el portal no la disparaba). */
export async function ganarOportunidad(id: string): Promise<{ ok: boolean; proyectoId?: string; error?: string }> {
  const res = await apiFetch(`/oportunidades/${id}/ganar`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok && !body.error) throw new Error('ganar failed: ' + res.status);
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

/** "+ Nueva versión": duplica la cotización vigente — la archiva como versión
 * superada y deja una copia idéntica como borrador editable inline (igual que
 * Nueva oportunidad). No manda nada a costeo. */
export async function duplicarVersion(id: string): Promise<DuplicarVersionResponse> {
  const res = await apiFetch(`/oportunidades/${id}/version/duplicar`, { method: 'POST' });
  const body: DuplicarVersionResponse = await res.json();
  if (!res.ok && !body.error) throw new Error('duplicar versión failed: ' + res.status);
  return body;
}

/** "Restaurar esta versión": deja la cotización igual a la instantánea elegida
 * (la vigente actual se archiva antes). Todo queda como borrador — la
 * oportunidad debe pasar por costeo otra vez. */
export async function restaurarVersion(id: string, version: number): Promise<DuplicarVersionResponse> {
  const res = await apiFetch(`/oportunidades/${id}/version/${version}/restaurar`, { method: 'POST' });
  const body: DuplicarVersionResponse = await res.json();
  if (!res.ok && !body.error) throw new Error('restaurar versión failed: ' + res.status);
  return body;
}

/** "Ajustar línea" (Efraín, 2026-07-31): cambiar producto (género)/color/
 * embellecimiento/cantidad de una línea sin versión ni costeo, incluso con la
 * Oportunidad Ganada — worker/lib/lineaAjustes.ts. `lineaId` es el subitem. */
export async function ajustarLinea(lineaId: string, input: AjustarLineaRequest): Promise<AjustarLineaResponse> {
  const res = await apiFetch(`/oportunidades/lineas/${lineaId}/ajustar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body: AjustarLineaResponse = await res.json();
  if (!res.ok && !body.error) throw new Error('ajustar línea failed: ' + res.status);
  return body;
}

/** Cotización del Proyecto (Efraín, 2026-08-10) — mismas líneas de la
 * Oportunidad ligada (worker/lib/proyectoCotizacionVirtual.ts). */
export async function getCotizacionVirtual(proyectoId: string): Promise<CotizacionVirtualDTO> {
  const res = await apiFetch(`/proyectos/${proyectoId}/cotizacion-virtual`);
  if (!res.ok) throw new Error('GET cotizacion-virtual failed: ' + res.status);
  return res.json();
}

/** "Ajustar línea" desde el Proyecto — mismo contrato que ajustarLinea y, desde
 * 2026-08-13, la misma escritura real a Monday (solo cambia contra qué se
 * autoriza al viewer). `lineaId` es siempre un subitem real. */
export async function ajustarLineaVirtual(
  proyectoId: string, lineaId: number, input: AjustarLineaRequest,
): Promise<AjustarLineaResponse> {
  const res = await apiFetch(`/proyectos/${proyectoId}/cotizacion-virtual/lineas/${lineaId}/ajustar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body: AjustarLineaResponse = await res.json();
  if (!res.ok && !body.error) throw new Error('ajustar línea virtual failed: ' + res.status);
  return body;
}

/** Zona -> URL de imagen (firmada, corta vigencia) para una línea de oportunidad. */
export async function getZoneImages(lineaId: string): Promise<Record<string, string>> {
  const res = await apiFetch(`/oportunidades/lineas/${lineaId}/embellecimiento-imagenes`);
  if (!res.ok) throw new Error('GET embellecimiento-imagenes failed: ' + res.status);
  return res.json();
}

/** Sube una imagen de referencia para una zona de embellecimiento de una línea. */
export async function uploadZoneImage(
  lineaId: string, zone: string, file: File,
): Promise<{ ok: boolean; zone?: string; url?: string; error?: string }> {
  const form = new FormData();
  form.append('zone', zone);
  form.append('file', file);
  const res = await apiFetch(`/oportunidades/lineas/${lineaId}/embellecimiento-imagen`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo subir la imagen.' };
  return body;
}

/** Productos propuestos por Ventas para una oportunidad (tab "Nuevos productos"). */
export async function getProposedProducts(oppId: string): Promise<ProposedProductDTO[]> {
  const res = await apiFetch(`/oportunidades/${oppId}/productos-propuestos`);
  if (!res.ok) throw new Error('GET productos-propuestos failed: ' + res.status);
  const body: ProposedProductsResponse = await res.json();
  return body.productos;
}

/** Propone un producto nuevo — avisa a Compras (update de Monday + notificación). */
export async function addProposedProduct(
  oppId: string, nombre: string, descripcion: string, file?: File,
): Promise<{ ok: boolean; producto?: ProposedProductDTO; error?: string }> {
  const form = new FormData();
  form.append('nombre', nombre);
  form.append('descripcion', descripcion);
  if (file) form.append('file', file);
  const res = await apiFetch(`/oportunidades/${oppId}/productos-propuestos`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo guardar el producto.' };
  return body as AddProposedProductResponse;
}

/** El Proyecto ligado a la oportunidad (con sus subitems de tallas); null si no existe. */
export async function getProyecto(oppId: string): Promise<ItemDetailDTO | null> {
  const res = await apiFetch(`/oportunidades/${oppId}/proyecto`);
  if (!res.ok) throw new Error('GET proyecto failed: ' + res.status);
  const body: ProyectoResponse = await res.json();
  return body.proyecto;
}

/** Oportunidad ligada a un Proyecto (dirección inversa) — null si el link aún
 * no resuelve (ver worker/routes/oportunidades.ts, fallback en vivo incl.). */
export async function getProyectoOportunidad(proyectoId: string): Promise<string | null> {
  const res = await apiFetch(`/proyectos/${proyectoId}/oportunidad`);
  if (!res.ok) throw new Error('GET oportunidad failed: ' + res.status);
  const body: { oportunidadId: string | null } = await res.json();
  return body.oportunidadId;
}

/** Una orden del ledger de OC (worker/lib/ocLedger.ts). */
export interface OcEmitidaDTO {
  folio: string;
  proyecto_id: number;
  proveedor_id: string | null;
  proveedor: string;
  archivo: string | null;
  archivo_sin_costos: string | null;
  con_imagenes: number;
  motor: string;
  estado: string;
  emitida_por: string | null;
  emitida_at: string;
}

/** Órdenes registradas de un Proyecto. Es lo que permite saber de QUÉ proveedor
 * es cada PDF sin adivinarlo del nombre del archivo. */
export async function listOcDeProyecto(proyectoId: string): Promise<OcEmitidaDTO[]> {
  const res = await apiFetch(`/oc?proyecto=${encodeURIComponent(proyectoId)}&limit=200`);
  if (!res.ok) return [];
  const body: { ordenes: OcEmitidaDTO[] } = await res.json();
  return body.ordenes ?? [];
}

/** Foto de producto de la OC con imágenes (worker/lib/ocImagenes.ts). Vive por
 * SKU y se reusa en todas las órdenes — no es del proyecto ni de la línea. */
export interface OcImagenDTO {
  sku: string;
  /** 'sin-foto' = ya se buscó en el catálogo y no hay. Distinto de "todavía no
   * se ha buscado", que es simplemente no tener fila. */
  estado: 'ok' | 'sin-foto';
  origen: 'airtable' | 'subida';
  contentType: string;
  bytes: number;
  updatedAt: string;
  updatedBy: string;
}

/** Estado de la foto de varios SKUs. No sale a Airtable: solo dice qué hay
 * guardado (jalar del catálogo es explícito, `restablecerOcImagen`). */
export async function listOcImagenes(skus: string[], sync = false): Promise<OcImagenDTO[]> {
  if (skus.length === 0) return [];
  const res = await apiFetch(`/oc-imagenes?skus=${encodeURIComponent(skus.join(','))}${sync ? '&sync=1' : ''}`);
  if (!res.ok) return [];
  const body: { imagenes: OcImagenDTO[] } = await res.json();
  return body.imagenes ?? [];
}

/** URL de la miniatura. `v` la refresca tras subir una foto nueva: el key de R2
 * cambia pero la URL del portal no, y el navegador se quedaría con la vieja. */
export function ocImagenUrl(sku: string, v?: string): string {
  return `/api/oc-imagenes/${encodeURIComponent(sku)}/foto${v ? `?v=${encodeURIComponent(v)}` : ''}`;
}

export async function uploadOcImagen(sku: string, file: File): Promise<OcImagenDTO> {
  const res = await apiFetch(`/oc-imagenes/${encodeURIComponent(sku)}/foto`, {
    method: 'PUT', body: file,
  });
  const body: { imagen?: OcImagenDTO; error?: string } = await res.json();
  if (!res.ok || !body.imagen) throw new Error(body.error ?? 'no se pudo subir la imagen');
  return body.imagen;
}

/** Imágenes extra de un producto DENTRO de un proyecto (renders, muestras, el
 * detalle del bordado) — worker/lib/proyectoImagenes.ts. Distintas de la foto
 * por SKU del catálogo: estas no se heredan a la OC de otro cliente. Cada una
 * sale como su propia ficha en la OC con imágenes. */
export async function listProyectoImagenes(proyectoId: string): Promise<ProyectoImagenDTO[]> {
  const res = await apiFetch(`/proyectos/${proyectoId}/imagenes`);
  if (!res.ok) return [];
  const body: ProyectoImagenesResponse = await res.json();
  return body.imagenes ?? [];
}

export function proyectoImagenUrl(proyectoId: string, imagenId: string): string {
  return `/api/proyectos/${proyectoId}/imagenes/${imagenId}`;
}

export async function uploadProyectoImagen(
  proyectoId: string, sku: string, file: File,
): Promise<ProyectoImagenDTO> {
  const q = `?sku=${encodeURIComponent(sku)}&nombre=${encodeURIComponent(file.name)}`;
  const res = await apiFetch(`/proyectos/${proyectoId}/imagenes${q}`, { method: 'POST', body: file });
  const body: { imagen?: ProyectoImagenDTO; error?: string } = await res.json();
  if (!res.ok || !body.imagen) throw new Error(body.error ?? 'no se pudo subir la imagen');
  return body.imagen;
}

export async function deleteProyectoImagen(proyectoId: string, imagenId: string): Promise<void> {
  const res = await apiFetch(`/proyectos/${proyectoId}/imagenes/${imagenId}`, { method: 'DELETE' });
  if (!res.ok) {
    const body: { error?: string } = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'no se pudo quitar la imagen');
  }
}

/** "Usar la del catálogo": re-jala la de Airtable y pisa la subida. */
export async function restablecerOcImagen(sku: string): Promise<OcImagenDTO> {
  const res = await apiFetch(`/oc-imagenes/${encodeURIComponent(sku)}/restablecer`, { method: 'POST' });
  const body: { imagen?: OcImagenDTO; error?: string } = await res.json();
  if (!res.ok || !body.imagen) throw new Error(body.error ?? 'el catálogo no tiene foto de este producto');
  return body.imagen;
}

export type ProyectoAction =
  | 'tallas-regenerar' | 'tallas-confirmar' | 'tallas-importar'
  | 'generar-oc'                    // cmp-tallas/Eledo + firmas DocuSeal
  | 'generar-oc-portal'             // motor propio del portal, sin firma electrónica
  | 'generar-oc-portal-imagenes';   // la misma, con ficha y foto por producto

/** Acciones de cmp-tallas sobre el Proyecto (tallas y órdenes de compra).
 * `onlyProveedor` (solo 'generar-oc'): genera la OC de un solo proveedor en vez
 * de todos. `metodoPago`/`condPago` (solo junto con `onlyProveedor`): overrides
 * de ese proveedor — sin ellos, cmp-tallas usa el default del Proyecto. */
export async function proyectoAction(
  proyectoId: string, action: ProyectoAction,
  opts?: { onlyProveedor?: string; metodoPago?: string; condPago?: string },
): Promise<ProyectoActionResponse> {
  const hasBody = !!(opts?.onlyProveedor || opts?.metodoPago || opts?.condPago);
  const res = await apiFetch(`/proyectos/${proyectoId}/${action}`, hasBody
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) }
    : { method: 'POST' });
  const body: ProyectoActionResponse = await res.json();
  if (!res.ok && !body.reason) throw new Error(`${action} failed: ` + res.status);
  return body;
}

/** Notas al proveedor de cada OC del Proyecto (worker/lib/ocNotas.ts), por id
 * de proveedor — se imprimen en el PDF de la orden. Solo Compras/Admin. */
export async function getOcNotas(proyectoId: string): Promise<Record<string, string>> {
  const res = await apiFetch(`/proyectos/${proyectoId}/oc-notas`);
  if (!res.ok) throw new Error('GET oc-notas failed: ' + res.status);
  const body: { notas?: Record<string, string> } = await res.json();
  return body.notas ?? {};
}

/** Guarda la nota de UN proveedor (vacía = se borra). Devuelve la nota ya
 * recortada por el server, que es la que va a salir impresa. */
export async function saveOcNota(
  proyectoId: string, proveedorId: string, nota: string,
): Promise<{ ok: boolean; nota?: string; error?: string }> {
  const res = await apiFetch(`/proyectos/${proyectoId}/oc-notas/${proveedorId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nota }),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo guardar la nota.' };
  return body;
}

/** Sube "Inventario Actual (Imagen)" a la Oportunidad — Compras, junto a la
 * cotización firmada (tab Documentación). */
export async function uploadOportunidadInventario(
  oppId: string, file: File,
): Promise<{ ok: boolean; name?: string; url?: string; error?: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch(`/oportunidades/${oppId}/inventario`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo subir el archivo.' };
  return body;
}

/** Sube la OC / cotización / contrato firmado por el cliente al Proyecto ligado. */
export async function uploadProyectoDocumento(
  proyectoId: string, file: File,
): Promise<{ ok: boolean; name?: string; url?: string; error?: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch(`/proyectos/${proyectoId}/documento`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo subir el archivo.' };
  return body;
}

/** Borra un archivo de la OC/contrato del cliente — del portal y de Monday, 1-1
 * (el worker respalda los bytes en R2 antes; ver worker/lib/archivoBorrado.ts).
 * `assetId` sale de la URL de Monday y es lo que distingue dos archivos con el
 * MISMO nombre — justo el caso que originó esto (la misma OC subida dos veces). */
export async function borrarProyectoDocumento(
  proyectoId: string, archivo: { assetId: number; nombre: string },
): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/proyectos/${proyectoId}/documento/borrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId: archivo.assetId, nombre: archivo.nombre }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo borrar el documento.' };
  return { ok: true };
}

/** Sube "# Guia - empresa" / "Evidencia recolección" (tab Logística) a un
 * subitem de proyectos_sub. */
export async function uploadLogisticaArchivo(
  subitemId: string, field: 'guia-empresa' | 'evidencia-recoleccion', file: File,
): Promise<{ ok: boolean; name?: string; url?: string; error?: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch(`/proyectos_sub/${subitemId}/logistica/${field}`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo subir el archivo.' };
  return body;
}

/** Cambiar el producto (y su proveedor) de una línea de la OC conservando las
 * tallas — falta de inventario (worker/lib/proyectoLineaProducto.ts). El
 * servidor puede responder `requiereConfirmacion` con avisos: no es un error,
 * es "la OC anterior ya salió, ¿aun así?". No toca la Oportunidad. */
export async function cambiarProductoLineas(
  proyectoId: string, input: CambiarProductoLineasRequest,
): Promise<CambiarProductoLineasResponse> {
  const res = await apiFetch(`/proyectos/${proyectoId}/lineas/cambiar-producto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json() as CambiarProductoLineasResponse;
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo cambiar el producto.' };
  return body;
}

/** Marca "esta línea ya no es el producto cotizado" por línea del Proyecto. */
export async function getCambiosProducto(proyectoId: string): Promise<CambioProductoDTO[]> {
  const res = await apiFetch(`/proyectos/${proyectoId}/cambios-producto`);
  if (!res.ok) return [];
  const body = await res.json() as CambiosProductoResponse;
  return body.cambios ?? [];
}

export interface ProyectoLineaInput {
  producto: string;
  /** Zona de embellecimiento (Espalda, Frente derecho…). Con esto la línea nace
   * como línea de EMBELLECIMIENTO: el server la nombra "✨ <zona>", que es el
   * marcador con el que la OC a proveedor la distingue de un producto. */
  zona?: string;
  proveedorId?: string;
  cantidad?: number;
  talla?: string;
  color?: string;
  sku?: string;
  costo?: number;
  descuento?: number;
  moneda?: string;
}

/** Línea manual del Proyecto (producto faltante / compra independiente) —
 * Compras/admin. Con Proveedor puesto, "Generar OC por proveedor" ya la toma. */
export async function addProyectoLinea(
  proyectoId: string, input: ProyectoLineaInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const res = await apiFetch(`/proyectos/${proyectoId}/lineas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo crear la línea.' };
  return body;
}

/** Borra una línea del Proyecto (Compras/admin) — borra el subitem en Monday y
 * en el espejo, y deja el rastro en el log de actividad del Proyecto. */
export async function deleteProyectoLinea(
  proyectoId: string, lineaId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/proyectos/${proyectoId}/lineas/${lineaId}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo eliminar la línea.' };
  return body;
}

/** Captura de tallas por boxes (vendedor) — crea subitems del Proyecto directo,
 * sin pasar por cmp-tallas (worker/lib/proyectoTallas.ts). El Sheet + "Importar
 * tallas" de Compras siguen intactos, esto es una alta alternativa más rápida. */
export async function capturarTallas(
  proyectoId: string, rows: TallaBoxInput[],
): Promise<{ ok: boolean; created?: number; updated?: number; omitted?: number; error?: string }> {
  const res = await apiFetch(`/proyectos/${proyectoId}/tallas-capturar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudieron guardar las tallas.' };
  return body;
}

/** Avisa a Compras (Monday @mención + WhatsApp) que una línea producto+color
 * del Proyecto no cuadra contra lo cotizado (worker/lib/proyectoTallas.ts). */
export async function reportarTallasIncorrectas(
  proyectoId: string, producto: string, color?: string,
): Promise<{ ok: boolean; notificados?: number; error?: string }> {
  const res = await apiFetch(`/proyectos/${proyectoId}/tallas-reportar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto, color }),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo reportar.' };
  return body;
}

/** Timeline de "Estado del producto" por línea del Proyecto (tab Ejecución) —
 * historial vive en D1 (worker/lib/estadoProducto.ts), no en columnas de fecha de
 * Monday. Trae TODAS las líneas del proyecto; el front filtra por subItemId. */
export async function getEstadoHistorial(proyectoId: string): Promise<EstadoHistorialEntryDTO[]> {
  const res = await apiFetch(`/proyectos/${proyectoId}/estado-historial`);
  if (!res.ok) throw new Error('GET estado-historial failed: ' + res.status);
  const body: EstadoHistorialResponse = await res.json();
  return body.historial;
}

/** Resumen libre por producto+color (tab Ejecución) — nativo en D1, worker/lib/
 * productoResumen.ts. Trae solo los grupos que ya tienen resumen guardado. */
export async function getProductoResumen(proyectoId: string): Promise<ProductoResumenDTO[]> {
  const res = await apiFetch(`/proyectos/${proyectoId}/resumen-producto`);
  if (!res.ok) throw new Error('GET resumen-producto failed: ' + res.status);
  const body: ProductoResumenResponse = await res.json();
  return body.resumen;
}

export async function patchProductoResumen(proyectoId: string, producto: string, color: string, resumen: string): Promise<void> {
  const res = await apiFetch(`/proyectos/${proyectoId}/resumen-producto`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto, color, resumen }),
  });
  if (!res.ok) throw new Error('PATCH resumen-producto failed: ' + res.status);
}

/** Checkbox "Género M/F" por producto de catálogo — nativo en D1, worker/lib/
 * productoGenero.ts. Trae solo los productos marcados (true); el resto se asume
 * sin género. */
export async function getProductoGenero(): Promise<Record<string, boolean>> {
  const res = await apiFetch('/productos/genero');
  if (!res.ok) throw new Error('GET productos/genero failed: ' + res.status);
  const body: ProductoGeneroResponse = await res.json();
  return body.generos;
}

export async function patchProductoGenero(productoId: string, generoMF: boolean): Promise<void> {
  const res = await apiFetch(`/productos/${productoId}/genero`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generoMF }),
  });
  if (!res.ok) throw new Error('PATCH productos/genero failed: ' + res.status);
}

export async function refreshItem(slug: BoardSlug, id: string): Promise<{ ok: boolean }> {
  const res = await apiFetch(`/boards/${slug}/items/${id}/refresh`, { method: 'POST' });
  if (!res.ok) throw new Error('refresh failed: ' + res.status);
  return res.json();
}

export async function getItemDetail(
  slug: BoardSlug,
  id: string,
  opts?: { fresh?: boolean },
): Promise<{ item: ItemDetailDTO; offlineMock: boolean }> {
  try {
    const item = await getItem(slug, id, opts);
    return { item, offlineMock: false };
  } catch (e) {
    if (e instanceof AccessError) throw e;
    if (!import.meta.env.DEV) throw e;
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

/** Marca updates/replies como vistos por el viewer actual — best-effort, nunca lanza
 * (el "ojito" nunca debe romper la carga del feed). */
export async function markUpdatesSeen(slug: BoardSlug, id: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await apiFetch(`/boards/${slug}/items/${id}/updates/seen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
  } catch { /* best-effort */ }
}

/** Adjunta un archivo a un update ya creado (el composer primero crea el
 * update con postUpdate, luego llama esto con su id) — attachment nativo de
 * Monday, no un link que expira. */
export async function postUpdateAttachment(
  slug: BoardSlug, id: string, updateId: string, file: File,
): Promise<{ ok: boolean; id?: string; name?: string; ext?: string; error?: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch(`/boards/${slug}/items/${id}/updates/${updateId}/attachment`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) return { ok: false, error: body.error ?? 'No se pudo adjuntar el archivo.' };
  return body;
}

/** URL del proxy que sirve los bytes de un adjunto de actualización — nunca
 * el link firmado de Monday directo (expira en ~1h). `download` fuerza
 * Content-Disposition: attachment en vez de inline. */
export function updateAttachmentHref(
  slug: BoardSlug, id: string, assetId: string, name: string, download = false,
): string {
  const q = new URLSearchParams({ name });
  if (download) q.set('download', '1');
  return `/api/boards/${slug}/items/${id}/updates/attachments/${assetId}?${q.toString()}`;
}

/** Full Monday roster for @-tagging in Actualizaciones. */
export async function getMentionUsers(): Promise<MentionUserDTO[]> {
  const res = await apiFetch('/users');
  if (!res.ok) return [];
  return res.json();
}

/** Log de actividad (worker/lib/activityLog.ts) — mirror filtrado de Monday,
 * newest first. Para 'oportunidades' incluye también sus líneas. */
export async function getActivity(slug: BoardSlug, id: string): Promise<ActivityEntryDTO[]> {
  const res = await apiFetch(`/boards/${slug}/items/${id}/activity`);
  if (!res.ok) throw new Error('GET activity failed: ' + res.status);
  const body: ActivityResponse = await res.json();
  return body.entries;
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

export async function createIdentity(payload: {
  email: string; nombre: string; phone: string | null; role: IdentityDTO['role']; active?: boolean;
  /** Alta "actuar en Monday como" (Efraín, 2026-08-06): mondayUserId de una
   * persona real ya en el roster, para que este usuario pueda crear oportunidades
   * a su nombre hasta que tenga cuenta propia. Omitido = solo directorio. */
  mondayUserId?: number;
}): Promise<IdentityDTO> {
  const res = await apiFetch('/admin/identities', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body: { error?: string } = await res.json().catch(() => ({}));
    throw new Error(body.error || 'POST identity failed: ' + res.status);
  }
  return res.json();
}

export async function getMondayUsers(): Promise<MondayUserDTO[]> {
  const res = await apiFetch('/admin/monday-users');
  if (!res.ok) throw new Error('GET monday-users failed: ' + res.status);
  return res.json();
}

export async function getBoardAccess(): Promise<BoardAccessDTO> {
  const res = await apiFetch('/admin/board-access');
  if (!res.ok) throw new Error('GET board-access failed: ' + res.status);
  return res.json();
}

export async function putBoardAccess(role: string, boardKeys: string[]): Promise<void> {
  const res = await apiFetch(`/admin/board-access/${encodeURIComponent(role)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boardKeys }),
  });
  if (!res.ok) throw new Error('PUT board-access failed: ' + res.status);
}

// Zonas de ventas: el líder ve (solo lectura) las oportunidades de sus miembros.
export async function getZonas(): Promise<ZonaDTO[]> {
  const res = await apiFetch('/admin/zonas');
  if (!res.ok) throw new Error('GET zonas failed: ' + res.status);
  return res.json();
}

export async function createZona(nombre: string): Promise<ZonaDTO> {
  const res = await apiFetch('/admin/zonas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }),
  });
  if (!res.ok) throw new Error(await errorText(res, 'POST zona failed'));
  return res.json();
}

export async function putZona(
  id: number, patch: Partial<Pick<ZonaDTO, 'nombre' | 'liderEmail' | 'miembros'>>,
): Promise<void> {
  const res = await apiFetch(`/admin/zonas/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorText(res, 'PUT zona failed'));
}

export async function deleteZona(id: number): Promise<void> {
  const res = await apiFetch(`/admin/zonas/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('DELETE zona failed: ' + res.status);
}

// El worker manda {error} legible en 400/409 (nombre repetido, email fuera del
// roster) — sin esto la UI mostraría "PUT zona failed: 409" y no el motivo.
async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: string };
    if (body?.error) return body.error;
  } catch { /* respuesta sin JSON */ }
  return `${fallback}: ${res.status}`;
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
