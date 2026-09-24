// worker/routes/cotLista.ts — tablero "Lista de cotizaciones" de Ventas
// (worker/lib/cotLista.ts). Gateado por el acceso al board 'cot_lista'
// (shared/boardAccess.ts), como la Lista de OC. Los renglones van además
// acotados por el scoping de Oportunidades (dal.ts).
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { getBoardAccess } from '../lib/boardAccess';
import { jsonStatus, rejectUnknownQuery, etagCoincide } from '../lib/http';
import { errorInterno } from '../lib/errores';
import { CotListaError, etagCotLista, guardarCotPdfDatos, listarCotizaciones } from '../lib/cotLista';

async function requireAccess(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const access = await getBoardAccess(c.env, c.get('viewer').role);
  if (!access.includes('cot_lista')) return jsonStatus({ error: 'forbidden' }, 403);
  return null;
}

export function cotListaRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/cot-lista', async c => {
    const denied = await requireAccess(c);
    if (denied) return denied;
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    try {
      const etag = await etagCotLista(c.env, c.get('viewer'));
      if (etagCoincide(c.req.header('If-None-Match'), etag)) return c.body(null, 304);
      c.header('ETag', etag);
      c.header('Cache-Control', 'private, no-cache');
      return c.json({ cotizaciones: await listarCotizaciones(c.env, c.get('viewer')) });
    } catch (err) {
      return errorInterno(c, err, { error: 'internal error' });
    }
  });

  // Lo que el navegador leyó del PDF (shared/cotMontoPdf.ts): fecha y totales.
  app.put('/api/cot-lista/:clave/pdf-datos', async c => {
    const denied = await requireAccess(c);
    if (denied) return denied;
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') return jsonStatus({ error: 'body inválido' }, 400);
    const n = (v: unknown) => (typeof v === 'number' ? v : v == null ? null : NaN);
    try {
      await guardarCotPdfDatos(c.env, c.get('viewer'), c.req.param('clave'), {
        fecha: typeof body.fecha === 'string' ? body.fecha : null,
        subtotal: n(body.subtotal), iva: n(body.iva), total: n(body.total),
        moneda: typeof body.moneda === 'string' ? body.moneda : null,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof CotListaError) return jsonStatus({ error: err.message }, err.status);
      return errorInterno(c, err, { error: 'internal error' });
    }
  });
}
