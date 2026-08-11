// Rutas específicas del flujo de Oportunidades: costeo, versiones de
// cotización, líneas de producto, imágenes de embellecimiento, PDFs de
// cotización y Proyecto/acciones de cmp-tallas. Movido tal cual desde
// worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import type { AjustarLineaRequest, AjustarLineaResponse, DuplicarOportunidadResponse, DuplicarVersionResponse, ItemDetailDTO, QuoteVersionsResponse, TallaBoxInput, CapturarTallasResponse, EstadoHistorialResponse, ProductoResumenResponse } from '../../shared/dto';
import type { ProposedProductsResponse, AddProposedProductResponse } from '../../shared/productosPropuestos';
import { getItem, childrenOf, pendingItemIds, proyectoForOportunidad, linkedItemId, PROYECTO_OPP_REL } from '../lib/dal';
import { toItemDTO } from '../lib/serialize';
import { OutboxError } from '../lib/outbox';
import {
  generateCotizacion, generateSheet, confirmTallas, importTallas, generateOC,
  AutomationError,
} from '../lib/automations';
import { enviarACosteo, enviarAValidacion, checkCosteo, checkValidacion, CosteoError } from '../lib/costeo';
import { listVersions, duplicateVersion, restoreVersion, esDraftVigente, recordFirstVersion, QuoteVersionError } from '../lib/quoteVersions';
import { ajustarLinea, AjusteLineaError } from '../lib/lineaAjustes';
import { capturarTallas, reportarTallasIncorrectas } from '../lib/proyectoTallas';
import { listEstadoHistorial } from '../lib/estadoProducto';
import { listProductoResumen, upsertProductoResumen } from '../lib/productoResumen';
import { duplicateOportunidad, DuplicateOportunidadError } from '../lib/duplicateOportunidad';
import { ganarOportunidad, GanarOportunidadError } from '../lib/ganarOportunidad';
import { createSubitem, addFileToColumn, fetchAssetPublicUrls, gql } from '../lib/monday';
import { listZoneImages, uploadZoneImage, EmbellImageError } from '../lib/embellecimientoImagenes';
import { listProposedProducts, addProposedProduct, ProposedProductError } from '../lib/productosPropuestos';
import { resolveMondayAsset, PROYECTO_DOCUMENTO_COL } from '../lib/portalFiles';
import { putFile, oportunidadFileKey } from '../lib/r2';
import { resolveCotizacionPdfUrl, CotizacionPdfError, type PdfKind } from '../lib/cotizacionPdfs';
import { refetchItem, refetchItemTree, upsertItem } from '../sync';
import { jsonStatus } from '../lib/http';
import { canWrite } from '../../shared/visibility';
import { emitNotification } from '../lib/notify';
import { createDocument } from '../lib/documents';
import { md5 } from '../lib/canon';

// Acciones de cmp-tallas sobre el Proyecto. Cada una exige que el viewer pueda
// ver el Proyecto (scoping de dal) + un gate de rol que refleja el botón de
// Monday: confirmar=VENDEDOR, importar/oc=COMPRAS, regenerar=ambos.
const PROYECTO_ACTIONS: Record<string, {
  roles: string[];
  run: (env: Env, id: number, opts: { onlyProveedor?: string; metodoPago?: string; condPago?: string }) => Promise<{ ok: boolean; [k: string]: unknown }>;
}> = {
  'tallas-regenerar': { roles: ['vendedor', 'compras', 'admin'], run: (env, id) => generateSheet(env, id) },
  'tallas-confirmar': { roles: ['vendedor', 'admin'], run: (env, id) => confirmTallas(env, id) },
  'tallas-importar': { roles: ['compras', 'admin'], run: (env, id) => importTallas(env, id) },
  // onlyProveedor: id del item de `proveedores` — genera la OC de un solo proveedor
  // en vez de todos (ProveedorGrid, botón por tarjeta). metodoPago/condPago:
  // overrides de ese proveedor, solo tienen efecto junto con onlyProveedor.
  'generar-oc': {
    roles: ['compras', 'admin'],
    run: (env, id, opts) => generateOC(env, id, { onlyProveedor: opts.onlyProveedor, metodoPago: opts.metodoPago, condPago: opts.condPago }),
  },
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

// Notifica al propio vendedor cuando "Mandar a costeo" rechaza por datos
// faltantes (pre-chequeo local o rechazo del endpoint de cmp-tallas) — best-effort,
// nunca debe tumbar la respuesta 422 que ya trae la lista de errores.
async function notifyCosteoIncompleto(env: Env, viewer: Identity, itemId: number, errors: string[]): Promise<void> {
  try {
    const oppRow = await getItem(env, 'oportunidades', itemId, viewer);
    const oppName = oppRow?.name ?? '';
    await emitNotification(env, {
      recipientEmail: viewer.email,
      severity: 'importante',
      kind: 'costeo_incompleto',
      title: `Faltan datos para mandar a costeo${oppName ? ': ' + oppName : ''}`,
      body: errors.join('\n'),
      boardKey: 'oportunidades',
      boardId: BOARDS.oportunidades.id,
      itemId,
      actor: viewer.nombre ?? viewer.email,
      dedupeKey: `costeo:${itemId}:${md5(errors.join('|'))}`,
    });
  } catch { /* best-effort — no bloquea la respuesta 422 */ }
}

/** Genera (o regenera) la solicitud de costeo del portal y la deja acusada por
 * quien apretó el botón. Best-effort a propósito: si algo falla aquí, "Mandar a
 * costeo" ya se ejecutó en cmp-tallas y no se puede deshacer — el documento se
 * puede volver a generar a mano desde la pestaña Documentación. */
async function generarSolicitudCosteo(
  c: Context<{ Bindings: Env }>, itemId: number, viewer: Identity,
): Promise<void> {
  try {
    await createDocument(c.env, viewer, {
      templateId: 'solicitud-costeo',
      sourceId: String(itemId),
      acuse: { ip: c.req.header('CF-Connecting-IP') ?? null, userAgent: c.req.header('User-Agent') ?? null },
    });
  } catch (err) {
    console.log('[solicitud-costeo] ' + String(err));
  }
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
    const viewer = c.get('viewer');

    try {
      const result = await enviarACosteo(c.env, itemId, viewer);
      // El stage, el PDF y los snapshots de subitems los escribió cmp-tallas
      // directo en Monday — refresca el árbol completo en el mirror.
      if (result.ok) await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
      // Solicitud de costeo del portal: el click ya viene autenticado, así que
      // vale como acuse — se genera y se asienta sola, sin pedirle firma a nadie
      // (Efraín, 2026-07-26). Best-effort: nunca tumba el "Mandar a costeo".
      if (result.ok) await generarSolicitudCosteo(c, itemId, viewer);
      if (!result.ok) await notifyCosteoIncompleto(c.env, viewer, itemId, result.errors ?? []);
      return result.ok ? c.json(result) : jsonStatus(result, 422);
    } catch (err) {
      if (err instanceof CosteoError) {
        await notifyCosteoIncompleto(c.env, viewer, itemId, [err.message]);
        return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      }
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

  // "Ganar" (Efraín, 2026-08-05): además de la Etapa, crea el Proyecto ligado
  // con el mismo mapeo que la automatización nativa de Monday que vivía atada
  // a un BOTÓN de esa columna (nunca al valor de Etapa) — ganar desde el
  // portal no la disparaba y el Proyecto (tallas/OC) nunca aparecía. Hallazgo
  // real haciendo la prueba end-to-end pedida por Efraín — ver
  // worker/lib/ganarOportunidad.ts.
  app.post('/api/oportunidades/:id/ganar', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    try {
      const result = await ganarOportunidad(c.env, c.executionCtx, itemId, c.get('viewer'));
      await refetchItem(c.env, BOARDS.oportunidades.id, itemId);
      return c.json({ ok: true, proyectoId: String(result.proyectoId) });
    } catch (err) {
      if (err instanceof GanarOportunidadError) return jsonStatus({ ok: false, error: err.message }, err.status);
      return jsonStatus({ ok: false, error: 'internal error' }, 500);
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

    // scope 'own' aquí y en todo lo que muta: un líder de zona ve las oportunidades
    // de su equipo pero no dispara automatizaciones sobre ellas (worker/lib/zonas.ts).
    const row = await getItem(c.env, 'oportunidades', itemId, viewer, 'own');
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
      const item = await getItem(c.env, 'oportunidades', itemId, viewer, 'own');
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

  // "Ajustar línea" (Efraín, 2026-07-31): cambiar producto (género)/color/
  // embellecimiento/cantidad de una línea sin versión ni costeo, incluso con
  // la Oportunidad Ganada — ver worker/lib/lineaAjustes.ts. :id es la línea
  // (subitem), no la oportunidad, mismo patrón que embellecimiento-imagenes
  // más abajo.
  app.post('/api/oportunidades/lineas/:id/ajustar', async c => {
    const lineaId = Number(c.req.param('id'));
    if (!Number.isFinite(lineaId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    const body = await c.req.json<AjustarLineaRequest>();
    if (body.modo !== 'editar' && body.modo !== 'dividir') return c.json({ error: 'modo inválido' }, 400);

    try {
      const result = await ajustarLinea(c.env, c.executionCtx, lineaId, viewer, body);
      await refetchItemTree(c.env, BOARDS.oportunidades.id, result.itemId);
      return c.json({ ok: true, lineaId: result.lineaId, nuevaLineaId: result.nuevaLineaId } satisfies AjustarLineaResponse);
    } catch (err) {
      if (err instanceof AjusteLineaError) return jsonStatus({ ok: false, error: err.message } satisfies AjustarLineaResponse, err.status);
      return jsonStatus({ ok: false, error: 'internal error' } satisfies AjustarLineaResponse, 500);
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
    if (!Number.isFinite(itemId) || (kind !== 'sin_firmar' && kind !== 'firmada' && kind !== 'solicitud_costeo')) return c.json({ error: 'not found' }, 404);
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

    // Esta ruta sirve cualquier key que exista en R2, así que se limita
    // explícitamente al prefijo de documentación de oportunidades (2026-07-25):
    // el bucket también guarda ya los PDFs de `documentos/…`, que tienen su
    // propia ruta con scoping por fuente (worker/routes/documents.ts).
    if (!key.startsWith('oportunidades/')) return c.json({ error: 'not found' }, 404);

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

    // El mapa key→columna de Monday vive en worker/lib/portalFiles.ts, para que
    // documents.ts pueda leer los mismos bytes al sellarlos (2026-07-25).
    try {
      const assetId = await resolveMondayAsset(c.env, key, viewer);
      if (assetId == null) return c.json({ error: 'not found' }, 404);
      return await proxyMondayAsset(c.env, assetId);
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

  // Tab "Nuevos productos" (worker/lib/productosPropuestos.ts): nativo en D1, sin
  // board de Monday detrás. El POST también avisa a Compras (update @mención +
  // notificación del portal) — así saben que Ventas está esperando seguimiento
  // (Efraín, 2026-07-30).
  app.get('/api/oportunidades/:id/productos-propuestos', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    try {
      const productos = await listProposedProducts(c.env, itemId, viewer);
      return c.json({ productos } satisfies ProposedProductsResponse);
    } catch (err) {
      if (err instanceof ProposedProductError) return jsonStatus({ error: err.message }, err.status);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  app.post('/api/oportunidades/:id/productos-propuestos', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const form = await c.req.formData();
    const nombre = String(form.get('nombre') ?? '');
    const descripcion = String(form.get('descripcion') ?? '');
    const file = form.get('file');

    try {
      const producto = await addProposedProduct(c.env, itemId, viewer, nombre, descripcion, file instanceof File ? file : undefined);
      return c.json({ ok: true, producto } satisfies AddProposedProductResponse);
    } catch (err) {
      if (err instanceof ProposedProductError) return jsonStatus({ error: err.message }, err.status);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  // Sube "Inventario Actual (Imagen)" (file_mm0hpefr) — se muestra en Documentación
  // junto a la cotización firmada, mismo template de sección (Efraín, 2026-08-10:
  // "Compras puede agregar el archivo Inventario"). Dual-write a R2 igual que
  // /proyectos/:id/documento arriba.
  app.post('/api/oportunidades/:id/inventario', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!canWrite('oportunidades', 'file_mm0hpefr', viewer.role)) return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, 'oportunidades', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);

    const asset = await addFileToColumn(c.env, itemId, 'file_mm0hpefr', file, file.name);
    c.executionCtx.waitUntil(refetchItem(c.env, BOARDS.oportunidades.id, itemId));

    const key = oportunidadFileKey(itemId, 'inventario', file.name);
    await putFile(c.env, key, file);
    return c.json({ ok: true, id: asset.id, name: asset.name, url: `/api/files/${key}` });
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

  // Timeline de "Estado del producto" por línea (tab Ejecución) — historial vive en
  // D1 (worker/lib/estadoProducto.ts), no en columnas de fecha de Monday. Mismo
  // scoping de lectura que el resto de rutas de Proyecto (propio + zona liderada).
  app.get('/api/proyectos/:id/estado-historial', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    const row = await getItem(c.env, 'proyectos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const historial = await listEstadoHistorial(c.env, itemId);
    const response: EstadoHistorialResponse = {
      historial: historial.map(h => ({
        subItemId: String(h.sub_item_id),
        estadoPrevio: h.estado_previo,
        estadoNuevo: h.estado_nuevo,
        changedAt: h.changed_at,
        changedBy: h.changed_by,
        comentario: h.comentario,
      })),
    };
    return c.json(response);
  });

  // Resumen libre por producto+color (tab Ejecución) — nativo en D1, worker/lib/
  // productoResumen.ts. Mismo scoping de lectura que estado-historial (propio + zona
  // liderada); escritura solo compras/admin, mismo gate que S_COMENTARIO por talla.
  app.get('/api/proyectos/:id/resumen-producto', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    const row = await getItem(c.env, 'proyectos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const resumen = await listProductoResumen(c.env, itemId);
    const response: ProductoResumenResponse = {
      resumen: resumen.map(r => ({
        producto: r.producto,
        color: r.color,
        resumen: r.resumen,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      })),
    };
    return c.json(response);
  });

  app.patch('/api/proyectos/:id/resumen-producto', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (viewer.role !== 'compras' && viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ producto?: string; color?: string; resumen?: string }>();
    const producto = body.producto?.trim();
    if (!producto) return c.json({ error: 'producto is required' }, 400);

    await upsertProductoResumen(c.env, {
      proyectoId: itemId, producto, color: body.color?.trim() ?? '',
      resumen: body.resumen ?? '', actorEmail: viewer.email,
    });
    return c.json({ ok: true });
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

    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
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

  // Captura de tallas por boxes (vendedor) — crea subitems del Proyecto directo
  // desde la UI de boxes de TallasTab, sin pasar por cmp-tallas (worker/lib/proyectoTallas.ts).
  // El Sheet + "Importar tallas" (Compras) siguen intactos, es una alta alternativa
  // más rápida, no un reemplazo. Registrada ANTES de /api/proyectos/:id/:action por
  // el mismo motivo que /lineas y /documento arriba.
  app.post('/api/proyectos/:id/tallas-capturar', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (viewer.role !== 'vendedor' && viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ rows?: TallaBoxInput[] }>();
    const rows = Array.isArray(body.rows) ? body.rows : [];

    try {
      const result = await capturarTallas(c.env, viewer, itemId, rows);
      return c.json(result satisfies CapturarTallasResponse);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'No se pudieron guardar las tallas: ' + detail }, 500);
    }
  });

  // Reportar tallas incorrectas (vendedor/compras/admin, mismo grupo que edita
  // Cantidad inline en ProyectoTallasSection) — avisa a Compras por Monday +
  // WhatsApp cuando una línea producto+color no cuadra contra lo cotizado.
  // Registrada ANTES de /api/proyectos/:id/:action por el mismo motivo que
  // /lineas y /tallas-capturar arriba.
  app.post('/api/proyectos/:id/tallas-reportar', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!['vendedor', 'compras', 'admin'].includes(viewer.role)) return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ producto?: string; color?: string }>();
    const producto = body.producto?.trim();
    if (!producto) return c.json({ error: 'producto is required' }, 400);

    try {
      const result = await reportarTallasIncorrectas(c.env, viewer, itemId, row.name, producto, body.color?.trim() || undefined);
      return c.json(result);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'No se pudo reportar: ' + detail }, 500);
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

    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
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
    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    // Body opcional — solo 'generar-oc' lo usa (onlyProveedor/metodoPago/condPago);
    // las otras 3 acciones siguen llamándose sin body, por eso el .catch cubre el JSON vacío.
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const opts = {
      onlyProveedor: typeof body.onlyProveedor === 'string' ? body.onlyProveedor : undefined,
      metodoPago: typeof body.metodoPago === 'string' ? body.metodoPago : undefined,
      condPago: typeof body.condPago === 'string' ? body.condPago : undefined,
    };

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
