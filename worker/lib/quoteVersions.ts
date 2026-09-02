// worker/lib/quoteVersions.ts — Versiones de cotización. La vigente SIEMPRE es el
// mirror actual (Monday); `cotizacion_versions` en D1 solo archiva instantáneas de
// versiones superadas — nunca decide cuál es la vigente (Efraín, 2026-07-15).
// "+ Nueva versión" = DUPLICAR la vigente tal cual (Efraín, 2026-07-17: el draft
// editor de líneas era abrumador): se archiva la vigente en D1 y el mirror queda
// como copia idéntica en borrador — el vendedor la edita inline igual que en
// Nueva oportunidad y la regresa a costeo con "Mandar a costeo" cuando quiera.
// Borrador = todas las líneas con Etapa Costeo vacía/"No iniciado" (duplicar las
// resetea); nunca se tocan columnas de costo (grupo AC/WAC, de Compras).
// El vendedor puede versionar en CUALQUIER etapa, incluidas Ganada/Perdida
// (Efraín, 2026-08-14 — revierte el candado de Ganada/Perdida del
// 2026-07-15: sí hay casos reales de modificar una cotización ya cerrada,
// p.ej. un cambio pedido tras ganar) — no solo tras cotizar.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { QuoteLineSnapshot, QuoteVersionDTO } from '../../shared/dto';
import { getItem, childrenOf, listItems } from './dal';
import { submitWrite, flushOutbox } from './outbox';
import { createSubitem } from './monday';
import { borrarItem } from './itemBorrado';
import { upsertItem } from '../sync';
import type { RawCol } from './serialize';
import { listAjustes } from './lineaAjustes';
import { emitNotification, resolveRecipients, personIdsFromColumns } from './notify';
import { BOARDS } from '../../shared/boards';

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

// Oportunidades (item padre) — "Compras" asignado, para notificar al crear una
// versión (mismo id ya hardcodeado en worker/lib/costoDivergencia.ts, no hay
// constante compartida única — docs/monday-column-map.md).
const OPP_COMPRAS_COL = 'multiple_person_mm03qyw9';

const EMB_LABEL_CON = 'Con Embellecimiento';
const EMB_LABEL_SIN = 'Sin Embellecimiento';
const ETAPA_NO_INICIADO = 'No iniciado';

/** Columnas de línea que definen QUÉ se cotiza (a diferencia de costos/Etapa
 * Costeo, que son trabajo de Compras). Editarlas sobre una vigente ya costeada
 * dispara un versionado automático (worker/routes/boards.ts, oportunidades.ts)
 * — mismo criterio que "+ Nueva versión", pero sin que el vendedor tenga que
 * pedirlo aparte: las versiones son un registro "detrás", nunca un candado
 * para seguir editando (Efraín, 2026-08-14). */
export const LINE_DEFINING_COLS: ReadonlySet<string> = new Set([
  SUB_PRODUCTO_REL, SUB_PRODUCTO_TXT, SUB_COLOR, SUB_CANTIDAD, SUB_EMB_STATUS, SUB_EMB_DESC,
]);

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

/** Primer id ligado de una board_relation del mirror ({linked_item_ids:[...]},
 * ver monday.ts normalizeCols) — mismo parseo que duplicateOportunidad.ts. */
function linkedProductoId(col?: RawCol): number | undefined {
  if (!col?.value) return undefined;
  try {
    const ids = ((JSON.parse(col.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? []).map(Number).filter(Number.isFinite);
    return ids[0];
  } catch {
    return undefined;
  }
}

// Exportado para worker/lib/proyectoCotizacionVirtual.ts — la cotización virtual
// del Proyecto arma su vista base a partir de las MISMAS líneas vigentes que
// listVersions, sin duplicar este parseo.
export function snapshotLine(row: MirrorItem): QuoteLineSnapshot {
  const cols = colsOf(row);
  const embStatus = (cols.get(SUB_EMB_STATUS)?.text ?? '').trim();
  return {
    subitemId: row.item_id,
    productoItemId: linkedProductoId(cols.get(SUB_PRODUCTO_REL)),
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

/** Qué líneas regresan a "No iniciado" al archivar una versión. 'todas' = el
 * "+ Nueva versión" explícito (re-cotización completa); una lista = versionado
 * automático, donde solo la línea que cambió pierde su Etapa Costeo y el costeo
 * del resto sobrevive (Efraín, 2026-08-19: "no podemos perder toda la info").
 * Una línea que ya estaba pendiente no se reescribe: sería un write a Monday
 * para dejarla igual. Puro, para test unitario. */
export function lineasAResetear(lines: QuoteLineSnapshot[], resetear: 'todas' | number[]): number[] {
  const pedidas = resetear === 'todas' ? null : new Set(resetear);
  const out: number[] = [];
  for (const l of lines) {
    if (l.subitemId == null) continue;
    if (pedidas && !pedidas.has(l.subitemId)) continue;
    if (!l.etapaCosteo || l.etapaCosteo === ETAPA_NO_INICIADO) continue;
    out.push(l.subitemId);
  }
  return out;
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
  const vigenteId = archived.length ? Math.max(...archived.map(v => v.id)) + 1 : 1;
  const vigente: QuoteVersionDTO = {
    id: vigenteId,
    label: `V${archived.length + 1}`,
    createdAt: lineas[0]?.synced_at ?? new Date().toISOString(),
    status: 'vigente',
    total: totalOf(vigenteProducts),
    products: vigenteProducts,
    ajustes: await listAjustes(env, itemId, vigenteId),
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

function lineaPendiente(l: MirrorItem): boolean {
  const etapa = (colsOf(l).get(SUB_ETAPA_COSTEO)?.text ?? '').trim();
  return !etapa || etapa === ETAPA_NO_INICIADO;
}

/** true cuando la vigente es un borrador sin costear: TODAS las líneas con Etapa
 * Costeo vacía o "No iniciado" (duplicar la resetea; las líneas nuevas nacen sin
 * ella). Compartido con la ruta de crear líneas para desbloquear el grid como en
 * Nueva oportunidad. */
export function esDraftVigente(lineas: MirrorItem[]): boolean {
  if (lineas.length === 0) return false;
  return lineas.every(lineaPendiente);
}

/** true cuando ALGUNA línea espera costeo. Es el criterio de "esta cotización ya
 * está en revisión" desde que el versionado automático dejó de resetear las
 * líneas que nadie tocó (Efraín, 2026-08-19: "no podemos perder toda la info"):
 * sirve para (a) no apilar una versión archivada por cada tecleo mientras la
 * vigente ya tiene trabajo pendiente y (b) reactivar "Mandar a costeo", que es
 * exactamente lo que `checkCosteo` ya evaluaba del lado del server. */
export function hayLineaPendiente(lineas: MirrorItem[]): boolean {
  return lineas.some(lineaPendiente);
}

/**
 * Versionar EN AUTOMÁTICO antes de editar/borrar una línea — la regla de
 * Efraín (2026-09-02, "acuérdate que versión es después de costeo"): una
 * cotización que YA está costeada por completo archiva su foto antes de
 * tocarse; mientras quede alguna línea sin costear (Nueva oportunidad, un
 * borrador, un costeo a medias) solo se edita, sin versión. Mismo mecanismo
 * que "+ Nueva versión" (duplicateVersion) pero disparado por el write mismo:
 * las versiones son un registro "detrás", nunca un candado para seguir
 * editando (Efraín, 2026-08-14). Incluye Ganada/Perdida (2026-08-14).
 *
 * Es UNA sola función para los dos caminos que borran una línea (el 🗑 de la
 * fila = DELETE genérico, y "Ajustar línea → Eliminar") y para el PATCH de
 * columnas que definen la línea: antes "Eliminar" desde el modal versionaba
 * SIEMPRE, aun con la cotización sin costear, y el 🗑 solo si estaba
 * costeada — dos comportamientos para el mismo verbo.
 *
 * `resetear`: qué líneas regresan a "No iniciado" en la vigente (2026-08-19,
 * "no podemos perder toda la info"): al editar, solo la tocada; al borrar,
 * ninguna — la línea se va y las que quedan siguen costeadas igual. Devuelve
 * el error de duplicateVersion tal cual (p.ej. sin líneas); el caller decide.
 */
export async function autoVersionSiCosteada(
  env: Env, ctx: ExecutionContext, parentItemId: number, viewer: Identity,
  resetear: 'todas' | number[],
): Promise<QuoteVersionError | null> {
  const lineas = await childrenOf(env, 'oportunidades', parentItemId, viewer);
  if (lineas.length === 0 || hayLineaPendiente(lineas)) return null;
  try {
    await duplicateVersion(env, ctx, parentItemId, viewer, { resetear });
    return null;
  } catch (err) {
    if (err instanceof QuoteVersionError) return err;
    throw err;
  }
}

/** "+ Nueva versión" = duplicar la vigente, literal (Efraín, 2026-07-17): archiva
 * la vigente tal como está en D1 y regresa la Etapa Costeo de TODAS las líneas a
 * "No iniciado". El mirror (idéntico) queda como borrador: el grid se desbloquea
 * inline igual que en Nueva oportunidad y "Mandar a costeo" se reactiva. Aquí no
 * se edita ninguna línea — eso es un paso aparte del vendedor sobre el borrador. */
export async function duplicateVersion(
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity,
  opts: { resetear?: 'todas' | number[] } = {},
): Promise<void> {
  const resetear = opts.resetear ?? 'todas';
  // scope 'own': reescribe las líneas de la oportunidad (ver worker/lib/zonas.ts).
  const opp = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!opp) throw new QuoteVersionError(404, 'not found');

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
  //
  // `resetear` decide CUÁNTO se tira (Efraín, 2026-08-19: "no podemos perder
  // toda la info"). 'todas' es el "+ Nueva versión" explícito: el vendedor está
  // re-cotizando de cero y el borrador completo es justo lo que pidió. Una
  // LISTA es el versionado automático: cambió una línea, así que solo esa
  // regresa a "No iniciado" y las demás conservan su Etapa Costeo y su costeo.
  // El resto del pipeline ya trabajaba por línea — `enviarACosteo` no
  // recongela una línea ya costeada y solo manda las pendientes
  // (worker/lib/costeo.ts) — era este reset en bloque el que borraba el rastro
  // de qué había costeado Compras.
  for (const subitemId of lineasAResetear(currentLines, resetear)) {
    await submitWrite(env, ctx, 'oportunidades_sub', subitemId, { [SUB_ETAPA_COSTEO]: ETAPA_NO_INICIADO }, viewer, { skipFlush: true, trusted: true });
  }
  // Flush AQUÍ (no vía waitUntil): la ruta refetchea el árbol desde Monday
  // enseguida — sin este await el refetch pisaría el mirror con datos viejos.
  await flushOutbox(env);

  // Best-effort de verdad: la versión ya quedó archivada y el reset aplicado —
  // un fallo aquí (p.ej. vendedor_ids no parseable) no debe convertir el write
  // que la disparó en un 500 a medias.
  try {
    await notifyNuevaVersion(env, opp, itemId, version, viewer, resetear === 'todas');
  } catch { /* la notificación nunca bloquea el versionado */ }
}

/** Avisa a la OTRA parte cuando se crea una versión — vendedor avisa a Compras,
 * Compras (o admin) avisa a Ventas (Efraín, 2026-08-14: cubre los 4 disparadores
 * de duplicateVersion — botón explícito, auto-versionado al editar/borrar/crear
 * línea y "ajustar línea"→eliminar — desde este único punto). Best-effort,
 * `emitNotification`/`resolveRecipients` ya se tragan sus propios errores. */
async function notifyNuevaVersion(
  env: Env, opp: MirrorItem, itemId: number, version: number, viewer: Identity,
  resetTotal: boolean,
): Promise<void> {
  const vendedorIds = JSON.parse(opp.vendedor_ids || '[]') as number[];
  const compradorIds = personIdsFromColumns(opp.columns, OPP_COMPRAS_COL);
  const recipients = await resolveRecipients(
    env, viewer.role === 'vendedor' ? ['comprador'] : ['owner'],
    { vendedorIds, compradorIds, actorEmail: viewer.email },
  );
  const actorName = viewer.nombre || viewer.email;
  for (const recipientEmail of recipients) {
    await emitNotification(env, {
      recipientEmail,
      severity: 'importante',
      kind: 'nueva_version',
      title: `${actorName} creó V${version} de la cotización en ${opp.name}`,
      body: resetTotal
        ? 'La versión anterior quedó archivada y todas las líneas regresaron a costeo — revisa la vigente.'
        : 'La versión anterior quedó archivada. Solo la línea que cambió regresó a costeo; el resto conserva su Etapa Costeo.',
      boardKey: 'oportunidades',
      boardId: BOARDS.oportunidades.id,
      itemId,
      actor: actorName,
      dedupeKey: `nueva_version:${itemId}:${version}:${recipientEmail}`,
    });
  }
}

// Mismo criterio de tolerancia que costeo.ts norm(): sin acentos/mayúsculas.
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** "Restaurar esta versión" (Efraín, 2026-07-17): archiva la vigente y deja el
 * mirror igual a la instantánea elegida — reescribe producto/color/cantidad/
 * embellecimiento/precio en las líneas que siguen vivas, recrea las que ya no
 * existen (sus imágenes de zona no se versionan — no regresan) y BORRA de
 * Monday las que no estaban en esa versión. El resultado es un borrador
 * (Etapa Costeo "No iniciado" en todo): cambiar de versión implica que la
 * oportunidad pase por costeo otra vez, vía "Mandar a costeo". */
export async function restoreVersion(
  env: Env, ctx: ExecutionContext, itemId: number, versionNum: number, viewer: Identity,
): Promise<void> {
  // scope 'own': reescribe las líneas de la oportunidad (ver worker/lib/zonas.ts).
  const opp = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!opp) throw new QuoteVersionError(404, 'not found');

  const row = await env.DB
    .prepare('SELECT products FROM cotizacion_versions WHERE item_id = ? AND version = ?')
    .bind(itemId, versionNum)
    .first<{ products: string }>();
  if (!row) throw new QuoteVersionError(404, 'Esa versión no existe.');
  const target = JSON.parse(row.products) as QuoteLineSnapshot[];
  if (target.length === 0) throw new QuoteVersionError(422, 'Esa versión no tiene líneas — no hay nada que restaurar.');

  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  const currentLines = lineas.map(snapshotLine);

  // Archiva la vigente ANTES de tocar nada — nunca se pierde estado.
  const version = (await maxVersion(env, itemId)) + 1;
  await env.DB
    .prepare(`INSERT INTO cotizacion_versions (item_id, version, label, folio, total_fmt, products, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?)`)
    .bind(itemId, version, `V${version}`, String(totalOf(currentLines)), JSON.stringify(currentLines), new Date().toISOString())
    .run();

  // Instantáneas pre-2026-07-17 no traen productoItemId — se resuelve por nombre
  // contra el catálogo de Productos (mirror), cargado una sola vez y solo si hace falta.
  let catalogo: MirrorItem[] | undefined;
  const resolveProductoId = async (line: QuoteLineSnapshot): Promise<number | undefined> => {
    if (line.productoItemId) return line.productoItemId;
    catalogo ??= await listItems(env, 'productos', viewer);
    const objetivo = norm(line.producto);
    return catalogo.find(p => norm(p.name) === objetivo)?.item_id;
  };

  const currentById = new Map(currentLines.filter(l => l.subitemId != null).map(l => [l.subitemId, l]));
  const targetIds = new Set(target.filter(l => l.subitemId != null).map(l => l.subitemId));

  for (const t of target) {
    const cur = t.subitemId != null ? currentById.get(t.subitemId) : undefined;
    if (cur) {
      // La línea sigue viva: reescribir sus datos tal como estaban. `trusted`
      // porque precio/Etapa Costeo no son escribibles por vendedor — es una
      // restauración decidida por el server, mismo criterio que duplicateVersion.
      const writeCols: Record<string, string> = {
        [SUB_COLOR]: t.color,
        [SUB_CANTIDAD]: String(t.cantidad),
        [SUB_EMB_STATUS]: t.embellecimiento ? EMB_LABEL_CON : EMB_LABEL_SIN,
        [SUB_EMB_DESC]: t.descripcionEmbellecimiento ?? '',
        [SUB_PRECIO]: String(t.precioUnitario ?? 0),
        [SUB_ETAPA_COSTEO]: ETAPA_NO_INICIADO,
      };
      if (norm(cur.producto) !== norm(t.producto)) {
        const rel = await resolveProductoId(t);
        if (rel) writeCols[SUB_PRODUCTO_REL] = String(rel);
        else writeCols[SUB_PRODUCTO_TXT] = t.producto;
      }
      await submitWrite(env, ctx, 'oportunidades_sub', t.subitemId!, writeCols, viewer, { skipFlush: true, trusted: true });
      continue;
    }
    // La línea ya no existe: recrearla desde la instantánea (mismo patrón que
    // duplicateOportunidad.ts). Nace sin Etapa Costeo = pendiente de costeo.
    const subCols: Record<string, unknown> = {
      [SUB_CANTIDAD]: String(t.cantidad),
      [SUB_COLOR]: t.color,
      [SUB_EMB_STATUS]: { label: t.embellecimiento ? EMB_LABEL_CON : EMB_LABEL_SIN },
    };
    if (t.descripcionEmbellecimiento) subCols[SUB_EMB_DESC] = t.descripcionEmbellecimiento;
    if (t.precioUnitario) subCols[SUB_PRECIO] = String(t.precioUnitario);
    const rel = await resolveProductoId(t);
    if (rel) subCols[SUB_PRODUCTO_REL] = { item_ids: [rel] };
    else subCols[SUB_PRODUCTO_TXT] = t.producto;
    const sub = await createSubitem(env, itemId, t.producto.trim() || 'Producto', subCols);
    await upsertItem(env, 'oportunidades_sub', sub);
  }

  // Líneas que no estaban en la versión restaurada: se borran de Monday y del
  // mirror (worker/lib/itemBorrado.ts). Esconderlas solo del portal no sirve —
  // costeo y la cotización leen Monday directo y las seguirían cobrando
  // (Efraín, 2026-08-19). Restaurar sigue siendo reversible: si mañana se
  // restaura la versión nueva, el bloque de arriba las recrea desde su
  // instantánea con createSubitem.
  for (const cur of currentLines) {
    if (cur.subitemId != null && !targetIds.has(cur.subitemId)) {
      await borrarItem(env, BOARDS.oportunidades_sub.id, cur.subitemId, viewer.email);
    }
  }

  await flushOutbox(env);
}
