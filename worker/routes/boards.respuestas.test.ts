// Responder en un hilo (Jorge, 2026-09-25): el `parentId` lo manda el cliente,
// así que la ruta solo escribe si ese comentario está en el feed que el viewer
// ya puede ver (ubicarComentario). Sin eso, cualquier id de update de todo
// Monday recibiría la respuesta — mismo hueco que ya cerró el adjunto.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { boardRoutes } from './boards';
import { postUpdate } from '../lib/nativeUpdates';
import { ubicarComentario } from '../lib/updatesLineas';
import { notifyItemComment } from '../lib/updateNotify';
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
  ubicarComentario: vi.fn(),
}));
vi.mock('../lib/nativeUpdates', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/nativeUpdates')>(),
  postUpdate: vi.fn(async () => ({ id: '777', text_body: 'ok', created_at: '2026-09-25T00:00:00Z', creator: { name: 'Efrain Ponce Salinas' }, assets: [] })),
}));
vi.mock('../lib/updateNotify', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/updateNotify')>(),
  notifyItemComment: vi.fn(async () => undefined),
}));
vi.mock('../lib/rosterCache', () => ({ cachedFetchUsers: vi.fn(async () => []) }));

const viewer: Identity = { email: 'angel@cmp.test', nombre: 'Angel Omar Canto Cural', monday_user_id: 7, role: 'vendedor', active: true };

async function post(body: unknown) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => { c.set('viewer', viewer); await next(); });
  boardRoutes(app);
  return app.fetch(new Request('https://portal.test/api/boards/oportunidades/items/463/updates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), {} as Env, { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext);
}

beforeEach(() => vi.clearAllMocks());

describe('POST /updates con parentId (responder en un hilo)', () => {
  it('un comentario fuera del feed del viewer → 404, y NO se escribe nada en Monday', async () => {
    vi.mocked(ubicarComentario).mockResolvedValue(null);
    const res = await post({ body: 'hola', parentId: '999' });
    expect(res.status).toBe(404);
    expect(postUpdate).not.toHaveBeenCalled();
    expect(notifyItemComment).not.toHaveBeenCalled();
  });

  it('un parentId que no es numérico → 404 sin buscar ni escribir', async () => {
    const res = await post({ body: 'hola', parentId: '1 OR 1=1' });
    expect(res.status).toBe(404);
    expect(ubicarComentario).not.toHaveBeenCalled();
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it('comentario sobre una LÍNEA: la respuesta va al subitem donde vive, como hilo, con firma', async () => {
    vi.mocked(ubicarComentario).mockResolvedValue({ boardId: BOARDS.oportunidades_sub.id, itemId: 5001 });
    const res = await post({ body: 'Va en negro', parentId: '321' });
    expect(res.status).toBe(200);
    expect(ubicarComentario).toHaveBeenCalledWith(expect.anything(), 'oportunidades', ROW, viewer, '321');
    const [, boardId, itemId, body, , , parentId] = vi.mocked(postUpdate).mock.calls[0];
    expect([boardId, itemId, parentId]).toEqual([BOARDS.oportunidades_sub.id, 5001, '321']);
    expect(body).toBe('Va en negro\n\n— Angel Omar Canto Cural vía Portal CMP');
    // El aviso sigue siendo sobre la oportunidad que se tiene abierta.
    expect(notifyItemComment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itemId: 463, updateId: '777' }));
  });

  it('sin parentId: comentario nuevo en el item, como siempre (no busca hilo)', async () => {
    const res = await post({ body: 'Comentario nuevo' });
    expect(res.status).toBe(200);
    expect(ubicarComentario).not.toHaveBeenCalled();
    const [, boardId, itemId, , , , parentId] = vi.mocked(postUpdate).mock.calls[0];
    expect([boardId, itemId, parentId]).toEqual([BOARDS.oportunidades.id, 463, undefined]);
  });
});
