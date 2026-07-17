// worker/index.ts — Hono wiring. Webhook routes bypass access/identity; everything else
// under /api/* requires both. Non-/api requests fall through to the static asset bundle.
// Las rutas viven en worker/routes/* (boards genéricos, oportunidades, admin,
// inventario) + worker/sync, worker/wa y worker/assistant.
import { Hono } from 'hono';
import type { Env } from './env';
import { access } from './mw/access';
import { identity } from './mw/identity';
import { syncRoutes, reconcileAll } from './sync';
import { waRoutes } from './wa/routes';
import { assistantRoutes } from './assistant/routes';
import { boardRoutes } from './routes/boards';
import { adminRoutes } from './routes/admin';
import { oportunidadRoutes } from './routes/oportunidades';
import { inventarioRoutes } from './routes/inventario';
import { flushOutbox } from './lib/outbox';

const app = new Hono<{ Bindings: Env }>();

// Webhook routes registered first so they never pass through access/identity.
syncRoutes(app);
waRoutes(app);

app.use('/api/*', access, identity);

// Responses are scoped per viewer (see dal.ts scopeFor) and, since admin
// impersonation lets one browser act as several identities in a session,
// must never be cached/replayed across viewers by the browser's own HTTP
// cache — that would silently hand one viewer's data to the next.
app.use('/api/*', async (c, next) => {
  await next();
  // Don't clobber a route's own explicit Cache-Control (e.g. the signed PDF proxy).
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'private, no-store');
});

assistantRoutes(app);
boardRoutes(app);
adminRoutes(app);
oportunidadRoutes(app);
inventarioRoutes(app);

app.all('*', c => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(reconcileAll(env).then(() => flushOutbox(env)));
  },
};
