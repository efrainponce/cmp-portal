// worker/lib/proyectoTallas.ts — captura de tallas por boxes (vendedor): crea
// subitems del Proyecto directo, mismo patrón que POST /api/proyectos/:id/lineas
// (createSubitem, sin pasar por cmp-tallas). El Sheet + "Importar tallas"
// (worker/lib/automations.ts) siguen intactos como flujo paralelo — esto no los
// reemplaza, solo da una alta rápida alternativa.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import { registrarArchivo } from './archivoLog';
import type { Identity, MirrorItem } from '../../shared/types';
import type { TallaBoxInput, CapturarTallasResponse } from '../../shared/dto';
import { postUpdate } from './nativeUpdates';
import { toNativeColumns, insertNativeSubitem } from './nativeItems';
import { proveedorPorId } from './nativeMirrors';
import type { RawCol } from './serialize';
import { getItem, childrenOf, linkedItemId, ownsItem, PROYECTO_OPP_REL } from './dal';
import {
  createSubitem, gql, fetchItemWithSubitems, addFileToColumn, fetchUserById,
  cvText, cvNum, firstPersonId, type MentionInput, type MondayCol,
} from './monday';
import { emitNotification } from './notify';
import { upsertItem, refetchItem } from '../sync';
import { BOARDS } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import { PROYECTO_DOCUMENTO_COL } from './portalFiles';
import { renderDocument, type Block } from './pdf/layout';
import { fechaLarga } from './pdf/templates';
import { createDocuSealSubmission } from './docuseal';
import { getOrCreateDriveFolderForOportunidad, uploadPdfToDrive } from './drive';
import { fmtNumMx as NUM } from './importeEnLetras';
import { type RawColumn } from './canon';
import { submitWrite } from './outbox';
import { oportunidadFileKey, putFile } from './r2';

export type { TallaBoxInput };

// Oportunidad — línea de cotización (oportunidades_sub, 18395657607): costeo ya
// snapshoteado por "Solicitar costeo" (worker/lib/costeo.ts), redactado para
// vendedor en shared/visibility.ts — aquí se lee del mirror crudo (MirrorItem),
// nunca del DTO filtrado, porque quien llama este flujo es el propio vendedor.
const OPP_SUB_COSTO = 'numeric_mm0bph99';
const OPP_SUB_MONEDA = 'lookup_mm11t8gj';
const OPP_SUB_DESCUENTO = 'numeric_mkzn2q51';
const OPP_SUB_UNIDAD = 'lookup_mm0w4f4v';
const OPP_SUB_PRODUCTO_REL = 'board_relation_mkzmafgp';

// Productos (18395657591) — Proveedor asignado por Compras en Costeo
// (worker/lib/costeo.ts PRODUCTO_PROVEEDOR_COL, Efraín 2026-08-04: "no puede
// pasar si no tiene proveedor"), copiado de aquí al subitem del Proyecto.
const PRODUCTO_PROVEEDOR_COL = 'board_relation_mm1cwqky';

// Proyecto — subitems (proyectos_sub, 18395657609): mismas columnas que ya
// escribe POST /api/proyectos/:id/lineas, más costeo y proveedor copiados de
// la línea de cotización / su producto de catálogo.
const SUB_PRODUCTO = 'text_mm0hs17x';
const SUB_SKU = 'text_mm0hyrfs';
const SUB_COLOR = 'text_mm0h4a1c';
const SUB_TALLA = 'text_mm1antcb';
const SUB_CANTIDAD = 'numeric_mm0hj2q4';
const SUB_COSTO = 'numeric_mm1dj4fp';
const SUB_MONEDA = 'text_mm1gdsvg';
const SUB_DESCUENTO = 'numeric_mm1dmsaz';
const SUB_UNIDAD = 'text_mm56dbkm';
const SUB_PROVEEDOR = 'board_relation_mm1cfgv5';
const SUB_PROVEEDOR_RZ = 'lookup_mm1d2y9b';   // espejo: Proveedor → Razón Social (lo imprime la OC)

// Oportunidad — línea de cotización, mismos ids que TallasTab.tsx SUB_COLOR/
// SUB_CANTIDAD: lo cotizado originalmente para esa línea (producto+color),
// para cruzar contra lo ya importado al Proyecto (reportarTallasIncorrectas).
const OPP_SUB_SKU = 'lookup_mkzn7x9a';
const OPP_SUB_COLOR = 'text_mm07s2mg';
const OPP_SUB_CANTIDAD_COTIZADA = 'numeric_mkzm6399';

// Proyecto (18395657594) — "Confirmar tallas" nativo (Fase 3). Ids verificados
// contra shared/column-meta.gen.ts, mismos que cmp-tallas api/confirm_tallas.py.
const PROYECTO_STATUS = 'project_status';
const PROYECTO_STATUS_REVERT = 'Desglose de tallas';
// Título actual en Monday: "OC interna" — el nombre quedó desactualizado en
// algún momento, pero el id es el que confirm_tallas.py usa en producción para
// subir el PDF de relación de tallas; los ids de Monday no cambian con el título.
const PROYECTO_PDF_TALLAS = 'file_mm0hcrtz';
const PROYECTO_FOLIO = 'pulse_id_mm1a12gy';
const PROYECTO_FOLIO_OPP = 'lookup_mm1d56mp';
const PROYECTO_CARGO = 'lookup_mm1d1546';
const PROYECTO_CLIENTE = 'board_relation_mm0hb0gy';
const PROYECTO_INSTITUCION = 'lookup_mm1dwn6';
const PROYECTO_VENDEDOR = 'multiple_person_mm0hrnqq';

const NO_CUADRA_MSG =
  '⚠️ El desglose de tallas no cuadra con las cantidades de la oportunidad.\n' +
  'Por favor revisa el documento y asegúrate de que la suma de cada producto\n' +
  'coincida exactamente con la cantidad requerida antes de volver a solicitar validación.';

function firstLinkedId(cols: MondayCol[], id: string): number | null {
  const raw = cols.find(c => c.id === id)?.value;
  if (!raw) return null;
  try {
    const ids = (JSON.parse(raw) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
    const first = ids.map(Number).find(Number.isFinite);
    return first ?? null;
  } catch {
    return null;
  }
}

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

/** "Validar tallas (vendedor)" exige que el cliente ya tenga su OC/cotización/
 * contrato firmado subido en el Proyecto (file_mm0hayh4) — Efraín, 2026-08-10:
 * "no pueden empezar a enviar a validación de tallas sin el documento del
 * cliente". Solo lectura, mismo criterio que checkCosteo/checkValidacion
 * (worker/lib/costeo.ts): se valida ANTES de pegarle a cmp-tallas. */
export function checkOcCliente(row: MirrorItem): { ok: true } | { ok: false; error: string } {
  const tiene = !!colsOf(row).get(PROYECTO_DOCUMENTO_COL)?.text;
  return tiene ? { ok: true } : {
    ok: false,
    error: 'Falta subir la orden de compra / cotización firmada / contrato del cliente antes de validar tallas (pestaña Documentación).',
  };
}

/** Proyecto → Oportunidad ligada — mismo fallback en vivo que
 * GET /api/proyectos/:id/oportunidad (worker/routes/oportunidades.ts) para
 * cuando el mirror del board_relation todavía no capturó el link. */
export async function resolveOportunidadId(env: Env, viewer: Identity, proyectoId: number): Promise<number | null> {
  const row = await getItem(env, 'proyectos', proyectoId, viewer);
  if (!row) return null;
  let oppId = linkedItemId(row, PROYECTO_OPP_REL);
  if (oppId === null) {
    try {
      const data = await gql(env,
        `query($id:[ID!]){ items(ids:$id){ column_values(ids:["${PROYECTO_OPP_REL}"]){ ... on BoardRelationValue{linked_item_ids} } } }`,
        { id: [String(proyectoId)] },
      );
      const linked: string[] = data?.items?.[0]?.column_values?.[0]?.linked_item_ids ?? [];
      oppId = linked.map(Number).find(Number.isFinite) ?? null;
    } catch { /* best-effort — sin link, se captura sin enriquecimiento de costeo */ }
  }
  return oppId;
}

export interface CosteoEnrichment {
  costo?: string; moneda?: string; descuento?: string; unidad?: string;
  proveedorId?: number;
}

/** OPP_SUB_DESCUENTO (numeric_mkzn2q51) es el SNAP_DESC_PCT que escribe
 * worker/lib/costeo.ts's computeSnapshot — un PORCENTAJE entero (18 = 18%), no
 * una fracción. SUB_DESCUENTO en el Proyecto (numeric_mm1dmsaz) espera fracción
 * 0-1 (buildTallaColumns/oc.ts, mismo contrato que el Python real
 * import_tallas.py línea 374: `descuento_raw * 0.01`) — sin este ×0.01 aquí,
 * "18" se leía como 1800% y generate_oc.py calculaba subtotales negativos
 * (encontrado en la prueba end-to-end nativa de Fases 1-4, 2026-08-13).
 * La misma conversión, del lado de la UI del portal (donde se teclea el % a
 * mano), vive en shared/descuento.ts — si cambia la convención de la columna,
 * los dos lados se mueven juntos. */
export function pctTextToFraction(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? String(n / 100) : undefined;
}

async function fetchCosteoEnrichment(env: Env, oppId: number, viewer: Identity): Promise<Map<number, CosteoEnrichment>> {
  const lineas = await childrenOf(env, 'oportunidades', oppId, viewer);
  const map = new Map<number, CosteoEnrichment>();
  // Cache por producto de catálogo — varias líneas pueden compartir SKU, y así
  // solo se pide una vez el Proveedor de cada uno (mismo patrón que
  // productoCache en worker/lib/costeo.ts checkValidacion).
  const proveedorCache = new Map<number, number | null>();
  for (const row of lineas) {
    const cols = colsOf(row);
    const enr: CosteoEnrichment = {
      costo: cols.get(OPP_SUB_COSTO)?.text || undefined,
      moneda: cols.get(OPP_SUB_MONEDA)?.text || undefined,
      descuento: pctTextToFraction(cols.get(OPP_SUB_DESCUENTO)?.text || undefined),
      unidad: cols.get(OPP_SUB_UNIDAD)?.text || undefined,
    };
    const productoId = linkedItemId(row, OPP_SUB_PRODUCTO_REL);
    if (productoId !== null) {
      if (!proveedorCache.has(productoId)) {
        const producto = await getItem(env, 'productos', productoId, viewer);
        proveedorCache.set(productoId, producto ? linkedItemId(producto, PRODUCTO_PROVEEDOR_COL) : null);
      }
      enr.proveedorId = proveedorCache.get(productoId) ?? undefined;
    }
    map.set(row.item_id, enr);
  }
  return map;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Clave de identidad de una talla: producto+sku+color+talla, normalizada
 * (espacios/mayúsculas no cuentan) — con esto se decide qué filas ya existen
 * y se omiten en vez de duplicarse. Exportada para test unitario puro. */
export function identityKey(producto: string, sku: string | undefined, color: string | undefined, talla: string): string {
  return [norm(producto), norm(sku ?? ''), norm(color ?? ''), norm(talla)].join('|');
}

/** Filas capturables: cantidad positiva, talla y producto no vacíos. Exportada
 * para test unitario puro. */
export function filterWanted(rows: TallaBoxInput[]): TallaBoxInput[] {
  return rows.filter(r => r.cantidad > 0 && r.talla.trim() && r.producto.trim());
}

/** Columna→valor de un subitem de talla, con el costeo de la línea de
 * cotización copiado cuando hay match — nunca inventa un default. Exportada
 * para test unitario puro (sin red/D1). */
export function buildTallaColumns(r: TallaBoxInput, enr: CosteoEnrichment | undefined): Record<string, unknown> {
  const cols: Record<string, unknown> = {
    [SUB_PRODUCTO]: r.producto.trim(),
    [SUB_TALLA]: r.talla.trim(),
    [SUB_CANTIDAD]: r.cantidad,
  };
  if (r.sku?.trim()) cols[SUB_SKU] = r.sku.trim();
  if (r.color?.trim()) cols[SUB_COLOR] = r.color.trim();
  if (enr?.costo) cols[SUB_COSTO] = enr.costo;
  if (enr?.moneda) cols[SUB_MONEDA] = enr.moneda;
  if (enr?.descuento) cols[SUB_DESCUENTO] = enr.descuento;
  if (enr?.unidad) cols[SUB_UNIDAD] = enr.unidad;
  if (enr?.proveedorId != null) cols[SUB_PROVEEDOR] = { item_ids: [enr.proveedorId] };
  return cols;
}

/** Normaliza un valor para comparar current-vs-deseado sin que "20" != "20.0" ni
 * el orden de una board_relation cuenten como cambio — mirror de import_tallas.py's
 * `_norm`. */
function normValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const ids = (value as { item_ids?: unknown[] }).item_ids;
    if (ids) return [...ids].map(String).sort().join(',');
  }
  const s = String(value).trim();
  const f = Number(s.replace(/,/g, ''));
  return s !== '' && Number.isFinite(f) ? String(f) : s;
}

/** Valor actual de una columna del mirror, en la misma forma comparable que
 * normValue espera — board_relation lee `linked_item_ids`, el resto `text`. */
function currentValue(cols: Map<string, RawCol>, colId: string): unknown {
  const col = cols.get(colId);
  if (!col) return '';
  if (col.value) {
    try {
      const parsed = JSON.parse(col.value) as { linked_item_ids?: unknown[] };
      if (parsed.linked_item_ids) return { item_ids: parsed.linked_item_ids };
    } catch { /* no era JSON de board_relation — sigue a .text */ }
  }
  return col.text ?? '';
}

export function needsUpdate(cols: Map<string, RawCol>, desired: Record<string, unknown>): boolean {
  return Object.entries(desired).some(([colId, value]) => normValue(currentValue(cols, colId)) !== normValue(value));
}

/** Crea o actualiza subitems del Proyecto desde boxes de talla+cantidad
 * capturados por vendedor/compras — reconciliación real por identidad
 * (producto+sku+color+talla), mirror del criterio de import_tallas.py (Fase 3,
 * plan "salir de Monday", 2026-08-12: sin Google Sheet — la fuente "deseada" es
 * el propio request, no una hoja). Una fila cuya identidad ya existe pero con
 * cantidad/costeo distinto se ACTUALIZA en vez de omitirse; solo se omite si de
 * verdad no cambió nada. No borra: a diferencia de import_tallas.py esto es
 * siempre aditivo/correctivo, nunca una fuente de verdad que reemplaza al
 * Proyecto completo. */
// Tipo Monday de cada columna que buildTallaColumns puede llenar — necesario
// para convertir su forma de ESCRITURA ({item_ids:[...]} etc.) al RawColumn
// que necesita un subitem nativo (shared/nativeId.ts), que nunca pasa por un
// echo real de Monday que lo resuelva por su cuenta.
const TALLA_COL_TYPES: Record<string, string> = {
  [SUB_PRODUCTO]: 'text', [SUB_SKU]: 'text', [SUB_COLOR]: 'text', [SUB_TALLA]: 'text',
  [SUB_CANTIDAD]: 'numeric', [SUB_COSTO]: 'numeric', [SUB_MONEDA]: 'text',
  [SUB_DESCUENTO]: 'numeric', [SUB_UNIDAD]: 'text', [SUB_PROVEEDOR]: 'board_relation',
};

/** Columnas de una línea de talla NATIVA. Además de la conversión de shape,
 * resuelve el proveedor: `toNativeColumns` deja el board_relation con el ID
 * como texto, pero el agrupado y el PDF de la OC imprimen ese texto — en la
 * prueba end-to-end de producción (2026-08-18) la OC salió a nombre de
 * "11643361506" en vez de "UNIMX". La razón social es un espejo del board
 * Proveedores, así que también se copia (worker/lib/nativeMirrors.ts). */
async function nativeTallaColumns(env: Env, desired: Record<string, unknown>): Promise<RawColumn[]> {
  const columns = toNativeColumns(desired, TALLA_COL_TYPES);
  const proveedorId = Number(((desired[SUB_PROVEEDOR] as { item_ids?: number[] } | undefined)?.item_ids ?? [])[0]);
  if (!Number.isFinite(proveedorId) || proveedorId <= 0) return columns;
  const { nombre, razonSocial } = await proveedorPorId(env, proveedorId);
  const rel = columns.find(c => c.id === SUB_PROVEEDOR);
  if (rel) rel.text = nombre;
  if (razonSocial) columns.push({ id: SUB_PROVEEDOR_RZ, type: 'mirror', text: razonSocial, value: null });
  return columns;
}

export async function capturarTallas(
  env: Env, viewer: Identity, proyectoId: number, rows: TallaBoxInput[],
): Promise<CapturarTallasResponse> {
  const wanted = filterWanted(rows);
  if (wanted.length === 0) return { ok: true, created: 0, updated: 0, omitted: 0 };

  const oppId = await resolveOportunidadId(env, viewer, proyectoId);
  const enrichment = oppId !== null ? await fetchCosteoEnrichment(env, oppId, viewer) : new Map<number, CosteoEnrichment>();

  const existing = await childrenOf(env, 'proyectos', proyectoId, viewer);
  // El id más chico (más viejo) sobrevive si hay duplicados — mismo criterio que
  // build_plan de import_tallas.py, para que reconciliaciones concurrentes converjan.
  const byKey = new Map<string, MirrorItem>();
  for (const row of [...existing].sort((a, b) => a.item_id - b.item_id)) {
    const cols = colsOf(row);
    const key = identityKey(
      cols.get(SUB_PRODUCTO)?.text || '',
      cols.get(SUB_SKU)?.text || '',
      cols.get(SUB_COLOR)?.text || '',
      cols.get(SUB_TALLA)?.text || '',
    );
    if (!byKey.has(key)) byKey.set(key, row);
  }

  const native = isNativeId(proyectoId);
  let created = 0;
  let updated = 0;
  let omitted = 0;
  const seenThisRequest = new Set<string>();
  for (const r of wanted) {
    const key = identityKey(r.producto, r.sku, r.color, r.talla);
    if (seenThisRequest.has(key)) { omitted++; continue; } // duplicado dentro del mismo request
    seenThisRequest.add(key);

    const desired = buildTallaColumns(r, enrichment.get(r.subitemId));
    const match = byKey.get(key);
    if (!match) {
      if (native) {
        await insertNativeSubitem(env, 'proyectos_sub', proyectoId, r.producto.trim(), await nativeTallaColumns(env, desired));
      } else {
        const subitem = await createSubitem(env, proyectoId, r.producto.trim(), desired);
        await upsertItem(env, 'proyectos_sub', subitem);
      }
      created++;
      continue;
    }
    if (!needsUpdate(colsOf(match), desired)) { omitted++; continue; }
    if (native) {
      const columns = await nativeTallaColumns(env, desired);
      const byId = new Map(colsOf(match).entries());
      for (const c of columns) byId.set(c.id, c);
      await env.DB
        .prepare(`UPDATE items SET columns = ?, synced_at = ? WHERE board_id = ? AND item_id = ?`)
        .bind(JSON.stringify([...byId.values()]), new Date().toISOString(), BOARDS.proyectos_sub.id, match.item_id)
        .run();
    } else {
      await gql(
        env,
        `mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
        { b: String(BOARDS.proyectos_sub.id), i: String(match.item_id), cv: JSON.stringify(desired) },
      );
      await refetchItem(env, BOARDS.proyectos_sub.id, match.item_id);
    }
    updated++;
  }

  return { ok: true, created, updated, omitted };
}

export interface ReportarTallasResult { ok: true; notificados: number }

/** Avisa a Compras (update en Monday @mencionando + WhatsApp "importante",
 * mismo mecanismo que productosPropuestos.ts) que el desglose de una línea
 * producto+color no cuadra contra lo cotizado. El cruce es 100% D1 (sin
 * llamada nueva a Monday): lee las líneas ya importadas del Proyecto y las de
 * la Oportunidad ligada del mirror, y compara por nombre+color normalizados
 * (Efraín, 2026-08-05: "que coincida con la opp, si se puede todo en D1
 * mejor"). Sin match en la Oportunidad, reporta igual pero sin "cotizado".
 * Best-effort en el envío a cada destinatario (emitNotification ya se traga
 * sus propios errores); el update de Monday si puede tronar, se deja subir al
 * caller (es la acción principal, no un efecto secundario). */
export async function reportarTallasIncorrectas(
  env: Env, viewer: Identity, proyectoId: number, proyectoNombre: string,
  producto: string, color: string | undefined,
): Promise<ReportarTallasResult> {
  const proyectoRows = await childrenOf(env, 'proyectos', proyectoId, viewer);
  const proyectoMatches = proyectoRows.filter(row => {
    const cols = colsOf(row);
    return norm(cols.get(SUB_PRODUCTO)?.text || '') === norm(producto)
      && norm(cols.get(SUB_COLOR)?.text || '') === norm(color ?? '');
  });
  const asignadas = proyectoMatches
    .reduce((s, row) => s + (Number((colsOf(row).get(SUB_CANTIDAD)?.text ?? '').replace(/,/g, '')) || 0), 0);
  // Respaldo por SKU si el nombre no cruza: "Importar tallas" de cmp-tallas
  // puede reescribir el nombre del producto al copiarlo al Proyecto, y el SKU
  // (más estable) es lo único que sigue cruzando contra la Oportunidad.
  const proyectoSku = proyectoMatches.map(row => colsOf(row).get(SUB_SKU)?.text).find(s => s?.trim());

  const oppId = await resolveOportunidadId(env, viewer, proyectoId);
  let cotizado: number | null = null;
  if (oppId !== null) {
    const oppRows = await childrenOf(env, 'oportunidades', oppId, viewer);
    let matches = oppRows.filter(row =>
      norm(row.name) === norm(producto)
      && norm(colsOf(row).get(OPP_SUB_COLOR)?.text || '') === norm(color ?? ''));
    if (matches.length === 0 && proyectoSku) {
      matches = oppRows.filter(row =>
        norm(colsOf(row).get(OPP_SUB_SKU)?.text || '') === norm(proyectoSku)
        && norm(colsOf(row).get(OPP_SUB_COLOR)?.text || '') === norm(color ?? ''));
    }
    if (matches.length > 0) {
      cotizado = matches.reduce((s, row) =>
        s + (Number((colsOf(row).get(OPP_SUB_CANTIDAD_COTIZADA)?.text ?? '').replace(/,/g, '')) || 0), 0);
    }
  }

  // monday_user_id > 0: excluye usuarios dados de alta desde el portal (sin
  // persona real en Monday, ver dal.createNativeIdentity) — no se les puede
  // @mencionar en un update de Monday.
  const { results } = await env.DB.prepare(
    `SELECT monday_user_id, nombre, email FROM identity WHERE active = 1 AND role = 'compras' AND monday_user_id > 0`,
  ).all<{ monday_user_id: number; nombre: string | null; email: string }>();
  const compras = results ?? [];

  const actorName = viewer.nombre || viewer.email;
  const detalle = cotizado !== null
    ? `cotizado ${cotizado}, van ${asignadas} asignadas (${asignadas < cotizado ? `faltan ${cotizado - asignadas}` : `sobran ${asignadas - cotizado}`})`
    : `van ${asignadas} asignadas, sin línea de cotización para cruzar`;
  const body = `${actorName} reportó que el desglose de tallas de "${producto}"${color ? ` (${color})` : ''} en ${proyectoNombre} no cuadra: ${detalle}.`;

  const mentions: MentionInput[] = compras.filter(c => c.nombre).map(c => ({ id: c.monday_user_id, nombre: c.nombre as string }));
  // Sin nadie a quien @mencionar no se postea nada del lado de Monday (un update
  // que no le llega a nadie es ruido); en un Proyecto NATIVO el feed de D1 es el
  // único rastro que queda del reporte, así que ahí sí va siempre.
  if (mentions.length > 0 || isNativeId(proyectoId)) await postUpdate(env, BOARDS.proyectos.id, proyectoId, body, mentions);

  const reportId = crypto.randomUUID();
  let notificados = 0;
  for (const c of compras) {
    if (c.email === viewer.email) continue;
    await emitNotification(env, {
      recipientEmail: c.email,
      severity: 'importante',
      kind: 'tallas_incorrectas',
      title: `Tallas incorrectas en ${proyectoNombre}`,
      body,
      boardKey: 'doctallas',
      boardId: BOARDS.proyectos.id,
      itemId: proyectoId,
      actor: actorName,
      dedupeKey: `tallas_incorrectas:${reportId}:${c.email}`,
    });
    notificados++;
  }
  return { ok: true, notificados };
}

// ═══════════════════════════════════════════════════════════════════════════
// "Confirmar tallas" nativo (Fase 3, plan "salir de Monday", 2026-08-12) —
// reimplementa cmp-tallas' api/confirm_tallas.py SIN Google Sheet: el gate
// "TODO CUADRA" ya no lee una celda de fórmula, se calcula agregando D1/mirror
// (mismo cruce que reportarTallasIncorrectas, pero sobre TODAS las líneas a la
// vez). El PDF de relación de tallas ya no usa Eledo — lo genera el escritor
// propio del portal (worker/lib/pdf) — y se sube a Monday igual que antes para
// que DocuSeal lo firme (la firma SIGUE siendo DocuSeal, no se migra a la
// electrónica propia del portal — decisión ya tomada, docs/documentos-firma.md).
// ═══════════════════════════════════════════════════════════════════════════

export interface TodoCuadraMismatch {
  producto: string;
  color: string;
  cotizado: number;
  asignado: number;
}

export interface TodoCuadraResult {
  ok: boolean;
  reason?: string;
  mismatches: TodoCuadraMismatch[];
}

/** Gate "TODO CUADRA": la suma de cantidades asignadas en el Proyecto por
 * producto+color debe coincidir EXACTO con lo cotizado en la Oportunidad —
 * en cualquier dirección (falta o sobra ambas cuentan). 100% D1/mirror, sin
 * Google Sheet. */
export async function checkTodoCuadra(env: Env, viewer: Identity, proyectoId: number): Promise<TodoCuadraResult> {
  const oppId = await resolveOportunidadId(env, viewer, proyectoId);
  if (oppId === null) {
    return { ok: false, reason: 'El Proyecto no tiene una Oportunidad ligada — no se puede validar contra lo cotizado.', mismatches: [] };
  }

  const agg = new Map<string, TodoCuadraMismatch>();
  const keyOf = (producto: string, color: string): string => `${norm(producto)}|${norm(color)}`;

  for (const row of await childrenOf(env, 'oportunidades', oppId, viewer)) {
    const cols = colsOf(row);
    const color = cols.get(OPP_SUB_COLOR)?.text || '';
    const key = keyOf(row.name, color);
    const cantidad = Number((cols.get(OPP_SUB_CANTIDAD_COTIZADA)?.text ?? '').replace(/,/g, '')) || 0;
    const e = agg.get(key) ?? { producto: row.name, color, cotizado: 0, asignado: 0 };
    e.cotizado += cantidad;
    agg.set(key, e);
  }
  for (const row of await childrenOf(env, 'proyectos', proyectoId, viewer)) {
    const cols = colsOf(row);
    const producto = cols.get(SUB_PRODUCTO)?.text || '';
    const color = cols.get(SUB_COLOR)?.text || '';
    const key = keyOf(producto, color);
    const cantidad = Number((cols.get(SUB_CANTIDAD)?.text ?? '').replace(/,/g, '')) || 0;
    const e = agg.get(key) ?? { producto, color, cotizado: 0, asignado: 0 };
    e.asignado += cantidad;
    agg.set(key, e);
  }

  const mismatches = [...agg.values()].filter(e => e.cotizado !== e.asignado);
  return { ok: mismatches.length === 0, mismatches };
}

interface RelacionTallasHeader {
  proyectoNombre: string;
  folioOpp: string;
  cargo: string;
  cliente: string;
  institucion: string;
}

function relacionTallasBlocks(h: RelacionTallasHeader, lineas: { producto: string; sku: string; color: string; talla: string; cantidad: number }[]): Block[] {
  const total = lineas.reduce((s, l) => s + l.cantidad, 0);
  return [
    { kind: 'heading', text: 'Relación de tallas' },
    {
      kind: 'kv',
      rows: [
        ['Proyecto', h.proyectoNombre],
        ['Folio oportunidad', h.folioOpp],
        ['Institución', h.institucion],
        ['Cliente', h.cliente],
        ['Cargo', h.cargo],
      ],
    },
    { kind: 'heading', text: 'Tallas' },
    {
      kind: 'table',
      columns: [
        { header: 'Producto', width: 0.32 },
        { header: 'SKU', width: 0.16 },
        { header: 'Color', width: 0.2 },
        { header: 'Talla', width: 0.14, align: 'right' },
        { header: 'Cantidad', width: 0.18, align: 'right' },
      ],
      rows: lineas.map(l => [l.producto, l.sku, l.color, l.talla, NUM(l.cantidad)]),
      footer: ['', '', '', `${lineas.length} fila(s)`, NUM(total)],
    },
  ];
}

let tallasFolioTableReady = false;
async function nextTallasSeq(env: Env, proyectoId: number): Promise<number> {
  if (!tallasFolioTableReady) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS tallas_folios (item_id INTEGER PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0)`,
    ).run();
    tallasFolioTableReady = true;
  }
  await env.DB.prepare(
    `INSERT INTO tallas_folios (item_id, seq) VALUES (?, 1)
     ON CONFLICT(item_id) DO UPDATE SET seq = seq + 1`,
  ).bind(proyectoId).run();
  const row = await env.DB.prepare(`SELECT seq FROM tallas_folios WHERE item_id = ?`).bind(proyectoId).first<{ seq: number }>();
  return row?.seq ?? 1;
}

export interface ConfirmTallasResult {
  ok: boolean;
  errors?: string[];
  pdfUrl?: string;
  docusealId?: string;
}

/** "Validar tallas" para un Proyecto nativo (Zona Efrain, "salir de Monday").
 * Mismo gate que el flujo real (`checkTodoCuadra`, ya 100% D1) y el mismo PDF
 * (`relacionTallasBlocks`, función pura reusada tal cual) — pero el PDF va a
 * R2 en vez de subirse a una columna de Monday, y el rechazo mueve el status
 * con el `submitWrite` nativo en vez de un `gql` directo. Sin DocuSeal ni
 * Drive (ninguno aplica a un Proyecto que no existe en Monday). */
export async function confirmTallasNativeD1(
  env: Env, ctx: ExecutionContext, viewer: Identity, proyectoId: number,
): Promise<ConfirmTallasResult> {
  if (!(await ownsItem(env, 'proyectos', proyectoId, viewer))) return { ok: false, errors: ['not found'] };

  const gate = await checkTodoCuadra(env, viewer, proyectoId);
  if (!gate.ok) {
    await submitWrite(env, ctx, 'proyectos', proyectoId, { [PROYECTO_STATUS]: PROYECTO_STATUS_REVERT }, viewer, { trusted: true });
    const detalle = gate.mismatches.map(m => `${m.producto}${m.color ? ` (${m.color})` : ''}: cotizado ${m.cotizado}, asignado ${m.asignado}`);
    return { ok: false, errors: gate.reason ? [gate.reason] : detalle };
  }

  const proyecto = await getItem(env, 'proyectos', proyectoId, viewer, 'own');
  if (!proyecto) return { ok: false, errors: ['not found'] };
  const pCols = colsOf(proyecto);

  const lineas = (await childrenOf(env, 'proyectos', proyectoId, viewer))
    .map(s => {
      const c = colsOf(s);
      return {
        producto: c.get(SUB_PRODUCTO)?.text || '',
        sku: c.get(SUB_SKU)?.text || '',
        color: c.get(SUB_COLOR)?.text || '',
        talla: c.get(SUB_TALLA)?.text || '',
        cantidad: Number((c.get(SUB_CANTIDAD)?.text ?? '').replace(/,/g, '')) || 0,
      };
    })
    .filter(l => l.cantidad > 0);

  const seq = await nextTallasSeq(env, proyectoId);
  const folioProyecto = pCols.get(PROYECTO_FOLIO)?.text || String(proyectoId);
  const filename = `tallas_${folioProyecto}_${seq}.pdf`;

  const pdfBytes = renderDocument(
    { title: 'Relación de tallas', subtitle: proyecto.name, folio: folioProyecto, docId: `tallas-${proyectoId}-${seq}`, generatedAt: fechaLarga(new Date().toISOString()) },
    relacionTallasBlocks({
      proyectoNombre: proyecto.name,
      folioOpp: pCols.get(PROYECTO_FOLIO_OPP)?.text || '',
      cargo: pCols.get(PROYECTO_CARGO)?.text || '',
      cliente: pCols.get(PROYECTO_CLIENTE)?.text || '',
      institucion: pCols.get(PROYECTO_INSTITUCION)?.text || '',
    }, lineas),
  );

  let pdfUrl = '';
  const oppId = linkedItemId(proyecto, PROYECTO_OPP_REL);
  if (oppId != null) {
    const key = oportunidadFileKey(oppId, 'tallas', filename);
    await putFile(env, key, new Blob([pdfBytes], { type: 'application/pdf' }));
    pdfUrl = `/api/files/${key}`;
  }

  return { ok: true, pdfUrl };
}

/** "Validar tallas" del vendedor — flujo completo nativo. `ownsItem`: muta el
 * Proyecto (status en rechazo, PDF+firma en éxito), mismo criterio que
 * worker/lib/costeo.ts. */
export async function confirmTallasNative(env: Env, viewer: Identity, proyectoId: number): Promise<ConfirmTallasResult> {
  if (!(await ownsItem(env, 'proyectos', proyectoId, viewer))) return { ok: false, errors: ['not found'] };

  const gate = await checkTodoCuadra(env, viewer, proyectoId);
  if (!gate.ok) {
    const detalle = gate.mismatches.map(m =>
      `• ${m.producto}${m.color ? ` (${m.color})` : ''}: cotizado ${m.cotizado}, asignado ${m.asignado}`,
    ).join('\n');
    const body = gate.reason ?? (detalle ? `${NO_CUADRA_MSG}\n\n${detalle}` : NO_CUADRA_MSG);
    try {
      await gql(
        env,
        `mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
        { b: String(BOARDS.proyectos.id), i: String(proyectoId), cv: JSON.stringify({ [PROYECTO_STATUS]: { label: PROYECTO_STATUS_REVERT } }) },
      );
      await postUpdate(env, BOARDS.proyectos.id, proyectoId, body);
    } catch { /* best-effort: el rechazo ya quedó decidido, esto es solo el aviso */ }
    return { ok: false, errors: gate.reason ? [gate.reason] : gate.mismatches.map(m => `${m.producto}${m.color ? ` (${m.color})` : ''}: cotizado ${m.cotizado}, asignado ${m.asignado}`) };
  }

  const fetched = await fetchItemWithSubitems(env, proyectoId);
  if (!fetched) return { ok: false, errors: ['not found'] };
  const { item, subitems } = fetched;
  const cols = item.column_values;

  const lineas = subitems.map(s => ({
    producto: cvText(s.column_values, SUB_PRODUCTO),
    sku: cvText(s.column_values, SUB_SKU),
    color: cvText(s.column_values, SUB_COLOR),
    talla: cvText(s.column_values, SUB_TALLA),
    cantidad: cvNum(s.column_values, SUB_CANTIDAD),
  })).filter(l => l.cantidad > 0);

  const seq = await nextTallasSeq(env, proyectoId);
  const folioProyecto = cvText(cols, PROYECTO_FOLIO) || String(proyectoId);
  const filename = `tallas_${folioProyecto}_${seq}.pdf`;

  const pdfBytes = renderDocument(
    { title: 'Relación de tallas', subtitle: item.name, folio: folioProyecto, docId: `tallas-${proyectoId}-${seq}`, generatedAt: fechaLarga(new Date().toISOString()) },
    relacionTallasBlocks({
      proyectoNombre: item.name,
      folioOpp: cvText(cols, PROYECTO_FOLIO_OPP),
      cargo: cvText(cols, PROYECTO_CARGO),
      cliente: cvText(cols, PROYECTO_CLIENTE),
      institucion: cvText(cols, PROYECTO_INSTITUCION),
    }, lineas),
  );

  const upload = await addFileToColumn(env, proyectoId, PROYECTO_PDF_TALLAS, new Blob([pdfBytes], { type: 'application/pdf' }), filename);
  await registrarArchivo(env, {
    acto: 'genera', categoria: 'tallas', nombre: filename, boardId: BOARDS.proyectos.id,
    itemId: proyectoId, colId: PROYECTO_PDF_TALLAS, bytes: pdfBytes.length, porEmail: viewer.email,
  });

  // Fase 5 "salir de Monday" (2026-08-13): depositar en "09. RELACION DE
  // TALLAS" de la carpeta de Drive de la Oportunidad ligada — best-effort.
  if (env.DRIVE_NATIVE === '1') {
    const oppId = firstLinkedId(cols, PROYECTO_OPP_REL);
    if (oppId) {
      try {
        const resolved = await getOrCreateDriveFolderForOportunidad(env, oppId);
        if (resolved) await uploadPdfToDrive(env, resolved.folder.subfolders['09. RELACION DE TALLAS'], filename, pdfBytes);
      } catch { /* best-effort */ }
    }
  }

  const vendedorId = firstPersonId(cols, PROYECTO_VENDEDOR);
  const vendedorFallback = cvText(cols, PROYECTO_VENDEDOR);
  let vendedor = { name: vendedorFallback || 'Vendedor', email: '' };
  if (vendedorId) {
    try {
      const user = await fetchUserById(env, vendedorId);
      if (user) vendedor = { name: user.name, email: user.email };
    } catch { /* cae al fallback */ }
  }

  let docusealId = '';
  try {
    docusealId = await createDocuSealSubmission(env, {
      name: String(proyectoId),
      pdfUrl: upload.publicUrl,
      filename,
      signers: [{ role: 'Vendedor', name: vendedor.name, email: vendedor.email }],
    });
  } catch (err) {
    docusealId = `ERROR: ${String(err)}`;
  }

  return { ok: true, pdfUrl: upload.publicUrl, docusealId };
}
