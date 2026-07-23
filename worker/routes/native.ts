// worker/routes/native.ts — API PARALELA (dormida) del modelo nativo (plan 3).
// Replica las interacciones de Monday (list/detail/create/patch/activity) sobre las
// tablas nativas, reusando el scoping por viewer y la whitelist de visibilidad.
//
// DORMIDO: todo el router 404ea salvo NATIVE_SHADOW=1. Ningún componente del frontend
// lo llama — es el "sistema paralelo sin usar" (ver docs/plan-3-native-independence.md).
import type { Hono } from 'hono';
import type { Env } from '../env';
import { isNativeEntity, type NativeEntity } from '../../shared/native';
import {
  NativeError, nativeList, nativeGet, nativePatch, nativeCreate,
  nativeActivity, nativeAddComment, nativeStatus,
} from '../lib/native/repo';
import { backfillAll } from '../lib/native/project';
import { jsonStatus } from '../lib/http';

/** El flag que despierta toda la capa nativa. Off (default) = 404 en todo el router. */
function enabled(env: Env): boolean {
  return env.NATIVE_SHADOW === '1';
}

function entityParam(s: string): NativeEntity | null {
  return isNativeEntity(s) ? s : null;
}

export function nativeRoutes(app: Hono<{ Bindings: Env }>) {
  // Guard global: si el flag está apagado, ninguna ruta nativa existe.
  app.use('/api/native/*', async (c, next) => {
    if (!enabled(c.env)) return c.json({ error: 'not found' }, 404);
    await next();
  });

  // Admin: paridad nativo vs mirror.
  app.get('/api/native/admin/status', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    return c.json({ ok: true, entities: await nativeStatus(c.env) });
  });

  // Admin: proyecta todo el mirror → nativo (idempotente).
  app.post('/api/native/admin/backfill', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const result = await backfillAll(c.env);
    return c.json({ ok: true, boards: result });
  });

  app.get('/api/native/:entity', async c => {
    const entity = entityParam(c.req.param('entity'));
    if (!entity) return c.json({ error: 'not found' }, 404);
    const items = await nativeList(c.env, entity, c.get('viewer'), c.req.query('q'));
    return c.json({ entity, items, total: items.length });
  });

  app.post('/api/native/:entity', async c => {
    const entity = entityParam(c.req.param('entity'));
    if (!entity) return c.json({ error: 'not found' }, 404);
    try {
      const body = await c.req.json<{ title: string; parentId?: number | null; fields?: Record<string, string> }>();
      const dto = await nativeCreate(c.env, entity, c.get('viewer'), body);
      return c.json(dto);
    } catch (err) {
      return errResponse(err);
    }
  });

  app.get('/api/native/:entity/:id', async c => {
    const entity = entityParam(c.req.param('entity'));
    const id = Number(c.req.param('id'));
    if (!entity || !Number.isFinite(id)) return c.json({ error: 'not found' }, 404);
    const dto = await nativeGet(c.env, entity, id, c.get('viewer'));
    if (!dto) return c.json({ error: 'not found' }, 404);
    return c.json(dto);
  });

  app.patch('/api/native/:entity/:id', async c => {
    const entity = entityParam(c.req.param('entity'));
    const id = Number(c.req.param('id'));
    if (!entity || !Number.isFinite(id)) return c.json({ error: 'not found' }, 404);
    try {
      const body = await c.req.json<{ fields: Record<string, string> }>();
      const dto = await nativePatch(c.env, entity, id, c.get('viewer'), body.fields ?? {});
      return c.json(dto);
    } catch (err) {
      return errResponse(err);
    }
  });

  app.get('/api/native/:entity/:id/activity', async c => {
    const entity = entityParam(c.req.param('entity'));
    const id = Number(c.req.param('id'));
    if (!entity || !Number.isFinite(id)) return c.json({ error: 'not found' }, 404);
    try {
      return c.json(await nativeActivity(c.env, entity, id, c.get('viewer')));
    } catch (err) {
      return errResponse(err);
    }
  });

  app.post('/api/native/:entity/:id/activity', async c => {
    const entity = entityParam(c.req.param('entity'));
    const id = Number(c.req.param('id'));
    if (!entity || !Number.isFinite(id)) return c.json({ error: 'not found' }, 404);
    try {
      const body = await c.req.json<{ body: string }>();
      const dto = await nativeAddComment(c.env, entity, id, c.get('viewer'), body.body ?? '');
      return c.json(dto);
    } catch (err) {
      return errResponse(err);
    }
  });
}

function errResponse(err: unknown) {
  if (err instanceof NativeError) return jsonStatus({ error: err.message }, err.status);
  const detail = err instanceof Error ? err.message : String(err);
  return jsonStatus({ error: `internal error: ${detail}` }, 500);
}
