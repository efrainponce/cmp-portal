// worker/lib/duplicateOportunidad.ts — "Duplicar" en el drawer: clona una
// Oportunidad a una nueva en etapa "Nueva oportunidad" (4), con cabecera
// (Cliente/Vendedor/Comprador) + SOLO las líneas vigentes (el mirror actual,
// igual criterio que quoteVersions.ts) + su embellecimiento (estatus,
// descripción de zonas, precio de venta e imágenes de referencia). Nunca
// arrastra versiones anteriores (cotizacion_versions en D1), PDFs de
// cotización ni ningún otro documento — la nueva opp empieza limpia y pasa
// por costeo/cotización como cualquier oportunidad nueva (Efraín, 2026-07-17).
// Column ids de docs/monday-column-map.md / column-meta.gen.ts — nunca fabricar.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
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
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity,
): Promise<{ id: number }> {
  if (!DUPLICATE_ROLES.includes(viewer.role)) throw new DuplicateOportunidadError(403, 'cannot duplicate');

  const source = await getItem(env, 'oportunidades', itemId, viewer);
  if (!source) throw new DuplicateOportunidadError(404, 'not found');
  const srcCols = colsOf(source);

  const newCols: Record<string, unknown> = {
    [COL_ETAPA]: { label: 'Nueva oportunidad' },
  };
  const vendedor = peopleValue(srcCols.get(COL_VENDEDOR));
  if (vendedor) newCols[COL_VENDEDOR] = vendedor;
  const comprador = peopleValue(srcCols.get(COL_COMPRADOR));
  if (comprador) newCols[COL_COMPRADOR] = comprador;
  const contactoIds = linkedIds(srcCols.get(COL_CONTACTO));
  if (contactoIds.length) newCols[COL_CONTACTO] = { item_ids: contactoIds };

  let newItem;
  try {
    newItem = await createItem(env, BOARDS.oportunidades.id, `${source.name} (copia)`, newCols);
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
