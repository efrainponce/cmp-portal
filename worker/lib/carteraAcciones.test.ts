import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { cerrarOportunidad } from './carteraAcciones';
import { runTool } from './assistantTools';
import { getItem } from './dal';
import { submitWrite, OutboxError } from './outbox';
import { postUpdate } from './nativeUpdates';

vi.mock('./dal', async importOriginal => ({
  ...await importOriginal<typeof import('./dal')>(), getItem: vi.fn(),
}));
vi.mock('./outbox', async importOriginal => ({
  ...await importOriginal<typeof import('./outbox')>(), submitWrite: vi.fn(),
}));
vi.mock('./nativeUpdates', () => ({ postUpdate: vi.fn(async () => ({ id: '99' })) }));

const viewer: Identity = { email: 'sales@example.test', role: 'vendedor', monday_user_id: 1, active: true };
const item: MirrorItem = {
  board_id: 1, item_id: 123, parent_item_id: null, name: 'Prueba', group_id: null,
  vendedor_ids: '[1]', monday_updated_at: null, synced_at: '', content_hash: '',
  columns: JSON.stringify([{ id: 'deal_stage', text: 'Nueva oportunidad', value: '{"index":4}' }]),
};
const first = vi.fn();
const bind = vi.fn(() => ({ first }));
const prepare = vi.fn(() => ({ bind }));
const env = { DB: { prepare } } as unknown as Env;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getItem).mockResolvedValue(item);
  vi.mocked(submitWrite).mockResolvedValue({ ok: true, pending: true, outboxId: 771 });
  first.mockResolvedValue({ status: 'confirmed' });
});

describe('el cierre reporta el resultado de SU escritura', () => {
  it('consulta el id exacto aceptado por el outbox', async () => {
    await cerrarOportunidad(env, viewer, 123, 'cancelada', '');
    expect(prepare).toHaveBeenCalledWith('SELECT status FROM outbox WHERE id = ?');
    expect(bind).toHaveBeenCalledWith(771);
    expect(getItem).toHaveBeenCalledWith(env, 'oportunidades', 123, viewer, 'own');
  });
  it.each(['pending', 'sent', 'conflict', 'failed'])('%s nunca responde que ya quedó en Monday', async status => {
    first.mockResolvedValue({ status });
    const result = await runTool(env, viewer, 'cerrar_oportunidad', { item_id: 123, cierre: 'cancelada' });
    expect(result.content).not.toContain('quedó como');
    expect(result.content).not.toContain('✅');
    expect(postUpdate).not.toHaveBeenCalled();
  });
  it('confirmed anuncia éxito y conserva el motivo en Monday', async () => {
    const result = await runTool(env, viewer, 'cerrar_oportunidad', { item_id: 123, cierre: 'cancelada', motivo: 'El cliente canceló' });
    expect(result.content).toContain('quedó como *Cancelada* en Monday');
    expect(postUpdate).toHaveBeenCalledWith(expect.anything(), expect.anything(), 123, expect.stringContaining('El cliente canceló'), [], expect.anything());
  });
  it('una escritura nativa confirma el portal sin consultar Monday/outbox', async () => {
    vi.mocked(submitWrite).mockResolvedValue({ ok: true, pending: false });
    const result = await runTool(env, viewer, 'cerrar_oportunidad', { item_id: 123, cierre: 'cancelada' });
    expect(result.content).toContain('en el portal');
    expect(result.content).not.toContain('en Monday');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('si el estado ya no está disponible tampoco inventa confirmación', async () => {
    first.mockResolvedValue(null);
    const result = await runTool(env, viewer, 'cerrar_oportunidad', { item_id: 123, cierre: 'cancelada' });
    expect(result.content).toContain('pendiente');
    expect(postUpdate).not.toHaveBeenCalled();
  });
  it('un rechazo inicial de permisos nunca consulta ni anuncia éxito', async () => {
    vi.mocked(submitWrite).mockRejectedValue(new OutboxError(403, 'forbidden'));
    const result = await runTool(env, viewer, 'cerrar_oportunidad', { item_id: 123, cierre: 'cancelada' });
    expect(result.isError).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(postUpdate).not.toHaveBeenCalled();
  });
  it('conserva el motivo pendiente sin afirmar que la oportunidad ya se cerró', async () => {
    first.mockResolvedValue({ status: 'pending' });
    await cerrarOportunidad(env, viewer, 123, 'cancelada', 'El cliente canceló');
    expect(postUpdate).toHaveBeenCalledWith(expect.anything(), expect.anything(), 123,
      expect.stringContaining('solicitó el cambio a Cancelada (sin confirmar en Monday)'), [], expect.anything());
    expect(vi.mocked(postUpdate).mock.calls[0][3]).toContain('El cliente canceló');
  });
});
