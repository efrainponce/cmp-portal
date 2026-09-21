// Archivos del catálogo de Proveedores (2026-09-21, salida de Monday):
// Constancia fiscal, Cuenta de Banco y Actas solo se podían subir y ver dentro
// de Monday. Los datos de texto van por el PATCH genérico
// (worker/routes/boards.ts); esto cubre únicamente las columnas `file`.
// Dual-write como el resto del portal: el archivo sube a su columna de Monday
// Y a R2 (`proveedores/<id>/<colId>/<assetId>-<nombre>`), para que la lectura
// no dependa de Monday. Lo que se subió directo en Monday no tiene copia en R2:
// ahí se cae al asset de Monday.
import type { Hono } from 'hono';
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import { canRead, canWrite } from '../../shared/visibility';
import { getItem } from '../lib/dal';
import { addFileToColumn, fetchAssetPublicUrls } from '../lib/monday';
import { parseFiles } from '../lib/embellecimientoImagenes';
import { putFile } from '../lib/r2';
import { registrarArchivo } from '../lib/archivoLog';
import { refetchItem } from '../sync';
import { jsonStatus, contentDisposition, rejectUnknownQuery } from '../lib/http';
import { errorInterno } from '../lib/errores';
import { contentTypeFor, isGenericType } from '../lib/mime';

/** Las tres columnas `file` del board. Whitelist cerrada: el `:colId` de la
 * ruta nunca llega a Monday si no está aquí. */
export const PROVEEDOR_FILE_COLS = ['file_mm21ggd2', 'file_mm208m11', 'file_mm3krzd'] as const;
const esColDeArchivo = (colId: string): boolean => (PROVEEDOR_FILE_COLS as readonly string[]).includes(colId);

const MAX_BYTES = 25 * 1024 * 1024;

const r2Key = (itemId: number, colId: string, assetId: number | string, nombre: string) =>
  `proveedores/${itemId}/${colId}/${assetId}-${nombre}`;

export function proveedorRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/proveedores/:id/archivos', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    const row = await getItem(c.env, 'proveedores', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);
    const archivos: Record<string, { assetId: number; name: string; url: string }[]> = {};
    for (const colId of PROVEEDOR_FILE_COLS) {
      if (!canRead('proveedores', colId, viewer.role, viewer.email)) continue;
      archivos[colId] = parseFiles(row.columns, colId).map(f => ({
        assetId: f.assetId, name: f.name,
        url: `/api/proveedores/${itemId}/archivos/${colId}/${f.assetId}`,
      }));
    }
    return c.json({ archivos });
  });

  app.get('/api/proveedores/:id/archivos/:colId/:assetId', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const itemId = Number(c.req.param('id'));
    const colId = c.req.param('colId');
    const assetId = Number(c.req.param('assetId'));
    if (!Number.isFinite(itemId) || !Number.isFinite(assetId) || !esColDeArchivo(colId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!canRead('proveedores', colId, viewer.role, viewer.email)) return c.json({ error: 'not found' }, 404);
    const row = await getItem(c.env, 'proveedores', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);
    // El asset tiene que estar HOY en esa columna de ese proveedor: un assetId
    // suelto no abre archivos de otro item.
    const archivo = parseFiles(row.columns, colId).find(f => f.assetId === assetId);
    if (!archivo) return c.json({ error: 'not found' }, 404);
    try {
      const headers = { 'Content-Disposition': contentDisposition(archivo.name), 'Cache-Control': 'private, max-age=60' };
      const object = await c.env.FILES.get(r2Key(itemId, colId, assetId, archivo.name));
      if (object) {
        const guardado = object.httpMetadata?.contentType;
        return new Response(object.body, {
          headers: { ...headers, 'Content-Type': isGenericType(guardado ?? null) ? contentTypeFor(archivo.name) : guardado! },
        });
      }
      const url = (await fetchAssetPublicUrls(c.env, [String(assetId)])).get(String(assetId));
      if (!url) return c.json({ error: 'not found' }, 404);
      const upstream = await fetch(url);
      if (!upstream.ok) return jsonStatus({ error: 'no se pudo obtener el archivo' }, 502);
      const bytes = await upstream.arrayBuffer();
      const tipo = upstream.headers.get('content-type');
      return new Response(bytes, {
        headers: { ...headers, 'Content-Type': isGenericType(tipo) ? contentTypeFor(archivo.name) : tipo!, 'Content-Length': String(bytes.byteLength) },
      });
    } catch (err) {
      return errorInterno(c, err, { error: 'internal error' });
    }
  });

  app.post('/api/proveedores/:id/archivos/:colId', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const itemId = Number(c.req.param('id'));
    const colId = c.req.param('colId');
    if (!Number.isFinite(itemId) || !esColDeArchivo(colId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!canWrite('proveedores', colId, viewer.role)) return c.json({ error: 'forbidden' }, 403);
    const row = await getItem(c.env, 'proveedores', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);
    if (file.size > MAX_BYTES) return c.json({ error: 'El archivo pesa más de 25 MB.' }, 413);

    try {
      const asset = await addFileToColumn(c.env, itemId, colId, file, file.name);
      const nombre = asset.name || file.name;
      const key = r2Key(itemId, colId, asset.id, nombre);
      await putFile(c.env, key, file);
      await registrarArchivo(c.env, {
        acto: 'sube', categoria: 'proveedor', nombre,
        boardId: BOARDS.proveedores.id, itemId, colId, assetId: Number(asset.id) || null,
        r2Key: key, bytes: file.size, porEmail: viewer.email,
      });
      // El mirror se entera por el refetch: la lista de archivos sale de ahí.
      await refetchItem(c.env, BOARDS.proveedores.id, itemId);
      return c.json({ ok: true, assetId: Number(asset.id), name: nombre });
    } catch (err) {
      return errorInterno(c, err, { ok: false, error: 'internal error' });
    }
  });
}
