// worker/index.ts — Hono wiring. Webhook routes bypass access/identity; everything else
// under /api/* requires both. Non-/api requests fall through to the static asset bundle.
// Las rutas viven en worker/routes/* (boards genéricos, oportunidades, admin,
// inventario) + worker/sync, worker/wa y worker/assistant.
import { Hono } from 'hono';
import type { Env } from './env';
import { access } from './mw/access';
import { identity } from './mw/identity';
import { accionLog } from './mw/accionLog';
import { syncRoutes, reconcileAll, deltaSync, deltaSyncIfStale } from './sync';
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
import { purgeAccionLog } from './lib/accionLog';
import { logSync } from './sync/log';
import { jsonStatus } from './lib/http';

const app = new Hono<{ Bindings: Env }>();

// Webhook routes registered first so they never pass through access/identity.
syncRoutes(app);
waRoutes(app);

app.use('/api/*', access, identity);

// Bitácora de intentos de escritura (worker/lib/accionLog.ts). Después de
// identity porque necesita saber quién es, y antes de las rutas para que
// también atrape lo que ellas rechazan.
app.use('/api/*', accionLog);

// LATIDO del delta sync (worker/sync/delta.ts). El portal no tiene webhooks de
// cambio de columna desde 2026-07-31 (se comían ~80% de la cuota de acciones
// de Monday), así que TODO lo que se edita dentro de Monday o lo que escribe
// cmp-tallas entra al espejo por aquí (o por el cron de 15 min, que es el
// piso). Desde 2026-08-27 colgaba SOLO del poll de la lista — y la lista se
// desmonta al abrir una oportunidad, que es donde compras pasa el día: medido
// en sync_log el 2026-09-01, el latido corrió 1-5 veces por HORA en horario
// laboral, no una por minuto. Ahora cuelga de cualquier GET autenticado (la
// campana poletea cada 12 s aunque estés en el drawer), así que sincroniza
// mientras la gente trabaja. `deltaSyncIfStale` toma un lease en D1: corre
// COMO MUCHO uno cada LATIDO_MS por más gente que esté poleando, y CERO cuando
// nadie usa el portal — una llamada a Monday por intervalo de uso real, no por
// usuario. 30 s (Efraín, 2026-09-02): peor caso ~2,500 llamadas/día, 10 % del
// tope de 25,000. `?fresh=1` (botón "Actualizar") lo ESPERA dentro de su ruta
// en vez de dispararlo aquí de fondo — si no, el de fondo se llevaría el lease
// y el botón contestaría sin haber leído Monday.
const LATIDO_MS = 30_000;
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'GET' && !c.req.query('fresh')) {
    c.executionCtx.waitUntil(deltaSyncIfStale(c.env, LATIDO_MS).catch(() => { /* best-effort */ }));
  }
  await next();
});

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
// reconcileBoard): van repartidos en dos cron triggers, cada uno con su propio
// grupo — el de pipeline cada 12h (bajado de 6h el 2026-08-11 porque el delta
// sync ya cubre lo reciente en minutos, así que el full reconcile es red de
// seguridad y no la única fuente de verdad) y el de catálogos cada 10 min.
// Otro cron (cada 15 min) hace dos cosas SIN ser un board group: revisa
// sync_log y avisa por WhatsApp (worker/lib/errorAlerts.ts), y corre el delta sync
// (worker/sync/delta.ts). El último (semanal, 3am UTC) exporta el mirror D1 completo
// a R2 (worker/lib/backup.ts) — retención larga más allá de los 30 días de D1 Time
// Travel, no recovery del día a día. wrangler.jsonc debe declarar exactamente estos
// cuatro strings de cron. OJO con el día-de-semana de Cloudflare: rechaza "0"
// (con "0" el deploy sube el Worker pero el PUT de schedules falla en silencio,
// el Action queda rojo y el cron no se registra — 2026-08-12/13) y su numeración
// es 1=domingo…7=SÁBADO, no la de Unix: "0 3 * * 7" disparó en sábado
// 2026-08-15T03:00 UTC (verificado en vivo). El backup corre sábados — da igual
// el día mientras sea semanal.
const ALERT_CRON = '*/15 * * * *';
const BACKUP_CRON = '0 3 * * *';
const CRON_GROUPS: Record<string, BoardSlug[]> = {
  '0 0,12 * * *': ['oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub'],
  // Este grupo corría cada 12h ('0 6,18 * * *') y pasó a cada 10 MINUTOS
  // (Efraín, 2026-08-19, urgente): Productos no lo teclea gente en Monday, lo
  // escribe el sync de Airtable, y Compras se quedaba esperando a que el costo y
  // las tallas que acababa de capturar aparecieran en el portal ("ya tengo como
  // 15 min que subí las tallas y precio a Airtable"). Cubre lo que el delta sync
  // no: los writes del bot llegan en ráfaga y el delta capea 50 refetches por
  // corrida.
  //
  // Productos NO se llevó su propio cron porque la cuenta está en Workers Free y
  // el tope es de 5 cron triggers POR CUENTA — ya usados (4 aquí + 1 de
  // janing-portal). Un sexto lo rechaza la API con el código 10072 y, como el
  // deploy del código sí pasa, el Worker queda arriba con los crons viejos: el
  // Action en rojo es el ÚNICO aviso. Con Workers Paid el tope sube a 1000 y
  // entonces sí conviene separarlos por cadencia.
  //
  // Los otros tres se vienen de pasajeros y sale barato: reconcileAll pide UNA
  // vez el updated_at de los cuatro boards y solo pagina el que de verdad se
  // movió (productos 14 páginas, instituciones 32, contactos 8, proveedores 2).
  // La corrida típica es una sola call a Monday, y el peor caso —los cuatro
  // movidos— es exactamente el trabajo que este mismo grupo ya hacía a las 6 y
  // a las 18.
  '*/10 * * * *': ['productos', 'instituciones', 'contactos', 'proveedores'],
};

export default {
  fetch: app.fetch,
  scheduled: async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    if (controller.cron === ALERT_CRON) {
      ctx.waitUntil(Promise.all([checkErrorsAndAlert(env), deltaSync(env)]));
      return;
    }
    if (controller.cron === BACKUP_CRON) {
      // Las podas de ux_event (90 días) y accion_log (400) se cuelgan aquí y
      // no del cron de 15 min: son DELETE por rango que no tienen por qué
      // correr 96 veces al día.
      ctx.waitUntil(Promise.all([backupD1ToR2(env), purgeUxEvents(env), purgeAccionLog(env)]));
      return;
    }
    const slugs = CRON_GROUPS[controller.cron] ?? (Object.keys(BOARDS) as BoardSlug[]);
    ctx.waitUntil(reconcileAll(env, slugs).then(() => flushOutbox(env)));
  },
};
