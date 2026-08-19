// Rutas específicas del flujo de Oportunidades: costeo, versiones de
// cotización, líneas de producto, imágenes de embellecimiento, PDFs de
// cotización y Proyecto/acciones de cmp-tallas. Movido tal cual desde
// worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import type { AjustarLineaRequest, AjustarLineaResponse, CotizacionVirtualDTO, DuplicarOportunidadRequest, DuplicarOportunidadResponse, DuplicarVersionResponse, ItemDetailDTO, QuoteVersionsResponse, TallaBoxInput, CapturarTallasResponse, EstadoHistorialResponse, ProductoResumenResponse, ProductoGeneroResponse } from '../../shared/dto';
import type { ProposedProductsResponse, AddProposedProductResponse } from '../../shared/productosPropuestos';
import { getItem, childrenOf, pendingItemIds, proyectoForOportunidad, linkedItemId, PROYECTO_OPP_REL } from '../lib/dal';
import { toItemDTO } from '../lib/serialize';
import { OutboxError, submitWrite } from '../lib/outbox';
import {
  generateCotizacion, generateSheet, confirmTallas, importTallas, generateOC,
  AutomationError,
} from '../lib/automations';
import { enviarACosteo, enviarAValidacion, confirmarCosteo, checkCosteo, checkValidacion, CosteoError } from '../lib/costeo';
import { generarCotizacionNative, generarCotizacionNativeD1, CotizacionError } from '../lib/cotizacion';
import { listVersions, duplicateVersion, restoreVersion, hayLineaPendiente, recordFirstVersion, QuoteVersionError } from '../lib/quoteVersions';
import { ajustarLinea, AjusteLineaError } from '../lib/lineaAjustes';
import { listCotizacionVirtual, ajustarLineaVirtual, ProyectoCotizacionError } from '../lib/proyectoCotizacionVirtual';
import { capturarTallas, reportarTallasIncorrectas, checkOcCliente, confirmTallasNative, confirmTallasNativeD1 } from '../lib/proyectoTallas';
import { generarOcNative, generarOcNativeD1 } from '../lib/oc';
import { getOcNota, getOcNotas, setOcNota, OC_NOTA_MAX } from '../lib/ocNotas';
import { listEstadoHistorial } from '../lib/estadoProducto';
import { recordDirectChanges } from '../lib/activityLog';
import { listProductoResumen, upsertProductoResumen } from '../lib/productoResumen';
import { listGeneroMF, setGeneroMF } from '../lib/productoGenero';
import { syncTallasPortal } from '../lib/airtable';
import { duplicateOportunidad, DuplicateOportunidadError } from '../lib/duplicateOportunidad';
import { ganarOportunidad, GanarOportunidadError } from '../lib/ganarOportunidad';
import { createSubitem, addFileToColumn, fetchAssetPublicUrls, gql } from '../lib/monday';
import { borrarItem, BorradoError } from '../lib/itemBorrado';
import { buscarArchivo, borrarArchivoDeColumna, puedeBorrarArchivo, registrarSubida, subidoPor, ArchivoBorradoError } from '../lib/archivoBorrado';
import { postUpdate } from '../lib/nativeUpdates';
import { stampInstitucionEnOpsDeContacto } from '../lib/nativeMirrors';
import { toNativeColumns, insertNativeSubitem, stampNativeFileMarker } from '../lib/nativeItems';
import { insertSeguimiento } from '../lib/home';
import { listZoneImages, uploadZoneImage, EmbellImageError } from '../lib/embellecimientoImagenes';
import { listProposedProducts, addProposedProduct, ProposedProductError } from '../lib/productosPropuestos';
import { resolveMondayAsset, PROYECTO_DOCUMENTO_COL } from '../lib/portalFiles';
import { putFile, oportunidadFileKey } from '../lib/r2';
import { resolveCotizacionPdfUrl, nativeCotizacionPdf, CotizacionPdfError, type PdfKind } from '../lib/cotizacionPdfs';
import { refetchItem, refetchItemTree, upsertItem } from '../sync';
import { jsonStatus } from '../lib/http';
import { contentTypeFor, isGenericType } from '../lib/mime';
import { canWrite } from '../../shared/visibility';
import { reserveNativeId } from '../lib/nativeSeq';
import { canonValue, rawHash, type RawColumn } from '../lib/canon';
import { emitNotification } from '../lib/notify';
import { createDocument, documentPdf } from '../lib/documents';
import { generarOcProveedorPdf, OcProveedorPdfError } from '../lib/ocProveedorPdf';
import { generarCotizacionPreviewPdf, CotizacionPreviewPdfError } from '../lib/cotizacionPreviewPdf';
import { md5 } from '../lib/canon';

// Comentarios de la OC en el Proyecto (text_mm4c74f8) — es de donde cmp-tallas
// saca el bloque de comentarios del PDF; el portal lo usa solo como puente para
// la nota por proveedor que guarda en D1 (worker/lib/ocNotas.ts).
const PROYECTO_COMENTARIOS_OC = 'text_mm4c74f8';

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
 * cuelga el proxy de Vite en dev). `name` (el key pedido) solo se usa para
 * deducir el Content-Type: Monday manda todo como octet-stream y así el
 * navegador descargaba las imágenes en vez de mostrarlas. */
async function proxyMondayAsset(env: Env, assetId: number, name: string): Promise<Response> {
  const urls = await fetchAssetPublicUrls(env, [String(assetId)]);
  const url = urls.get(String(assetId));
  if (!url) return jsonStatus({ error: 'not found' }, 404);
  const upstream = await fetch(url);
  if (!upstream.ok) return jsonStatus({ error: 'no se pudo obtener el archivo' }, 502);
  const bytes = await upstream.arrayBuffer();
  const upstreamType = upstream.headers.get('content-type');
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': isGenericType(upstreamType) ? contentTypeFor(name) : upstreamType!,
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

// "Solicitud Costeo" (docs/monday-column-map.md) — antes la llenaba el PDF de Eledo
// que subía cmp-tallas; en modo nativo (COSTEO_NATIVE=1) el PDF propio del portal
// pasa a ser el oficial también ahí.
const OPP_FILE_COSTEO = 'file_mm10k65a';

/** Genera (o regenera) la solicitud de costeo del portal y la deja acusada por
 * quien apretó el botón. Best-effort a propósito: si algo falla aquí, "Mandar a
 * costeo" ya se ejecutó (nativo o cmp-tallas) y no se puede deshacer — el
 * documento se puede volver a generar a mano desde la pestaña Documentación.
 * `folioCosteo`: cuando viene (modo nativo), los mismos bytes se suben además a
 * Monday (file_mm10k65a) con el folio de worker/lib/costeo.ts's nextCosteoSeq —
 * en modo cmp-tallas esa columna ya la llena Eledo, así que aquí no se toca. */
async function generarSolicitudCosteo(
  c: Context<{ Bindings: Env }>, itemId: number, viewer: Identity, folioCosteo?: string,
): Promise<void> {
  try {
    const doc = await createDocument(c.env, viewer, {
      templateId: 'solicitud-costeo',
      sourceId: String(itemId),
      acuse: { ip: c.req.header('CF-Connecting-IP') ?? null, userAgent: c.req.header('User-Agent') ?? null },
    });
    if (c.env.COSTEO_NATIVE === '1' && folioCosteo && !isNativeId(itemId)) {
      const { bytes } = await documentPdf(c.env, doc.id, viewer, false);
      const filename = `costeo_${folioCosteo.replace(/[^\w.-]+/g, '_')}.pdf`;
      await addFileToColumn(c.env, itemId, OPP_FILE_COSTEO, new Blob([bytes], { type: 'application/pdf' }), filename);
    }
  } catch (err) {
    console.log('[solicitud-costeo] ' + String(err));
  }
}

/** Hoja de costeo (todas las columnas de Costeo, en horizontal) al **validar el
 * costeo** (7→9) — sola, sin pedirle nada a nadie, mismo trato de "acuse
 * automático" que la solicitud de costeo. Solo la ven compras/admin
 * (shared/documents.ts DOC_TEMPLATES['validacion-costeo'].view).
 *
 * Salía al MANDAR a validación (15→7) hasta el 2026-08-18, y ahí el Precio de
 * Venta todavía no existe: se captura durante la validación, así que el
 * documento se congelaba con precio, subtotal y total en $0 y una utilidad
 * negativa igual al costo (visto en OPP-0913: el precio entró 1h45 después de
 * generarse el PDF). Efraín: "obvio necesito el precio si no no sirve de nada".
 * Aquí el precio ya está garantizado — "Validar costeo" es justamente la
 * aprobación de esa columna y la UI no deja apretarlo sin ella.
 *
 * Best-effort: la etapa ya se movió y no se deshace porque el PDF falle. */
async function generarHojaValidacion(c: Context<{ Bindings: Env }>, itemId: number, viewer: Identity): Promise<void> {
  try {
    await createDocument(c.env, viewer, {
      templateId: 'validacion-costeo',
      sourceId: String(itemId),
      acuse: { ip: c.req.header('CF-Connecting-IP') ?? null, userAgent: c.req.header('User-Agent') ?? null },
    });
  } catch (err) {
    console.log('[validacion-costeo] ' + String(err));
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
      const result = await enviarACosteo(c.env, c.executionCtx, itemId, viewer);
      // El stage (y, si ok, los snapshots de subitems) se escribió directo en
      // Monday — cmp-tallas o el flujo nativo (COSTEO_NATIVE=1), ambos mutan
      // incluso al rechazar (revierten a "Nueva oportunidad" + update). Un
      // rechazo del pre-chequeo LOCAL (checkCosteo) nunca toca Monday — de ahí
      // `mutated`, para no gastar una lectura de más en ese caso, con mucho el
      // más frecuente.
      if (result.ok || result.mutated) await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
      // Solicitud de costeo del portal: el click ya viene autenticado, así que
      // vale como acuse — se genera y se asienta sola, sin pedirle firma a nadie
      // (Efraín, 2026-07-26). Best-effort: nunca tumba el "Mandar a costeo".
      if (result.ok) await generarSolicitudCosteo(c, itemId, viewer, result.folio);
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

  // "Validar costeo" — dirección aprueba el precio de venta (etapa 7→9 "Costeo
  // Confirmado"). Igual que enviar-validacion: no hay endpoint de cmp-tallas
  // para este paso, el portal escribe el stage. SOLO admin: es exactamente la
  // aprobación de Precio de Venta C/U, la única columna con `w: ['admin']`
  // (shared/visibility.ts). Hasta 2026-08-18 el drawer saltaba de aquí directo
  // a "Generar cotización" — no había dónde validar (Efraín).
  app.post('/api/oportunidades/:id/validar-costeo', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    try {
      const result = await confirmarCosteo(c.env, c.executionCtx, itemId, viewer);
      if (result.ok) {
        // Árbol completo (no solo el padre) y ANTES de generar el documento: el
        // Precio de Venta se captura seguido en Monday directo, y el documento
        // congela lo que vea el espejo — con la relectura del padre nada más,
        // las líneas podían entrar todavía con el precio viejo.
        await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
        await generarHojaValidacion(c, itemId, viewer);
      }
      return result.ok ? c.json(result) : jsonStatus(result, 422);
    } catch (err) {
      if (err instanceof CosteoError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      if (err instanceof OutboxError) return jsonStatus({ ok: false, errors: [err.message] }, err.status);
      return jsonStatus({ ok: false, errors: ['internal error'] }, 500);
    }
  });

  // Seguimiento (pantalla Inicio, Efraín 2026-08-10): mensaje corto del vendedor
  // sobre una oportunidad stale — se postea como Update REAL de Monday (visible
  // para cualquiera que abra el item ahí, no solo en el portal) y se guarda
  // ligado por monday_update_id (worker/lib/home.ts insertSeguimiento), nunca
  // como texto suelto desconectado del Update.
  app.post('/api/oportunidades/:id/seguimiento', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    const body = await c.req.json().catch(() => ({}));
    const mensaje = typeof body.mensaje === 'string' ? body.mensaje.trim() : '';
    if (!mensaje) return jsonStatus({ error: 'mensaje requerido' }, 422);

    const item = await getItem(c.env, 'oportunidades', itemId, viewer, 'own');
    if (!item) return c.json({ error: 'not found' }, 404);

    // El Update lo postea la cuenta de la integración, no el viewer — se
    // prefija el nombre para que en Monday quede claro quién habló (mismo
    // patrón que worker/lib/productosPropuestos.ts / proyectoTallas.ts).
    const actorName = viewer.nombre ?? viewer.email;
    const update = await postUpdate(c.env, BOARDS.oportunidades.id, itemId, `${actorName}: ${mensaje}`);
    await insertSeguimiento(c.env, {
      itemId, mondayUpdateId: Number(update.id), autorEmail: viewer.email, mensaje,
    });
    return c.json({ ok: true, updateId: update.id });
  });

  // Institución de la oportunidad (Efraín, 2026-08-18: "que se pueda elegir una
  // institución a la oportunidad y que se ligue al contacto automáticamente").
  // La oportunidad NO tiene columna propia de Institución: `lookup_mm1bs976` es
  // un espejo del Contacto ligado, así que elegirla aquí escribe la relación EN
  // EL CONTACTO (`contact_account`) — el mismo dato que edita
  // EditContactoModal, solo que llegando desde la oportunidad. Sin Cliente no
  // hay dónde guardarla: se rechaza con el motivo en claro.
  app.post('/api/oportunidades/:id/institucion', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    const body = await c.req.json<{ institucionId?: string }>().catch(() => ({}) as { institucionId?: string });
    const institucionId = Number(body.institucionId);
    if (!Number.isFinite(institucionId) || institucionId === 0) {
      return jsonStatus({ ok: false, error: 'Falta elegir la institución' }, 422);
    }

    // scope 'own' en la oportunidad (un líder de zona la VE pero no la escribe)
    // y, abajo, el scope propio del CONTACTO dentro de submitWrite: el permiso
    // de columna (`contact_account`, vendedor+admin) sale de la misma whitelist
    // que el resto de writes.
    const opp = await getItem(c.env, 'oportunidades', itemId, viewer, 'own');
    if (!opp) return c.json({ error: 'not found' }, 404);
    const contactoId = linkedItemId(opp, 'deal_contact');
    if (!contactoId) {
      return jsonStatus({
        ok: false,
        error: 'Esta oportunidad no tiene Cliente todavía. Asigna primero el contacto y vuelve a elegir la institución.',
      }, 422);
    }
    if (!(await getItem(c.env, 'instituciones', institucionId, viewer))) {
      return jsonStatus({ ok: false, error: 'Institución no encontrada' }, 404);
    }

    try {
      await submitWrite(c.env, c.executionCtx, 'contactos', contactoId, { contact_account: String(institucionId) }, viewer);
    } catch (err) {
      if (err instanceof OutboxError) {
        // 404 de submitWrite = el contacto no es del viewer (dal scope 'own').
        const error = err.status === 404
          ? 'El contacto de esta oportunidad es de otro vendedor — pídele a esa persona o a un admin que cambie la institución.'
          : err.message;
        return jsonStatus({ ok: false, error }, err.status === 404 ? 403 : err.status);
      }
      return jsonStatus({ ok: false, error: 'internal error' }, 500);
    }

    const institucion = await stampInstitucionEnOpsDeContacto(c.env, contactoId, institucionId);
    return c.json({ ok: true, institucion });
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
  // embellecimiento a una oportunidad nueva — `etapa` (opcional, default
  // "Nueva oportunidad") la elige quien duplica en DuplicarOportunidadModal;
  // nunca versiones de cotización ni otros documentos (worker/lib/duplicateOportunidad.ts).
  app.post('/api/oportunidades/:id/duplicar', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json<DuplicarOportunidadRequest>().catch(() => ({}) as DuplicarOportunidadRequest);

    try {
      const result = await duplicateOportunidad(c.env, c.executionCtx, itemId, c.get('viewer'), body.etapa);
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
      // Fase 2 (plan "salir de Monday", 2026-08-12): mismo gate que COSTEO_NATIVE —
      // fallback vivo a cmp-tallas mientras se corre en paralelo contra
      // oportunidades reales y se compara el resultado antes de cortar el cable.
      // Un item nativo (Zona Efrain) no cabe en ninguna de las dos ramas de
      // arriba (ninguna sabe hablar con un id que no existe en Monday) —
      // siempre su propia rama D1-only, sin importar el flag.
      const result = isNativeId(itemId)
        ? await generarCotizacionNativeD1(c.env, c.executionCtx, itemId, viewer)
        : c.env.COTIZACION_NATIVE === '1'
          ? await generarCotizacionNative(c.env, itemId, viewer)
          : await generateCotizacion(c.env, itemId);
      if (result.ok) {
        const folio = 'folio' in result ? result.folio : (result as { folio_cotizacion?: unknown }).folio_cotizacion;
        await recordFirstVersion(c.env, itemId, viewer, typeof folio === 'string' ? folio : undefined, Number(result.total ?? 0));
      }
      await refetchItem(c.env, BOARDS.oportunidades.id, itemId);
      return c.json(result);
    } catch (err) {
      if (err instanceof AutomationError) return jsonStatus({ ok: false, reason: err.message }, err.status);
      if (err instanceof CotizacionError) return jsonStatus({ ok: false, reason: err.message }, err.status);
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
        // Agregar una línea sobre una vigente ya costeada versiona en automático
        // (mismo mecanismo que "+ Nueva versión") en vez de bloquear — las
        // versiones son un registro "detrás", nunca un candado para seguir
        // trabajando la cotización, incluida Ganada/Perdida (Efraín, 2026-08-14).
        const lineas = await childrenOf(c.env, 'oportunidades', itemId, viewer);
        // La línea nueva nace sin Etapa Costeo (= pendiente); las que ya
        // estaban costeadas no se tocan (Efraín, 2026-08-19).
        if (lineas.length > 0 && !hayLineaPendiente(lineas)) {
          await duplicateVersion(c.env, c.executionCtx, itemId, viewer, { resetear: [] });
        }
      }

      // Cantidad arranca en 0 a propósito (Efraín) — el grid la marca con warning
      // hasta que el vendedor la captura, en vez de fingir una cantidad de 1.
      const subitemName = 'Nueva línea';

      // Item nativo (Zona Efrain, "salir de Monday"): la línea nace y vive en D1
      // igual que el padre — mismo espacio de ids sintéticos (reserveNativeId),
      // sin create_subitem a Monday. oportunidades_sub no tiene authzCols (los
      // subitems se scopean por el dueño del PADRE, worker/lib/dal.ts), así que
      // no hace falta el shape estructurado que sí necesita un item con personas.
      if (isNativeId(itemId)) {
        const lineId = await reserveNativeId(c.env);
        const cantidadText = canonValue('numeric', String(body.cantidad ?? 0));
        const columns: RawColumn[] = [
          { id: 'numeric_mkzm6399', type: 'numeric', text: cantidadText, value: JSON.stringify(cantidadText) },
        ];
        const now = new Date().toISOString();
        await c.env.DB
          .prepare(
            `INSERT INTO items (board_id, item_id, parent_item_id, name, group_id, vendedor_ids, monday_updated_at, synced_at, content_hash, columns)
             VALUES (?, ?, ?, ?, NULL, '[]', ?, ?, ?, ?)`,
          )
          .bind(BOARDS.oportunidades_sub.id, lineId, itemId, subitemName, now, now, rawHash(columns), JSON.stringify(columns))
          .run();
        try {
          await recordDirectChanges(c.env, 'oportunidades_sub', [{
            boardId: BOARDS.oportunidades_sub.id, itemId: lineId, event: 'create_pulse',
            columnId: null, columnTitle: null, previousText: null, newText: subitemName,
            userId: viewer.monday_user_id, userEmail: viewer.email,
          }]);
        } catch { /* best-effort */ }
        return c.json({ ok: true, id: String(lineId) });
      }

      // Subitem real (create_subitem, no create_item) — así Monday lo linkea al
      // padre automáticamente; create_item en el board de subitems NO lo hace.
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
    if (body.modo !== 'editar' && body.modo !== 'dividir' && body.modo !== 'eliminar') {
      return c.json({ error: 'modo inválido' }, 400);
    }

    // 'eliminar' (Efraín, 2026-08-13): a diferencia de editar/dividir, borrar
    // una línea completa cambia el total de la cotización — se maneja aparte,
    // reusando duplicateVersion (archiva la vigente como versión nueva y
    // resetea Etapa Costeo) antes de borrar, mismo mecanismo que "+ Nueva
    // versión" y con el mismo guard de Ganada/Perdida.
    if (body.modo === 'eliminar') {
      const linea = await getItem(c.env, 'oportunidades_sub', lineaId, viewer, 'own');
      if (!linea || linea.parent_item_id == null) return c.json({ error: 'not found' }, 404);
      const itemId = linea.parent_item_id;
      try {
        // `resetear: []`: se archiva la foto (ahí queda la línea eliminada)
        // y ninguna línea viva se descostea (Efraín, 2026-08-19).
        await duplicateVersion(c.env, c.executionCtx, itemId, viewer, { resetear: [] });
        // Se borra en Monday y en el mirror (worker/lib/itemBorrado.ts): una
        // línea que solo se esconde del portal sigue contando en costeo y en la
        // cotización, que leen Monday directo (Efraín, 2026-08-19). Sigue
        // siendo recuperable: la versión que acaba de archivar duplicateVersion
        // la conserva, y el renglón completo queda en `item_borrado`.
        await borrarItem(c.env, BOARDS.oportunidades_sub.id, lineaId, viewer.email);
        await refetchItemTree(c.env, BOARDS.oportunidades.id, itemId);
        const versions = await listVersions(c.env, itemId, viewer);
        return c.json({ ok: true, lineaId, versions } satisfies AjustarLineaResponse);
      } catch (err) {
        if (err instanceof QuoteVersionError) return jsonStatus({ ok: false, error: err.message } satisfies AjustarLineaResponse, err.status);
        if (err instanceof BorradoError) return jsonStatus({ ok: false, error: err.message } satisfies AjustarLineaResponse, err.status);
        return jsonStatus({ ok: false, error: 'internal error' } satisfies AjustarLineaResponse, 500);
      }
    }

    try {
      const result = await ajustarLinea(c.env, c.executionCtx, lineaId, viewer, body);
      await refetchItemTree(c.env, BOARDS.oportunidades.id, result.itemId);
      return c.json({ ok: true, lineaId: result.lineaId, nuevaLineaId: result.nuevaLineaId, costoDivergente: result.costoDivergente } satisfies AjustarLineaResponse);
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
      // Oportunidad nativa (Zona Efrain): no hay asset de Monday que resolver —
      // los PDFs de Eledo quedaron en R2 y el nombre en el marcador de la
      // columna (worker/lib/cotizacion.ts).
      if (isNativeId(itemId)) {
        const nativo = await nativeCotizacionPdf(c.env, itemId, viewer, kind);
        if (!nativo) return c.json({ error: 'not found' }, 404);
        return new Response(nativo.bytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(nativo.bytes.byteLength),
            'Cache-Control': 'private, max-age=60',
          },
        });
      }

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
      // El tipo guardado gana, pero si el upload no traía uno (o llegó como
      // octet-stream) se deduce de la extensión — si no, el navegador descarga
      // la imagen en vez de abrirla.
      const stored = object.httpMetadata?.contentType;
      return new Response(object.body, {
        status: 200,
        headers: {
          'Content-Type': isGenericType(stored) ? contentTypeFor(key) : stored!,
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
      return await proxyMondayAsset(c.env, assetId, key);
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

  // OC a proveedor generada nativa por el portal (2026-08-13) — arma el PDF al
  // vuelo desde el mirror, sin pasar por Eledo/cmp-tallas. Convive con el botón
  // "Generar OC" existente (worker/lib/automations.ts generateOC) mientras se
  // prueba: ese sigue siendo el flujo oficial con folio + firmas por DocuSeal.
  app.get('/api/proyectos/:id/oc-nativa/:proveedorId/pdf', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const proveedorId = c.req.param('proveedorId');
    const viewer = c.get('viewer');
    if (viewer.role !== 'compras' && viewer.role !== 'admin') return jsonStatus({ error: 'forbidden' }, 403);

    try {
      const bytes = await generarOcProveedorPdf(c.env, itemId, proveedorId, viewer);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.length),
          'Content-Disposition': 'inline; filename="orden-de-compra.pdf"',
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      if (err instanceof OcProveedorPdfError) return jsonStatus({ error: err.message }, err.status);
      return jsonStatus({ error: 'internal error' }, 500);
    }
  });

  // Notas al proveedor de una OC (worker/lib/ocNotas.ts) — texto libre de
  // Compras que se imprime en el PDF. Una por proveedor, no una por Proyecto:
  // ver el porqué en ese archivo. Mismo gate de rol que el resto del tab
  // "Órdenes de compra" (el desglose por proveedor es de Compras/Admin).
  app.get('/api/proyectos/:id/oc-notas', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (viewer.role !== 'compras' && viewer.role !== 'admin') return jsonStatus({ error: 'forbidden' }, 403);
    const row = await getItem(c.env, 'proyectos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ notas: await getOcNotas(c.env, itemId) });
  });

  app.put('/api/proyectos/:id/oc-notas/:proveedorId', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const proveedorId = c.req.param('proveedorId');
    const viewer = c.get('viewer');
    if (viewer.role !== 'compras' && viewer.role !== 'admin') return jsonStatus({ error: 'forbidden' }, 403);
    // Muta -> scope 'own' (worker/lib/dal.ts): el líder de zona LEE el proyecto
    // de su equipo pero no le escribe la nota.
    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const nota = typeof body.nota === 'string' ? body.nota : '';
    if (nota.length > OC_NOTA_MAX) {
      return jsonStatus({ error: `La nota no puede pasar de ${OC_NOTA_MAX} caracteres.` }, 400);
    }
    const guardada = await setOcNota(c.env, itemId, proveedorId, nota, viewer.email);
    return c.json({ ok: true, nota: guardada });
  });

  // Cotización — vista previa generada nativa por el portal (2026-08-13), mismo
  // template visual que la OC a proveedor. SOLO vista previa: no se guarda en
  // D1, no se firma, no sale de aquí — la cotización oficial para el cliente
  // sigue generándose en Eledo (docs/documentos-firma.md, Efraín 2026-07-26).
  app.get('/api/oportunidades/:id/cotizacion-preview/pdf', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    try {
      const bytes = await generarCotizacionPreviewPdf(c.env, itemId, viewer);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.length),
          'Content-Disposition': 'inline; filename="cotizacion-vista-previa.pdf"',
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      if (err instanceof CotizacionPreviewPdfError) return jsonStatus({ error: err.message }, err.status);
      return jsonStatus({ error: 'internal error' }, 500);
    }
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

  // Cotización del Proyecto (Efraín, 2026-08-10; escritura real desde
  // 2026-08-13): mismas líneas de la Oportunidad ligada; "Editar/Dividir"
  // reusa el motor de "Ajustar línea" de Oportunidades (worker/lib/lineaAjustes.ts)
  // así que SÍ escribe a Monday, pero autoriza contra el dueño del Proyecto,
  // no de la Oportunidad (ver comentario de worker/lib/proyectoCotizacionVirtual.ts).
  // Solo versiones intermedias (V{n}.{m}); no existe "+ Nueva versión" desde el Proyecto.
  app.get('/api/proyectos/:id/cotizacion-virtual', async c => {
    const proyectoId = Number(c.req.param('id'));
    if (!Number.isFinite(proyectoId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    try {
      const data = await listCotizacionVirtual(c.env, proyectoId, viewer);
      return c.json(data satisfies CotizacionVirtualDTO);
    } catch (err) {
      if (err instanceof ProyectoCotizacionError) return jsonStatus({ error: err.message }, err.status);
      return jsonStatus({ error: 'internal error' }, 500);
    }
  });

  // :lineaId es siempre un subitem real de la Oportunidad ligada.
  app.post('/api/proyectos/:id/cotizacion-virtual/lineas/:lineaId/ajustar', async c => {
    const proyectoId = Number(c.req.param('id'));
    const lineaId = Number(c.req.param('lineaId'));
    if (!Number.isFinite(proyectoId) || !Number.isFinite(lineaId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    const body = await c.req.json<AjustarLineaRequest>();
    if (body.modo !== 'editar' && body.modo !== 'dividir') return c.json({ error: 'modo inválido' }, 400);

    try {
      const result = await ajustarLineaVirtual(c.env, c.executionCtx, proyectoId, lineaId, viewer, body);
      if (result.itemId != null) await refetchItemTree(c.env, BOARDS.oportunidades.id, result.itemId);
      return c.json({ ok: result.ok, lineaId: result.lineaId, nuevaLineaId: result.nuevaLineaId, costoDivergente: result.costoDivergente } satisfies AjustarLineaResponse);
    } catch (err) {
      if (err instanceof ProyectoCotizacionError) return jsonStatus({ ok: false, error: err.message } satisfies AjustarLineaResponse, err.status);
      if (err instanceof AjusteLineaError) return jsonStatus({ ok: false, error: err.message } satisfies AjustarLineaResponse, err.status);
      return jsonStatus({ ok: false, error: 'internal error' } satisfies AjustarLineaResponse, 500);
    }
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

  // Checkbox "Género M/F" por producto de catálogo (worker/lib/productoGenero.ts)
  // — nativo en D1, mismo gate de escritura que Tallas (text_mm5v6jhj, grupo WAC
  // en shared/visibility.ts). Decide si el write-back a Airtable "Tallas Portal"
  // (worker/lib/airtable.ts syncTallasPortal) expande la lista con prefijo M-/F-;
  // nunca se ve en Monday.
  app.get('/api/productos/genero', async c => {
    const response: ProductoGeneroResponse = { generos: await listGeneroMF(c.env) };
    return c.json(response);
  });

  app.patch('/api/productos/:id/genero', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!canWrite('productos', 'text_mm5v6jhj', viewer.role)) return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, 'productos', itemId, viewer);
    if (!row) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ generoMF?: boolean }>();
    await setGeneroMF(c.env, itemId, !!body.generoMF, viewer.email);
    c.executionCtx.waitUntil(syncTallasPortal(c.env, row));
    return c.json({ ok: true });
  });

  // Línea manual del Proyecto — para productos que faltaron en el desglose de
  // tallas o compras independientes que no vienen del Sheet importado. Mismo
  // patrón acotado que /api/oportunidades/:id/productos (subitem real vía
  // create_subitem, whitelist de columnas fija). Con esto, "Generar OC por
  // proveedor" (only_proveedor) ya cubre una OC "de la nada" (Efraín, 2026-07-17).
  // Registrada ANTES de /api/proyectos/:id/:action a propósito: ese wildcard
  // también matchea /lineas (action="lineas") y la intercepta con 404 si va después.
  // Tipos Monday de las columnas que llena la línea manual — los necesita
  // toNativeColumns para escribir el mismo shape que dejaría un echo de Monday
  // (worker/lib/nativeItems.ts).
  const LINEA_MANUAL_COL_TYPES: Record<string, string> = {
    text_mm0hs17x: 'text', board_relation_mm1cfgv5: 'board_relation', numeric_mm0hj2q4: 'numeric',
    text_mm1antcb: 'text', text_mm0h4a1c: 'text', text_mm0hyrfs: 'text',
    numeric_mm1dj4fp: 'numbers', numeric_mm1dmsaz: 'numbers', text_mm1gdsvg: 'text',
  };
  app.post('/api/proyectos/:id/lineas', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (viewer.role !== 'compras' && viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const body = await c.req.json<{
      producto?: string; proveedorId?: string; cantidad?: number; talla?: string; color?: string; sku?: string;
      costo?: number; descuento?: number; moneda?: string;
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
    // Costo/descuento/moneda desde el alta (Efraín, 2026-08-18): una OC "de la
    // nada" nace completa, sin tener que editar la línea inmediatamente después
    // — son las mismas columnas que el PDF de la OC lee (worker/lib/ocProveedorPdf.ts).
    if (body.costo !== undefined && Number.isFinite(body.costo)) subitemCols.numeric_mm1dj4fp = body.costo;
    if (body.descuento !== undefined && Number.isFinite(body.descuento)) subitemCols.numeric_mm1dmsaz = body.descuento;
    if (body.moneda?.trim()) subitemCols.text_mm1gdsvg = body.moneda.trim();

    try {
      // Proyecto nativo (Zona Efrain): la línea es una fila más de `items` con
      // id sintético — no hay subitem que crear del lado de Monday. Mismo
      // camino que capturarTallas (worker/lib/proyectoTallas.ts), compartido
      // vía worker/lib/nativeItems.ts.
      if (isNativeId(itemId)) {
        const columns = toNativeColumns(subitemCols, LINEA_MANUAL_COL_TYPES);
        // toNativeColumns deja el `text` del board_relation como el ID crudo
        // (es lo único que sabe); en un item real ese texto es el NOMBRE del
        // proveedor, y es de donde la tarjeta de la OC saca su título. Sin
        // esto la tarjeta se titulaba "12686013883" (visto en la prueba local
        // 2026-08-18) — no hay espejo de Monday que lo rellene después.
        if (body.proveedorId) {
          const prov = await c.env.DB.prepare('SELECT name FROM items WHERE board_id = ? AND item_id = ?')
            .bind(BOARDS.proveedores.id, Number(body.proveedorId)).first<{ name: string }>();
          const rel = columns.find(col => col.id === 'board_relation_mm1cfgv5');
          if (rel && prov?.name) rel.text = prov.name;
        }
        const id = await insertNativeSubitem(c.env, 'proyectos_sub', itemId, producto, columns);
        // El alta de una línea REAL la registra Monday en su activity_log y el
        // delta sync la recoge (proyectos_sub ya está en la whitelist de
        // worker/lib/activityLog.ts); un proyecto nativo no tiene ese log, así
        // que se asienta aquí o el alta no deja rastro en ninguna parte.
        await recordDirectChanges(c.env, 'proyectos_sub', [{
          boardId: BOARDS.proyectos_sub.id, itemId: id, event: 'create_pulse',
          columnId: null, columnTitle: null,
          previousText: null, newText: producto,
          userId: viewer.monday_user_id, userEmail: viewer.email,
        }]);
        return c.json({ ok: true, id: String(id) });
      }
      const subitem = await createSubitem(c.env, itemId, producto, subitemCols);
      await upsertItem(c.env, 'proyectos_sub', subitem);
      return c.json({ ok: true, id: subitem.id });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'No se pudo crear la línea: ' + detail }, 500);
    }
  });

  // Borrar una línea del Proyecto — Compras corrige una OC que trae de más
  // (Efraín, 2026-08-18). No se usa el DELETE genérico de /api/boards porque
  // ese no distingue rol (un vendedor podría borrar líneas del proyecto) ni
  // deja rastro: aquí queda asentado en activity_log contra el Proyecto padre,
  // que es lo único que sobrevive al borrado de la línea.
  app.delete('/api/proyectos/:id/lineas/:lineaId', async c => {
    const itemId = Number(c.req.param('id'));
    const lineaId = Number(c.req.param('lineaId'));
    if (!Number.isFinite(itemId) || !Number.isFinite(lineaId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (viewer.role !== 'compras' && viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);
    const linea = await getItem(c.env, 'proyectos_sub', lineaId, viewer, 'own');
    if (!linea || linea.parent_item_id !== itemId) return c.json({ error: 'not found' }, 404);

    // Borra en Monday y en el mirror (worker/lib/itemBorrado.ts); en un
    // Proyecto NATIVO (Zona Efrain) la línea solo vive en D1 y ahí se queda
    // en la fila de D1, que es su sistema de registro.
    try {
      await borrarItem(c.env, BOARDS.proyectos_sub.id, lineaId, viewer.email);
    } catch (err) {
      if (err instanceof BorradoError) return jsonStatus({ ok: false, error: err.message }, err.status);
      throw err;
    }

    await recordDirectChanges(c.env, 'proyectos', [{
      boardId: BOARDS.proyectos.id, itemId, event: 'delete_pulse',
      columnId: null, columnTitle: null,
      previousText: linea.name, newText: null,
      userId: viewer.monday_user_id, userEmail: viewer.email,
    }]);
    return c.json({ ok: true });
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

    // Proyecto nativo (Zona Efrain, "salir de Monday"): no existe columna de
    // Monday a la que subir — el archivo vive SOLO en R2, y se estampa un
    // marcador en `items.columns` para que checkOcCliente (worker/lib/
    // proyectoTallas.ts) encuentre texto no vacío en PROYECTO_DOCUMENTO_COL.
    if (isNativeId(itemId)) {
      const oppId = linkedItemId(row, PROYECTO_OPP_REL);
      const key = oppId != null ? oportunidadFileKey(oppId, 'documento', file.name) : null;
      if (key) await putFile(c.env, key, file);
      await stampNativeFileMarker(c.env, 'proyectos', itemId, PROYECTO_DOCUMENTO_COL, file.name, 'replace');
      // assetId 0: un item nativo no tiene asset de Monday — el registro de
      // quién subió empata por nombre (worker/lib/archivoBorrado.ts).
      await registrarSubida(c.env, BOARDS.proyectos.id, itemId, PROYECTO_DOCUMENTO_COL, { assetId: 0, nombre: file.name }, viewer.email);
      return c.json({ ok: true, id: `native-${Date.now()}`, name: file.name, url: key ? `/api/files/${key}` : '' });
    }

    const asset = await addFileToColumn(c.env, itemId, PROYECTO_DOCUMENTO_COL, file, file.name);
    c.executionCtx.waitUntil(refetchItem(c.env, BOARDS.proyectos.id, itemId));

    // Deja constancia de QUIÉN lo subió: Monday no lo sabe decir (todo sube con
    // el token de servicio), y sin esto no se puede cumplir "solo el que lo
    // subió lo puede borrar" (Efraín, 2026-08-19).
    await registrarSubida(c.env, BOARDS.proyectos.id, itemId, PROYECTO_DOCUMENTO_COL,
      { assetId: Number(asset.id) || 0, nombre: asset.name || file.name }, viewer.email);

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

  // Borra un archivo de la OC/contrato: del portal Y de Monday, 1-1
  // (worker/lib/archivoBorrado.ts — respaldo en R2 antes, tope por hora, y
  // `update_assets_on_item` en vez de cualquier mutación destructiva).
  // Efraín, 2026-08-19: "vendedor puede borrar documentos que el SUBIO".
  app.post('/api/proyectos/:id/documento/borrar', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!canWrite('proyectos', PROYECTO_DOCUMENTO_COL, viewer.role)) return c.json({ error: 'forbidden' }, 403);

    // scope 'own': borrar es una escritura — solo sobre lo propio, nunca sobre
    // lo que el viewer apenas LEE por liderar la zona (worker/lib/zonas.ts).
    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ assetId?: number; nombre?: string }>().catch(() => ({} as { assetId?: number; nombre?: string }));
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    const assetId = Number(body.assetId) || 0;
    if (!nombre && !assetId) return c.json({ error: 'falta el archivo a borrar' }, 400);

    // En vivo, no contra el mirror: el espejo tarda en ver una subida y borrar
    // lo recién subido contestaba 404 (prueba de producción, 2026-08-19).
    const archivo = await buscarArchivo(c.env, BOARDS.proyectos.id, itemId, PROYECTO_DOCUMENTO_COL, { assetId, nombre });
    if (!archivo) return c.json({ error: 'ese documento ya no está en el proyecto' }, 404);

    const uploader = await subidoPor(c.env, BOARDS.proyectos.id, itemId, PROYECTO_DOCUMENTO_COL, archivo);
    if (!puedeBorrarArchivo(viewer, uploader)) {
      return c.json({ error: 'ese documento lo subió alguien más — pídele a quien lo subió, o a un admin, que lo borre' }, 403);
    }

    try {
      const oppId = linkedItemId(row, PROYECTO_OPP_REL);
      const res = await borrarArchivoDeColumna(c.env, {
        slug: 'proyectos', itemId, colId: PROYECTO_DOCUMENTO_COL,
        oppId, categoria: 'documento', ref: archivo, viewer,
      });
      if (!isNativeId(itemId)) await refetchItem(c.env, BOARDS.proyectos.id, itemId);
      return c.json({ ok: true, nombre: res.nombre });
    } catch (err) {
      if (err instanceof ArchivoBorradoError) return jsonStatus({ error: err.message }, err.status);
      return c.json({ error: 'No se pudo borrar el documento.' }, 500);
    }
  });

  // Sube "# Guia - empresa" / "Evidencia recolección" (columnas file de
  // proyectos_sub) desde el tab Logística — mismo patrón dual-write que
  // /proyectos/:id/documento arriba, pero por subitem: el key de R2 lleva
  // subitemId+field para no chocar entre líneas (worker/lib/portalFiles.ts
  // resolveMondayAsset tiene la rama 'logistica' que sabe leerlo de vuelta).
  const LOGISTICA_FILE_COLS: Record<string, string> = {
    'guia-empresa': 'file_mm4pz90b',
    'evidencia-recoleccion': 'file_mm4pc4tj',
  };
  app.post('/api/proyectos_sub/:id/logistica/:field', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const field = c.req.param('field');
    const colId = LOGISTICA_FILE_COLS[field];
    if (!colId) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');
    if (!canWrite('proyectos_sub', colId, viewer.role)) return c.json({ error: 'forbidden' }, 403);

    const row = await getItem(c.env, 'proyectos_sub', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);

    // Resolver el oppId: proyectos_sub no tiene el board_relation a la
    // Oportunidad directo — se sube por el padre (parent_item_id = Proyecto).
    const proyectoId = row.parent_item_id;
    const proyectoRow = proyectoId != null ? await getItem(c.env, 'proyectos', proyectoId, viewer, 'own') : null;
    const oppId = proyectoRow ? linkedItemId(proyectoRow, PROYECTO_OPP_REL) : null;

    // Línea nativa (Zona Efrain): no hay columna de Monday a la que subir — el
    // archivo vive SOLO en R2 y se estampa el marcador en el mirror, igual que
    // /proyectos/:id/documento. Sin oppId no hay key estable que reconstruir
    // después, así que ahí se rechaza en vez de dejar el archivo huérfano.
    if (isNativeId(itemId)) {
      if (oppId == null) return c.json({ error: 'el proyecto no está ligado a una oportunidad' }, 409);
      const key = oportunidadFileKey(oppId, `logistica/${itemId}/${field}`, file.name);
      await putFile(c.env, key, file);
      await stampNativeFileMarker(c.env, 'proyectos_sub', itemId, colId, file.name);
      return c.json({ ok: true, id: `native-${itemId}-${field}`, name: file.name, url: `/api/files/${key}` });
    }

    const asset = await addFileToColumn(c.env, itemId, colId, file, file.name);
    c.executionCtx.waitUntil(refetchItem(c.env, BOARDS.proyectos_sub.id, itemId));

    if (oppId != null) {
      const key = oportunidadFileKey(oppId, `logistica/${itemId}/${field}`, file.name);
      await putFile(c.env, key, file);
      return c.json({ ok: true, id: asset.id, name: asset.name, url: `/api/files/${key}` });
    }
    return c.json({ ok: true, id: asset.id, name: asset.name, url: asset.publicUrl });
  });

  app.post('/api/proyectos/:id/:action', async c => {
    const itemId = Number(c.req.param('id'));
    if (!Number.isFinite(itemId)) return c.json({ error: 'not found' }, 404);
    const actionKey = c.req.param('action');
    const action = PROYECTO_ACTIONS[actionKey];
    if (!action) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    if (!action.roles.includes(viewer.role)) return c.json({ error: 'forbidden' }, 403);
    const row = await getItem(c.env, 'proyectos', itemId, viewer, 'own');
    if (!row) return c.json({ error: 'not found' }, 404);

    // El botón del cliente ya se deshabilita sin el documento (ProyectoActionBar) —
    // esto es el gate real: la API se puede llamar directo sin pasar por la UI.
    if (actionKey === 'tallas-confirmar') {
      const pre = checkOcCliente(row);
      if (!pre.ok) return jsonStatus({ ok: false, reason: pre.error }, 400);
    }

    // Body opcional — solo 'generar-oc' lo usa (onlyProveedor/metodoPago/condPago);
    // las otras 3 acciones siguen llamándose sin body, por eso el .catch cubre el JSON vacío.
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const opts = {
      onlyProveedor: typeof body.onlyProveedor === 'string' ? body.onlyProveedor : undefined,
      metodoPago: typeof body.metodoPago === 'string' ? body.metodoPago : undefined,
      condPago: typeof body.condPago === 'string' ? body.condPago : undefined,
    };

    // cmp-tallas genera su PDF leyendo los comentarios de la COLUMNA del Proyecto
    // y no acepta la nota por request (docs/cmp-tallas-endpoint-map.md): para ese
    // camino la nota de ESTE proveedor se estampa en la columna justo antes de
    // disparar, o la OC saldría sin ella. Los dos caminos nativos la leen directo
    // de D1 (worker/lib/ocNotas.ts) y no pasan por aquí.
    const legacyOc = actionKey === 'generar-oc' && !isNativeId(itemId) && c.env.OC_NATIVE !== '1';
    if (legacyOc && opts.onlyProveedor) {
      const nota = await getOcNota(c.env, itemId, opts.onlyProveedor);
      if (nota) {
        try {
          await submitWrite(c.env, c.executionCtx, 'proyectos', itemId, { [PROYECTO_COMENTARIOS_OC]: nota }, viewer);
        } catch { /* best-effort: la OC sale sin la nota, no vale abortar el flujo */ }
      }
    }

    try {
      // Fase 3/4 (plan "salir de Monday", 2026-08-12): mismo gate que
      // COSTEO_NATIVE/COTIZACION_NATIVE — fallback vivo a cmp-tallas mientras se
      // corre en paralelo contra Proyectos reales antes de cortar el cable.
      // "tallas-regenerar"/"tallas-importar" siguen en cmp-tallas (dependen del
      // Sheet, que esta fase retiró — Efraín, 2026-08-12).
      const result = actionKey === 'tallas-confirmar' && isNativeId(itemId)
        ? await confirmTallasNativeD1(c.env, c.executionCtx, viewer, itemId)
        : actionKey === 'tallas-confirmar' && c.env.TALLAS_NATIVE === '1'
        ? await confirmTallasNative(c.env, viewer, itemId)
        : actionKey === 'generar-oc' && isNativeId(itemId)
        ? await generarOcNativeD1(c.env, viewer, itemId, opts)
        : actionKey === 'generar-oc' && c.env.OC_NATIVE === '1'
        ? await generarOcNative(c.env, viewer, itemId, opts)
        : await action.run(c.env, itemId, opts);
      // cmp-tallas (o el flujo nativo) escribe directo en Monday — refresca el mirror.
      await refetchItemTree(c.env, BOARDS.proyectos.id, itemId);
      return c.json(result);
    } catch (err) {
      if (err instanceof AutomationError) return jsonStatus({ ok: false, reason: err.message }, err.status);
      return jsonStatus({ ok: false, reason: 'internal error' }, 500);
    }
  });
}
