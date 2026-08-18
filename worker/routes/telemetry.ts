// worker/routes/telemetry.ts — ingesta de la capa de interacción y el reporte
// agregado. Dos reglas de forma, las dos por presupuesto de subrequests:
//  - POST responde 204 ANTES de tocar D1 (el insert va en waitUntil): la
//    telemetría jamás debe agregarle latencia a la sesión de nadie.
//  - Entra en LOTE, nunca por evento — el cliente acumula (src/lib/telemetry.ts).
import type { Hono } from 'hono';
import type { Env } from '../env';
import { UX_MAX_BATCH } from '../../shared/telemetry';
import { ingestUxEvents } from '../lib/telemetry';
import { buildUxReport } from '../lib/uxMetrics';

// Ventana por defecto del reporte. Cap duro de 180 días: la retención de
// ux_event es de 90 (shared/telemetry.ts), pero activity_log llega más atrás y
// el cruce de atribución es correlacionado — una ventana abierta lo vuelve caro.
const DIAS_DEFAULT = 30;
const DIAS_MAX = 180;

export function telemetryRoutes(app: Hono<{ Bindings: Env }>) {
  app.post('/api/telemetry', async c => {
    const viewer = c.get('viewer');

    // Suplantación: `viewer` es el SUPLANTADO (worker/mw/identity.ts), así que
    // los clics del admin se le atribuirían a esa persona y ensuciarían tanto
    // la adopción como el tiempo por tarea. Ver como alguien es diagnóstico,
    // no trabajo real de esa persona — se tira el lote.
    if (c.get('impersonatedBy')) return c.body(null, 204);

    let body: { sessionId?: unknown; events?: unknown } | null = null;
    try { body = await c.req.json(); } catch { /* lote ilegible — se ignora */ }

    const events = Array.isArray(body?.events) ? body.events : [];
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    if (events.length > 0 && events.length <= UX_MAX_BATCH) {
      // `viewer` va del identity del SERVIDOR. Si el body trae user_id/role, ni
      // se leen: serían falsificables y además saldrían mal.
      c.executionCtx.waitUntil(ingestUxEvents(c.env, viewer, sessionId, events));
    }
    return c.body(null, 204);
  });

  // Reporte AGREGADO — las 5 métricas comparables contra la línea base de
  // Monday, con el corte portal-vs-Monday explícito (worker/lib/uxMetrics.ts).
  // Solo admin: esto mide personas, y aunque la salida no trae a nadie por
  // nombre, es material de dirección, no de operación.
  app.get('/api/telemetry/report', async c => {
    const viewer = c.get('viewer');
    if (viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const dias = Math.min(Math.max(Number(c.req.query('dias')) || DIAS_DEFAULT, 1), DIAS_MAX);
    const hasta = new Date().toISOString();
    const desde = new Date(Date.now() - dias * 86400_000).toISOString();
    return c.json(await buildUxReport(c.env, desde, hasta));
  });
}
