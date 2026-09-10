// worker/routes/salud.ts — Salud del portal para admin (2026-09-10): el mismo
// reporte que `node scripts/salud.mjs` imprime en la terminal, y un botón para
// correr la revisión de integridad ya (sin esperar al cron de cada hora).
// Ver worker/lib/salud.ts.
import type { Hono } from 'hono';
import type { Env } from '../env';
import { rejectUnknownQuery } from '../lib/http';
import { reporteSalud, revisarSalud } from '../lib/salud';
import { errorInterno } from '../lib/errores';

const HORAS_DEFAULT = 24;
const HORAS_MAX = 24 * 30;

export function saludRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/admin/salud', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const queryMala = rejectUnknownQuery(c.req.url, ['horas']);
    if (queryMala) return queryMala;
    const horas = Math.min(Math.max(Number(c.req.query('horas')) || HORAS_DEFAULT, 1), HORAS_MAX);
    try {
      return c.json(await reporteSalud(c.env, horas));
    } catch (err) {
      return errorInterno(c, err);
    }
  });

  app.post('/api/admin/salud/revisar', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    try {
      return c.json(await revisarSalud(c.env));
    } catch (err) {
      return errorInterno(c, err);
    }
  });
}
