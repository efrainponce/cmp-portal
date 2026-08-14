// worker/lib/duplicateOportunidad.ts — "Duplicar" en el drawer: clona una
// Oportunidad a una nueva, con cabecera (Cliente/Vendedor/Comprador) + SOLO
// las líneas vigentes (el mirror actual, igual criterio que quoteVersions.ts),
// copiadas campo por campo tal cual (producto/color/cantidad/comentarios/
// embellecimiento + TODO su costeo: costos, Etapa Costeo, moneda, IVA%,
// Margen Gob%, precio de venta — Efraín, 2026-08-14: "duplicado es duplicado,
// todo debe estar igual", no una oportunidad que arranca en blanco).
//
// La ETAPA de la oportunidad nueva la elige quien duplica (`etapaDestino`,
// UI: DuplicarOportunidadModal — Efraín, 2026-08-14: "duplicar pregunta a que
// estado se manda"), default "Nueva oportunidad" si no se manda. Fuera de esa
// etapa es SOLO la etiqueta — nunca replica el PROCESO que esa etapa implica
// (Proyecto de "Ganada" vía ganarOportunidad.ts, PDFs de costeo/validación,
// fechas de solicitud/validación) porque esos son artefactos reales de pasos
// que nunca ocurrieron en el duplicado; forjarlos sería la misma mentira de
// datos que este mismo archivo dejó de cometer con las líneas. Nunca arrastra
// versiones anteriores (cotizacion_versions en D1), PDFs de cotización ni
// ningún otro documento.
// Column ids de docs/monday-column-map.md / column-meta.gen.ts — nunca fabricar.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { DEAL_STAGE_LABELS, DUPLICAR_ETAPAS_VALIDAS } from '../../shared/dealStages';
import { createItem, createSubitem, addFileToColumn, fetchAssetPublicUrls } from './monday';
import { getItem, childrenOf } from './dal';
import { upsertItem, refetchItemTree } from '../sync';
import type { RawCol } from './serialize';

export class DuplicateOportunidadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ETAPA_DEFAULT = '4'; // Nueva oportunidad

// Oportunidades (18395657596)
const COL_ETAPA = 'deal_stage';
const COL_VENDEDOR = 'deal_owner';
const COL_CONTACTO = 'deal_contact';
const COL_COMPRADOR = 'multiple_person_mm03qyw9';

// Oportunidades subitems (18395657607)
const SUB_PRODUCTO_REL = 'board_relation_mkzmafgp';
const SUB_PRODUCTO_TXT = 'text_mm0bkm1j';
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_COMENTARIOS = 'long_text_mm1hyszv';
const SUB_EMB_STATUS = 'color_mm1b34bg';
const SUB_EMB_DESC = 'long_text_mm1bj4pt';
const SUB_PRECIO = 'numeric_mkzneg3d';
const SUB_FILE = 'file_mm5akjy5';

// Costeo del renglón (ids de gridMeta.tsx/quoteVersions.ts — GRID_COLS_COSTEO):
// copiados tal cual para que el clon nazca ya costeado, no en blanco. Las
// columnas `formula_*` (Costo real/total C/U) NO se copian — Monday las
// recalcula solo a partir de estos mismos inputs.
const SUB_ETAPA_COSTEO = 'color_mm084gvf';
const SUB_MONEDA = 'color_mm5s709s';
const SUB_COSTO_DISTR = 'numeric_mm0bph99';
const SUB_DESCUENTO_PCT = 'numeric_mkzn2q51';
const SUB_CONVERSION = 'numeric_mm0rvhgs';
const SUB_GASTOS_PCT = 'numeric_mkzngs9x';
const SUB_COSTO_EMBELL = 'numeric_mm0gxvpa';
const SUB_TECHO = 'numeric_mkznpn83';
const SUB_IVA_PCT = 'numeric_mm0cg0bm';
const SUB_MARGEN_GOB_PCT = 'numeric_mkznnm5s';

const DUPLICATE_ROLES: Identity['role'][] = ['vendedor', 'compras', 'admin'];

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

/** board_relation columns store {linked_item_ids:[...]} in the mirror (see
 * worker/lib/monday.ts normalizeCols) — create_item/create_subitem need {item_ids:[...]}. */
function linkedIds(col?: RawCol): number[] {
  if (!col?.value) return [];
  try {
    const parsed = JSON.parse(col.value) as { linked_item_ids?: unknown[] };
    return (parsed.linked_item_ids ?? []).map(Number).filter(Number.isFinite);
  } catch {
    return [];
  }
}

/** people columns store the exact {personsAndTeams:[...]} shape Monday's write
 * mutation expects — pass it straight through (same pattern as createOportunidad.ts). */
function peopleValue(col?: RawCol): unknown | undefined {
  if (!col?.value) return undefined;
  try {
    return JSON.parse(col.value);
  } catch {
    return undefined;
  }
}

interface FileEntry { name: string; assetId: number }
function parseFiles(col?: RawCol): FileEntry[] {
  if (!col?.value) return [];
  try {
    return (JSON.parse(col.value) as { files?: FileEntry[] }).files ?? [];
  } catch {
    return [];
  }
}

/** Copia una línea de embellecimiento: descarga cada imagen de referencia de
 * la línea original y la vuelve a subir a la línea nueva (mismo nombre
 * "<Zona>__original", así embellecimientoImagenes.ts la reconoce igual).
 * Best-effort por archivo — una imagen que falla no aborta la línea. */
async function copyZoneImages(env: Env, sourceCols: Map<string, RawCol>, newSubitemId: number): Promise<void> {
  const files = parseFiles(sourceCols.get(SUB_FILE));
  if (files.length === 0) return;
  const urls = await fetchAssetPublicUrls(env, files.map(f => String(f.assetId)));
  for (const f of files) {
    const url = urls.get(String(f.assetId));
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      await addFileToColumn(env, newSubitemId, SUB_FILE, blob, f.name);
    } catch {
      // imagen individual falla -> se omite, el resto de la línea sigue
    }
  }
}

export async function duplicateOportunidad(
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity, etapaDestino?: string,
): Promise<{ id: number }> {
  if (!DUPLICATE_ROLES.includes(viewer.role)) throw new DuplicateOportunidadError(403, 'cannot duplicate');
  const etapaKey = etapaDestino && DUPLICAR_ETAPAS_VALIDAS.includes(etapaDestino) ? etapaDestino : ETAPA_DEFAULT;

  // scope 'own': crea items en Monday a partir de esta (ver worker/lib/zonas.ts).
  const source = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!source) throw new DuplicateOportunidadError(404, 'not found');
  const srcCols = colsOf(source);

  const newCols: Record<string, unknown> = {
    [COL_ETAPA]: { label: DEAL_STAGE_LABELS[etapaKey] },
  };
  const vendedor = peopleValue(srcCols.get(COL_VENDEDOR));
  if (vendedor) newCols[COL_VENDEDOR] = vendedor;
  const comprador = peopleValue(srcCols.get(COL_COMPRADOR));
  if (comprador) newCols[COL_COMPRADOR] = comprador;
  const contactoIds = linkedIds(srcCols.get(COL_CONTACTO));
  if (contactoIds.length) newCols[COL_CONTACTO] = { item_ids: contactoIds };

  let newItem;
  try {
    // maxRetries:1 — mismo razonamiento que createRecord.ts: "Duplicar" espera
    // este round-trip para navegar al duplicado.
    newItem = await createItem(env, BOARDS.oportunidades.id, `${source.name} (copia)`, newCols, { maxRetries: 1 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new DuplicateOportunidadError(502, `monday create failed: ${detail}`);
  }
  await upsertItem(env, 'oportunidades', newItem);
  const newItemId = Number(newItem.id);

  // Líneas vigentes = el mirror actual de subitems (mismo criterio que
  // quoteVersions.ts: "la vigente SIEMPRE es el mirror actual") — nunca las
  // versiones archivadas en cotizacion_versions. En paralelo — mismas mutaciones
  // a Monday, mucha menos latencia total (patrón de createOportunidad.ts): con
  // varias líneas, crearlas una por una es visiblemente lento para un botón.
  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  await Promise.all(lineas.map(async linea => {
    const lc = colsOf(linea);
    const subCols: Record<string, unknown> = {};

    const cantidad = lc.get(SUB_CANTIDAD)?.text;
    if (cantidad) subCols[SUB_CANTIDAD] = cantidad.replace(/,/g, '');
    const color = lc.get(SUB_COLOR)?.text;
    if (color) subCols[SUB_COLOR] = color;
    const comentarios = lc.get(SUB_COMENTARIOS)?.text;
    if (comentarios) subCols[SUB_COMENTARIOS] = comentarios;
    const embStatus = lc.get(SUB_EMB_STATUS)?.text;
    if (embStatus) subCols[SUB_EMB_STATUS] = { label: embStatus };
    const embDesc = lc.get(SUB_EMB_DESC)?.text;
    if (embDesc) subCols[SUB_EMB_DESC] = embDesc;
    const precio = lc.get(SUB_PRECIO)?.text;
    if (precio) subCols[SUB_PRECIO] = precio.replace(/,/g, '');

    const etapaCosteo = lc.get(SUB_ETAPA_COSTEO)?.text;
    if (etapaCosteo) subCols[SUB_ETAPA_COSTEO] = { label: etapaCosteo };
    const moneda = lc.get(SUB_MONEDA)?.text;
    if (moneda) subCols[SUB_MONEDA] = { label: moneda };
    for (const [colId, raw] of [
      [SUB_COSTO_DISTR, lc.get(SUB_COSTO_DISTR)?.text],
      [SUB_DESCUENTO_PCT, lc.get(SUB_DESCUENTO_PCT)?.text],
      [SUB_CONVERSION, lc.get(SUB_CONVERSION)?.text],
      [SUB_GASTOS_PCT, lc.get(SUB_GASTOS_PCT)?.text],
      [SUB_COSTO_EMBELL, lc.get(SUB_COSTO_EMBELL)?.text],
      [SUB_TECHO, lc.get(SUB_TECHO)?.text],
      [SUB_IVA_PCT, lc.get(SUB_IVA_PCT)?.text],
      [SUB_MARGEN_GOB_PCT, lc.get(SUB_MARGEN_GOB_PCT)?.text],
    ] as const) {
      if (raw) subCols[colId] = raw.replace(/,/g, '');
    }

    const productoIds = linkedIds(lc.get(SUB_PRODUCTO_REL));
    if (productoIds.length) {
      subCols[SUB_PRODUCTO_REL] = { item_ids: productoIds };
    } else {
      const productoTxt = lc.get(SUB_PRODUCTO_TXT)?.text;
      if (productoTxt) subCols[SUB_PRODUCTO_TXT] = productoTxt;
    }

    let newSub;
    try {
      newSub = await createSubitem(env, newItemId, linea.name, subCols);
    } catch {
      return; // una línea falla -> se omite, no aborta el resto de la duplicación
    }
    await upsertItem(env, 'oportunidades_sub', newSub);
    await copyZoneImages(env, lc, Number(newSub.id));
  }));

  // Un solo refetch de árbol al final: recoge el item + todas sus líneas
  // (incluidas las imágenes recién subidas) en una llamada.
  ctx.waitUntil(refetchItemTree(env, BOARDS.oportunidades.id, newItemId));

  return { id: newItemId };
}
