// Plain fetch client for /api/inventario/* — native D1 feature, separate from
// src/lib/apiClient.ts's BoardSlug/Monday-mirror routes, but reuses apiFetch (same
// same-origin credentials + 401/403 -> AccessError handling).
import { apiFetch, AccessError } from './apiClient';
import type {
  CreateMovementRequest, CreateMovementResponse, MovementDTO, MovementType, StockRowDTO, WarehouseDTO,
} from '../../shared/inventory';

export { AccessError };
export type { CreateMovementRequest, CreateMovementResponse, MovementDTO, MovementType, StockRowDTO, WarehouseDTO };

export async function getWarehouses(): Promise<WarehouseDTO[]> {
  const res = await apiFetch('/inventario/warehouses');
  if (!res.ok) throw new Error('GET warehouses failed: ' + res.status);
  return res.json();
}

export async function getStock(): Promise<StockRowDTO[]> {
  const res = await apiFetch('/inventario/stock');
  if (!res.ok) throw new Error('GET stock failed: ' + res.status);
  return res.json();
}

export async function getMovements(): Promise<MovementDTO[]> {
  const res = await apiFetch('/inventario/movements');
  if (!res.ok) throw new Error('GET movements failed: ' + res.status);
  return res.json();
}

export async function createMovement(body: CreateMovementRequest): Promise<CreateMovementResponse> {
  const res = await apiFetch('/inventario/movements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json: CreateMovementResponse = await res.json();
  if (!res.ok && !json.error) throw new Error('POST movement failed: ' + res.status);
  return json;
}
