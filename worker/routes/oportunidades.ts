// Rutas específicas del flujo de Oportunidades: costeo, versiones de
// cotización, líneas de producto, imágenes de embellecimiento, PDFs de
// cotización y Proyecto/acciones de cmp-tallas. Movido tal cual desde
// worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Hono } from 'hono';
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import type { DuplicarOportunidadResponse, DuplicarVersionResponse, ItemDetailDTO, QuoteVersionsResponse } from '../../shared/dto';
import { getItem, childrenOf, pendingItemIds, proyectoForOportunidad, linkedItemId, PROYECTO_OPP_REL } from '../lib/dal';
import { toItemDTO } from '../lib/serialize';
import { OutboxError } from '../lib/outbox';
import {
  generateCotizacion, generateSheet, confirmTallas, importTallas, generateOC,
  AutomationError,
} from '../lib/automations';
import { enviarACosteo, enviarAValidacion, checkCosteo, checkValidacion, CosteoError } from '../lib/costeo';
import { listVersions, duplicateVersion, restoreVersion, esDraftVigente, recordFirstVersion, QuoteVersionError } from '../lib/quoteVersions';
import { duplicateOportunidad, DuplicateOportunidadError } from '../lib/duplicateOportunidad';
import { createSubitem, addFileToColumn, fetchAssetPublicUrls, gql } from '../lib/monday';
import { listZoneImages, uploadZoneImage, parseFiles, splitZone, EmbellImageError } from '../lib/embellecimientoImagenes';
import { putFile, oportunidadFileKey } from '../lib/r2';
import { resolveCotizacionPdfUrl, CotizacionPdfError, type PdfKind } from '../lib/cotizacionPdfs';
import { refetchItem, refetchItemTree, upsertItem } from '../sync';
import { jsonStatus } from '../lib/http';
import { canWrite } from '../../shared/visibility';

// OC / cotización / contrato firmado por el cliente (board Proyectos) — único
// campo de documentación habilitado para upload por ahora (Efraín, 2026-07-17).
const PROYECTO_DOCUMENTO_COL = 'file_mm0hayh4';

// Documentos que genera cmp-tallas subiendo directo a Monday (nunca al portal,
// nunca dual-write) — el fallback de /api/files es lo único que los mantiene
// funcionando vía R2 (fase 2 de la migración, 2026-07-18). Las 3 primeras son
// columnas de la propia Oportunidad (itemId = oppId, sin lookup); tallas/oc
// viven en el Proyecto ligado, igual que 'documento'.
const OPP_FILE_COLS: Record<string, string> = {
  'solicitud-costeo': 'file_mm0z6rze',
  'cotizacion-no-firmada': 'file_mm0fgrzq',
  'cotizacion-firmada': 'file_mm0zjras',
};
const PROYECTO_FILE_COLS: Record<string, string> = {
  'tallas': 'file_mm0hcrtz',
  'oc': 'file_mm0hj9pn',
};

// Acciones de cmp-tallas sobre el Proyecto. Cada una exige que el viewer pueda
// ver el Proyecto (scoping de dal) + un gate de rol que refleja el botón de
// Monday: confirmar=VENDEDOR, importar/oc=COMPRAS, regenerar=ambos.
const PROYECTO_ACTIONS: Record<string, {
  roles: string[];
  run: (env: Env, id: number, opts: { onlyProveedor?: string }) => Promise<{ ok: boolean; [k: string]: unknown }>;
}> = {
  'tallas-regenerar': { roles: ['vendedor', 'compras', 'admin'], run: (env, id) => generateSheet(env, id) },
  'tallas-confirmar': { roles: ['vendedor', 'admin'], run: (env, id) => confirmTallas(env, id) },
  'tallas-importar': { roles: ['compras', 'admin'], run: (env, id) => importTallas(env, id) },
  // onlyProveedor: id del item de `proveedores` — genera la OC de un solo proveedor
  // en vez de todos (ProveedorGrid, botón por tarjeta).
  'generar-oc': { roles: ['compras', 'admin'], run: (env, id, opts) => generateOC(env, id, { onlyProveedor: opts.onlyProveedor }) },
};

/** Fallback de /api/files para assetIds aún no migrados a R2 — resuelve el
 * link firmado vigente de Monday y bufferea los bytes (mismo patrón que
 * /api/oportunidades/:id/cotizacion-pdf/:kind: streamear sin Content-Length
 * cuelga el proxy de Vite en dev). */
async function proxyMondayAsset(env: Env, assetId: number): Promise<Response> {
  const urls = await fetchAssetPublicUrls(env, [String(assetId)]);
  const url = urls.get(String(assetId));
  if (!url) return jsonStatus({ error: 'not found' }, 404);
  const upstream = await fetch(url);
  if (!upstream.ok) return jsonStatus({ error: 'no se pudo obtener el archivo' }, 502);
  const bytes = await upstream.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export function oportunidadRoutes(app: Hono<{ Bindings: Env }>) {
  // Pre-chequeo de solo lectura: la UI deshabilita "Mandar a costeo" y lista lo
  // que falta ANTES de que alguien pueda dar click. Sin ningún efecto.
  app.get('/api/oportunidades/:id/costeo-check', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);

    try {
      return c.json(await checkCosteo(c.env, itemId, c.get('viewer')));
    } catch (err) {
      if (err instanceof CosteoError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      return jsonStatus({ ok: false, errors: ['internal error'] }, 500);
    }
  });

  // Pre-chequeo de solo lectura para "Mandar a Validación de costeo": la UI
  // deshabilita el botón y lista qué productos les falta confirmación de
  // Compras antes de que alguien pueda dar click. Sin ningún efecto.
  app.get('/api/oportunidades/:id/validacion-check', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);

    try {
      return c.json(await checkValidacion(c.env, itemId, c.get('viewer')));
    } catch (err) {
      if (err instanceof CosteoError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      return jsonStatus({ ok: false, errors: ['internal error'] }, 500);
    }
  });

  // Mandar a costeo = el flujo real de cmp-tallas (validar_costeo): valida, snapshotea
  // costos, genera el PDF de solicitud y mueve deal_stage→"En costeo". 422 con la
  // lista de errores legibles si algo falta (pre-chequeo local o rechazo del endpoint).
  app.post('/api/oportunidades/:id/enviar-costeo', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);

    try {
      const result = await enviarACosteo(c.env, itemId, c.get('viewer'));
      // El stage, el PDF y los snapshots de subitems los escribió cmp-tallas
      // directo en Monday — refresca el árbol completo en el mirror.
      if (result.ok) await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
      return result.ok ? c.json(result) : jsonStatus(result, 422);
    } catch (err) {
      if (err instanceof CosteoError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      if (err instanceof AutomationError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      if (err instanceof OutboxError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      return jsonStatus({ ok: false, errors: ['internal error'] }, 500);
    }
  });

  // Mandar a Validación de costeo = avance manual de Compras (etapa 15→7), sin
  // automatización de cmp-tallas de por medio (no existe endpoint para este
  // paso — docs/cmp-tallas-endpoint-map.md).
  app.post('/api/oportunidades/:id/enviar-validacion', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (viewer.role !== 'compras' && viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    try {
      const result = await enviarAValidacion(c.env, c.executionCtx, itemId, viewer);
      return result.ok ? c.json(result) : jsonStatus(result, 422);
    } catch (err) {
      if (err instanceof CosteoError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      if (err instanceof OutboxError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      return jsonStatus({ ok: false, errors: ['internal error'] }, 500);
    }
  });

  // Duplicar (botón del drawer): clona cabecera + líneas vigentes +
  // embellecimiento a una oportunidad nueva en etapa "Nueva oportunidad" —
  // nunca versiones de cotización ni otros documentos (worker/lib/duplicateOportunidad.ts).
  app.post('/api/oportunidades/:id/duplicar', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);

    try {
      const result = await duplicateOportunidad(c.env, c.executionCtx, itemId, c.get('viewer'));
      return c.json({ ok: true, id: String(result.id) } satisfies DuplicarOportunidadResponse);
    } catch (err) {
      if (err instanceof DuplicateOportunidadError) {
        return jsonStatus({ ok: false, error: err.message } satisfies DuplicarOportunidadResponse, err.status);
      }
      return jsonStatus({ ok: false, error: 'internal error' } satisfies DuplicarOportunidadResponse, 500);
    }
  });

  app.post('/api/oportunidades/:id/cotizacion', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, 'oportunidades', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    try {
      const result = await generateCotizacion(c.env, itemId);
      if (result.ok) {
        await recordFirstVersion(c.env, itemId, viewer, typeof result.folio_cotizacion === 'string' ? result.folio_cotizacion : undefined, Number(result.total ?? 0));
      }
      await refetchItem(c.env, BOARDS.oportunidades.id, itemId);
      return c.json(result);
    } catch (err) {
      if (err instanceof AutomationError) return jsonStatus({ ok: false, reason: err.message }, err.status);
      return jsonStatus({ ok: false, reason: 'internal error' }, 500);
    }
  });

  // Versiones de cotización — la vigente se arma del mirror; D1 archiva las
  // anteriores. [] solo cuando la oportunidad no tiene líneas todavía.
  app.get('/api/oportunidades/:id/versiones', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, 'oportunidades', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const versions = await listVersions(c.env, itemId, viewer);
    return c.json({ versions } satisfies QuoteVersionsResponse);
  });

  // "+ Nueva versión" = duplicado literal de la vigente (Efraín, 2026-07-17): se
  // archiva tal cual en D1 y las líneas regresan a Etapa Costeo "No iniciado" —
  // el mirror (idéntico) queda como borrador editable inline, y mandarlo a costeo
  // es un paso aparte con el botón "Mandar a costeo".
  const VERSION_ROLES = ['vendedor', 'compras', 'admin'];

  app.post('/api/oportunidades/:id/version/duplicar', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!VERSION_ROLES.includes(viewer.role)) return c.json({ error: 'forbidden' }, 403);

    try {
      await duplicateVersion(c.env, c.executionCtx, itemId, viewer);
      // El flush ya mandó los resets a Monday — sincroniza el mirror completo.
      await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
      const versions = await listVersions(c.env, itemId, viewer);
      return c.json({ ok: true, versions } satisfies DuplicarVersionResponse);
    } catch (err) {
      if (err instanceof QuoteVersionError) return jsonStatus({ ok: false, error: err.message } satisfies DuplicarVersionResponse, err.status);
      if (err instanceof OutboxError) return jsonStatus({ ok: false, error: err.message } satisfies DuplicarVersionResponse, err.status);
      return jsonStatus({ ok: false, error: 'internal error' } satisfies DuplicarVersionResponse, 500);
    }
  });

  // "Restaurar esta versión" — deja el mirror igual a la instantánea elegida
  // (archivando antes la vigente) y todo queda como borrador: cambiar de versión
  // implica que la oportunidad pase por costeo otra vez (Efraín, 2026-07-17).
  app.post('/api/oportunidades/:id/version/:version/restaurar', async c => {
    const itemId = Number(c.req.param('id'));
    const versionNum = Number(c.req.param('version'));
    if (!Number.isFinite(itemId) || !Number.isFinite(versionNum)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!VERSION_ROLES.includes(viewer.role)) return c.json({ error: 'forbidden' }, 403);

    try {
      await restoreVersion(c.env, c.executionCtx, itemId, versionNum, viewer);
      // El flush ya escribió/creó/borró líneas en Monday — el refetch de árbol
      // además purga del mirror las que se borraron.
      await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
      const versions = await listVersions(c.env, itemId, viewer);
      return c.json({ ok: true, versions } satisfies DuplicarVersionResponse);
    } catch (err) {
      if (err instanceof QuoteVersionError) return jsonStatus({ ok: false, error: err.message } satisfies DuplicarVersionResponse, err.status);
      if (err instanceof OutboxError) return jsonStatus({ ok: false, error: err.message } satisfies DuplicarVersionResponse, err.status);
      return jsonStatus({ ok: false, error: 'internal error' } satisfies DuplicarVersionResponse, 500);
    }
  });

  // Crear una línea de producto — sin versioning. Permitido en Nueva oportunidad
  // (stage 4) y sobre un borrador de versión (todas las líneas sin costear), donde
  // el grid se comporta igual que en Nueva oportunidad (Efraín, 2026-07-17).
  app.post('/api/oportunidades/:id/productos', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    const body = await c.req.json<{ cantidad?: number }>();

    try {
      const item = await getItem(c.env, 'oportunidades', itemId, viewer);
      if (!item) return c.json({ error: 'not found' }, 404);

      // MirrorItem.columns is raw [{id,type,text,value}] JSON — same shape/parsing
      // as worker/lib/costeo.ts's colsOf, not the serialized ItemDTO.cols.
      const raw: { id: string; text: string; value: string }[] = JSON.parse(item.columns || '[]');
      const stageCol = raw.find(col => col.id === 'deal_stage');
      let stageIndex = '';
      try {
        stageIndex = String((JSON.parse(stageCol?.value ?? 'null') as { index?: unknown })?.index ?? '');
      } catch { /* value vacío/optimista — cae en 'no coincide con 4' abajo */ }
      if (stageIndex !== '4') {
        if (stageIndex === '1' || stageIndex === '2') {
          return c.json({ error: 'La oportunidad ya está Ganada o Perdida — no se pueden agregar líneas.' }, 400);
        }
        const lineas = await childrenOf(c.env, 'oportunidades', itemId, viewer);
        if (!esDraftVigente(lineas)) {
          return c.json({ error: 'Solo se pueden crear líneas en Nueva oportunidad o en una versión nueva sin costear.' }, 400);
        }
      }

      // Subitem real (create_subitem, no create_item) — así Monday lo linkea al
      // padre automáticamente; create_item en el board de subitems NO lo hace.
      // Cantidad arranca en 0 a propósito (Efraín) — el grid la marca con warning
      // hasta que el vendedor la captura, en vez de fingir una cantidad de 1.
      const subitemName = 'Nueva línea';
      const subitemCols: Record<string, unknown> = {
        numeric_mkzm6399: body.cantidad ?? 0, // cantidad
      };
      const subitem = await createSubitem(c.env, itemId, subitemName, subitemCols);

      await upsertItem(c.env, 'oportunidades_sub', subitem);
      return c.json({ ok: true, id: subitem.id });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Error creando producto:', detail);
      return c.json({ error: 'No se pudo crear la línea: ' + detail }, 500);
    }
  });

  // Imágenes de referencia por zona de embellecimiento — :id es la línea
  // (subitem de oportunidades_sub), no la oportunidad. Monday no tiene una
  // columna por zona; la zona va codificada en el nombre del archivo
  // (ver worker/lib/embellecimientoImagenes.ts).
  app.get('/api/oportunidades/lineas/:id/embellecimiento-imagenes', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    try {
      const images = await listZoneImages(c.env, itemId, viewer);
      return c.json(images);
    } catch (err) {
      if (err instanceof EmbellImageError) return jsonStatus({ error: err.message }, err.status);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  // Vista previa embebida del PDF de cotización (sin firmar/firmada) — transmite
  // los bytes desde nuestro dominio en vez de mandar el link crudo de Monday al
  // iframe, que exige sesión de monday.com y bloquea el framing por CSP (ver
  // worker/lib/cotizacionPdfs.ts).
  app.get('/api/oportunidades/:id/cotizacion-pdf/:kind', async c => {
    const itemId = Number(c.req.param('id'));
    const kind = c.req.param('kind') as PdfKind;
    if (!Number.isFinite(itemId) || (kind !== 'sin_firmar' && kind !== 'firmada')) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    try {
      const url = await resolveCotizacionPdfUrl(c.env, itemId, viewer, kind);
      if (!url) return c.json({ error: 'not found' }, 404);
      const upstream = await fetch(url);
      if (!upstream.ok) return jsonStatus({ error: 'no se pudo obtener el PDF' }, 502);
      // Buffer en vez de pasar upstream.body como stream — el proxy de Vite en dev
      // se cuelga con una Response de Workers streameada sin Content-Length
      // (verificado en vivo: la petición nunca regresaba a través del proxy).
      // El PDF es chico (cientos de KB), bufferear no cuesta nada y evita el hang.
      const bytes = await upstream.arrayBuffer();
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'private, max-age=60',
        },
      });
    } catch (err) {
      if (err instanceof CotizacionPdfError) return jsonStatus({ error: err.message }, err.status);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  // Sirve archivos migrados a R2: documento/embellecimiento (los sube el
  // portal, dual-write real — ver worker/lib/r2.ts) y solicitud-costeo/
  // cotizacion-no-firmada/cotizacion-firmada/tallas/oc (los genera cmp-tallas
  // subiendo directo a Monday — sin dual-write posible, así que el fallback de
  // abajo es el único mecanismo que los sirve, no una optimización). Si el key
  // aún no existe en R2 (archivo viejo o recién generado por cmp-tallas) cae
  // de vuelta a Monday resolviendo el asset desde el mirror, para que el
  // frontend pueda apuntar siempre a /api/files/... sin depender del backfill.
  app.get('/api/files/:key{.+}', async c => {
    const key = c.req.param('key');
    const viewer = c.get('viewer');

    const object = await c.env.FILES.get(key);
    if (object) {
      return new Response(object.body, {
        status: 200,
        headers: {
          'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
          'Content-Length': String(object.size),
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }

    const parts = key.split('/');
    const oppId = Number(parts[1]);
    if (parts[0] !== 'oportunidades' || !Number.isFinite(oppId)) return c.json({ error: 'not found' }, 404);
    const categoria = parts[2];

    try {
      if (categoria === 'documento') {
        const filename = parts.slice(3).join('/');
        const proyecto = await proyectoForOportunidad(c.env, oppId, viewer);
        if (!proyecto) return c.json({ error: 'not found' }, 404);
        const entry = parseFiles(proyecto.columns, PROYECTO_DOCUMENTO_COL).find(f => f.name === filename);
        if (!entry) return c.json({ error: 'not found' }, 404);
        return await proxyMondayAsset(c.env, entry.assetId);
      }

      if (categoria === 'embellecimiento') {
        const lineaId = Number(parts[3]);
        const zone = parts[4];
        const filename = parts.slice(5).join('/');
        if (!Number.isFinite(lineaId)) return c.json({ error: 'not found' }, 404);
        const row = await getItem(c.env, 'oportunidades_sub', lineaId, viewer);
        if (!row) return c.json({ error: 'not found' }, 404);
        const entry = parseFiles(row.columns)
          .map(f => ({ ...f, split: splitZone(f.name) }))
          .find(f => f.split?.zone === zone && f.split.original === filename);
        if (!entry) return c.json({ error: 'not found' }, 404);
        return await proxyMondayAsset(c.env, entry.assetId);
      }

      if (categoria in OPP_FILE_COLS) {
        const filename = parts.slice(3).join('/');
        const row = await getItem(c.env, 'oportunidades', oppId, viewer);
        if (!row) return c.json({ error: 'not found' }, 404);
        const entry = parseFiles(row.columns, OPP_FILE_COLS[categoria]).find(f => f.name === filename);
        if (!entry) return c.json({ error: 'not found' }, 404);
        return await proxyMondayAsset(c.env, entry.assetId);
      }

      if (categoria in PROYECTO_FILE_COLS) {
        const filename = parts.slice(3).join('/');
        const proyecto = await proyectoForOportunidad(c.env, oppId, viewer);
        if (!proyecto) return c.json({ error: 'not found' }, 404);
        const entry = parseFiles(proyecto.columns, PROYECTO_FILE_COLS[categoria]).find(f => f.name === filename);
        if (!entry) return c.json({ error: 'not found' }, 404);
        return await proxyMondayAsset(c.env, entry.assetId);
      }

      return c.json({ error: 'not found' }, 404);
    } catch {
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.post('/api/oportunidades/lineas/:id/embellecimiento-imagen', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const form = await c.req.formData();
    const zone = String(form.get('zone') ?? '');
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);
    // Imagen o archivo (PDF, etc.) — file_mm5akjy5 es una columna de archivo
    // genérica de Monday, no solo de imágenes (Efraín, 2026-07-16).

    try {
      const result = await uploadZoneImage(c.env, c.executionCtx, itemId, viewer, zone, file, file.name);
      return c.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof EmbellImageError) return jsonStatus({ error: err.message }, err.status);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  // El Proyecto ligado a la oportunidad (tallas/OC viven ahí, no en la Oportunidad).
  // 200 con {proyecto: null} cuando aún no existe — el drawer muestra el estado vacío.
  app.get('/api/oportunidades/:id/proyecto', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const opp = await getItem(c.env, 'oportunidades', itemId, viewer);
    if (!opp) return c.json({ error: 'not found' }, 404);

    const row = await proyectoForOportunidad(c.env, itemId, viewer);
    if (!row) return c.json({ proyecto: null });

    const [pending, children, childPending] = await Promise.all([
      pendingItemIds(c.env, BOARDS.proyectos.id),
      childrenOf(c.env, 'proyectos', row.item_id, viewer),
      pendingItemIds(c.env, BOARDS.proyectos_sub.id),
    ]);
    const dto: ItemDetailDTO = toItemDTO(row, 'proyectos', viewer.role, pending.has(row.item_id));
    dto.children = children.map(r => toItemDTO(r, 'proyectos_sub', viewer.role, childPending.has(r.item_id)));
    return c.json({ proyecto: dto });
  });

  // Dirección inversa de la ruta de arriba (Proyecto → Oportunidad ligada). El
  // mirror puede venir vacío para board_relation aunque el link exista en Monday
  // (connect-columns no siempre mueven el updated_at del item, así que el
  // reconcile de 6h puede tardar en agarrarlo) — si el valor guardado no trae
  // el link, se resuelve en vivo esa sola columna de este item (mismo patrón que
  // ya usa createOportunidad.ts para deal_contact) en vez de esperar (Efraín,
  // 2026-07-17). Éxito por fallback dispara un refetch completo para que el
  // mirror se autocorrija y la próxima lectura ya no necesite el fallback.
  app.get('/api/proyectos/:id/oportunidad', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const row = await getItem(c.env, 'proyectos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    let oppId = linkedItemId(row, PROYECTO_OPP_REL);
    if (oppId === null) {
      try {
        const data = await gql(c.env,
          `query($id:[ID!]){ items(ids:$id){ column_values(ids:["${PROYECTO_OPP_REL}"]){ ... on BoardRelationValue{linked_item_ids} } } }`,
          { id: [String(itemId)] },
        );
        const linked: string[] = data?.items?.[0]?.column_values?.[0]?.linked_item_ids ?? [];
        oppId = linked.map(Number).find(Number.isFinite) ?? null;
        if (oppId !== null) c.executionCtx.waitUntil(refetchItem(c.env, BOARDS.proyectos.id, itemId));
      } catch { /* best-effort — sin link se muestra el estado vacío */ }
    }
    if (oppId === null) return c.json({ oportunidadId: null });

    // Re-valida el scoping del viewer sobre la Oportunidad ligada: que el
    // Proyecto sea visible no implica que la Oportunidad también lo sea.
    const opp = await getItem(c.env, 'oportunidades', oppId, viewer);
    return c.json({ oportunidadId: opp ? String(oppId) : null });
  });

  // Línea manual del Proyecto — para productos que faltaron en el desglose de
  // tallas o compras independientes que no vienen del Sheet importado. Mismo
  // patrón acotado que /api/oportunidades/:id/productos (subitem real vía
  // create_subitem, whitelist de columnas fija). Con esto, "Generar OC por
  // proveedor" (only_proveedor) ya cubre una OC "de la nada" (Efraín, 2026-07-17).
  // Registrada ANTES de /api/proyectos/:id/:action a propósito: ese wildcard
  // también matchea /lineas (action="lineas") y la intercepta con 404 si va después.
  app.post('/api/proyectos/:id/lineas', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (viewer.role !== 'compras' && viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const body = await c.req.json<{
      producto?: string; proveedorId?: string; cantidad?: number; talla?: string; color?: string; sku?: string;
    }>();
    const producto = body.producto?.trim();
    if (!producto) return c.json({ error: 'producto is required' }, 400);

    const row = await getItem(c.env, 'proyectos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const subitemCols: Record<string, unknown> = { text_mm0hs17x: producto };
    if (body.proveedorId) subitemCols.board_relation_mm1cfgv5 = { item_ids: [Number(body.proveedorId)] };
    if (body.cantidad !== undefined) subitemCols.numeric_mm0hj2q4 = body.cantidad;
    if (body.talla?.trim()) subitemCols.text_mm1antcb = body.talla.trim();
    if (body.color?.trim()) subitemCols.text_mm0h4a1c = body.color.trim();
    if (body.sku?.trim()) subitemCols.text_mm0hyrfs = body.sku.trim();

    try {
      const subitem = await createSubitem(c.env, itemId, producto, subitemCols);
      await upsertItem(c.env, 'proyectos_sub', subitem);
      return c.json({ ok: true, id: subitem.id });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'No se pudo crear la línea: ' + detail }, 500);
    }
  });

  // Sube la OC / cotización / contrato firmado por el cliente al Proyecto ligado.
  // Registrada ANTES de /api/proyectos/:id/:action a propósito — mismo motivo
  // que /lineas arriba: el wildcard también matchea /documento (action="documento")
  // e intercepta con 404 si va después (bug encontrado y corregido, Efraín 2026-07-17).
  app.post('/api/proyectos/:id/documento', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!canWrite('proyectos', PROYECTO_DOCUMENTO_COL, viewer.role)) return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, 'proyectos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);

    const asset = await addFileToColumn(c.env, itemId, PROYECTO_DOCUMENTO_COL, file, file.name);
    c.executionCtx.waitUntil(refetchItem(c.env, BOARDS.proyectos.id, itemId));

    // Dual-write a R2: el Proyecto no trae el oppId directo, se resuelve del
    // board_relation ya cargado en `row` (ver worker/lib/dal.ts). Si el
    // proyecto aún no está ligado (caso raro), se queda solo en Monday.
    const oppId = linkedItemId(row, PROYECTO_OPP_REL);
    if (oppId != null) {
      const key = oportunidadFileKey(oppId, 'documento', file.name);
      await putFile(c.env, key, file);
      return c.json({ ok: true, id: asset.id, name: asset.name, url: `/api/files/${key}` });
    }
    return c.json({ ok: true, id: asset.id, name: asset.name, url: asset.publicUrl });
  });

  app.post('/api/proyectos/:id/:action', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const action = PROYECTO_ACTIONS[c.req.param('action')];
    if (!action) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    if (!action.roles.includes(viewer.role)) return c.json({ error: 'forbidden' }, 403);
    const row = await getItem(c.env, 'proyectos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    // Body opcional — solo 'generar-oc' lo usa (onlyProveedor); las otras 3 acciones
    // siguen llamándose sin body, por eso el .catch cubre el JSON vacío.
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const opts = { onlyProveedor: typeof body.onlyProveedor === 'string' ? body.onlyProveedor : undefined };

    try {
      const result = await action.run(c.env, itemId, opts);
      // cmp-tallas escribe directo en Monday (links, archivos, subitems) — refresca el mirror.
      await refetchItemTree(c.env, BOARDS.proyectos.id, itemId);
      return c.json(result);
    } catch (err) {
      if (err instanceof AutomationError) return jsonStatus({ ok: false, reason: err.message }, err.status);
      return jsonStatus({ ok: false, reason: 'internal error' }, 500);
    }
  });
}
