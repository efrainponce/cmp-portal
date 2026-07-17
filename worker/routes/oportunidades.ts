// Rutas específicas del flujo de Oportunidades: costeo, versiones de
// cotización, líneas de producto, imágenes de embellecimiento, PDFs de
// cotización y Proyecto/acciones de cmp-tallas. Movido tal cual desde
// worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Hono } from 'hono';
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import type { DuplicarOportunidadResponse, DuplicarVersionResponse, ItemDetailDTO, QuoteVersionsResponse } from '../../shared/dto';
import { getItem, childrenOf, pendingItemIds, proyectoForOportunidad } from '../lib/dal';
import { toItemDTO } from '../lib/serialize';
import { OutboxError } from '../lib/outbox';
import {
  generateCotizacion, generateSheet, confirmTallas, importTallas, generateOC,
  AutomationError,
} from '../lib/automations';
import { enviarACosteo, enviarAValidacion, checkCosteo, CosteoError } from '../lib/costeo';
import { listVersions, duplicateVersion, restoreVersion, esDraftVigente, recordFirstVersion, QuoteVersionError } from '../lib/quoteVersions';
import { duplicateOportunidad, DuplicateOportunidadError } from '../lib/duplicateOportunidad';
import { createSubitem } from '../lib/monday';
import { listZoneImages, uploadZoneImage, EmbellImageError } from '../lib/embellecimientoImagenes';
import { resolveCotizacionPdfUrl, CotizacionPdfError, type PdfKind } from '../lib/cotizacionPdfs';
import { refetchItem, refetchItemTree, upsertItem } from '../sync';
import { jsonStatus } from '../lib/http';

// Acciones de cmp-tallas sobre el Proyecto. Cada una exige que el viewer pueda
// ver el Proyecto (scoping de dal) + un gate de rol que refleja el botón de
// Monday: confirmar=VENDEDOR, importar/oc=COMPRAS, regenerar=ambos.
const PROYECTO_ACTIONS: Record<string, {
  roles: string[];
  run: (env: Env, id: number) => Promise<{ ok: boolean; [k: string]: unknown }>;
}> = {
  'tallas-regenerar': { roles: ['vendedor', 'compras', 'admin'], run: (env, id) => generateSheet(env, id) },
  'tallas-confirmar': { roles: ['vendedor', 'admin'], run: (env, id) => confirmTallas(env, id) },
  'tallas-importar': { roles: ['compras', 'admin'], run: (env, id) => importTallas(env, id) },
  'generar-oc': { roles: ['compras', 'admin'], run: (env, id) => generateOC(env, id) },
};

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

  app.post('/api/proyectos/:id/:action', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const action = PROYECTO_ACTIONS[c.req.param('action')];
    if (!action) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    if (!action.roles.includes(viewer.role)) return c.json({ error: 'forbidden' }, 403);
    const row = await getItem(c.env, 'proyectos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    try {
      const result = await action.run(c.env, itemId);
      // cmp-tallas escribe directo en Monday (links, archivos, subitems) — refresca el mirror.
      await refetchItemTree(c.env, BOARDS.proyectos.id, itemId);
      return c.json(result);
    } catch (err) {
      if (err instanceof AutomationError) return jsonStatus({ ok: false, reason: err.message }, err.status);
      return jsonStatus({ ok: false, reason: 'internal error' }, 500);
    }
  });
}
