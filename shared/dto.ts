// Generic role-scoped DTOs. The serializer (worker/lib/serialize.ts) is the ONLY
// producer; it emits exactly the whitelisted columns for the viewer's role.
import type { Role } from './types';
import type { BoardSlug } from './boards';

export interface ColVal {
  text: string;                 // Monday's display text ('' if empty)
  value?: unknown;              // parsed value when useful (numbers, status index, files)
  type: string;                 // monday column type
}

export interface ItemDTO {
  id: string;
  name: string;
  parentId?: string;
  group?: string;
  syncedAt: string;             // ISO — drives "sincronizado hace X min"
  mondayUpdatedAt: string | null; // ISO, Monday's own item.updated_at — drives "actualizado hace X min"
  pendingWrite?: boolean;       // outbox row not yet confirmed by Monday echo
  cols: Record<string, ColVal>; // keyed by monday column id, whitelist-filtered
}

export interface ItemDetailDTO extends ItemDTO {
  children?: ItemDTO[];         // subitems, same whitelist rules
}

export interface ListResponse {
  board: BoardSlug;
  items: ItemDTO[];
  total: number;
  etag: string;                 // aggregate hash — If-None-Match => 304
}

export interface MeDTO {
  email: string; nombre: string; role: Role; mondayUserId: number;
  // Presente cuando un admin está viendo el portal como este usuario — nombre/email
  // del admin real, para el banner "Salir de impersonación".
  impersonatedBy?: { email: string; nombre: string } | null;
}

export interface WriteRequest { cols: Record<string, string> }  // colId -> new raw value
export interface WriteResponse { ok: boolean; pending: boolean; error?: string }

export interface CreateRequest { name: string; cols: Record<string, string> }
export interface CreateResponse { ok: boolean; id?: string; error?: string }

export interface VendedorDTO { id: number; nombre: string }

// GET /api/oportunidades/:id/costeo-check (solo lectura, deshabilita el botón) y
// POST /api/oportunidades/:id/enviar-costeo (dispara validar_costeo de cmp-tallas) —
// 422 con errores legibles cuando algo falta. `folio` = PDF de costeo generado.
export interface EnviarCosteoResponse { ok: boolean; errors?: string[]; folio?: string }

// GET /api/oportunidades/:id/proyecto — el Proyecto ligado (tallas/OC viven ahí);
// null cuando la oportunidad aún no tiene Proyecto.
export interface ProyectoResponse { proyecto: ItemDetailDTO | null }

// Versiones de cotización (worker/lib/quoteVersions.ts). La vigente se arma en
// caliente desde el mirror; las anteriores vienen archivadas en D1. `products` es
// de solo lectura (snapshot); la edición vive en QuoteVersionRequest.
export interface QuoteLineSnapshot {
  subitemId?: number;
  producto: string;
  sku?: string;
  color: string;
  cantidad: number;
  embellecimiento: boolean;
  descripcionEmbellecimiento?: string;
  precioUnitario?: number;
  pendienteCosteo?: boolean;
  /** Etapa Costeo (color_mm084gvf) al momento del snapshot — "No iniciado" o
   * vacío si Compras todavía no la toca; usado por submitVersion para saber
   * si debe resetearla al editar la línea. */
  etapaCosteo?: string;
}

export interface QuoteVersionDTO {
  id: number;
  label: string;
  createdAt: string;
  status: 'vigente' | 'anterior';
  folio?: string;
  total: number;
  products: QuoteLineSnapshot[];
}

export interface QuoteVersionsResponse { versions: QuoteVersionDTO[] }

// POST /api/oportunidades/:id/version — `subitemId` ausente = línea nueva.
export interface QuoteLineInput {
  subitemId?: number;
  productoItemId?: number;   // link a Productos, cuando viene del catálogo
  producto: string;          // nombre a mostrar / fallback de texto libre
  color: string;
  cantidad: number;
  embellecimiento: boolean;
  descripcionEmbellecimiento?: string;
}

export interface QuoteVersionRequest { lines: QuoteLineInput[] }
export interface QuoteVersionResponse {
  ok: boolean; changed: boolean; error?: string; versions?: QuoteVersionDTO[];
  /** Resultado de reenviar a costeo (solo cuando changed:true) — mismo shape que
   * EnviarCosteoResponse, sin folio garantizado si cmp-tallas lo rechazó. */
  costeo?: { ok: boolean; folio?: string; errors?: string[] };
}

// POST /api/proyectos/:id/(tallas-regenerar|tallas-confirmar|tallas-importar|generar-oc)
// — contrato cmp-tallas: siempre {ok, skipped?, reason?, ...extras}.
export interface ProyectoActionResponse {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  [key: string]: unknown;
}

// Monday item updates (comments) — read/posted live, never mirrored to D1.
export interface UpdateDTO { id: string; body: string; author: string; createdAt: string }
export interface CreateUpdateRequest { body: string; mentions?: { id: number; nombre: string }[] }

// GET /api/users — full Monday account roster (any authenticated viewer), used
// to power @-tagging in Actualizaciones. Distinct from /api/vendedores, which
// is the smaller D1 identity roster scoped to portal roles.
export interface MentionUserDTO { id: number; nombre: string }

// Admin settings: identity rows the admin manages (who can log in, phone, role).
export interface IdentityDTO {
  email: string;
  phone: string | null;
  nombre: string | null;
  mondayUserId: number;
  role: Role;
  active: boolean;
}
// Monday directory entry offered for import in Settings.
export interface MondayUserDTO { id: number; nombre: string; email: string; phone: string | null; teams: string[] }

// Column metadata the UI needs to render board-like tables (titles, types,
// status label colors from Monday settings). Generated — see shared/column-meta.ts.
export interface ColMeta {
  id: string; title: string; type: string;
  w?: boolean;                  // viewer's role may write this column
  labels?: Record<string, { label: string; color?: string }>;  // status/dropdown
}

// Portal chat bubble — same Claude agent + tools as the WhatsApp bot (worker/wa/),
// a second channel keyed by the viewer's email instead of a phone number.
export interface AssistantMessage { role: 'user' | 'assistant'; text: string }
export interface AssistantHistoryResponse { messages: AssistantMessage[] }
export interface AssistantChatRequest { text: string }
export interface AssistantChatResponse { reply: string }
