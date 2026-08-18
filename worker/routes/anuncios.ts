// Anuncios del portal — API sobre worker/lib/anuncios.ts. Leer: cualquier viewer
// (la lista ya viene filtrada por su rol+zona). Escribir: SOLO admin, igual que
// Configuración — publicar un comunicado es un acto de dirección, no de operación.
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { Role } from '../../shared/types';
import type { AnunciosResponse, AnuncioSeveridad, CrearAnuncioRequest, CrearAnuncioResponse } from '../../shared/dto';
import {
  listAnuncios, createAnuncio, updateAnuncio, setArchivado, deleteAnuncio,
  marcarVisto, destinatariosWa, registrarWaEnviados, AnuncioError,
} from '../lib/anuncios';
import { notifyAnuncioWa } from '../wa/notify';
import { md5 } from '../lib/canon';

function severidadDe(v: unknown): AnuncioSeveridad {
  return v === 'importante' ? 'importante' : 'normal';
}

export function anuncioRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/anuncios', async c => {
    const viewer = c.get('viewer');
    const { anuncios, noLeidos } = await listAnuncios(c.env, viewer);
    const response: AnunciosResponse = { anuncios, noLeidos };

    // El ETag entra updated_at + visto de cada fila: editar un anuncio o marcarlo
    // leído tiene que romper el 304 (si no, el badge se queda pegado).
    const etag = '"' + md5(anuncios.map(a => `${a.id}:${a.updatedAt}:${a.visto ? 1 : 0}:${a.archivado ? 1 : 0}`).join('|') + `#${noLeidos}`) + '"';
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304, { ETag: etag });
    c.header('ETag', etag);
    return c.json(response);
  });

  app.post('/api/anuncios', async c => {
    const viewer = c.get('viewer');
    if (viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json<CrearAnuncioRequest>();
    try {
      const anuncio = await createAnuncio(c.env, viewer, {
        titulo: body.titulo ?? '',
        cuerpo: body.cuerpo ?? '',
        severidad: severidadDe(body.severidad),
        roles: (body.roles ?? []) as Role[],
        zonaIds: (body.zonaIds ?? []).map(Number),
      });

      // WhatsApp SOLO con la casilla explícita (decisión de Efraín, 2026-08-17):
      // la severidad por sí sola no manda nada. En waitUntil porque son N
      // subrequests a Meta y el admin no tiene por qué esperarlos.
      if (body.notificarWa) {
        c.executionCtx.waitUntil((async () => {
          const destinatarios = await destinatariosWa(c.env, { roles: anuncio.roles, zonaIds: anuncio.zonaIds }, viewer.email);
          const enviados = await notifyAnuncioWa(c.env, anuncio.titulo, destinatarios);
          if (enviados > 0) await registrarWaEnviados(c.env, anuncio.id, enviados);
        })());
      }

      const response: CrearAnuncioResponse = { anuncio };
      return c.json(response, 201);
    } catch (err) {
      if (err instanceof AnuncioError) return c.json({ error: err.message }, err.status as 400 | 404);
      throw err;
    }
  });

  app.patch('/api/anuncios/:id', async c => {
    const viewer = c.get('viewer');
    if (viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json<Partial<CrearAnuncioRequest>>();
    try {
      await updateAnuncio(c.env, c.req.param('id'), {
        ...(body.titulo !== undefined ? { titulo: body.titulo } : {}),
        ...(body.cuerpo !== undefined ? { cuerpo: body.cuerpo } : {}),
        ...(body.severidad !== undefined ? { severidad: severidadDe(body.severidad) } : {}),
        ...(body.roles !== undefined ? { roles: body.roles as Role[] } : {}),
        ...(body.zonaIds !== undefined ? { zonaIds: body.zonaIds.map(Number) } : {}),
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AnuncioError) return c.json({ error: err.message }, err.status as 400 | 404);
      throw err;
    }
  });

  app.post('/api/anuncios/:id/archivar', async c => {
    const viewer = c.get('viewer');
    if (viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json<{ archivado?: boolean }>().catch(() => ({ archivado: true }));
    try {
      await setArchivado(c.env, c.req.param('id'), body.archivado !== false);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof AnuncioError) return c.json({ error: err.message }, err.status as 400 | 404);
      throw err;
    }
  });

  app.delete('/api/anuncios/:id', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    await deleteAnuncio(c.env, c.req.param('id'));
    return c.json({ ok: true });
  });

  // "Visto" del viewer — lo dispara la UI al desplegar el anuncio, mismo espíritu
  // que los ojitos de Actualizaciones (worker/lib/updateSeen.ts).
  app.post('/api/anuncios/:id/visto', async c => {
    await marcarVisto(c.env, c.req.param('id'), c.get('viewer').email);
    return c.json({ ok: true });
  });
}
