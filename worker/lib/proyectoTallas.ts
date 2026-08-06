// worker/lib/proyectoTallas.ts — captura de tallas por boxes (vendedor): crea
// subitems del Proyecto directo, mismo patrón que POST /api/proyectos/:id/lineas
// (createSubitem, sin pasar por cmp-tallas). El Sheet + "Importar tallas"
// (worker/lib/automations.ts) siguen intactos como flujo paralelo — esto no los
// reemplaza, solo da una alta rápida alternativa.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { TallaBoxInput, CapturarTallasResponse } from '../../shared/dto';
import type { RawCol } from './serialize';
import { getItem, childrenOf, linkedItemId, PROYECTO_OPP_REL } from './dal';
import { createSubitem, createUpdate, gql, type MentionInput } from './monday';
import { emitNotification } from './notify';
import { upsertItem } from '../sync';
import { BOARDS } from '../../shared/boards';

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

// Oportunidad — línea de cotización, mismos ids que TallasTab.tsx SUB_COLOR/
// SUB_CANTIDAD: lo cotizado originalmente para esa línea (producto+color),
// para cruzar contra lo ya importado al Proyecto (reportarTallasIncorrectas).
const OPP_SUB_SKU = 'lookup_mkzn7x9a';
const OPP_SUB_COLOR = 'text_mm07s2mg';
const OPP_SUB_CANTIDAD_COTIZADA = 'numeric_mkzm6399';

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
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
      descuento: cols.get(OPP_SUB_DESCUENTO)?.text || undefined,
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

/** Crea subitems del Proyecto directo desde boxes de talla+cantidad capturados
 * por el vendedor. Solo alta: una fila cuya identidad (producto+sku+color+talla)
 * ya existe en el Proyecto se omite en vez de duplicar o actualizar — a
 * diferencia de "Importar tallas" (cmp-tallas), esto no reconcilia ni borra. */
export async function capturarTallas(
  env: Env, viewer: Identity, proyectoId: number, rows: TallaBoxInput[],
): Promise<CapturarTallasResponse> {
  const wanted = filterWanted(rows);
  if (wanted.length === 0) return { ok: true, created: 0, omitted: 0 };

  const oppId = await resolveOportunidadId(env, viewer, proyectoId);
  const enrichment = oppId !== null ? await fetchCosteoEnrichment(env, oppId, viewer) : new Map<number, CosteoEnrichment>();

  const existing = await childrenOf(env, 'proyectos', proyectoId, viewer);
  const seenKeys = new Set(existing.map(row => {
    const cols = colsOf(row);
    return identityKey(
      cols.get(SUB_PRODUCTO)?.text || '',
      cols.get(SUB_SKU)?.text || '',
      cols.get(SUB_COLOR)?.text || '',
      cols.get(SUB_TALLA)?.text || '',
    );
  }));

  let created = 0;
  let omitted = 0;
  for (const r of wanted) {
    const key = identityKey(r.producto, r.sku, r.color, r.talla);
    if (seenKeys.has(key)) { omitted++; continue; }
    seenKeys.add(key); // también evita duplicar dentro del mismo request

    const cols = buildTallaColumns(r, enrichment.get(r.subitemId));
    const subitem = await createSubitem(env, proyectoId, r.producto.trim(), cols);
    await upsertItem(env, 'proyectos_sub', subitem);
    created++;
  }

  return { ok: true, created, omitted };
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
  if (mentions.length > 0) await createUpdate(env, proyectoId, body, mentions);

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
