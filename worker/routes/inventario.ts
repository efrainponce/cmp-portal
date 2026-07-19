// Inventario (2026-07-15): native D1 feature, not a Monday-mirrored board — quantity-
// based stock across bodegas + vendedores carrying samples. Acceso gateado por equipo
// (shared/boardAccess.ts, board_key 'inventario') — igual que el nav, pero aquí también
// protege la API (2026-07-18: antes de esto cualquier rol autenticado podía pegarle
// directo al endpoint sin pasar por el sidebar).
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import type {
  CreateMovementRequest, CreateMovementResponse, CreateWarehouseRequest, CreateWarehouseResponse,
} from '../../shared/inventory';
import { listWarehouses, listMovements, listStock, createMovement, createWarehouse, InventoryError } from '../lib/inventory';
import { getBoardAccess } from '../lib/boardAccess';
import { jsonStatus } from '../lib/http';

async function requireInventoryAccess(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const viewer = c.get('viewer');
  const access = await getBoardAccess(c.env, viewer.role);
  if (!access.includes('inventario')) return c.json({ error: 'forbidden' }, 403);
  return null;
}

export function inventarioRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/inventario/warehouses', async c => {
    const denied = await requireInventoryAccess(c);
    if (denied) return denied;
    return c.json(await listWarehouses(c.env));
  });

  app.post('/api/inventario/warehouses', async c => {
    const denied = await requireInventoryAccess(c);
    if (denied) return denied;
    const body = await c.req.json<CreateWarehouseRequest>();
    try {
      const warehouse = await createWarehouse(c.env, body);
      return c.json({ ok: true, id: warehouse.id } satisfies CreateWarehouseResponse);
    } catch (err) {
      if (err instanceof InventoryError) {
        return jsonStatus({ ok: false, error: err.message } satisfies CreateWarehouseResponse, err.status);
      }
      return jsonStatus({ ok: false, error: 'internal error' } satisfies CreateWarehouseResponse, 500);
    }
  });

  app.get('/api/inventario/stock', async c => {
    const denied = await requireInventoryAccess(c);
    if (denied) return denied;
    return c.json(await listStock(c.env));
  });

  app.get('/api/inventario/movements', async c => {
    const denied = await requireInventoryAccess(c);
    if (denied) return denied;
    return c.json(await listMovements(c.env));
  });

  app.post('/api/inventario/movements', async c => {
    const denied = await requireInventoryAccess(c);
    if (denied) return denied;
    const body = await c.req.json<CreateMovementRequest>();
    try {
      const movement = await createMovement(c.env, body);
      return c.json({ ok: true, id: movement.id } satisfies CreateMovementResponse);
    } catch (err) {
      if (err instanceof InventoryError) {
        return jsonStatus({ ok: false, error: err.message } satisfies CreateMovementResponse, err.status);
      }
      return jsonStatus({ ok: false, error: 'internal error' } satisfies CreateMovementResponse, 500);
    }
  });
}
