// worker/routes/drive.ts — carpeta de Google Drive de una Oportunidad o un
// Proyecto para el tab Documentación (Efraín, 2026-09-15): listar subcarpetas
// y archivos, crear la carpeta del Proyecto y espejar a Drive los documentos
// que el item tiene en Monday. Ver worker/lib/drive.ts.
//
// Se registra ANTES de oportunidadRoutes en worker/index.ts: el wildcard
// POST /api/proyectos/:id/:action de ahí también matchea /drive.
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { MirrorItem } from '../../shared/types';
import type { DriveCarpetaResponse, DriveSincronizarResponse } from '../../shared/dto';
import { getItem, leadsOthers, ownsItem } from '../lib/dal';
import { errorInterno } from '../lib/errores';
import { rejectUnknownQuery } from '../lib/http';
import {
  crearCarpetaProyecto, driveDisponible, esErrorDeDrive, listarCarpeta, resolverCarpeta, sincronizarDocumentos,
  type CarpetaKind,
} from '../lib/drive';

const SLUG: Record<CarpetaKind, 'oportunidades' | 'proyectos'> = { oportunidad: 'oportunidades', proyecto: 'proyectos' };

export function driveRoutes(app: Hono<{ Bindings: Env }>) {
  for (const kind of ['oportunidad', 'proyecto'] as const) {
    const slug = SLUG[kind];

    // Listado: carpeta + subcarpetas + archivos. Lectura (el líder de zona
    // también la ve); nunca crea nada en Drive.
    app.get(`/api/${slug}/:id/drive`, async c => {
      const itemId = Number(c.req.param('id'));
      if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
      const queryMala = rejectUnknownQuery(c.req.url, []);
      if (queryMala) return queryMala;
      const row = await getItem(c.env, slug, itemId, c.get('viewer'));
      if (!row) return c.json({ error: 'not found' }, 404);

      const vacio: DriveCarpetaResponse = { disponible: driveDisponible(c.env), carpeta: null, subcarpetas: [], archivos: [], puedeCrear: false };
      if (!vacio.disponible) return c.json(vacio);
      try {
        const folder = await resolverCarpeta(c.env, kind, row, { ensure: false });
        if (!folder) {
          // Crear es una escritura: solo el dueño (mismo criterio que
          // dto.ownedByViewer en worker/routes/boards.ts).
          const viewer = c.get('viewer');
          const puedeCrear = kind === 'proyecto' && (!leadsOthers(viewer) || await ownsItem(c.env, slug, itemId, viewer));
          return c.json({ ...vacio, puedeCrear } satisfies DriveCarpetaResponse);
        }
        const listado = await listarCarpeta(c.env, folder.rootFolderId);
        const body: DriveCarpetaResponse = {
          disponible: true,
          carpeta: { id: folder.rootFolderId, url: folder.rootFolderUrl, nombre: nombreCarpeta(row) },
          ...listado,
        };
        return c.json(body);
      } catch (err) {
        if (esErrorDeDrive(err)) return c.json({ error: `Drive no respondió: ${err.message}` }, 502);
        return errorInterno(c, err, { error: 'No se pudo leer la carpeta de Drive.' });
      }
    });

    // Espeja a Drive los archivos del item (scope 'own': es una escritura).
    app.post(`/api/${slug}/:id/drive/sincronizar`, async c => {
      const itemId = Number(c.req.param('id'));
      if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
      if (!driveDisponible(c.env)) return c.json({ error: 'Drive no está configurado en este ambiente.' }, 503);
      const row = await getItem(c.env, slug, itemId, c.get('viewer'), 'own');
      if (!row) return c.json({ error: 'not found' }, 404);
      try {
        const folder = await resolverCarpeta(c.env, kind, row, { ensure: true });
        if (!folder) {
          return c.json({ error: kind === 'proyecto' ? 'Este proyecto aún no tiene carpeta de Drive — créala primero.' : 'Esta oportunidad no tiene carpeta de Drive.' }, 409);
        }
        const r = await sincronizarDocumentos(c.env, kind, row, folder);
        const body: DriveSincronizarResponse = { ok: true, ...r };
        return c.json(body);
      } catch (err) {
        if (esErrorDeDrive(err)) return c.json({ error: `Drive no respondió: ${err.message}` }, 502);
        return errorInterno(c, err, { error: 'No se pudieron sincronizar los documentos.' });
      }
    });
  }

  // Crea la carpeta del Proyecto (solo el dueño; idempotente).
  app.post('/api/proyectos/:id/drive', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    if (!driveDisponible(c.env)) return c.json({ error: 'Drive no está configurado en este ambiente.' }, 503);
    const row = await getItem(c.env, 'proyectos', itemId, c.get('viewer'), 'own');
    if (!row) return c.json({ error: 'not found' }, 404);
    try {
      const folder = await crearCarpetaProyecto(c.env, itemId);
      return c.json({ ok: true, carpeta: { id: folder.rootFolderId, url: folder.rootFolderUrl, nombre: nombreCarpeta(row) } });
    } catch (err) {
      if (esErrorDeDrive(err)) return c.json({ error: `Drive no respondió: ${err.message}` }, 502);
      return errorInterno(c, err, { error: 'No se pudo crear la carpeta de Drive.' });
    }
  });
}

function nombreCarpeta(row: MirrorItem): string {
  return row.name;
}
