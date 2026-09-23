// "Validar costeo" (confirmarCosteo) — qué va en el camino del botón y qué no.
//
// El botón promediaba 8.3 s (ux_event, 14 días al 2026-09-23). Lo que el
// botón NO debe esperar: los avisos (un envío a Meta por destinatario, en
// serie) y el update de bitácora en Monday. Lo que SÍ: el write de la etapa
// queda en el outbox con skipFlush para que la RUTA lo mande a Monday en
// paralelo con la relectura de las líneas y lo espere antes de responder.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { confirmarCosteo } from './costeo';
import { getItem, childrenOf } from './dal';
import { submitWrite } from './outbox';
import { emitStageNotification } from './notify';
import { postUpdate } from './nativeUpdates';

vi.mock('./dal', async importOriginal => ({
  ...await importOriginal<typeof import('./dal')>(), getItem: vi.fn(), childrenOf: vi.fn(),
}));
vi.mock('./outbox', async importOriginal => ({
  ...await importOriginal<typeof import('./outbox')>(), submitWrite: vi.fn(),
}));
vi.mock('./notify', async importOriginal => ({
  ...await importOriginal<typeof import('./notify')>(), emitStageNotification: vi.fn(),
}));
vi.mock('./nativeUpdates', () => ({ postUpdate: vi.fn(async () => ({ id: '1' })) }));

const viewer: Identity = { email: 'admin@example.test', role: 'admin', monday_user_id: 1, active: true };
const mirror = (id: number, columns: unknown[]): MirrorItem => ({
  board_id: 1, item_id: id, parent_item_id: null, name: `I${id}`, group_id: null,
  vendedor_ids: '[7]', monday_updated_at: null, synced_at: '', content_hash: '',
  columns: JSON.stringify(columns),
});
const opp = mirror(10, [{ id: 'deal_stage', type: 'status', text: 'Costeo en validación', value: '{"index":7}' }]);
const linea = mirror(11, [{ id: 'numeric_mkzneg3d', type: 'numeric', text: '150', value: '"150"' }]);
const env = {} as Env;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getItem).mockResolvedValue(opp);
  vi.mocked(childrenOf).mockResolvedValue([linea]);
  vi.mocked(submitWrite).mockResolvedValue({ ok: true, pending: true, outboxId: 1 });
});

describe('confirmarCosteo', () => {
  it('deja la etapa en el outbox SIN flush propio (lo manda la ruta)', async () => {
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    const res = await confirmarCosteo(env, ctx, 10, viewer);
    expect(res).toEqual({ ok: true });
    expect(submitWrite).toHaveBeenCalledWith(
      env, ctx, 'oportunidades', 10, expect.objectContaining({ deal_stage: expect.any(String) }), viewer,
      { trusted: true, skipFlush: true },
    );
  });

  it('responde sin esperar los avisos ni el update de bitácora', async () => {
    // Un aviso que nunca termina: si confirmarCosteo lo esperara, este test
    // se colgaría en vez de resolver.
    vi.mocked(emitStageNotification).mockReturnValue(new Promise<void>(() => {}));
    const pendientes: Promise<unknown>[] = [];
    const ctx = { waitUntil: vi.fn((p: Promise<unknown>) => { pendientes.push(p); }), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

    const res = await confirmarCosteo(env, ctx, 10, viewer);

    expect(res.ok).toBe(true);
    expect(emitStageNotification).toHaveBeenCalledTimes(1);
    expect(postUpdate).toHaveBeenCalledTimes(1);
    // Los dos van a waitUntil (aviso + bitácora).
    expect(pendientes).toHaveLength(2);
  });

  it('una línea sin precio no escribe nada ni avisa', async () => {
    vi.mocked(childrenOf).mockResolvedValue([mirror(12, [])]);
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    const res = await confirmarCosteo(env, ctx, 10, viewer);
    expect(res.ok).toBe(false);
    expect(submitWrite).not.toHaveBeenCalled();
    expect(emitStageNotification).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
});
