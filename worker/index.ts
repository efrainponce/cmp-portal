// worker/index.ts — Hono wiring. Webhook routes bypass access/identity; everything else
// under /api/* requires both. Non-/api requests fall through to the static asset bundle.
// Las rutas viven en worker/routes/* (boards genéricos, oportunidades, admin,
// inventario) + worker/sync, worker/wa y worker/assistant.
import { Hono } from 'hono';
import type { Env } from './env';
import { access } from './mw/access';
import { identity } from './mw/identity';
import { syncRoutes, reconcileAll } from './sync';
import { BOARDS, type BoardSlug } from '../shared/boards';
import { waRoutes } from './wa/routes';
import { assistantRoutes } from './assistant/routes';
import { boardRoutes } from './routes/boards';
import { adminRoutes } from './routes/admin';
import { oportunidadRoutes } from './routes/oportunidades';
import { inventarioRoutes } from './routes/inventario';
import { notificationRoutes } from './routes/notifications';
import { documentRoutes } from './routes/documents';
import { flushOutbox } from './lib/outbox';
import { checkErrorsAndAlert } from './lib/errorAlerts';
import { logSync } from './sync/log';
import { jsonStatus } from './lib/http';

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
notificationRoutes(app);
documentRoutes(app);

app.all('*', c => c.env.ASSETS.fetch(c.req.raw));

// Red de seguridad para excepciones no capturadas por los try/catch específicos que ya
// existen por ruta (AutomationError, QuoteVersionError, etc. — esos nunca llegan aquí,
// se resuelven donde ya se resuelven). Deja rastro en sync_log para el cron de alertas
// de abajo; sin esto un bug real no dejaba ningún rastro.
app.onError(async (err, c) => {
  await logSync(c.env, 'http', null, null, false, `${c.req.method} ${c.req.path}: ${err}`);
  return jsonStatus({ error: 'internal error' }, 500);
});

// Los 8 boards no caben en una sola invocación de reconcile (ver comentario en
// reconcileAll): dos cron triggers a las 3h uno del otro, cada uno con su propio
// grupo. El tercer cron (cada 15 min) no es un board group — revisa sync_log y avisa
// por WhatsApp (worker/lib/errorAlerts.ts) — wrangler.jsonc debe declarar exactamente
// estos tres strings de cron.
const ALERT_CRON = '*/15 * * * *';
const CRON_GROUPS: Record<string, BoardSlug[]> = {
  '0 */6 * * *': ['oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub'],
  '0 3,9,15,21 * * *': ['productos', 'instituciones', 'contactos', 'proveedores'],
};

export default {
  fetch: app.fetch,
  scheduled: async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    if (controller.cron === ALERT_CRON) {
      ctx.waitUntil(checkErrorsAndAlert(env));
      return;
    }
    const slugs = CRON_GROUPS[controller.cron] ?? (Object.keys(BOARDS) as BoardSlug[]);
    ctx.waitUntil(reconcileAll(env, slugs).then(() => flushOutbox(env)));
  },
};
