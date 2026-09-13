import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { atenderComando } from './comandos';
import { pendienteActivo, resolverPendiente } from './estado';
import { cerrarOportunidad, CarteraError } from '../lib/carteraAcciones';
import { aplicarComandoPref } from './preferencias';

vi.mock('./estado', async importOriginal => ({
  ...await importOriginal<typeof import('./estado')>(),
  pendienteActivo: vi.fn(async () => null),
  resolverPendiente: vi.fn(async () => true),
  crearPendiente: vi.fn(async () => undefined),
}));
vi.mock('../lib/carteraAcciones', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/carteraAcciones')>(),
  cerrarOportunidad: vi.fn(),
}));
vi.mock('./preferencias', async importOriginal => ({
  ...await importOriginal<typeof import('./preferencias')>(),
  aplicarComandoPref: vi.fn(async () => ({ respuesta: 'Preferencia actualizada', pendiente: null })),
}));

const env = {} as Env;
const viewer: Identity = { email: 'sales@example.test', role: 'vendedor', monday_user_id: 1, active: true };
const pending = { id: 42, email: viewer.email, tipo: 'cerrar' as const, itemId: 123, datos: { cierre: 'cancelada' }, createdAt: '', expiraAt: '' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pendienteActivo).mockResolvedValue(null);
  vi.mocked(cerrarOportunidad).mockResolvedValue({ etapa: 'Cancelada', folio: 'OPP-123', nombre: 'Prueba', etiqueta: 'OPP-123 Prueba', estado: 'confirmed', destino: 'Monday' });
  vi.mocked(resolverPendiente).mockResolvedValue(true);
});

describe('router y conversación del agente', () => {
  it.each(['sí', 'ok', 'dale', 'confirmo', 'no', 'perdida'])('%s llega al agente si el router no tiene confirmación', async text => {
    expect(await atenderComando(env, viewer, text)).toBeNull();
    expect(cerrarOportunidad).not.toHaveBeenCalled();
  });
  it('una confirmación propia lee el pendiente una sola vez', async () => {
    vi.mocked(pendienteActivo).mockResolvedValue(pending);
    const res = await atenderComando(env, viewer, 'sí');
    expect(res?.respuesta).toContain('Cancelada');
    expect(cerrarOportunidad).toHaveBeenCalledOnce();
    expect(pendienteActivo).toHaveBeenCalledTimes(1);
  });
  it('NO deja la oportunidad intacta', async () => {
    vi.mocked(pendienteActivo).mockResolvedValue(pending);
    await atenderComando(env, viewer, 'no');
    expect(cerrarOportunidad).not.toHaveBeenCalled();
    expect(resolverPendiente).toHaveBeenCalledWith(env, 42, 'no');
  });
  it('el menú conserva prioridad sobre el número de una oportunidad', async () => {
    vi.mocked(pendienteActivo).mockResolvedValue({ ...pending, tipo: 'menu', itemId: null });
    await atenderComando(env, viewer, '3');
    expect(aplicarComandoPref).toHaveBeenCalledWith(env, viewer.email, { tipo: 'opcion', n: 3 });
    expect(cerrarOportunidad).not.toHaveBeenCalled();
  });
  it('una confirmación ya consumida no vuelve a escribir', async () => {
    vi.mocked(pendienteActivo).mockResolvedValue(pending);
    vi.mocked(resolverPendiente).mockResolvedValue(false);
    await atenderComando(env, viewer, 'sí');
    expect(cerrarOportunidad).not.toHaveBeenCalled();
  });
  it('un rechazo de permisos no anuncia cierre exitoso', async () => {
    vi.mocked(pendienteActivo).mockResolvedValue(pending);
    vi.mocked(cerrarOportunidad).mockRejectedValue(new CarteraError(404, 'No encontré esa oportunidad entre las tuyas.'));
    expect((await atenderComando(env, viewer, 'sí'))?.respuesta).toContain('No se pudo');
  });
  it('dos mensajes que leyeron el mismo pendiente ejecutan el cierre una sola vez', async () => {
    vi.mocked(pendienteActivo).mockResolvedValue(pending);
    vi.mocked(resolverPendiente).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const replies = await Promise.all([atenderComando(env, viewer, 'sí'), atenderComando(env, viewer, 'sí')]);
    expect(cerrarOportunidad).toHaveBeenCalledTimes(1);
    expect(replies.filter(r => r?.respuesta.includes('quedó como'))).toHaveLength(1);
  });
  it('un NO que perdió la carrera no promete haber cancelado la acción', async () => {
    vi.mocked(pendienteActivo).mockResolvedValue(pending);
    vi.mocked(resolverPendiente).mockResolvedValue(false);
    const reply = await atenderComando(env, viewer, 'no');
    expect(reply?.respuesta).not.toContain('la dejo como está');
    expect(reply?.atendidoPor).toBe('router:confirmar_ya_atendida');
    expect(cerrarOportunidad).not.toHaveBeenCalled();
  });
});
