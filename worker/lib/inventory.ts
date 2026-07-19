// worker/lib/inventory.ts — Inventario DAL + validation. Native D1 tables
// (warehouses/movements/stock view, worker/schema.sql), no BOARDS/BoardSlug involved.
import type { Env } from '../env';
import type {
  CreateMovementRequest, CreateWarehouseRequest, MovementDTO, MovementType, StockRowDTO, WarehouseDTO,
} from '../../shared/inventory';
import { MOVEMENT_TYPES, validateMovementEndpoints } from '../../shared/inventory';

export class InventoryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface WarehouseRow { id: number; name: string; type: string; location: string | null; active: number }
interface MovementRow {
  id: number; type: string; product_name: string; quantity: number;
  origin_id: number | null; destination_id: number | null; captured_by: string;
  folio: string | null; notes: string | null; created_at: string;
}
interface StockRow { product_name: string; warehouse_id: number; name: string; type: string; stock: number }

const toWarehouseDTO = (r: WarehouseRow): WarehouseDTO => ({
  id: r.id, name: r.name, type: r.type as WarehouseDTO['type'], location: r.location, active: !!r.active,
});

const toMovementDTO = (r: MovementRow): MovementDTO => ({
  id: r.id, type: r.type as MovementType, productName: r.product_name, quantity: r.quantity,
  originId: r.origin_id, destinationId: r.destination_id, capturedBy: r.captured_by,
  folio: r.folio, notes: r.notes, createdAt: r.created_at,
});

export async function listWarehouses(env: Env): Promise<WarehouseDTO[]> {
  const res = await env.DB.prepare('SELECT * FROM warehouses WHERE active = 1 ORDER BY type, name').all<WarehouseRow>();
  return (res.results ?? []).map(toWarehouseDTO);
}

export async function listMovements(env: Env): Promise<MovementDTO[]> {
  const res = await env.DB
    .prepare('SELECT * FROM movements ORDER BY created_at DESC, id DESC LIMIT 2000')
    .all<MovementRow>();
  return (res.results ?? []).map(toMovementDTO);
}

// Nets the stock view's per-movement +/- rows into one row per (product, warehouse),
// joined with warehouses for name/type — the UI splits Bodegas vs. Vendedores on `type`.
// Zero-net rows (e.g. a sample fully returned) are dropped, nothing to show for those.
export async function listStock(env: Env): Promise<StockRowDTO[]> {
  const sql = `
    SELECT s.product_name, s.warehouse_id, w.name, w.type, SUM(s.inbound) AS stock
    FROM stock s JOIN warehouses w ON w.id = s.warehouse_id
    GROUP BY s.product_name, s.warehouse_id
    HAVING SUM(s.inbound) != 0
    ORDER BY w.type DESC, w.name, s.product_name`;
  const res = await env.DB.prepare(sql).all<StockRow>();
  return (res.results ?? []).map((r) => ({
    productName: r.product_name, warehouseId: r.warehouse_id, warehouseName: r.name,
    warehouseType: r.type as StockRowDTO['warehouseType'], stock: r.stock,
  }));
}

export async function createWarehouse(env: Env, body: CreateWarehouseRequest): Promise<WarehouseDTO> {
  const name = body.name?.trim();
  if (!name) throw new InventoryError(400, 'El nombre del almacén es requerido.');
  if (body.type !== 'bodega' && body.type !== 'person') {
    throw new InventoryError(400, 'Tipo de almacén inválido.');
  }

  const res = await env.DB
    .prepare('INSERT INTO warehouses (name, type, location) VALUES (?, ?, ?)')
    .bind(name, body.type, body.location?.trim() || null)
    .run();

  const row = await env.DB
    .prepare('SELECT * FROM warehouses WHERE id = ?')
    .bind(res.meta.last_row_id)
    .first<WarehouseRow>();
  return toWarehouseDTO(row!);
}

async function activeWarehouseExists(env: Env, id: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM warehouses WHERE id = ? AND active = 1').bind(id).first();
  return !!row;
}

export async function createMovement(env: Env, body: CreateMovementRequest): Promise<MovementDTO> {
  const type = body.type;
  if (!MOVEMENT_TYPES.includes(type)) throw new InventoryError(400, 'Tipo de movimiento inválido.');

  const productName = body.productName?.trim();
  if (!productName) throw new InventoryError(400, 'El producto es requerido.');

  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new InventoryError(400, 'La cantidad debe ser mayor a 0.');

  const capturedBy = body.capturedBy?.trim();
  if (!capturedBy) throw new InventoryError(400, 'Falta quién capturó el movimiento.');

  const originId = body.originId ?? null;
  const destinationId = body.destinationId ?? null;
  const shapeError = validateMovementEndpoints(type, originId, destinationId);
  if (shapeError) throw new InventoryError(400, shapeError);

  if (originId != null && !(await activeWarehouseExists(env, originId))) {
    throw new InventoryError(400, 'El almacén de origen no existe.');
  }
  if (destinationId != null && !(await activeWarehouseExists(env, destinationId))) {
    throw new InventoryError(400, 'El almacén de destino no existe.');
  }

  let folio = body.folio?.trim() || null;
  if (!folio) {
    const maxRow = await env.DB
      .prepare('SELECT MAX(CAST(folio AS INTEGER)) AS max_folio FROM movements WHERE folio IS NOT NULL')
      .first<{ max_folio: number | null }>();
    const nextNum = (maxRow?.max_folio ?? 0) + 1;
    folio = String(nextNum);
  }

  const res = await env.DB
    .prepare(
      `INSERT INTO movements (type, product_name, quantity, origin_id, destination_id, captured_by, folio, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      type, productName, quantity, originId, destinationId, capturedBy,
      folio, body.notes?.trim() || null,
    )
    .run();

  const row = await env.DB
    .prepare('SELECT * FROM movements WHERE id = ?')
    .bind(res.meta.last_row_id)
    .first<MovementRow>();
  return toMovementDTO(row!);
}
