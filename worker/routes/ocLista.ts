// worker/routes/ocLista.ts — tablero "Lista de OC" (worker/lib/ocLista.ts).
// Gateado por el acceso al board 'oc_lista' (shared/boardAccess.ts), como
// inventario: aquí el whitelist del nav también es la llave de la ruta. Los
// renglones van además acotados por el scoping de Proyectos (dal.ts).
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { getBoardAccess } from '../lib/boardAccess';
import { jsonStatus, rejectUnknownQuery } from '../lib/http';
import { errorInterno } from '../lib/errores';
import { guardarMonto, listarOrdenesCompra, marcarPagada, OcListaError } from '../lib/ocLista';

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

  // Lo que el navegador leyó del PDF (shared/ocMontoPdf.ts) — pdfjs no corre
  // en el Worker. El server valida que las cifras cuadren entre sí.
  app.put('/api/oc-lista/:folio/monto', async c => {
    const denied = await requireAccess(c);
    if (denied) return denied;
    const body = await c.req.json<{ subtotal?: unknown; iva?: unknown; total?: unknown; moneda?: unknown }>().catch(() => null);
    if (!body) return jsonStatus({ error: 'body inválido' }, 400);
    try {
      await guardarMonto(c.env, c.get('viewer'), c.req.param('folio'), {
        subtotal: body.subtotal as number, iva: body.iva as number, total: body.total as number,
        moneda: typeof body.moneda === 'string' ? body.moneda : null,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof OcListaError) return jsonStatus({ error: err.message }, err.status);
      return errorInterno(c, err, { error: 'internal error' });
    }
  });
}
