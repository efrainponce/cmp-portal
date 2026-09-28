// Reacciones (fase 3, Jorge 2026-09-25): solo D1, y solo sobre comentarios o
// respuestas del feed que el viewer ya ve — el updateId lo manda el cliente.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { boardRoutes } from './boards';
import { estaEnFeed } from '../lib/updatesLineas';
import { ponerReaccion } from '../lib/reacciones';
import { getItem } from '../lib/dal';
import { BOARDS } from '../../shared/boards';

const ROW: MirrorItem = {
  board_id: BOARDS.oportunidades.id, item_id: 463, parent_item_id: null, name: 'OPP-0463', group_id: null,
  vendedor_ids: '[7]', monday_updated_at: null, synced_at: '2026-09-25T00:00:00Z', content_hash: '', columns: '[]',
};

vi.mock('../lib/dal', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/dal')>(),
  getItem: vi.fn(async () => ROW),
}));
vi.mock('../lib/updatesLineas', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/updatesLineas')>(),
  estaEnFeed: vi.fn(async () => true),
}));
vi.mock('../lib/reacciones', () => ({ ponerReaccion: vi.fn(async () => undefined), reaccionesDe: vi.fn(async () => new Map()) }));

const viewer: Identity = { email: 'angel@cmp.test', nombre: 'Angel Omar Canto Cural', monday_user_id: 7, role: 'vendedor', active: true };

async function reaccionar(updateId: string, body: unknown) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => { c.set('viewer', viewer); await next(); });
  boardRoutes(app);
  return app.fetch(new Request(`https://portal.test/api/boards/oportunidades/items/463/updates/${updateId}/reacciones`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), {} as Env);
}

beforeEach(() => vi.clearAllMocks());

describe('POST /updates/:updateId/reacciones', () => {
  it('pone la reacción del viewer, con su nombre y el item abierto', async () => {
    const res = await reaccionar('901', { tipo: 'heart', activa: true });
    expect(res.status).toBe(200);
    expect(estaEnFeed).toHaveBeenCalledWith(expect.anything(), 'oportunidades', ROW, viewer, '901');
    expect(ponerReaccion).toHaveBeenCalledWith(expect.anything(), {
      updateId: '901', itemId: 463, email: 'angel@cmp.test', nombre: 'Angel Omar Canto Cural', tipo: 'heart', activa: true,
    });
  });

  it('quitarla manda activa:false (estado final, no alternar)', async () => {
    await reaccionar('901', { tipo: 'heart', activa: false });
    expect(vi.mocked(ponerReaccion).mock.calls[0][1]).toMatchObject({ activa: false });
  });

  it('un comentario fuera del feed del viewer → 404 y no se guarda nada', async () => {
    vi.mocked(estaEnFeed).mockResolvedValueOnce(false);
    const res = await reaccionar('999', { tipo: '+1', activa: true });
    expect(res.status).toBe(404);
    expect(ponerReaccion).not.toHaveBeenCalled();
  });

  it('un item que el viewer no puede leer → 404 sin buscar en Monday', async () => {
    vi.mocked(getItem).mockResolvedValueOnce(null);
    const res = await reaccionar('901', { tipo: '+1', activa: true });
    expect(res.status).toBe(404);
    expect(estaEnFeed).not.toHaveBeenCalled();
    expect(ponerReaccion).not.toHaveBeenCalled();
  });

  it.each([
    [{ tipo: '🔥', activa: true }],
    [{ tipo: 'fire', activa: true }],
    [{ tipo: '+1' }],
    [{ tipo: '+1', activa: 'si' }],
  ])('reacción inválida %j → 400 sin tocar nada', async (body) => {
    const res = await reaccionar('901', body);
    expect(res.status).toBe(400);
    expect(ponerReaccion).not.toHaveBeenCalled();
  });

  it('un updateId no numérico → 404', async () => {
    const res = await reaccionar('abc', { tipo: '+1', activa: true });
    expect(res.status).toBe(404);
    expect(ponerReaccion).not.toHaveBeenCalled();
  });
});
