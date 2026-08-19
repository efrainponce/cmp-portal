// worker/lib/duplicateOportunidad.ts — "Duplicar" en el drawer: clona una
// Oportunidad a una nueva. COPIA EXACTA (Efraín, 2026-08-19, después de que
// Elizabeth duplicó OPP-0593 y el clon nació sin Zona, sin Tipo de cotización,
// sin fechas y con las condiciones comerciales en el texto por defecto):
// la cabecera se copia CAMPO POR CAMPO —no solo Vendedor/Compras/Contacto— y
// las líneas vigentes (el mirror actual, igual criterio que quoteVersions.ts)
// se copian enteras: producto/SKU/color/cantidad/comentarios/embellecimiento
// + TODO su costeo (costos, Etapa Costeo, moneda, IVA%, Margen Gob%, precio),
// EN EL MISMO ORDEN que la original (ver createSubitem secuencial abajo).
// Lo que se agrega aquí hay que agregarlo también a COPY_ITEM_COLS/las líneas:
// una columna que no esté listada nace vacía y nadie se entera hasta que falta.
//
// La ETAPA de la oportunidad nueva la elige quien duplica (`etapaDestino`,
// UI: DuplicarOportunidadModal — Efraín, 2026-08-14: "duplicar pregunta a que
// estado se manda"), default "Nueva oportunidad" si no se manda. Fuera de esa
// etapa es SOLO la etiqueta — nunca replica el PROCESO que esa etapa implica
// (Proyecto de "Ganada" vía ganarOportunidad.ts, PDFs de costeo/validación,
// fechas de solicitud/validación) porque esos son artefactos reales de pasos
// que nunca ocurrieron en el duplicado; forjarlos sería la misma mentira de
// datos que este mismo archivo dejó de cometer con las líneas. Confirmado por
// Efraín el 2026-08-19 al pedir la copia exacta: "copia exacta" = los DATOS,
// no la evidencia. Por eso NO se copian (y es a propósito, no un olvido):
//   · PDFs: Cotizaciones generadas/sin precio/Firmadas, Solicitud Costeo
//   · fechas de solicitud/validación de costeo y de creación del Proyecto
//   · la relación al Proyecto y la Carpeta Drive (dos oportunidades apuntando
//     al mismo proyecto/carpeta ensucia tallas y OC)
//   · Razón/Comentario de Pérdida
//   · Event ID y Origen Web — identifican el envío de web que creó ESE
//     registro; duplicar un id único es falsear el origen del clon
//   · las versiones anteriores (cotizacion_versions en D1) y los documentos
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
const COL_INVENTARIO_IMG = 'file_mm0hpefr'; // Inventario Actual (Imagen) — se re-sube, ver copyFiles

/** Cabecera de la Oportunidad, columna por columna con el TIPO con el que
 * Monday la quiere escribir (mismos shapes que worker/lib/columnEncode.ts:
 * status={label}, dropdown={labels:[…]}, date={date:"YYYY-MM-DD"},
 * people/board_relation se pasan del value crudo del mirror).
 * `deal_stage` NO va aquí: lo elige quien duplica, no se copia.
 * Lo que falta en esta lista es la lista de exclusiones del encabezado. */
const COPY_ITEM_COLS: { id: string; kind: 'people' | 'relation' | 'dropdown' | 'date' | 'status' | 'text' | 'checkbox' }[] = [
  { id: 'deal_owner', kind: 'people' },                    // Vendedor
  { id: 'multiple_person_mm03qyw9', kind: 'people' },      // Compras
  { id: 'multiple_person_mm0wt53c', kind: 'people' },      // Vendedores secundarios
  { id: 'multiple_person_mm1m73qp', kind: 'people' },      // Responsable compras
  { id: 'deal_contact', kind: 'relation' },                // Contacto
  { id: 'board_relation_mkzsyfmd', kind: 'relation' },     // Lead de origen
  { id: 'dropdown_mm03g067', kind: 'dropdown' },           // Zona
  { id: 'deal_expected_close_date', kind: 'date' },        // Fecha Limite
  { id: 'date_mm09mv5b', kind: 'date' },                   // Fecha Cotización
  { id: 'color_mm0ex0ed', kind: 'status' },                // Quieres cotizar nuevos productos?
  { id: 'color_mm47f0ca', kind: 'status' },                // Tipo de cotización
  { id: 'text_mm0gje0', kind: 'text' },                    // Vigencia de la cotización
  { id: 'text_mm0gjrrd', kind: 'text' },                   // Tiempo de entrega
  { id: 'long_text_mm1m416j', kind: 'text' },              // Comentarios cotización (condiciones comerciales)
  { id: 'boolean_mm3qf8yv', kind: 'checkbox' },            // Sector Publico
];

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
const SUB_SKU = 'text_mm0bxy39';
const SUB_RECOSTEO = 'color_mm1eq4a0';
const SUB_NUEVO_PRODUCTO = 'color_mm1r1052';

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
const SUB_PRECIO_SUGERIDO = 'numeric_mm2qzzbe'; // "Precio de Venta (formula)" — numbers, no es fórmula
const SUB_COSTO_EMBELL_TXT = 'long_text_mm1b9bh8'; // desglose de costo por zona de embellecimiento

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

/** Copia los archivos de una columna `file`: los descarga de la original y los
 * vuelve a subir al item/línea nuevo con el MISMO nombre (las imágenes de
 * embellecimiento se llaman "<Zona>__original", así embellecimientoImagenes.ts
 * las reconoce igual). Monday no sabe "mover" un archivo entre items, solo
 * re-subirlo. Best-effort por archivo — uno que falla no aborta el resto. */
async function copyFiles(env: Env, sourceCols: Map<string, RawCol>, colId: string, targetId: number): Promise<void> {
  const files = parseFiles(sourceCols.get(colId));
  if (files.length === 0) return;
  const urls = await fetchAssetPublicUrls(env, files.map(f => String(f.assetId)));
  for (const f of files) {
    const url = urls.get(String(f.assetId));
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      await addFileToColumn(env, targetId, colId, blob, f.name);
    } catch {
      // archivo individual falla -> se omite, el resto sigue
    }
  }
}

/** Valor listo para create_item de una columna de la cabecera, según su tipo.
 * `undefined` = la original la tiene vacía y no se manda (mandar '' en un
 * date/dropdown lo rechaza Monday). Los labels van por TEXTO, nunca por id:
 * los ids de label son propios de cada columna (mismo motivo documentado en
 * ganarOportunidad.ts, donde copiar {ids:[…]} tradujo "Centro" a "Sur"). */
function itemColValue(kind: string, col: RawCol | undefined): unknown | undefined {
  if (!col) return undefined;
  const text = (col.text ?? '').trim();
  switch (kind) {
    case 'people':
      return peopleValue(col);
    case 'relation': {
      const ids = linkedIds(col);
      return ids.length ? { item_ids: ids } : undefined;
    }
    case 'dropdown':
      // dropdown admite varias etiquetas separadas por coma en el `text`.
      return text ? { labels: text.split(',').map(t => t.trim()).filter(Boolean) } : undefined;
    case 'date':
      return text ? { date: text.slice(0, 10) } : undefined;
    case 'status':
      return text ? { label: text } : undefined;
    case 'checkbox':
      return text ? { checked: 'true' } : undefined;
    default:
      return text || undefined;
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
  for (const { id, kind } of COPY_ITEM_COLS) {
    const value = itemColValue(kind, srcCols.get(id));
    if (value !== undefined) newCols[id] = value;
  }

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

  // La imagen del inventario que subió el vendedor es dato de entrada de la
  // cotización, no evidencia de un paso: se re-sube al clon.
  await copyFiles(env, srcCols, COL_INVENTARIO_IMG, newItemId);

  // Líneas vigentes = el mirror actual de subitems (mismo criterio que
  // quoteVersions.ts: "la vigente SIEMPRE es el mirror actual") — nunca las
  // versiones archivadas en cotizacion_versions. `childrenOf` ya las devuelve
  // en el orden que se ven en el portal (item_order).
  //
  // UNA POR UNA, no Promise.all: en Monday el orden de los subitems es el
  // orden en que se crean, así que en paralelo llegaban revueltos —
  // OPP-0925 (2026-08-19) salió Chamarra/UA Stellar/Camisola cuando la
  // original iba Pantalón/Camisola/Chamarra, con los renglones todavía
  // llamados "1".."9" pero ya en otra posición. Una copia exacta incluye el
  // orden; lo que se paga es latencia (un round-trip por línea).
  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  const conImagenes: { lc: Map<string, RawCol>; subId: number }[] = [];
  for (const linea of lineas) {
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
    // Desglose de costo por zona que captura Compras: se veía perdido en el
    // clon aunque la línea siguiera marcada "Con Embellecimiento".
    const costoEmbTxt = lc.get(SUB_COSTO_EMBELL_TXT)?.text;
    if (costoEmbTxt) subCols[SUB_COSTO_EMBELL_TXT] = costoEmbTxt;
    const precio = lc.get(SUB_PRECIO)?.text;
    if (precio) subCols[SUB_PRECIO] = precio.replace(/,/g, '');

    const etapaCosteo = lc.get(SUB_ETAPA_COSTEO)?.text;
    if (etapaCosteo) subCols[SUB_ETAPA_COSTEO] = { label: etapaCosteo };
    const moneda = lc.get(SUB_MONEDA)?.text;
    if (moneda) subCols[SUB_MONEDA] = { label: moneda };
    const recosteo = lc.get(SUB_RECOSTEO)?.text;
    if (recosteo) subCols[SUB_RECOSTEO] = { label: recosteo };
    const nuevoProducto = lc.get(SUB_NUEVO_PRODUCTO)?.text;
    if (nuevoProducto) subCols[SUB_NUEVO_PRODUCTO] = { label: nuevoProducto };
    for (const [colId, raw] of [
      [SUB_COSTO_DISTR, lc.get(SUB_COSTO_DISTR)?.text],
      [SUB_DESCUENTO_PCT, lc.get(SUB_DESCUENTO_PCT)?.text],
      [SUB_CONVERSION, lc.get(SUB_CONVERSION)?.text],
      [SUB_GASTOS_PCT, lc.get(SUB_GASTOS_PCT)?.text],
      [SUB_COSTO_EMBELL, lc.get(SUB_COSTO_EMBELL)?.text],
      [SUB_TECHO, lc.get(SUB_TECHO)?.text],
      [SUB_IVA_PCT, lc.get(SUB_IVA_PCT)?.text],
      [SUB_MARGEN_GOB_PCT, lc.get(SUB_MARGEN_GOB_PCT)?.text],
      [SUB_PRECIO_SUGERIDO, lc.get(SUB_PRECIO_SUGERIDO)?.text],
    ] as const) {
      if (raw) subCols[colId] = raw.replace(/,/g, '');
    }

    // Relación al catálogo Y los textos: `text_mm0bkm1j`/`text_mm0bxy39` los
    // llena una automatización de Monday a partir de la relación, pero solo
    // cuando la relación existe — copiarlos siempre deja la línea completa
    // también cuando el producto está escrito a mano (fuera de catálogo).
    const productoIds = linkedIds(lc.get(SUB_PRODUCTO_REL));
    if (productoIds.length) subCols[SUB_PRODUCTO_REL] = { item_ids: productoIds };
    const productoTxt = lc.get(SUB_PRODUCTO_TXT)?.text;
    if (productoTxt) subCols[SUB_PRODUCTO_TXT] = productoTxt;
    const sku = lc.get(SUB_SKU)?.text;
    if (sku) subCols[SUB_SKU] = sku;

    let newSub;
    try {
      newSub = await createSubitem(env, newItemId, linea.name, subCols);
    } catch {
      continue; // una línea falla -> se omite, no aborta el resto de la duplicación
    }
    await upsertItem(env, 'oportunidades_sub', newSub);
    if (parseFiles(lc.get(SUB_FILE)).length) conImagenes.push({ lc, subId: Number(newSub.id) });
  }

  // Las imágenes sí en paralelo: ya no hay orden que preservar (cuelgan de una
  // línea que ya existe) y son la parte lenta (descargar + volver a subir).
  await Promise.all(conImagenes.map(({ lc, subId }) => copyFiles(env, lc, SUB_FILE, subId)));

  // Un solo refetch de árbol al final: recoge el item + todas sus líneas
  // (incluidas las imágenes recién subidas) en una llamada.
  ctx.waitUntil(refetchItemTree(env, BOARDS.oportunidades.id, newItemId));

  return { id: newItemId };
}
