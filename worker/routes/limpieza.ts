// worker/routes/limpieza.ts — POST /api/admin/limpieza/borrar: borra UN item
// de prueba con sus líneas, por id y nombre exacto. Toda la lógica y las
// guardas viven en worker/lib/limpieza.ts (compartidas con la cola del cron).
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { BoardSlug } from '../../shared/boards';
import { borrarPrueba, LimpiezaError } from '../lib/limpieza';
import { BorradoError } from '../lib/itemBorrado';
import { jsonStatus } from '../lib/http';
import { errorInterno } from '../lib/errores';

interface Body { slug?: unknown; itemId?: unknown; nombre?: unknown }

export function limpiezaRoutes(app: Hono<{ Bindings: Env }>) {
  app.post('/api/admin/limpieza/borrar', async c => {
    const viewer = c.get('viewer');
    if (viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    let body: Body;
    try { body = await c.req.json<Body>(); } catch { return jsonStatus({ ok: false, error: 'body inválido' }, 400); }
    const slug = String(body.slug ?? '') as BoardSlug;
    const itemId = Number(body.itemId);
    const nombre = typeof body.nombre === 'string' ? body.nombre : '';
    try {
      const r = await borrarPrueba(c.env, slug, itemId, nombre, viewer.email);
      return c.json({ ok: true, itemId, nombre, lineas: r.lineas });
    } catch (err) {
      if (err instanceof LimpiezaError || err instanceof BorradoError) {
        return jsonStatus({ ok: false, error: err.message }, err.status);
      }
      return errorInterno(c, err, { ok: false, error: 'internal error' });
    }
  });
}
