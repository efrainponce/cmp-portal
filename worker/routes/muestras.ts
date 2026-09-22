// worker/routes/muestras.ts — Solicitudes de muestra (Efraín, 2026-09-21).
// Lógica en worker/lib/muestras.ts; aquí autorización y forma de la respuesta.
//
// Todo bajo /api/muestras (no /api/proyectos/:id/...) para no chocar con los
// comodines de oportunidadRoutes. La puerta es SIEMPRE el item ligado:
// leer = dal.getItem(…, 'read'), mutar = dal.getItem(…, 'own') — 404 si no le
// toca, nunca 403, igual que el resto de los writes. El board "Solicitudes de
// muestra" del sidebar es solo declutter (shared/boardAccess.ts): la lista ya
// sale recortada por renglón.
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { getItem } from '../lib/dal';
import { canReadBoard } from '../../shared/visibility';
import { jsonStatus, rejectUnknownQuery } from '../lib/http';
import { errorInterno } from '../lib/errores';
import { esEstadoGestion, puedeGestionarMuestras, validarSolicitud, type MuestraPadre } from '../../shared/muestras';
import type { MirrorItem } from '../../shared/types';
import {
  MuestraError, borrarMuestra, cambiarEstadoMuestra, crearMuestra, editarMuestra, enviarMuestra, listarMuestras, muestrasDeItem, nuevaVersionMuestra, padreDeMuestra,
} from '../lib/muestras';

type Ctx = Context<{ Bindings: Env }>;

const esPadre = (v: unknown): v is MuestraPadre => v === 'oportunidades' || v === 'proyectos';

function fail(c: Ctx, err: unknown): Response {
  if (err instanceof MuestraError) return jsonStatus({ ok: false, error: err.message }, err.status);
  return errorInterno(c, err, { ok: false, error: 'internal error' });
}

/** La solicitud `:id` y su item ligado, con el scope pedido. */
async function autorizarMuestra(c: Ctx, mode: 'read' | 'own'): Promise<{ id: number; padre: MuestraPadre; row: MirrorItem } | Response> {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'not found' }, 404);
  const ref = await padreDeMuestra(c.env, id);
  const viewer = c.get('viewer');
  if (!ref || !canReadBoard(ref.padre, viewer.role)) return c.json({ ok: false, error: 'not found' }, 404);
  const row = await getItem(c.env, ref.padre, ref.itemId, viewer, mode);
  if (!row) return c.json({ ok: false, error: 'not found' }, 404);
  return { id, padre: ref.padre, row };
}

export function muestrasRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/muestras', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    try {
      return c.json({ solicitudes: await listarMuestras(c.env, c.get('viewer')) });
    } catch (err) {
      return fail(c, err);
    }
  });

  // Las del tab del drawer de una Oportunidad o un Proyecto.
  app.get('/api/muestras/de/:padre/:itemId', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const padre = c.req.param('padre');
    const itemId = Number(c.req.param('itemId'));
    const viewer = c.get('viewer');
    if (!esPadre(padre) || !Number.isInteger(itemId) || !canReadBoard(padre, viewer.role)) return c.json({ error: 'not found' }, 404);
    try {
      const row = await getItem(c.env, padre, itemId, viewer, 'read');
      if (!row) return c.json({ error: 'not found' }, 404);
      const editable = !!(await getItem(c.env, padre, itemId, viewer, 'own'));
      return c.json({ solicitudes: await muestrasDeItem(c.env, padre, row, editable, viewer), editable });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/api/muestras', async c => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const padre = body?.padre;
    const itemId = Number(body?.itemId);
    const viewer = c.get('viewer');
    if (!esPadre(padre) || !Number.isInteger(itemId)) return jsonStatus({ ok: false, error: 'falta a qué oportunidad o proyecto va la solicitud' }, 400);
    const v = validarSolicitud(body);
    if (!v.ok) return jsonStatus({ ok: false, error: v.error }, 400);
    try {
      if (!canReadBoard(padre, viewer.role) || !(await getItem(c.env, padre, itemId, viewer, 'own'))) return c.json({ ok: false, error: 'not found' }, 404);
      const id = await crearMuestra(c.env, padre, itemId, v.valor, viewer);
      return c.json({ ok: true, id: String(id) });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.put('/api/muestras/:id', async c => {
    const body = await c.req.json<unknown>().catch(() => null);
    const v = validarSolicitud(body);
    if (!v.ok) return jsonStatus({ ok: false, error: v.error }, 400);
    try {
      const auth = await autorizarMuestra(c, 'own');
      if (auth instanceof Response) return auth;
      await editarMuestra(c.env, auth.id, v.valor, c.get('viewer'));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  // El botón "Enviar a Compras" del tab: lo manda quien puede escribir el item.
  app.post('/api/muestras/:id/enviar', async c => {
    try {
      const auth = await autorizarMuestra(c, 'own');
      if (auth instanceof Response) return auth;
      await enviarMuestra(c.env, auth.id, auth.padre, auth.row, c.get('viewer'));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  // "+ Nueva versión": duplica una ya enviada como borrador V{n+1}.
  app.post('/api/muestras/:id/version', async c => {
    try {
      const auth = await autorizarMuestra(c, 'own');
      if (auth instanceof Response) return auth;
      const id = await nuevaVersionMuestra(c.env, auth.id, c.get('viewer'));
      return c.json({ ok: true, id: String(id) });
    } catch (err) {
      return fail(c, err);
    }
  });

  // Estado desde el board: solo Compras/admin, sobre lo que pueden LEER (Compras
  // lee lo de todo el equipo; escribir el item no es requisito para gestionar
  // la muestra).
  app.put('/api/muestras/:id/estado', async c => {
    const body = await c.req.json<{ estado?: unknown }>().catch(() => null);
    if (!esEstadoGestion(body?.estado)) return jsonStatus({ ok: false, error: 'estado inválido' }, 400);
    if (!puedeGestionarMuestras(c.get('viewer').role)) return jsonStatus({ ok: false, error: 'solo Compras cambia el estado' }, 403);
    try {
      const auth = await autorizarMuestra(c, 'read');
      if (auth instanceof Response) return auth;
      await cambiarEstadoMuestra(c.env, auth.id, body.estado, c.get('viewer'));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/api/muestras/:id', async c => {
    try {
      const auth = await autorizarMuestra(c, 'own');
      if (auth instanceof Response) return auth;
      await borrarMuestra(c.env, auth.id, c.get('viewer'));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });
}
