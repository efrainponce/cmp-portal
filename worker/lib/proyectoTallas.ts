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
import { createSubitem, gql } from './monday';
import { upsertItem } from '../sync';

export type { TallaBoxInput };

// Oportunidad — línea de cotización (oportunidades_sub, 18395657607): costeo ya
// snapshoteado por "Solicitar costeo" (worker/lib/costeo.ts), redactado para
// vendedor en shared/visibility.ts — aquí se lee del mirror crudo (MirrorItem),
// nunca del DTO filtrado, porque quien llama este flujo es el propio vendedor.
const OPP_SUB_COSTO = 'numeric_mm0bph99';
const OPP_SUB_MONEDA = 'lookup_mm11t8gj';
const OPP_SUB_DESCUENTO = 'numeric_mkzn2q51';
const OPP_SUB_UNIDAD = 'lookup_mm0w4f4v';

// Proyecto — subitems (proyectos_sub, 18395657609): mismas columnas que ya
// escribe POST /api/proyectos/:id/lineas, más costeo copiado de la línea de
// cotización. Proveedor (board_relation_mm1cfgv5) se deja sin asignar — igual
// que ya hace ese endpoint hoy; Compras lo pone en Monday antes de la OC.
const SUB_PRODUCTO = 'text_mm0hs17x';
const SUB_SKU = 'text_mm0hyrfs';
const SUB_COLOR = 'text_mm0h4a1c';
const SUB_TALLA = 'text_mm1antcb';
const SUB_CANTIDAD = 'numeric_mm0hj2q4';
const SUB_COSTO = 'numeric_mm1dj4fp';
const SUB_MONEDA = 'text_mm1gdsvg';
const SUB_DESCUENTO = 'numeric_mm1dmsaz';
const SUB_UNIDAD = 'text_mm56dbkm';

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

export interface CosteoEnrichment { costo?: string; moneda?: string; descuento?: string; unidad?: string }

async function fetchCosteoEnrichment(env: Env, oppId: number, viewer: Identity): Promise<Map<number, CosteoEnrichment>> {
  const lineas = await childrenOf(env, 'oportunidades', oppId, viewer);
  const map = new Map<number, CosteoEnrichment>();
  for (const row of lineas) {
    const cols = colsOf(row);
    map.set(row.item_id, {
      costo: cols.get(OPP_SUB_COSTO)?.text || undefined,
      moneda: cols.get(OPP_SUB_MONEDA)?.text || undefined,
      descuento: cols.get(OPP_SUB_DESCUENTO)?.text || undefined,
      unidad: cols.get(OPP_SUB_UNIDAD)?.text || undefined,
    });
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
