import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { identity } from './identity';
import { adminRoutes } from '../routes/admin';
import { puedeVerUtilidades, puedeConsultarDireccion } from '../../shared/visibility';
import { upsertIdentity, createNativeIdentity } from '../lib/dal';

vi.mock('../lib/zonas', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/zonas')>(),
  readableUserIds: vi.fn(async () => []),
  hiddenOwnerIdsFor: vi.fn(async () => []),
}));
vi.mock('../lib/dal', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/dal')>(),
  getIdentityByEmail: vi.fn(async () => ({ monday_user_id: 1, role: 'admin', active: true })),
  upsertIdentity: vi.fn(async () => undefined),
  createNativeIdentity: vi.fn(),
}));

const CEO = 'efrain.ponce@mexicanadeproteccion.com';
const PAM = 'compras@mexicanadeproteccion.com';
const JORGE = 'webcmp@mexicanadeproteccion.com';
const OTHER = 'admin@example.test';
const SELLER = 'seller@example.test';
const person = (email: string): Identity => ({ email, monday_user_id: 1, role: email === SELLER ? 'vendedor' : 'admin', active: true });

async function request(actor: string, target?: string, path = '/check', method = 'GET', body?: unknown) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => { c.set('email', actor); await next(); });
  app.use('*', identity);
  app.get('/check', c => c.json({
    email: c.get('viewer').email,
    profits: puedeVerUtilidades(c.get('viewer').email),
    executive: puedeConsultarDireccion(c.get('viewer').email),
  }));
  adminRoutes(app);
  const DB = { prepare: () => ({ bind: (email: string) => ({ first: async () => person(email) }) }) };
  return app.fetch(new Request(`https://portal.test${path}`, {
    method, headers: { ...(target ? { 'X-Impersonate-Email': target } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), { DB } as unknown as Env);
}

beforeEach(() => vi.clearAllMocks());

describe('identidad autenticada limita la suplantación', () => {
  it.each([[PAM, CEO], [JORGE, CEO], [OTHER, CEO], [PAM, JORGE], [OTHER, PAM]])(
    '%s no adquiere permisos de %s', async (actor, target) => {
      expect((await request(actor, target)).status).toBe(403);
    },
  );
  it.each([[CEO, PAM], [CEO, JORGE], [PAM, SELLER], [OTHER, SELLER]])(
    '%s conserva ver-como permitido para %s', async (actor, target) => {
      const res = await request(actor, target);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ email: target, profits: false });
    },
  );
  it('un vendedor no puede suplantar a dirección', async () => {
    const res = await request(SELLER, CEO);
    expect(await res.json()).toMatchObject({ email: SELLER, profits: false, executive: false });
  });
  it('dirección conserva su acceso normal', async () => {
    expect(await (await request(CEO)).json()).toMatchObject({ profits: true, executive: true });
  });
});

describe('administración de identidades no permite tomar una cuenta privilegiada', () => {
  it.each(['POST', 'PUT'])('%s bloquea cambiar/registrar el teléfono de dirección', async method => {
    const path = '/api/admin/identities' + (method === 'PUT' ? `/${CEO}` : '');
    const res = await request(PAM, undefined, path, method, { email: CEO, nombre: 'CEO', phone: '5555555555' });
    expect(res.status).toBe(403);
    expect(upsertIdentity).not.toHaveBeenCalled();
    expect(createNativeIdentity).not.toHaveBeenCalled();
  });
  it('usa el actor real al administrar, incluso al suplantar otro admin', async () => {
    const res = await request(OTHER, CEO, `/api/admin/identities/${CEO}`, 'PUT', { phone: '5555555555' });
    expect(res.status).toBe(403);
    expect(upsertIdentity).not.toHaveBeenCalled();
  });
  it('dirección conserva la edición de su teléfono', async () => {
    const res = await request(CEO, undefined, `/api/admin/identities/${CEO}`, 'PUT', { phone: '5555555555' });
    expect(res.status).toBe(200);
    expect(upsertIdentity).toHaveBeenCalledOnce();
  });
});
