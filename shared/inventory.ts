// Inventario module DTOs + shared business rules (2026-07-15). Native D1 feature —
// unlike shared/{boards,dto}.ts this has nothing to do with the Monday mirror; see
// worker/schema.sql (warehouses/movements/stock) and worker/lib/inventory.ts.
export type MovementType = 'Entrada' | 'Salida' | 'Transferencia' | 'Consolidación';
export type WarehouseType = 'bodega' | 'person';

export const MOVEMENT_TYPES: MovementType[] = ['Entrada', 'Salida', 'Transferencia', 'Consolidación'];

export interface WarehouseDTO {
  id: number;
  name: string;
  type: WarehouseType;
  location: string | null;
  active: boolean;
}

export interface MovementDTO {
  id: number;
  type: MovementType;
  productName: string;
  quantity: number;
  originId: number | null;
  destinationId: number | null;
  capturedBy: string;
  folio: string | null;
  notes: string | null;
  createdAt: string;
}

export interface StockRowDTO {
  productName: string;
  warehouseId: number;
  warehouseName: string;
  warehouseType: WarehouseType;
  stock: number;
}

export interface CreateMovementRequest {
  type: MovementType;
  productName: string;
  quantity: number;
  originId?: number | null;
  destinationId?: number | null;
  capturedBy: string;
  folio?: string;
  notes?: string;
}
export interface CreateMovementResponse { ok: boolean; id?: number; error?: string }

export interface CreateWarehouseRequest {
  name: string;
  type: WarehouseType;
  location?: string;
}
export interface CreateWarehouseResponse { ok: boolean; id?: number; error?: string }

/** Which of origin/destination the "New Movement" form should show for a given type.
 * Consolidación is bidirectional (2026-07-15 decision): a physical-count correction can
 * go either way — up (destination_id) or down (origin_id, magnitude only, never a
 * negative quantity) — so both fields are candidates and the form's "Dirección" choice
 * (not the type alone) decides which one is actually shown/required. */
export function movementFieldVisibility(type: MovementType): { origin: boolean; destination: boolean } {
  switch (type) {
    case 'Entrada': return { origin: false, destination: true };
    case 'Salida': return { origin: true, destination: false };
    case 'Transferencia': return { origin: true, destination: true };
    case 'Consolidación': return { origin: true, destination: true };
  }
}

/** Mirrors the DB CHECK constraint in worker/schema.sql so a bad request gets a
 * friendly 400 from the worker instead of a raw SQLite constraint error; also used
 * by the New Movement form to disable submit before hitting the network. */
export function validateMovementEndpoints(
  type: MovementType, originId: number | null, destinationId: number | null,
): string | null {
  const hasOrigin = originId != null;
  const hasDest = destinationId != null;
  switch (type) {
    case 'Entrada':
      if (hasOrigin) return 'Entrada no lleva almacén de origen.';
      if (!hasDest) return 'Entrada requiere un almacén de destino.';
      return null;
    case 'Salida':
      if (hasDest) return 'Salida no lleva almacén de destino.';
      if (!hasOrigin) return 'Salida requiere un almacén de origen.';
      return null;
    case 'Transferencia':
      if (!hasOrigin || !hasDest) return 'Transferencia requiere origen y destino.';
      if (originId === destinationId) return 'Origen y destino no pueden ser el mismo almacén.';
      return null;
    case 'Consolidación':
      if (hasOrigin === hasDest) return 'Consolidación requiere exactamente un almacén: destino para un ajuste al alza, origen para un ajuste a la baja.';
      return null;
  }
}
