// Reacomodo de líneas (asa ⠿): el de la OC (Compras/admin, desde 2026-08-25) y
// el de la grid de Cotización de la Oportunidad (Jorge, 2026-09-28). Los dos
// guardan en item_order con la misma lógica (guardarOrdenLineas).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { oportunidadRoutes } from './oportunidades';
import { getItem, childrenOf } from '../lib/dal';
import { setManualOrder } from '../lib/itemOrder';
import { BOARDS } from '../../shared/boards';

const padre = (board: 'oportunidades' | 'proyectos', id: number): MirrorItem => ({
  board_id: BOARDS[board].id, item_id: id, parent_item_id: null, name: 'x', group_id: null,
  vendedor_ids: '[7]', monday_updated_at: null, synced_at: '', content_hash: '', columns: '[]',
});
const hijo = (id: number) => ({ ...padre('oportunidades', id), parent_item_id: 1 });

vi.mock('../lib/dal', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/dal')>(),
  getItem: vi.fn(),
  childrenOf: vi.fn(async () => [hijo(11), hijo(12), hijo(13)]),
}));
vi.mock('../lib/itemOrder', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/itemOrder')>(),
  setManualOrder: vi.fn(async () => undefined),
}));

const vendedor: Identity = { email: 'angel@cmp.test', nombre: 'Angel', monday_user_id: 7, role: 'vendedor', active: true };

async function put(path: string, body: unknown, viewer = vendedor) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => { c.set('viewer', viewer); await next(); });
  oportunidadRoutes(app);
  return app.fetch(new Request(`https://portal.test${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), {} as Env);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getItem).mockImplementation(async (_env, slug, id) => padre(slug as 'oportunidades' | 'proyectos', id));
});

describe('PUT /api/oportunidades/:id/orden-lineas', () => {
  it('el vendedor dueño reacomoda todas las líneas; se guarda en el board de líneas de oportunidad', async () => {
    const res = await put('/api/oportunidades/1/orden-lineas', { ids: ['13', '11', '12'] });
    expect(res.status).toBe(200);
    expect(getItem).toHaveBeenCalledWith(expect.anything(), 'oportunidades', 1, vendedor, 'own');
    expect(setManualOrder).toHaveBeenCalledWith(expect.anything(), BOARDS.oportunidades_sub.id, 1, [13, 11, 12]);
  });

  it('sin permiso de escritura sobre esa oportunidad → 404 y no se guarda', async () => {
    vi.mocked(getItem).mockResolvedValueOnce(null);
    const res = await put('/api/oportunidades/1/orden-lineas', { ids: ['12', '11'] });
    expect(res.status).toBe(404);
    expect(setManualOrder).not.toHaveBeenCalled();
  });

  it.each([
    [{ ids: ['11', '99'] }, 'línea ajena a la oportunidad'],
    [{ ids: ['11', '11'] }, 'ids repetidos'],
    [{ ids: [] }, 'ids inválidos'],
    [{ ids: ['abc'] }, 'ids inválidos'],
  ])('%j → 400 (%s) sin guardar', async (body, error) => {
    const res = await put('/api/oportunidades/1/orden-lineas', body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error });
    expect(setManualOrder).not.toHaveBeenCalled();
  });
});

describe('PUT /api/proyectos/:id/orden-lineas (la OC, sin cambios de comportamiento)', () => {
  it('un vendedor sigue sin poder reacomodar la OC → 403', async () => {
    const res = await put('/api/proyectos/2/orden-lineas', { ids: ['12', '11'] });
    expect(res.status).toBe(403);
    expect(setManualOrder).not.toHaveBeenCalled();
  });

  it('Compras reacomoda SOLO las líneas de una tarjeta: se permutan sus lugares', async () => {
    const compras: Identity = { ...vendedor, role: 'compras' };
    const res = await put('/api/proyectos/2/orden-lineas', { ids: ['13', '11'] }, compras);
    expect(res.status).toBe(200);
    expect(setManualOrder).toHaveBeenCalledWith(expect.anything(), BOARDS.proyectos_sub.id, 2, [13, 12, 11]);
  });
});
