// Ruta de la pantalla "Inicio" — pendientes por rol (worker/lib/home.ts).
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { HomeResponse } from '../../shared/dto';
import { buildHomeResponse } from '../lib/home';
import { md5 } from '../lib/canon';

export function homeRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/home', async c => {
    const viewer = c.get('viewer');
    const response: HomeResponse = await buildHomeResponse(c.env, viewer);

    const fingerprint = response.sections.map(s => `${s.key}:${s.items.map(i => i.itemId).join(',')}`).join('|');
    const etag = '"' + md5(fingerprint) + '"';
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304, { ETag: etag });
    c.header('ETag', etag);
    return c.json(response);
  });
}
