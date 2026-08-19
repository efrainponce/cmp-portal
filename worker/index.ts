// worker/index.ts — Hono wiring. Webhook routes bypass access/identity; everything else
// under /api/* requires both. Non-/api requests fall through to the static asset bundle.
// Las rutas viven en worker/routes/* (boards genéricos, oportunidades, admin,
// inventario) + worker/sync, worker/wa y worker/assistant.
import { Hono } from 'hono';
import type { Env } from './env';
import { access } from './mw/access';
import { identity } from './mw/identity';
import { syncRoutes, reconcileAll, deltaSync } from './sync';
import { BOARDS, type BoardSlug } from '../shared/boards';
import { waRoutes } from './wa/routes';
import { assistantRoutes } from './assistant/routes';
import { boardRoutes } from './routes/boards';
import { adminRoutes } from './routes/admin';
import { oportunidadRoutes } from './routes/oportunidades';
import { inventarioRoutes } from './routes/inventario';
import { notificationRoutes } from './routes/notifications';
import { documentRoutes } from './routes/documents';
import { homeRoutes } from './routes/home';
import { anuncioRoutes } from './routes/anuncios';
import { telemetryRoutes } from './routes/telemetry';
import { flushOutbox } from './lib/outbox';
import { checkErrorsAndAlert } from './lib/errorAlerts';
import { backupD1ToR2 } from './lib/backup';
import { purgeUxEvents } from './lib/telemetry';
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
homeRoutes(app);
anuncioRoutes(app);
telemetryRoutes(app);

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
// reconcileBoard): dos cron triggers a las 12h uno del otro, cada uno con su propio
// grupo — bajado de 6h a 12h el 2026-08-11 porque el delta sync (abajo) ya cubre
// lo reciente en minutos, así que el full reconcile es ahora red de seguridad, no
// la única fuente de verdad; corre la mitad de veces = la mitad de calls a Monday.
// Productos se salió de ese reparto y tiene su propio cron de 10 min (ver abajo).
// Otro cron (cada 15 min) hace dos cosas SIN ser un board group: revisa
// sync_log y avisa por WhatsApp (worker/lib/errorAlerts.ts), y corre el delta sync
// (worker/sync/delta.ts). El último (semanal, 3am UTC) exporta el mirror D1 completo
// a R2 (worker/lib/backup.ts) — retención larga más allá de los 30 días de D1 Time
// Travel, no recovery del día a día. wrangler.jsonc debe declarar exactamente estos
// cinco strings de cron. OJO con el día-de-semana de Cloudflare: rechaza "0"
// (con "0" el deploy sube el Worker pero el PUT de schedules falla en silencio,
// el Action queda rojo y el cron no se registra — 2026-08-12/13) y su numeración
// es 1=domingo…7=SÁBADO, no la de Unix: "0 3 * * 7" disparó en sábado
// 2026-08-15T03:00 UTC (verificado en vivo). El backup corre sábados — da igual
// el día mientras sea semanal.
const ALERT_CRON = '*/15 * * * *';
const BACKUP_CRON = '0 3 * * *';
const CRON_GROUPS: Record<string, BoardSlug[]> = {
  '0 0,12 * * *': ['oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub'],
  '0 6,18 * * *': ['instituciones', 'contactos', 'proveedores'],
  // Productos aparte y cada 10 min (Efraín, 2026-08-19, urgente): el catálogo no
  // lo edita gente en Monday, lo escribe el sync de Airtable, y Compras se queda
  // esperando a que el costo/las tallas que acaba de capturar aparezcan en el
  // portal ("ya tengo como 15 min que subí las tallas y precio a Airtable").
  // Sale barato porque reconcileAll pregunta primero el updated_at del board y
  // solo pagina (14 páginas, ~1335 productos) cuando de verdad se movió.
  // Cubre lo que el delta sync no: los writes del bot de Airtable llegan en
  // ráfaga y el delta capea 50 refetches por corrida.
  '*/10 * * * *': ['productos'],
};

export default {
  fetch: app.fetch,
  scheduled: async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    if (controller.cron === ALERT_CRON) {
      ctx.waitUntil(Promise.all([checkErrorsAndAlert(env), deltaSync(env)]));
      return;
    }
    if (controller.cron === BACKUP_CRON) {
      // La poda de ux_event (90 días) se cuelga aquí y no del cron de 15 min:
      // es un DELETE por rango que no tiene por qué correr 96 veces al día.
      ctx.waitUntil(Promise.all([backupD1ToR2(env), purgeUxEvents(env)]));
      return;
    }
    const slugs = CRON_GROUPS[controller.cron] ?? (Object.keys(BOARDS) as BoardSlug[]);
    ctx.waitUntil(reconcileAll(env, slugs).then(() => flushOutbox(env)));
  },
};
