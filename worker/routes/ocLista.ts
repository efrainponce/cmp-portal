// worker/routes/ocLista.ts — tablero "Lista de OC" (worker/lib/ocLista.ts).
// Gateado por el acceso al board 'oc_lista' (shared/boardAccess.ts), como
// inventario: aquí el whitelist del nav también es la llave de la ruta. Los
// renglones van además acotados por el scoping de Proyectos (dal.ts).
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { getBoardAccess } from '../lib/boardAccess';
import { jsonStatus, rejectUnknownQuery } from '../lib/http';
import { errorInterno } from '../lib/errores';
import { etagOcLista, guardarPdfDatos, listarOrdenesCompra, marcarPagada, OcListaError } from '../lib/ocLista';

async function requireAccess(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const access = await getBoardAccess(c.env, c.get('viewer').role);
  if (!access.includes('oc_lista')) return jsonStatus({ error: 'forbidden' }, 403);
  return null;
}

export function ocListaRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/oc-lista', async c => {
    const denied = await requireAccess(c);
    if (denied) return denied;
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    try {
      // El front refresca cada minuto: si nada cambió, 304 y no se arma nada.
      const etag = await etagOcLista(c.env, c.get('viewer'));
      if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
      c.header('ETag', etag);
      c.header('Cache-Control', 'private, no-cache');
      return c.json({ ordenes: await listarOrdenesCompra(c.env, c.get('viewer')) });
    } catch (err) {
      return errorInterno(c, err, { error: 'internal error' });
    }
  });

  app.put('/api/oc-lista/:folio/pagada', async c => {
    const denied = await requireAccess(c);
    if (denied) return denied;
    const body = await c.req.json<{ pagada?: unknown }>().catch(() => null);
    if (typeof body?.pagada !== 'boolean') return jsonStatus({ error: 'pagada debe ser true o false' }, 400);
    try {
      await marcarPagada(c.env, c.get('viewer'), c.req.param('folio'), body.pagada);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof OcListaError) return jsonStatus({ error: err.message }, err.status);
      return errorInterno(c, err, { error: 'internal error' });
    }
  });

  // Lo que el navegador leyó del PDF (shared/ocMontoPdf.ts): fecha y totales —
  // pdfjs no corre en el Worker. El server valida fecha y que las cifras cuadren.
  app.put('/api/oc-lista/:folio/pdf-datos', async c => {
    const denied = await requireAccess(c);
    if (denied) return denied;
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') return jsonStatus({ error: 'body inválido' }, 400);
    const n = (v: unknown) => (typeof v === 'number' ? v : v == null ? null : NaN);
    try {
      await guardarPdfDatos(c.env, c.get('viewer'), c.req.param('folio'), {
        fecha: typeof body.fecha === 'string' ? body.fecha : null,
        subtotal: n(body.subtotal), iva: n(body.iva), total: n(body.total),
        moneda: typeof body.moneda === 'string' ? body.moneda : null,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof OcListaError) return jsonStatus({ error: err.message }, err.status);
      return errorInterno(c, err, { error: 'internal error' });
    }
  });
}
