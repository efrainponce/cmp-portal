// worker/lib/lineaAjustes.ts — "Ajustar línea" (Efraín, 2026-07-31, WhatsApp con
// Ricardo/Pam): cambiar producto (género), color, embellecimiento o cantidad de
// una línea de cotización SIN crear una versión ni pasar por costeo — funciona
// incluso con la Oportunidad Ganada. Nace del caso real de la OC: el cliente
// cambia detalles que no afectan el precio ya negociado (SKU dama↔caballero
// mismo precio, reparto de una cantidad entre dos colores, embellecimiento
// distinto para un subconjunto) y hoy eso obligaba a reiniciar todo el pipeline
// porque las líneas quedan bloqueadas apenas Ganada.
//
// Nunca escribe numeric_mkzneg3d (precio) ni deal_stage — por construcción, no
// por validación: el precio de venta es un valor negociado que vive solo en la
// línea (el catálogo de Productos no tiene columna de precio), así que nunca
// hace falta comparar "mismo precio" entre SKUs, basta con no tocar el campo.
//
// Dos modos:
//   - 'editar':  PATCH en el sitio, la misma línea.
//   - 'dividir': crea una línea hermana con una parte de la cantidad actual;
//     copia TODA la línea origen (precio, Etapa Costeo, costeo de Compras,
//     imagen de embellecimiento, etc. — ver copyRemainingCols) salvo lo que
//     vino en el body, y resta esa cantidad de la origen.
//
// Un tercer modo, 'eliminar' (borrar la línea completa), NO vive aquí — a
// diferencia de editar/dividir SÍ reinicia el ciclo de costeo (crea una
// versión nueva primero, como "+ Nueva versión") y por eso está bloqueado en
// Ganada/Perdida; se maneja en worker/routes/oportunidades.ts junto con
// duplicateVersion (2026-08-13, Efraín: "cuando no está en Nueva oportunidad
// se crea una nueva versión").
//
// Cada ajuste queda registrado en cotizacion_ajustes como V{mayor}.{n} — no es
// una versión real (no pasa por costeo), solo trazabilidad de que la vigente
// tuvo retoques; quoteVersions.ts (listVersions) la adjunta a la vigente para
// mostrarla en VersionChips.
//
// Lo que dejó OPP-0970 (Pam, 2026-08-26 → reportado 2026-09-10):
//   - Al cambiar de producto (caballero → dama) el SKU y el nombre de la línea
//     nueva salen del CATÁLOGO, nunca copiados de la línea origen. Antes
//     `copyRemainingCols` arrastraba el SKU texto (`text_mm0bxy39`) y la línea
//     de dama nacía como "Women's … POLO / SKU 71049" — así salió en el archivo
//     de tallas y así se capturaron las tallas del Proyecto.
//   - Si la línea hermana de un 'dividir' desaparece (alguien la borra directo
//     en Monday — el portal nunca esconde una línea, worker/lib/itemBorrado.ts),
//     la cotización se queda con la origen ya recortada y SIN la parte nueva,
//     y nadie lo ve: la origen sigue diciendo "Dividida". `listAjustesConEstado`
//     marca esos ajustes (`lineaBorrada`) y `restaurarLineaDividida` vuelve a
//     crear la línea a partir del ajuste + la origen actual, sin restar de nuevo.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import { registrarArchivo } from './archivoLog';
import { BOARDS } from '../../shared/boards';
import type { Identity, MirrorItem } from '../../shared/types';
import type { AjusteDTO, AjustarLineaRequest, CostoDivergenciaDTO } from '../../shared/dto';
import { getItem, getItemTrusted } from './dal';
import { ensureItemBorradoTable } from './itemBorrado';
import { submitWrite, flushOutbox } from './outbox';
import { createSubitem, addFileToColumn, fetchAssetPublicUrls, fetchItem, updateItemColumns } from './monday';
import { upsertItem } from '../sync';
import { toRawColumns } from '../sync/upsert';
import { productoIdDeWrite } from './ficha';
import { isNativeId } from '../../shared/nativeId';
import type { RawCol } from './serialize';
import { checkCostoDivergente } from './costoDivergencia';
import { COLUMN_META } from '../../shared/column-meta.gen';

export class AjusteLineaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Oportunidades subitems (18395657607) — docs/monday-column-map.md. Mismos ids
// que worker/lib/quoteVersions.ts (SUB_*); redefinidos aquí siguiendo el mismo
// criterio del resto del repo (duplicateOportunidad.ts, costeo.ts…): cada
// archivo declara los ids de columna que usa, no los importa de otro módulo.
const SUB_PRODUCTO_REL = 'board_relation_mkzmafgp';
const SUB_PRODUCTO_TXT = 'text_mm0bkm1j';
const SUB_PRODUCTO_NOMBRE = 'lookup_mm0x4kda';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_EMB_STATUS = 'color_mm1b34bg';
const SUB_EMB_DESC = 'long_text_mm1bj4pt';
const SUB_FILE = 'file_mm5akjy5'; // Imagen embellecimiento
// SKU texto de la línea: es el que cmp-tallas imprime en el archivo de tallas y
// el que el Proyecto hereda al capturar tallas — por eso va del catálogo, no
// copiado, cuando la línea cambia de producto.
const SUB_SKU_TXT = 'text_mm0bxy39';
// Catálogo de Productos (18395657591): SKU propio del producto. El nombre del
// producto es el `name` del item ("61165 - Women's Performance Short Sleeve
// POLO"), mismo formato que Monday deja en `text_mm0bkm1j` al ligar la relación.
const PRODUCTO_SKU = 'product_and_service_sku';

// "dividir" clona la línea entera, no solo producto/color/cantidad/embellecimiento
// (Pam, 2026-08-11: Costo Distr. C/U y demás campos de Compras salían vacíos en
// la línea nueva). COPY_COL_TYPES = tipos que sí son datos capturados a mano
// (numeric/text/status) — todo lo demás en oportunidades_sub es mirror/formula
// (se recalcula solo) o metadata de Monday (creation_log, item_id, button…),
// nunca algo que tenga sentido copiar.
const COPY_COL_TYPES = new Set(['numbers', 'text', 'long_text', 'status']);
// Ya tienen su propio manejo explícito abajo (con override de `input` o lógica
// especial) — el copiado genérico no debe pisarlos. El SKU texto entra aquí
// desde 2026-09-10: se copia SOLO si el producto no cambia (crearLineaHermana).
const DIVIDIR_EXPLICIT_IDS = new Set([
  'name', SUB_PRODUCTO_REL, SUB_PRODUCTO_TXT, SUB_PRODUCTO_NOMBRE, SUB_SKU_TXT,
  SUB_COLOR, SUB_CANTIDAD, SUB_EMB_STATUS, SUB_EMB_DESC, SUB_FILE,
]);

/** Copia genérica de cols "de captura" (numeric/text/status) de la línea
 * origen a la nueva, saltando las que ya tienen manejo explícito — así
 * Recosteo?, SKU manual, Comentarios Ventas, Costo Distr., Descuento,
 * Gastos %, Techo, IVA, Moneda (línea), etc. no se quedan vacíos al dividir,
 * sin tener que enumerar cada columna del board a mano. Exportada para test
 * unitario puro (sin red/D1). */
export function copyRemainingCols(cols: Map<string, RawCol>): Record<string, unknown> {
  const meta = COLUMN_META.oportunidades_sub;
  const out: Record<string, unknown> = {};
  for (const [id, col] of cols) {
    if (DIVIDIR_EXPLICIT_IDS.has(id)) continue;
    const type = meta[id]?.type;
    if (!type || !COPY_COL_TYPES.has(type)) continue;
    const text = col.text?.trim();
    if (!text) continue;
    out[id] = type === 'status' ? { label: text } : type === 'numbers' ? text.replace(/,/g, '') : text;
  }
  return out;
}

/** Descarga+resube la imagen de embellecimiento de la línea origen a la
 * nueva (mismo patrón que duplicateOportunidad.ts copyZoneImages) — best
 * effort por archivo, una imagen que falla no aborta la línea. */
async function copyEmbellecimientoImage(env: Env, sourceCols: Map<string, RawCol>, newSubitemId: number): Promise<void> {
  const raw = sourceCols.get(SUB_FILE)?.value;
  if (!raw) return;
  let files: { name: string; assetId: number }[];
  try {
    files = (JSON.parse(raw) as { files?: { name: string; assetId: number }[] }).files ?? [];
  } catch {
    return;
  }
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
      await registrarArchivo(env, {
        acto: 'copia', categoria: 'copia-linea', nombre: f.name,
        boardId: BOARDS.oportunidades_sub.id, itemId: newSubitemId, colId: SUB_FILE, bytes: blob.size,
      });
    } catch {
      // imagen individual falla -> se omite, el resto de la línea sigue
    }
  }
}

/** SKU y nombre que la línea toma del catálogo al cambiar de producto. Puro
 * (recibe el renglón del espejo de Productos) para test unitario. El SKU sale
 * de `product_and_service_sku`; si el catálogo no lo trae, del prefijo
 * "SKU - Nombre" con el que se nombran los productos. */
export function textosDeProducto(producto: { name: string; columns: string }): { nombre: string; sku: string } {
  const nombre = producto.name.trim();
  let sku = '';
  try {
    const cols: RawCol[] = JSON.parse(producto.columns || '[]');
    sku = (cols.find(c => c.id === PRODUCTO_SKU)?.text ?? '').trim();
  } catch {
    // sin columnas parseables: cae al prefijo del nombre
  }
  if (!sku) {
    const m = /^(\S+)\s+-\s+/.exec(nombre);
    if (m) sku = m[1];
  }
  return { nombre, sku };
}

/** Item del catálogo cuyo nombre es exactamente `nombre` (sin distinguir
 * mayúsculas) — para 'restaurar', que solo tiene el nombre registrado en el
 * ajuste. undefined si no hay uno: el llamador conserva el producto de la
 * línea origen. */
async function productoIdPorNombre(env: Env, nombre: string): Promise<number | undefined> {
  const row = await env.DB
    .prepare('SELECT item_id FROM items WHERE board_id = ? AND lower(trim(name)) = lower(?) LIMIT 1')
    .bind(BOARDS.productos.id, nombre.trim())
    .first<{ item_id: number }>();
  return row?.item_id;
}

/** SKU y Producto en texto que se DERIVAN de un write que toca la relación de
 * producto de una línea (`board_relation_mkzmafgp`). Lo usan todos los caminos
 * que eligen producto —la grid (PATCH genérico), "Ajustar línea", restaurar
 * una versión y el alta de líneas— porque la automatización de Monday que llena
 * esos textos a partir de la relación NO corre cuando escribe el portal (en
 * vivo, 2026-09-10: 9 de 228 cambios de relación del portal la dispararon) y
 * cmp-tallas imprime el SKU del archivo de tallas de `text_mm0bxy39`. Sin
 * relación en el write → {}. Relación vaciada (producto de texto libre) → el
 * SKU del producto anterior se limpia. Producto que el espejo no conoce → {}
 * (no se inventa nada). */
export async function textosDerivadosDeProducto(env: Env, cols: Record<string, unknown>): Promise<Record<string, string>> {
  if (!(SUB_PRODUCTO_REL in cols)) return {};
  const raw = cols[SUB_PRODUCTO_REL];
  const productoId = productoIdDeWrite(raw);
  if (productoId == null) {
    return String(raw ?? '').trim() === '' ? { [SUB_SKU_TXT]: '' } : {};
  }
  const producto = await getItemTrusted(env, 'productos', productoId);
  if (!producto) return {};
  const t = textosDeProducto(producto);
  return { [SUB_PRODUCTO_TXT]: t.nombre, [SUB_SKU_TXT]: t.sku };
}

/** Cantidad tal como llega de un PATCH de la grid: sin comas de miles y un
 * número ≥ 0; null si no es válida (vacío, texto, negativo). Puro. */
export function normalizarCantidad(raw: unknown): string | null {
  const limpio = String(raw ?? '').replace(/,/g, '').trim();
  if (limpio === '') return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 ? limpio : null;
}

interface LineaHermanaParams {
  cantidad: number;
  color: string;
  embLabel: string;
  embDesc: string;
  productoId?: number;
  productoNombre?: string;
}

/** Crea la línea hermana de un 'dividir' (y la vuelve a crear en 'restaurar'):
 * copia la línea origen entera (copyRemainingCols + relación/textos de producto
 * + imagen de embellecimiento) y encima pone lo que cambió. Con producto del
 * catálogo —el nuevo o el mismo de la origen— SKU y Producto en texto salen
 * SIEMPRE del catálogo: antes se copiaban de la origen (la línea de dama nacía
 * con el SKU de caballero, OPP-0970) o, dividiendo solo por color, el Producto
 * en texto quedaba vacío. No toca la cantidad de la origen: eso es del
 * llamador. */
async function crearLineaHermana(
  env: Env, itemId: number, cols: Map<string, RawCol>, p: LineaHermanaParams,
): Promise<{ nuevaLineaId: number; nombre: string; productoId?: number }> {
  const subCols: Record<string, unknown> = {
    ...copyRemainingCols(cols),
    [SUB_CANTIDAD]: String(p.cantidad),
    [SUB_COLOR]: p.color,
    [SUB_EMB_STATUS]: { label: p.embLabel },
  };
  if (p.embDesc && p.embLabel === EMB_LABEL_CON) subCols[SUB_EMB_DESC] = p.embDesc;

  const productoId = p.productoId ?? linkedProductoId(cols.get(SUB_PRODUCTO_REL));
  let nombre = p.productoNombre?.trim() || productoNombre(cols) || 'Producto';
  const producto = productoId != null ? await getItemTrusted(env, 'productos', productoId) : null;
  if (p.productoId != null && !producto) {
    throw new AjusteLineaError(404, 'Ese producto no está en el catálogo del portal; recarga e intenta de nuevo.');
  }
  if (productoId != null) subCols[SUB_PRODUCTO_REL] = { item_ids: [productoId] };
  if (producto) {
    const t = textosDeProducto(producto);
    subCols[SUB_PRODUCTO_TXT] = t.nombre;
    if (t.sku) subCols[SUB_SKU_TXT] = t.sku;
    if (p.productoId != null && !p.productoNombre?.trim()) nombre = t.nombre;
  } else {
    // Sin catálogo (texto libre, o un producto que el espejo ya no tiene): se
    // copian los textos de la origen tal cual.
    const txt = cols.get(SUB_PRODUCTO_TXT)?.text?.trim();
    if (txt) subCols[SUB_PRODUCTO_TXT] = txt;
    const sku = cols.get(SUB_SKU_TXT)?.text?.trim();
    if (sku) subCols[SUB_SKU_TXT] = sku;
  }

  const nuevaLinea = await createSubitem(env, itemId, nombre, subCols);
  const nuevaLineaId = Number(nuevaLinea.id);
  // Best-effort: la línea YA existe en Monday y las rutas releen el árbol
  // completo enseguida (refetchItemTree). Un fallo del espejo o de la imagen
  // no debe convertir un 'dividir' en una operación a medias.
  try { await upsertItem(env, 'oportunidades_sub', nuevaLinea); } catch { /* lo trae el refetch */ }
  // La imagen de embellecimiento solo tiene sentido si la línea nueva lleva embellecimiento.
  if (p.embLabel === EMB_LABEL_CON) {
    try { await copyEmbellecimientoImage(env, cols, nuevaLineaId); } catch { /* imagen opcional */ }
  }
  return { nuevaLineaId, nombre, productoId: productoId ?? undefined };
}

const EMB_LABEL_CON = 'Con Embellecimiento';
const EMB_LABEL_SIN = 'Sin Embellecimiento';

const AJUSTE_ROLES = ['vendedor', 'compras', 'admin'];

let tableReady = false;

export async function ensureAjustesTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cotizacion_ajustes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id          INTEGER NOT NULL,
      version          INTEGER NOT NULL,
      subversion       INTEGER NOT NULL,
      linea_id         INTEGER NOT NULL,
      linea_origen_id  INTEGER,
      resumen          TEXT NOT NULL,
      campos_antes     TEXT NOT NULL,
      campos_despues   TEXT NOT NULL,
      viewer_email     TEXT NOT NULL,
      created_at       TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_cotajustes_item_version ON cotizacion_ajustes(item_id, version)'),
  ]);
  tableReady = true;
}

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

function linkedProductoId(col?: RawCol): number | undefined {
  if (!col?.value) return undefined;
  try {
    const ids = ((JSON.parse(col.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? []).map(Number).filter(Number.isFinite);
    return ids[0];
  } catch {
    return undefined;
  }
}

interface LineaSnapshot {
  producto: string;
  color: string;
  cantidad: number;
  embellecimiento: string;
  descripcionEmbellecimiento: string;
  /** Item del catálogo, si lo hay. 'restaurar' lo usa en vez de buscar el
   * producto por nombre (un producto renombrado ya no se encontraba). Ajustes
   * anteriores a 2026-09-10 no lo traen. */
  productoItemId?: number;
}

function snapshot(cols: Map<string, RawCol>): LineaSnapshot {
  return {
    producto: productoNombre(cols),
    color: (cols.get(SUB_COLOR)?.text ?? '').trim(),
    cantidad: Number((cols.get(SUB_CANTIDAD)?.text ?? '').replace(/,/g, '')) || 0,
    embellecimiento: (cols.get(SUB_EMB_STATUS)?.text ?? '').trim(),
    descripcionEmbellecimiento: cols.get(SUB_EMB_DESC)?.text || '',
    productoItemId: linkedProductoId(cols.get(SUB_PRODUCTO_REL)),
  };
}

async function nextSubversion(env: Env, itemId: number, version: number): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COALESCE(MAX(subversion), 0) as m FROM cotizacion_ajustes WHERE item_id = ? AND version = ?')
    .bind(itemId, version)
    .first<{ m: number }>();
  return (row?.m ?? 0) + 1;
}

// La versión mayor "vigente" es siempre archivadas.length + 1 (mismo cómputo
// que listVersions en quoteVersions.ts): mientras no exista ninguna "Nueva
// versión" archivada, la vigente es la 1.
export async function currentMajorVersion(env: Env, itemId: number): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COALESCE(MAX(version), 0) as m FROM cotizacion_versions WHERE item_id = ?')
    .bind(itemId)
    .first<{ m: number }>();
  return (row?.m ?? 0) + 1;
}

function resumenDe(antes: LineaSnapshot, despues: LineaSnapshot, dividida: boolean): string {
  const cambios: string[] = [];
  if (despues.producto && antes.producto !== despues.producto) cambios.push(`Producto cambiado a ${despues.producto}`);
  if (antes.color !== despues.color) cambios.push(`Color: ${despues.color || '—'}`);
  if (antes.embellecimiento !== despues.embellecimiento) cambios.push(`Embellecimiento: ${despues.embellecimiento || '—'}`);
  if (!dividida && antes.cantidad !== despues.cantidad) cambios.push(`Cantidad: ${antes.cantidad} → ${despues.cantidad}`);
  const base = cambios.length > 0 ? cambios.join(' · ') : 'Línea ajustada';
  return dividida ? `Línea dividida (${despues.cantidad} uds) — ${base}` : base;
}

async function registrarAjuste(
  env: Env, itemId: number, lineaId: number, lineaOrigenId: number | undefined,
  antes: LineaSnapshot, despues: LineaSnapshot, viewer: Identity,
): Promise<void> {
  await ensureAjustesTable(env);
  const version = await currentMajorVersion(env, itemId);
  const subversion = await nextSubversion(env, itemId, version);
  await env.DB.prepare(
    `INSERT INTO cotizacion_ajustes (item_id, version, subversion, linea_id, linea_origen_id, resumen, campos_antes, campos_despues, viewer_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    itemId, version, subversion, lineaId, lineaOrigenId ?? null,
    resumenDe(antes, despues, lineaOrigenId !== undefined),
    JSON.stringify(antes), JSON.stringify(despues), viewer.email, new Date().toISOString(),
  ).run();
}

/** Color y Cantidad — lo ÚNICO de la línea que Compras cambia inline desde la
 * grid de Cotización (shared/visibility.ts los abrió a `w: V` el 2026-08-19).
 * Un cambio así NO reinicia el ciclo de costeo: se registra como mini versión
 * V{mayor}.{n}, igual que "Ajustar línea" (Efraín, 2026-08-19: "acuérdate de
 * hacer mini versiones 1.1"). */
export const AJUSTE_INLINE_COLS: ReadonlySet<string> = new Set([SUB_COLOR, SUB_CANTIDAD]);

/** El resto de LINE_DEFINING_COLS (worker/lib/quoteVersions.ts): cambiar
 * producto o embellecimiento sí cambia QUÉ se cotiza y sigue disparando el
 * versionado completo. Se enumera aquí en vez de importar LINE_DEFINING_COLS
 * para no cerrar el ciclo de imports (quoteVersions ya importa listAjustes de
 * este archivo); lineaAjustes.test.ts ancla que las dos mitades sumen
 * exactamente ese conjunto, así que un cambio allá truena aquí. */
const AJUSTE_INLINE_VERSIONABLES: ReadonlySet<string> = new Set([
  SUB_PRODUCTO_REL, SUB_PRODUCTO_TXT, SUB_EMB_STATUS, SUB_EMB_DESC,
]);

/** Roles que cambian color/cantidad sin reiniciar el costeo: Compras y ADMIN
 * (Efraín, 2026-08-19: "te faltó que yo como admin también puedo hacerlo… o sea
 * los admins pueden hacer todo esto igual"). El vendedor no: su cambio sigue
 * archivando versión completa y regresando esa línea a costeo, que es lo que el
 * traspaso Ventas→Compras necesita. */
const AJUSTE_INLINE_ROLES = ['compras', 'admin'];

/** ¿Este PATCH a una línea es un ajuste (mini versión) en vez de un versionado
 * completo? Solo si lo manda Compras o admin, toca color o cantidad y no
 * arrastra ninguna otra columna definitoria — un PATCH que además cambie el
 * producto sí versiona, como cualquier otro. Puro, para test unitario. */
export function esAjusteInline(role: string, colIds: string[]): boolean {
  if (!AJUSTE_INLINE_ROLES.includes(role)) return false;
  if (colIds.some(id => AJUSTE_INLINE_VERSIONABLES.has(id))) return false;
  return colIds.some(id => AJUSTE_INLINE_COLS.has(id));
}

/** Asienta el ajuste de un cambio inline de color/cantidad hecho por Compras.
 * Se llama DESPUÉS de que el write salió bien (worker/routes/boards.ts): un
 * PATCH que muere en 403 no debe dejar una mini versión fantasma. `linea` es
 * el renglón del espejo ANTES del write — de ahí sale el "antes". */
export async function registrarAjusteInline(
  env: Env, itemId: number, linea: MirrorItem, cols: Record<string, unknown>, viewer: Identity,
): Promise<void> {
  const antes = snapshot(colsOf(linea));
  const despues: LineaSnapshot = { ...antes };
  if (cols[SUB_COLOR] !== undefined) despues.color = String(cols[SUB_COLOR] ?? '').trim();
  if (cols[SUB_CANTIDAD] !== undefined) {
    despues.cantidad = Number(String(cols[SUB_CANTIDAD] ?? '').replace(/,/g, '')) || 0;
  }
  // Reescribir el mismo valor (blur sin cambio) no merece una subversión.
  if (antes.color === despues.color && antes.cantidad === despues.cantidad) return;
  await registrarAjuste(env, itemId, linea.item_id, undefined, antes, despues, viewer);
}

export interface AjustarLineaResult { itemId: number; lineaId: number; nuevaLineaId?: number; costoDivergente?: CostoDivergenciaDTO }

/** "Ajustar línea": ver comentario de archivo. `productoNombre` en el input es
 * solo para el resumen legible del historial — el mirror real (lookup) lo
 * puebla Monday de forma asíncrona, igual que el resto de la grid. */
export async function ajustarLinea(
  env: Env, ctx: ExecutionContext, lineaId: number, viewer: Identity, input: AjustarLineaRequest,
): Promise<AjustarLineaResult> {
  if (!AJUSTE_ROLES.includes(viewer.role)) throw new AjusteLineaError(403, 'forbidden');

  // scope 'own': el scope de oportunidades_sub ya valida contra el dueño de la
  // Oportunidad padre (worker/lib/zonas.ts) — mismo criterio que
  // embellecimientoImagenes.ts. Sin guard de deal_stage a propósito: es la
  // excepción explícita para que esto funcione incluso Ganada.
  const linea = await getItem(env, 'oportunidades_sub', lineaId, viewer, 'own');
  if (!linea || linea.parent_item_id == null) throw new AjusteLineaError(404, 'not found');
  return applyAjusteLinea(env, ctx, linea.parent_item_id, lineaId, linea, viewer, input);
}

/** El cuerpo real de "Ajustar línea" (editar/dividir), separado de
 * `ajustarLinea` para que otros llamadores que YA autorizaron al viewer por
 * otra vía (worker/lib/proyectoCotizacionVirtual.ts: el dueño del Proyecto,
 * no necesariamente de la Oportunidad) puedan reusar la escritura real a
 * Monday sin repetir el chequeo de scope de `oportunidades_sub`, que
 * resolvería contra la columna Compras/Vendedor de la OPORTUNIDAD y podría
 * rechazar a alguien que sí es dueño del Proyecto (Efraín, 2026-08-13). */
export async function applyAjusteLinea(
  env: Env, ctx: ExecutionContext, itemId: number, lineaId: number, linea: MirrorItem, viewer: Identity, input: AjustarLineaRequest,
): Promise<AjustarLineaResult> {
  // Se trabaja sobre la lectura FRESCA de Monday, no sobre el espejo: la resta
  // de la origen escribe un valor absoluto (cantidad − lo que se mueve) y
  // 'editar' compara contra lo que la línea tiene; con el espejo atrasado (una
  // edición directa en Monday, un import de tallas que aún no llega) se pisaba
  // ese cambio (revisión 2026-09-10). Líneas nativas (Zona Efrain): D1 es la
  // fuente de verdad.
  let cols = colsOf(linea);
  let nombreLinea = linea.name;
  if (!isNativeId(lineaId)) {
    const fresca = await fetchItem(env, lineaId);
    if (!fresca || Number(fresca.parent_item?.id) !== itemId) {
      throw new AjusteLineaError(404, 'Esa línea ya no existe en Monday. Recarga la cotización.');
    }
    cols = new Map(toRawColumns(fresca).map(c => [c.id, c as unknown as RawCol]));
    nombreLinea = fresca.name;
  }
  const antes = snapshot(cols);

  const cantidadInput = input.cantidad != null && Number.isFinite(input.cantidad) ? input.cantidad : undefined;
  if (cantidadInput != null && cantidadInput <= 0) throw new AjusteLineaError(400, 'La cantidad debe ser mayor a cero.');

  if (input.modo === 'dividir') {
    if (isNativeId(itemId)) {
      throw new AjusteLineaError(400, 'Dividir no está disponible en oportunidades de Zona Efrain: cambia la cantidad y agrega la línea nueva a mano.');
    }
    if (cantidadInput == null || cantidadInput >= antes.cantidad) {
      throw new AjusteLineaError(400, 'Para dividir, la cantidad debe ser menor a la cantidad actual de la línea.');
    }
    const embLabel = input.embellecimiento?.estado === undefined
      ? (antes.embellecimiento || EMB_LABEL_SIN)
      : (input.embellecimiento.estado === 'con' ? EMB_LABEL_CON : EMB_LABEL_SIN);
    const embDesc = embLabel === EMB_LABEL_CON ? (input.embellecimiento?.descripcion ?? antes.descripcionEmbellecimiento) : '';
    const color = (input.color ?? antes.color).trim();

    // Dividir es atómico SIN borrar nada (Ajustar línea nunca quita líneas:
    // worker/lib/monday.destructivo.test.ts). Antes se creaba la línea nueva y
    // la resta de la origen iba por el outbox en segundo plano: si fallaba, la
    // cotización quedaba con la cantidad duplicada, un "internal error" y, al
    // reintentar, otra línea más (revisión 2026-09-10). Ahora:
    // 1) Restar de la origen DIRECTO a Monday, esperando la respuesta. Si Monday
    //    lo rechaza, todavía no se tocó nada.
    const restante = antes.cantidad - cantidadInput;
    const escribirOrigen = async (cantidad: number) => {
      const origen = await updateItemColumns(env, BOARDS.oportunidades_sub.id, lineaId, { [SUB_CANTIDAD]: String(cantidad) });
      if (origen) {
        try { await upsertItem(env, 'oportunidades_sub', origen); } catch { /* lo trae el refetch */ }
      }
    };
    try {
      await escribirOrigen(restante);
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      throw new AjusteLineaError(502, `Monday no dejó restar la cantidad de la línea origen, así que no se dividió nada. (${detalle})`);
    }

    // 2) La línea nueva. Si Monday no la crea, la origen regresa a su cantidad.
    let nueva: Awaited<ReturnType<typeof crearLineaHermana>>;
    try {
      nueva = await crearLineaHermana(env, itemId, cols, {
        cantidad: cantidadInput, color, embLabel, embDesc,
        productoId: input.productoId ?? undefined,
        productoNombre: input.productoId != null ? input.productoNombre : undefined,
      });
    } catch (err) {
      let regresada = true;
      try { await escribirOrigen(antes.cantidad); } catch { regresada = false; }
      if (err instanceof AjusteLineaError && regresada) throw err;
      const detalle = err instanceof Error ? err.message : String(err);
      throw new AjusteLineaError(502, regresada
        ? `Monday no creó la línea nueva; la línea origen se quedó con sus ${antes.cantidad} uds. (${detalle})`
        : `Monday no creó la línea nueva y no se pudo regresar la cantidad de la origen (quedó en ${restante}): corrígela a ${antes.cantidad}. (${detalle})`);
    }

    const despues: LineaSnapshot = {
      producto: nueva.nombre, color, cantidad: cantidadInput, embellecimiento: embLabel,
      descripcionEmbellecimiento: embDesc, productoItemId: nueva.productoId,
    };
    await registrarAjuste(env, itemId, nueva.nuevaLineaId, lineaId, antes, despues, viewer);

    const costoDivergente = input.productoId != null
      ? await checkCostoDivergente(env, itemId, viewer, linkedProductoId(cols.get(SUB_PRODUCTO_REL)), input.productoId, antes.producto)
      : undefined;
    return { itemId, lineaId, nuevaLineaId: nueva.nuevaLineaId, costoDivergente };
  }

  // modo 'editar': PATCH en el sitio, y SOLO lo que de verdad cambia respecto a
  // lo que Monday tiene hoy: un modal abierto desde antes ya no regresa sin
  // aviso un valor que alguien más cambió, y guardar sin cambios no deja una
  // subversión "Línea ajustada" vacía.
  const writeCols: Record<string, string> = {};
  if (cantidadInput != null && cantidadInput !== antes.cantidad) writeCols[SUB_CANTIDAD] = String(cantidadInput);
  const colorNuevo = input.color != null ? input.color.trim() : antes.color;
  if (colorNuevo !== antes.color) writeCols[SUB_COLOR] = colorNuevo;
  const embNuevo = input.embellecimiento?.estado !== undefined
    ? (input.embellecimiento.estado === 'con' ? EMB_LABEL_CON : EMB_LABEL_SIN)
    : antes.embellecimiento;
  if (embNuevo !== antes.embellecimiento) writeCols[SUB_EMB_STATUS] = embNuevo;
  const descNueva = input.embellecimiento?.descripcion;
  if (embNuevo === EMB_LABEL_CON && descNueva !== undefined && descNueva !== antes.descripcionEmbellecimiento) {
    writeCols[SUB_EMB_DESC] = descNueva;
  }
  const productoAnteriorId = linkedProductoId(cols.get(SUB_PRODUCTO_REL));
  let productoNuevo: { id: number; nombre: string } | undefined;
  if (input.productoId != null && input.productoId !== productoAnteriorId) {
    const producto = await getItemTrusted(env, 'productos', input.productoId);
    if (!producto) throw new AjusteLineaError(404, 'Ese producto no está en el catálogo del portal; recarga e intenta de nuevo.');
    const t = textosDeProducto(producto);
    // SKU y Producto en texto del catálogo (cmp-tallas los lee de ahí). Si el
    // catálogo no trae SKU, el del producto anterior se limpia en vez de
    // quedarse: un SKU de caballero en un producto de dama es justo OPP-0970.
    writeCols[SUB_PRODUCTO_REL] = String(input.productoId);
    writeCols[SUB_PRODUCTO_TXT] = t.nombre;
    writeCols[SUB_SKU_TXT] = t.sku;
    // Una línea que se llama como su producto (las que nacen de 'dividir') se
    // renombra al nuevo; un nombre propio ("PARTIDA 2.1") se respeta.
    const nombre = nombreLinea.trim();
    const textoAnterior = (cols.get(SUB_PRODUCTO_TXT)?.text ?? '').trim();
    if (nombre && (nombre === textoAnterior || nombre === antes.producto)) writeCols.name = t.nombre;
    productoNuevo = { id: input.productoId, nombre: t.nombre };
  }

  if (Object.keys(writeCols).length === 0) {
    throw new AjusteLineaError(400, 'No hay cambios que guardar: la línea ya tiene esos datos.');
  }

  // `scopeChecked`: el llamador ya autorizó al viewer (dueño de la Oportunidad
  // en ajustarLinea, dueño del PROYECTO en ajustarLineaVirtual). Sin esto el
  // outbox volvía a exigir ser dueño de la Oportunidad y rechazaba al del Proyecto.
  await submitWrite(env, ctx, 'oportunidades_sub', lineaId, writeCols, viewer, { trusted: true, skipFlush: true, scopeChecked: true });
  await flushOutbox(env);

  const despues: LineaSnapshot = {
    producto: productoNuevo?.nombre ?? antes.producto,
    color: colorNuevo,
    cantidad: SUB_CANTIDAD in writeCols ? Number(writeCols[SUB_CANTIDAD]) : antes.cantidad,
    embellecimiento: embNuevo,
    descripcionEmbellecimiento: writeCols[SUB_EMB_DESC] ?? antes.descripcionEmbellecimiento,
    productoItemId: productoNuevo?.id ?? antes.productoItemId,
  };
  await registrarAjuste(env, itemId, lineaId, undefined, antes, despues, viewer);

  const costoDivergente = productoNuevo
    ? await checkCostoDivergente(env, itemId, viewer, productoAnteriorId, productoNuevo.id, antes.producto)
    : undefined;
  return { itemId, lineaId, costoDivergente };
}

/** Ajustes (subversiones V{version}.{n}) de la versión mayor indicada — usado
 * por quoteVersions.ts's listVersions para adjuntarlos a la vigente. */
export async function listAjustes(env: Env, itemId: number, version: number): Promise<AjusteDTO[]> {
  await ensureAjustesTable(env);
  const { results } = await env.DB.prepare(
    'SELECT subversion, resumen, viewer_email, created_at, linea_id, linea_origen_id FROM cotizacion_ajustes WHERE item_id = ? AND version = ? ORDER BY subversion',
  ).bind(itemId, version).all<{ subversion: number; resumen: string; viewer_email: string; created_at: string; linea_id: number; linea_origen_id: number | null }>();
  return (results ?? []).map(r => ({
    subversion: r.subversion, resumen: r.resumen, viewerEmail: r.viewer_email, createdAt: r.created_at,
    lineaId: r.linea_id, lineaOrigenId: r.linea_origen_id ?? undefined,
  }));
}

/** Qué divisiones hay que AVISAR: la línea nueva de un 'dividir' ya no está
 * entre las vivas (la cotización se quedó con la origen recortada y sin la
 * parte nueva, lo que le pasó a OPP-0970 sin que nadie lo viera) Y además:
 *  - no se borró desde el portal (`borradasEnPortal` = renglones de
 *    item_borrado): ese borrado es intencional y queda respaldado; antes el
 *    aviso perseguía a quien borraba a propósito;
 *  - la línea origen sigue viva: si no, no hay nada que restaurar (el botón
 *    fallaba siempre);
 *  - nadie marcó "Ya no aplica" (`descartadas`, por subversión);
 *  - una sola marca por línea nueva (restaurar deja dos ajustes apuntando a
 *    la misma, y se veían dos botones que duplicaban la línea).
 * Puro, para test. */
export function marcarDivisionesBorradas(
  lines: { subitemId?: number }[], ajustes: AjusteDTO[],
  borradasEnPortal: ReadonlySet<number> = new Set(), descartadas: ReadonlySet<number> = new Set(),
): AjusteDTO[] {
  const vivas = new Set(lines.map(l => l.subitemId).filter((id): id is number => id != null));
  const yaMarcadas = new Set<number>();
  return ajustes.map(a => {
    if (a.lineaOrigenId == null || vivas.has(a.lineaId) || !vivas.has(a.lineaOrigenId)) return a;
    if (borradasEnPortal.has(a.lineaId) || descartadas.has(a.subversion) || yaMarcadas.has(a.lineaId)) return a;
    yaMarcadas.add(a.lineaId);
    return { ...a, lineaBorrada: true };
  });
}

let descartadasReady = false;

/** Divisiones cuyo aviso alguien descartó con "Ya no aplica" (el borrado en
 * Monday de su línea nueva fue a propósito). Lazy; documentada en
 * worker/schema.sql. */
export async function ensureDescartadasTable(env: Env): Promise<void> {
  if (descartadasReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ajuste_descartado (
    item_id    INTEGER NOT NULL,
    version    INTEGER NOT NULL,
    subversion INTEGER NOT NULL,
    by_email   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (item_id, version, subversion)
  )`).run();
  descartadasReady = true;
}

/** listAjustes + la marca de "línea hermana borrada en Monday" contra las
 * líneas vivas de la vigente. Lo usan listVersions (Oportunidad) y
 * getVirtualLines (Proyecto) — las dos superficies donde la cotización se ve. */
export async function listAjustesConEstado(
  env: Env, itemId: number, version: number, lines: { subitemId?: number }[],
): Promise<AjusteDTO[]> {
  const ajustes = await listAjustes(env, itemId, version);
  const vivas = new Set(lines.map(l => l.subitemId));
  const candidatas = [...new Set(ajustes.filter(a => a.lineaOrigenId != null && !vivas.has(a.lineaId)).map(a => a.lineaId))];
  if (candidatas.length === 0) return ajustes;
  await ensureItemBorradoTable(env);
  await ensureDescartadasTable(env);
  const enPortal = new Set<number>();
  for (let i = 0; i < candidatas.length; i += 90) {
    const lote = candidatas.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT item_id FROM item_borrado WHERE board_id = ? AND item_id IN (${lote.map(() => '?').join(',')})`,
    ).bind(BOARDS.oportunidades_sub.id, ...lote).all<{ item_id: number }>();
    for (const r of results ?? []) enPortal.add(Number(r.item_id));
  }
  const { results: desc } = await env.DB
    .prepare('SELECT subversion FROM ajuste_descartado WHERE item_id = ? AND version = ?')
    .bind(itemId, version)
    .all<{ subversion: number }>();
  return marcarDivisionesBorradas(lines, ajustes, enPortal, new Set((desc ?? []).map(d => Number(d.subversion))));
}

/** "Ya no aplica" (2026-09-10): quien ve el aviso de una división cuya línea
 * nueva se borró en Monday confirma que ese borrado fue a propósito; el aviso
 * no vuelve a salir para esa subversión. Autoriza contra la Oportunidad; el
 * Proyecto tiene su camino en proyectoCotizacionVirtual.ts y reusa
 * `applyDescartarAviso`. */
export async function descartarAvisoDivision(
  env: Env, itemId: number, subversion: number, viewer: Identity,
): Promise<void> {
  if (!AJUSTE_ROLES.includes(viewer.role)) throw new AjusteLineaError(403, 'forbidden');
  const opp = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!opp) throw new AjusteLineaError(404, 'not found');
  await applyDescartarAviso(env, itemId, subversion, viewer);
}

export async function applyDescartarAviso(
  env: Env, itemId: number, subversion: number, viewer: Identity,
): Promise<void> {
  await ensureAjustesTable(env);
  await ensureDescartadasTable(env);
  const version = await currentMajorVersion(env, itemId);
  const ajuste = await env.DB
    .prepare('SELECT linea_origen_id FROM cotizacion_ajustes WHERE item_id = ? AND version = ? AND subversion = ?')
    .bind(itemId, version, subversion)
    .first<{ linea_origen_id: number | null }>();
  if (!ajuste || ajuste.linea_origen_id == null) throw new AjusteLineaError(404, 'Ese ajuste no es una división.');
  await env.DB.prepare(
    `INSERT INTO ajuste_descartado (item_id, version, subversion, by_email, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_id, version, subversion) DO NOTHING`,
  ).bind(itemId, version, subversion, viewer.email, new Date().toISOString()).run();
}

export interface RestaurarLineaResult { itemId: number; lineaId: number; nuevaLineaId: number }

interface AjusteRow {
  id: number; version: number; subversion: number; linea_id: number; linea_origen_id: number | null;
  resumen: string; campos_despues: string;
}

/** "Restaurar línea" (OPP-0970, 2026-09-10): la línea hermana de un 'dividir'
 * ya no existe — alguien la borró directo en Monday (el portal nunca la
 * esconde: worker/lib/itemBorrado.ts) — y la cotización se quedó con la
 * origen recortada y sin la parte nueva. La vuelve a crear con lo registrado
 * en el ajuste (producto/color/cantidad/embellecimiento) sobre la línea origen
 * ACTUAL (precio, costeo, Etapa Costeo, imagen…), SIN volver a restar la
 * cantidad de la origen (eso ya pasó al dividir). El ajuste original pasa a
 * apuntar a la línea nueva y se asienta un renglón más ("Línea restaurada").
 * Autoriza contra la Oportunidad (dueño); el Proyecto tiene su propio camino
 * en proyectoCotizacionVirtual.ts y reusa `applyRestaurarLinea`. */
export async function restaurarLineaDividida(
  env: Env, itemId: number, subversion: number, viewer: Identity,
): Promise<RestaurarLineaResult> {
  if (!AJUSTE_ROLES.includes(viewer.role)) throw new AjusteLineaError(403, 'forbidden');
  const opp = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!opp) throw new AjusteLineaError(404, 'not found');
  return applyRestaurarLinea(env, itemId, subversion, viewer);
}

export async function applyRestaurarLinea(
  env: Env, itemId: number, subversion: number, viewer: Identity,
): Promise<RestaurarLineaResult> {
  await ensureAjustesTable(env);
  const version = await currentMajorVersion(env, itemId);
  const ajuste = await env.DB.prepare(
    'SELECT id, version, subversion, linea_id, linea_origen_id, resumen, campos_despues FROM cotizacion_ajustes WHERE item_id = ? AND version = ? AND subversion = ?',
  ).bind(itemId, version, subversion).first<AjusteRow>();
  if (!ajuste || ajuste.linea_origen_id == null) throw new AjusteLineaError(404, 'Ese ajuste no es una división.');

  const viva = await getItemTrusted(env, 'oportunidades_sub', ajuste.linea_id);
  if (viva && viva.parent_item_id === itemId) {
    throw new AjusteLineaError(409, 'La línea de esa división sigue existiendo; no hay nada que restaurar.');
  }
  const origen = await getItemTrusted(env, 'oportunidades_sub', ajuste.linea_origen_id);
  if (!origen || origen.parent_item_id !== itemId) {
    throw new AjusteLineaError(404, 'La línea origen de la división ya no existe; agrega la línea a mano.');
  }

  let despues: Partial<LineaSnapshot> = {};
  try {
    despues = JSON.parse(ajuste.campos_despues) as Partial<LineaSnapshot>;
  } catch {
    // sin datos registrados: cae a la validación de cantidad
  }
  const cantidad = Number(despues.cantidad) || 0;
  if (cantidad <= 0) throw new AjusteLineaError(400, 'El ajuste no registró la cantidad de la línea dividida.');

  // La origen, leída de Monday si se puede: precio y costeo al día.
  let cols = colsOf(origen);
  const fresca = await fetchItem(env, ajuste.linea_origen_id).catch(() => null);
  if (fresca) cols = new Map(toRawColumns(fresca).map(c => [c.id, c as unknown as RawCol]));
  const antes = snapshot(cols);
  const producto = (despues.producto ?? '').trim();
  // El producto que se registró: por id si el ajuste lo trae (desde
  // 2026-09-10); si no, por nombre exacto del catálogo; si tampoco está en el
  // catálogo, la línea nueva conserva el producto de la origen.
  let productoId = despues.productoItemId ?? (producto ? await productoIdPorNombre(env, producto) : undefined);
  if (productoId != null && !(await getItemTrusted(env, 'productos', productoId))) productoId = undefined;
  const color = despues.color ?? antes.color;
  const embLabel = despues.embellecimiento || antes.embellecimiento || EMB_LABEL_SIN;
  const embDesc = despues.descripcionEmbellecimiento ?? antes.descripcionEmbellecimiento;
  const nueva = await crearLineaHermana(env, itemId, cols, {
    cantidad, color, embLabel, embDesc, productoId,
    productoNombre: productoId != null ? (producto || undefined) : undefined,
  });

  // El ajuste original apunta ahora a la línea que sí existe (el label
  // "Dividida" y el aviso quedan coherentes). El renglón "Línea restaurada"
  // queda en el historial SIN línea origen: si llevara la misma, dos renglones
  // apuntarían a la misma línea y un segundo borrado mostraría dos
  // "Restaurar" (restaurar dos veces la duplicaba).
  const restaurada: LineaSnapshot = {
    producto: nueva.nombre, color, cantidad, embellecimiento: embLabel,
    descripcionEmbellecimiento: embDesc, productoItemId: nueva.productoId,
  };
  await env.DB.prepare('UPDATE cotizacion_ajustes SET linea_id = ? WHERE id = ?').bind(nueva.nuevaLineaId, ajuste.id).run();
  const nextSub = await nextSubversion(env, itemId, version);
  await env.DB.prepare(
    `INSERT INTO cotizacion_ajustes (item_id, version, subversion, linea_id, linea_origen_id, resumen, campos_antes, campos_despues, viewer_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    itemId, version, nextSub, nueva.nuevaLineaId, null,
    `Línea restaurada (${cantidad} uds) — ${nueva.nombre}${color ? ` · Color: ${color}` : ''} (la de la .${subversion} la habían borrado en Monday)`,
    JSON.stringify(despues), JSON.stringify(restaurada), viewer.email, new Date().toISOString(),
  ).run();
  return { itemId, lineaId: ajuste.linea_origen_id, nuevaLineaId: nueva.nuevaLineaId };
}
