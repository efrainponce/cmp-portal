// worker/mw/identity.ts — email (from mw/access) -> D1 identity row -> c.get('viewer').
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';

declare module 'hono' {
  interface ContextVariableMap {
    viewer: Identity;
  }
}

export const identity: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const email = c.get('email');
  const row = await c.env.DB
    .prepare('SELECT * FROM identity WHERE email = ? AND active = 1')
    .bind(email)
    .first<Identity>();
  if (!row) return c.json({ error: 'pide acceso', email }, 403);
  c.set('viewer', row);
  return next();
};
