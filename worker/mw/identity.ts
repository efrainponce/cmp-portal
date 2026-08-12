// worker/mw/identity.ts — email (from mw/access) -> D1 identity row -> c.get('viewer').
// Admins may impersonate another active identity by sending X-Impersonate-Email:
// c.get('viewer') becomes the target so every downstream role/scope check (DAL,
// visibility, outbox) sees exactly what that user would see, while c.get('impersonatedBy')
// keeps the real admin around for the /api/me banner and the audit log line below.
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { readableUserIds, hiddenOwnerIdsFor } from '../lib/zonas';

declare module 'hono' {
  interface ContextVariableMap {
    viewer: Identity;
    impersonatedBy: Identity | null;
  }
}

export const identity: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const email = c.get('email');
  const fetchIdentity = (addr: string) =>
    c.env.DB.prepare('SELECT * FROM identity WHERE email = ? AND active = 1').bind(addr).first<Identity>();

  const row = await fetchIdentity(email);
  if (!row) return c.json({ error: 'pide acceso', email }, 403);

  // Zona: se resuelve UNA vez por request y viaja en el viewer, para que el DAL no
  // le pegue a D1 en cada getItem. Ver worker/lib/zonas.ts — solo ensancha lectura.
  const withScope = async (identity: Identity): Promise<Identity> => ({
    ...identity,
    scope_user_ids: await readableUserIds(c.env, identity),
    hidden_owner_ids: await hiddenOwnerIdsFor(c.env, identity),
  });

  const impersonateEmail = c.req.header('X-Impersonate-Email');
  if (impersonateEmail && row.role === 'admin' && impersonateEmail !== email) {
    const target = await fetchIdentity(impersonateEmail);
    if (!target) return c.json({ error: 'usuario a impersonar no encontrado o inactivo' }, 400);
    console.log(`[impersonate] ${row.email} -> ${target.email} ${c.req.method} ${c.req.path}`);
    // El scope se calcula sobre el SUPLANTADO: "ver como" debe mostrar la zona que
    // ese usuario ve, no la del admin.
    c.set('viewer', await withScope(target));
    c.set('impersonatedBy', row);
    return next();
  }

  c.set('viewer', await withScope(row));
  c.set('impersonatedBy', null);
  return next();
};
