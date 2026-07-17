// worker/lib/quoteVersions.ts — Versiones de cotización. La vigente SIEMPRE es el
// mirror actual (Monday); `cotizacion_versions` en D1 solo archiva instantáneas de
// versiones superadas — nunca decide cuál es la vigente (Efraín, 2026-07-15).
// "+ Nueva versión" = DUPLICAR la vigente tal cual (Efraín, 2026-07-17: el draft
// editor de líneas era abrumador): se archiva la vigente en D1 y el mirror queda
// como copia idéntica en borrador — el vendedor la edita inline igual que en
// Nueva oportunidad y la regresa a costeo con "Mandar a costeo" cuando quiera.
// Borrador = todas las líneas con Etapa Costeo vacía/"No iniciado" (duplicar las
// resetea); nunca se tocan columnas de costo (grupo AC/WAC, de Compras).
// El vendedor puede versionar en cualquier etapa salvo Ganada/Perdida (Efraín,
// 2026-07-15) — no solo tras cotizar.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { QuoteLineSnapshot, QuoteVersionDTO } from '../../shared/dto';
import { getItem, childrenOf } from './dal';
import { submitWrite, flushOutbox } from './outbox';
import type { RawCol } from './serialize';

export class QuoteVersionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Oportunidades subitems (18395657607) — docs/monday-column-map.md.
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
const ETAPA_NO_INICIADO = 'No iniciado';

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
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

/** true cuando la vigente es un borrador sin costear: TODAS las líneas con Etapa
 * Costeo vacía o "No iniciado" (duplicar la resetea; las líneas nuevas nacen sin
 * ella). Compartido con la ruta de crear líneas para desbloquear el grid como en
 * Nueva oportunidad. */
export function esDraftVigente(lineas: MirrorItem[]): boolean {
  if (lineas.length === 0) return false;
  return lineas.every(l => {
    const etapa = (colsOf(l).get(SUB_ETAPA_COSTEO)?.text ?? '').trim();
    return !etapa || etapa === ETAPA_NO_INICIADO;
  });
}

/** "+ Nueva versión" = duplicar la vigente, literal (Efraín, 2026-07-17): archiva
 * la vigente tal como está en D1 y regresa la Etapa Costeo de TODAS las líneas a
 * "No iniciado". El mirror (idéntico) queda como borrador: el grid se desbloquea
 * inline igual que en Nueva oportunidad y "Mandar a costeo" se reactiva. Aquí no
 * se edita ninguna línea — eso es un paso aparte del vendedor sobre el borrador. */
export async function duplicateVersion(
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity,
): Promise<void> {
  const opp = await getItem(env, 'oportunidades', itemId, viewer);
  if (!opp) throw new QuoteVersionError(404, 'not found');

  const cols = colsOf(opp);
  let stage = '';
  try { stage = String((JSON.parse(cols.get('deal_stage')?.value ?? 'null') as { index?: unknown })?.index ?? ''); } catch { /* ignore */ }
  if (stage === '1' || stage === '2') {
    throw new QuoteVersionError(422, 'La oportunidad ya está Ganada o Perdida — no se pueden editar sus líneas.');
  }

  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  if (lineas.length === 0) {
    throw new QuoteVersionError(422, 'La oportunidad no tiene líneas de producto — no hay nada que duplicar.');
  }
  // Doble click / borrador ya abierto: no apiles copias idénticas en D1.
  if (esDraftVigente(lineas)) {
    throw new QuoteVersionError(422, 'La versión vigente aún no se costea — edítala directo, no hace falta duplicarla.');
  }

  const currentLines = lineas.map(snapshotLine);
  const version = (await maxVersion(env, itemId)) + 1;
  await env.DB
    .prepare(`INSERT INTO cotizacion_versions (item_id, version, label, folio, total_fmt, products, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?)`)
    .bind(itemId, version, `V${version}`, String(totalOf(currentLines)), JSON.stringify(currentLines), new Date().toISOString())
    .run();

  // Reset del ciclo de costeo — `trusted` porque es una decisión del server (el
  // vendedor no puede escribir Etapa Costeo por su cuenta), mismo criterio que
  // enviarAValidacion en costeo.ts.
  for (const l of currentLines) {
    if (l.subitemId != null && l.etapaCosteo && l.etapaCosteo !== ETAPA_NO_INICIADO) {
      await submitWrite(env, ctx, 'oportunidades_sub', l.subitemId, { [SUB_ETAPA_COSTEO]: ETAPA_NO_INICIADO }, viewer, { skipFlush: true, trusted: true });
    }
  }
  // Flush AQUÍ (no vía waitUntil): la ruta refetchea el árbol desde Monday
  // enseguida — sin este await el refetch pisaría el mirror con datos viejos.
  await flushOutbox(env);
}
