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

export interface MeDTO { email: string; nombre: string; role: Role; mondayUserId: number }

export interface WriteRequest { cols: Record<string, string> }  // colId -> new raw value
export interface WriteResponse { ok: boolean; pending: boolean; error?: string }

export interface CreateRequest { name: string; cols: Record<string, string> }
export interface CreateResponse { ok: boolean; id?: string; error?: string }

export interface VendedorDTO { id: number; nombre: string }

// POST /api/oportunidades/:id/enviar-costeo — 422 con errores legibles cuando
// las líneas no pasan las validaciones (producto, cantidad, color de la lista).
export interface EnviarCosteoResponse { ok: boolean; errors?: string[] }

// Monday item updates (comments) — read/posted live, never mirrored to D1.
export interface UpdateDTO { id: string; body: string; author: string; createdAt: string }
export interface CreateUpdateRequest { body: string }

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
