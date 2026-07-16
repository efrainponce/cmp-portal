// worker/lib/quoteVersions.ts — Versiones de cotización. La vigente SIEMPRE es el
// mirror actual (Monday); `cotizacion_versions` en D1 solo archiva instantáneas de
// versiones superadas — nunca decide cuál es la vigente (Efraín, 2026-07-15). Una
// versión nueva se crea cuando cambia producto, color, cantidad o embellecimiento
// de una línea, o se agrega/quita una línea, respecto a la vigente. Nunca se tocan
// columnas de costo (grupo AC/WAC, capturadas aparte por Compras vía costeo.ts) —
// así el costeo de una línea sobrevive intacto mientras su producto no cambie.
// El vendedor puede editar líneas en cualquier etapa salvo Ganada/Perdida (Efraín,
// 2026-07-15) — no solo tras cotizar. Si una oportunidad nunca tuvo V1 anclada
// (nueva, o clonada/legacy sin historial), la primera edición la ancla al vuelo.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { QuoteLineInput, QuoteLineSnapshot, QuoteVersionDTO } from '../../shared/dto';
import { getItem, childrenOf } from './dal';
import { submitWrite, flushOutbox } from './outbox';
import { createSubitem } from './monday';
import { upsertItem } from '../sync';
import type { RawCol } from './serialize';

export class QuoteVersionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Oportunidades subitems (18395657607) — docs/monday-column-map.md.
const SUB_PRODUCTO_REL = 'board_relation_mkzmafgp';
const SUB_PRODUCTO_TXT = 'text_mm0bkm1j';
const SUB_PRODUCTO_NOMBRE = 'lookup_mm0x4kda';    // mirror del producto ligado
const SUB_SKU = 'lookup_mkzn7x9a';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_EMB_STATUS = 'color_mm1b34bg';
const SUB_EMB_DESC = 'long_text_mm1bj4pt';
const SUB_PRECIO = 'numeric_mkzneg3d';
const SUB_ETAPA_COSTEO = 'color_mm084gvf';

const EMB_LABEL_CON = 'Con Embellecimiento';
const EMB_LABEL_SIN = 'Sin Embellecimiento';
const ETAPA_NO_INICIADO = 'No iniciado';

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

// Mismo criterio de tolerancia que worker/lib/costeo.ts norm(): sin acentos/mayúsculas.
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function productoNombre(cols: Map<string, RawCol>): string {
  return (cols.get(SUB_PRODUCTO_NOMBRE)?.text || cols.get(SUB_PRODUCTO_TXT)?.text || '').trim();
}

function snapshotLine(row: MirrorItem): QuoteLineSnapshot {
  const cols = colsOf(row);
  const embStatus = (cols.get(SUB_EMB_STATUS)?.text ?? '').trim();
  return {
    subitemId: row.item_id,
    producto: productoNombre(cols) || row.name,
    sku: cols.get(SUB_SKU)?.text || undefined,
    color: (cols.get(SUB_COLOR)?.text ?? '').trim(),
    cantidad: Number((cols.get(SUB_CANTIDAD)?.text ?? '').replace(/,/g, '')) || 0,
    embellecimiento: embStatus === EMB_LABEL_CON,
    descripcionEmbellecimiento: cols.get(SUB_EMB_DESC)?.text || undefined,
    // .value en el mirror crudo es el JSON sin normalizar de Monday (para numeric
    // llega como '"1640"', con comillas literales) — .text ya viene limpio, mismo
    // patrón que cantidad arriba.
    precioUnitario: Number((cols.get(SUB_PRECIO)?.text ?? '').replace(/,/g, '')) || 0,
    etapaCosteo: cols.get(SUB_ETAPA_COSTEO)?.text || undefined,
  };
}

function totalOf(lines: QuoteLineSnapshot[]): number {
  return lines.reduce((sum, l) => sum + (l.precioUnitario ?? 0) * l.cantidad, 0);
}

interface ArchivedRow {
  version: number;
  label: string;
  folio: string | null;
  total_fmt: string | null;
  products: string;
  created_at: string;
}

async function archivedVersions(env: Env, itemId: number): Promise<QuoteVersionDTO[]> {
  const res = await env.DB
    .prepare('SELECT version, label, folio, total_fmt, products, created_at FROM cotizacion_versions WHERE item_id = ? ORDER BY version')
    .bind(itemId)
    .all<ArchivedRow>();
  return (res.results ?? []).map(r => ({
    id: r.version,
    label: r.label,
    createdAt: r.created_at,
    status: 'anterior' as const,
    folio: r.folio ?? undefined,
    total: Number(r.total_fmt ?? 0) || 0,
    products: JSON.parse(r.products) as QuoteLineSnapshot[],
  }));
}

async function maxVersion(env: Env, itemId: number): Promise<number> {
  const row = await env.DB
    .prepare('SELECT MAX(version) as m FROM cotizacion_versions WHERE item_id = ?')
    .bind(itemId)
    .first<{ m: number | null }>();
  return row?.m ?? 0;
}

/** Lista completa: archivadas (D1) + la vigente armada en caliente desde el mirror.
 * La vigente se muestra siempre que haya líneas (Efraín, 2026-07-15) — el vendedor
 * puede agregar/editar productos desde "Nueva oportunidad" en adelante, así que V1
 * existe conceptualmente desde la primera línea, no solo tras generar la cotización.
 * [] solo cuando la oportunidad no tiene ninguna línea todavía. */
export async function listVersions(env: Env, itemId: number, viewer: Identity): Promise<QuoteVersionDTO[]> {
  const archived = await archivedVersions(env, itemId);
  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  if (lineas.length === 0) return archived;
  const vigenteProducts = lineas.map(snapshotLine);
  const vigente: QuoteVersionDTO = {
    id: archived.length ? Math.max(...archived.map(v => v.id)) + 1 : 1,
    label: `V${archived.length + 1}`,
    createdAt: lineas[0]?.synced_at ?? new Date().toISOString(),
    status: 'vigente',
    total: totalOf(vigenteProducts),
    products: vigenteProducts,
  };
  return [...archived, vigente];
}

/** Se llama justo después de que `generateCotizacion` regresa ok — ancla "V1" con
 * las líneas tal como quedaron cotizadas. No-op si V1 ya existe (re-generación). */
export async function recordFirstVersion(
  env: Env, itemId: number, viewer: Identity, folio: string | undefined, total: number,
): Promise<void> {
  const existing = await maxVersion(env, itemId);
  if (existing > 0) return;
  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  const products = lineas.map(snapshotLine);
  await env.DB
    .prepare(`INSERT INTO cotizacion_versions (item_id, version, label, folio, total_fmt, products, created_at)
      VALUES (?, 1, 'V1', ?, ?, ?, ?)`)
    .bind(itemId, folio ?? null, String(total || totalOf(products)), JSON.stringify(products), new Date().toISOString())
    .run();
}

function linesDiffer(current: QuoteLineSnapshot, input: QuoteLineInput): boolean {
  return (
    norm(current.producto) !== norm(input.producto) ||
    norm(current.color) !== norm(input.color) ||
    current.cantidad !== input.cantidad ||
    current.embellecimiento !== input.embellecimiento ||
    (current.descripcionEmbellecimiento ?? '') !== (input.descripcionEmbellecimiento ?? '')
  );
}

/** Aplica una edición de líneas: si algo cambió respecto a la vigente, archiva la
 * vigente actual como versión superada y escribe los cambios (nunca columnas de
 * costo). Responde `changed:false` sin tocar nada si el draft es idéntico. */
export async function submitVersion(
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity, lines: QuoteLineInput[],
): Promise<{ changed: boolean }> {
  const opp = await getItem(env, 'oportunidades', itemId, viewer);
  if (!opp) throw new QuoteVersionError(404, 'not found');

  const cols = colsOf(opp);
  let stage = '';
  try { stage = String((JSON.parse(cols.get('deal_stage')?.value ?? 'null') as { index?: unknown })?.index ?? ''); } catch { /* ignore */ }
  // El vendedor puede agregar/editar productos en cualquier etapa salvo Ganada(1)/
  // Perdida(2) (Efraín, 2026-07-15) — no solo tras "Generar cotización". Si nunca
  // se ancló una V1 (oportunidad nueva, o clonada/legacy sin historial en D1), esta
  // edición ancla V1 al vuelo con el estado actual antes de aplicar el cambio.
  if (stage === '1' || stage === '2') {
    throw new QuoteVersionError(422, 'La oportunidad ya está Ganada o Perdida — no se pueden editar sus líneas.');
  }
  const existing = await maxVersion(env, itemId);

  const currentLines = (await childrenOf(env, 'oportunidades', itemId, viewer)).map(snapshotLine);
  const byId = new Map(currentLines.map(l => [l.subitemId, l]));
  const inputIds = new Set(lines.filter(l => l.subitemId != null).map(l => l.subitemId));

  const removed = currentLines.some(l => l.subitemId != null && !inputIds.has(l.subitemId));
  const added = lines.some(l => l.subitemId == null);
  const changedExisting = lines.some(l => {
    if (l.subitemId == null) return false;
    const cur = byId.get(l.subitemId);
    return !cur || linesDiffer(cur, l);
  });
  const changed = removed || added || changedExisting;
  if (!changed) return { changed: false };

  // Archiva la vigente ANTES de escribir nada — así D1 siempre archiva estado
  // pre-cambio, nunca el que se está a punto de escribir.
  const version = existing + 1;
  await env.DB
    .prepare(`INSERT INTO cotizacion_versions (item_id, version, label, folio, total_fmt, products, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?)`)
    .bind(itemId, version, `V${version}`, String(totalOf(currentLines)), JSON.stringify(currentLines), new Date().toISOString())
    .run();

  for (const input of lines) {
    if (input.subitemId == null) {
      // Línea nueva — mismo patrón que worker/lib/createOportunidad.ts.
      const subCols: Record<string, unknown> = {
        [SUB_CANTIDAD]: String(input.cantidad),
        [SUB_COLOR]: input.color,
        [SUB_EMB_STATUS]: { label: input.embellecimiento ? EMB_LABEL_CON : EMB_LABEL_SIN },
      };
      if (input.productoItemId) subCols[SUB_PRODUCTO_REL] = { item_ids: [input.productoItemId] };
      else subCols[SUB_PRODUCTO_TXT] = input.producto;
      if (input.descripcionEmbellecimiento) subCols[SUB_EMB_DESC] = input.descripcionEmbellecimiento;
      const sub = await createSubitem(env, itemId, input.producto.trim() || 'Producto', subCols);
      await upsertItem(env, 'oportunidades_sub', sub);
      continue;
    }
    const cur = byId.get(input.subitemId);
    if (!cur || !linesDiffer(cur, input)) continue;
    const writeCols: Record<string, string> = {
      [SUB_COLOR]: input.color,
      [SUB_CANTIDAD]: String(input.cantidad),
      [SUB_EMB_STATUS]: input.embellecimiento ? EMB_LABEL_CON : EMB_LABEL_SIN,
      [SUB_EMB_DESC]: input.descripcionEmbellecimiento ?? '',
    };
    if (norm(cur.producto) !== norm(input.producto)) {
      if (input.productoItemId) writeCols[SUB_PRODUCTO_REL] = String(input.productoItemId);
      else writeCols[SUB_PRODUCTO_TXT] = input.producto;
    }
    // Compras ya avanzó esta línea (Etapa Costeo != "No iniciado") pero el
    // vendedor la acaba de cambiar — resetearla para que validar_costeo (cmp-tallas)
    // la vuelva a snapshotear en vez de dejar costo viejo pegado a datos nuevos.
    if (cur.etapaCosteo && cur.etapaCosteo !== ETAPA_NO_INICIADO) {
      writeCols[SUB_ETAPA_COSTEO] = ETAPA_NO_INICIADO;
    }
    await submitWrite(env, ctx, 'oportunidades_sub', input.subitemId, writeCols, viewer, { skipFlush: true });
  }

  // Flush AQUÍ (no vía waitUntil): el caller manda esto a costeo enseguida y
  // cmp-tallas lee Monday directo — sin este await podría snapshotear datos
  // viejos. El refetch del árbol lo hace la ruta después del costeo, una sola vez.
  await flushOutbox(env);
  return { changed: true };
}
