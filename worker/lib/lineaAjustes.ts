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
import { createSubitem, addFileToColumn, fetchAssetPublicUrls } from './monday';
import { upsertItem } from '../sync';
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
 * + imagen de embellecimiento) y encima pone lo que cambió. Si el producto
 * cambia, SKU y nombre vienen del CATÁLOGO — antes se copiaban de la origen y
 * la línea de dama nacía con el SKU de caballero (OPP-0970, 2026-08-26: el
 * archivo de tallas salió con 71049 para el polo de mujer 61165). No toca la
 * cantidad de la origen: eso es del llamador. */
async function crearLineaHermana(
  env: Env, itemId: number, cols: Map<string, RawCol>, p: LineaHermanaParams,
): Promise<{ nuevaLineaId: number; nombre: string }> {
  const subCols: Record<string, unknown> = {
    ...copyRemainingCols(cols),
    [SUB_CANTIDAD]: String(p.cantidad),
    [SUB_COLOR]: p.color,
    [SUB_EMB_STATUS]: { label: p.embLabel },
  };
  if (p.embDesc) subCols[SUB_EMB_DESC] = p.embDesc;

  let nombre = p.productoNombre?.trim() || productoNombre(cols) || 'Producto';
  if (p.productoId != null) {
    subCols[SUB_PRODUCTO_REL] = { item_ids: [p.productoId] };
    const producto = await getItemTrusted(env, 'productos', p.productoId);
    if (producto) {
      const t = textosDeProducto(producto);
      subCols[SUB_PRODUCTO_TXT] = t.nombre;
      if (t.sku) subCols[SUB_SKU_TXT] = t.sku;
      if (!p.productoNombre?.trim()) nombre = t.nombre;
    }
  } else {
    const relId = linkedProductoId(cols.get(SUB_PRODUCTO_REL));
    if (relId != null) subCols[SUB_PRODUCTO_REL] = { item_ids: [relId] };
    else if (cols.get(SUB_PRODUCTO_TXT)?.text) subCols[SUB_PRODUCTO_TXT] = cols.get(SUB_PRODUCTO_TXT)!.text;
    const sku = cols.get(SUB_SKU_TXT)?.text?.trim();
    if (sku) subCols[SUB_SKU_TXT] = sku;
  }

  const nuevaLinea = await createSubitem(env, itemId, nombre, subCols);
  await upsertItem(env, 'oportunidades_sub', nuevaLinea);
  await copyEmbellecimientoImage(env, cols, Number(nuevaLinea.id));
  return { nuevaLineaId: Number(nuevaLinea.id), nombre };
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
}

function snapshot(cols: Map<string, RawCol>): LineaSnapshot {
  return {
    producto: productoNombre(cols),
    color: (cols.get(SUB_COLOR)?.text ?? '').trim(),
    cantidad: Number((cols.get(SUB_CANTIDAD)?.text ?? '').replace(/,/g, '')) || 0,
    embellecimiento: (cols.get(SUB_EMB_STATUS)?.text ?? '').trim(),
    descripcionEmbellecimiento: cols.get(SUB_EMB_DESC)?.text || '',
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
  const cols = colsOf(linea);
  const antes = snapshot(cols);

  const cantidadInput = input.cantidad != null && Number.isFinite(input.cantidad) ? input.cantidad : undefined;
  if (cantidadInput != null && cantidadInput <= 0) throw new AjusteLineaError(400, 'La cantidad debe ser mayor a cero.');

  if (input.modo === 'dividir') {
    if (cantidadInput == null || cantidadInput >= antes.cantidad) {
      throw new AjusteLineaError(400, 'Para dividir, la cantidad debe ser menor a la cantidad actual de la línea.');
    }
    const embLabel = input.embellecimiento?.estado === undefined
      ? (antes.embellecimiento || EMB_LABEL_SIN)
      : (input.embellecimiento.estado === 'con' ? EMB_LABEL_CON : EMB_LABEL_SIN);
    const embDesc = input.embellecimiento?.descripcion ?? antes.descripcionEmbellecimiento;
    const color = input.color ?? antes.color;

    const { nuevaLineaId, nombre: nombreNueva } = await crearLineaHermana(env, itemId, cols, {
      cantidad: cantidadInput, color, embLabel, embDesc,
      productoId: input.productoId ?? undefined,
      productoNombre: input.productoId != null ? input.productoNombre : antes.producto,
    });

    // Resta de la línea origen la cantidad que se movió a la nueva — trusted:
    // esto es parte de la misma operación compuesta, no un PATCH suelto del
    // cliente.
    await submitWrite(env, ctx, 'oportunidades_sub', lineaId, { [SUB_CANTIDAD]: String(antes.cantidad - cantidadInput) }, viewer, { trusted: true, skipFlush: true });
    await flushOutbox(env);

    const despues: LineaSnapshot = { producto: nombreNueva, color, cantidad: cantidadInput, embellecimiento: embLabel, descripcionEmbellecimiento: embDesc };
    await registrarAjuste(env, itemId, nuevaLineaId, lineaId, antes, despues, viewer);

    const costoDivergente = input.productoId != null
      ? await checkCostoDivergente(env, itemId, viewer, linkedProductoId(cols.get(SUB_PRODUCTO_REL)), input.productoId, antes.producto)
      : undefined;
    return { itemId, lineaId, nuevaLineaId, costoDivergente };
  }

  // modo 'editar': PATCH en el sitio, misma línea.
  const writeCols: Record<string, string> = {};
  if (cantidadInput != null) writeCols[SUB_CANTIDAD] = String(cantidadInput);
  if (input.color != null) writeCols[SUB_COLOR] = input.color;
  if (input.embellecimiento?.estado !== undefined) {
    writeCols[SUB_EMB_STATUS] = input.embellecimiento.estado === 'con' ? EMB_LABEL_CON : EMB_LABEL_SIN;
  }
  if (input.embellecimiento?.descripcion !== undefined) writeCols[SUB_EMB_DESC] = input.embellecimiento.descripcion;
  if (input.productoId != null) {
    writeCols[SUB_PRODUCTO_REL] = String(input.productoId);
    // SKU y nombre del catálogo, no los que la línea traía del producto
    // anterior (mismo criterio que crearLineaHermana; cmp-tallas lee el SKU
    // texto, no la relación).
    const producto = await getItemTrusted(env, 'productos', input.productoId);
    if (producto) {
      const t = textosDeProducto(producto);
      writeCols[SUB_PRODUCTO_TXT] = t.nombre;
      if (t.sku) writeCols[SUB_SKU_TXT] = t.sku;
    }
  }

  if (Object.keys(writeCols).length === 0) throw new AjusteLineaError(400, 'Nada que ajustar.');

  await submitWrite(env, ctx, 'oportunidades_sub', lineaId, writeCols, viewer, { trusted: true, skipFlush: true });
  await flushOutbox(env);

  const despues: LineaSnapshot = {
    producto: input.productoId != null ? (input.productoNombre || antes.producto) : antes.producto,
    color: input.color ?? antes.color,
    cantidad: cantidadInput ?? antes.cantidad,
    embellecimiento: input.embellecimiento?.estado !== undefined
      ? (input.embellecimiento.estado === 'con' ? EMB_LABEL_CON : EMB_LABEL_SIN)
      : antes.embellecimiento,
    descripcionEmbellecimiento: input.embellecimiento?.descripcion ?? antes.descripcionEmbellecimiento,
  };
  await registrarAjuste(env, itemId, lineaId, undefined, antes, despues, viewer);

  const costoDivergente = input.productoId != null
    ? await checkCostoDivergente(env, itemId, viewer, linkedProductoId(cols.get(SUB_PRODUCTO_REL)), input.productoId, antes.producto)
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

/** Marca los 'dividir' cuya línea hermana ya no está entre las líneas vivas:
 * la cotización se quedó recortada (la origen ya perdió esa cantidad) y sin
 * la parte nueva — lo que le pasó a OPP-0970 sin que nadie lo viera hasta el
 * archivo de tallas. Puro para test; `borrados` es lo que item_borrado sabe
 * (borradas desde el portal, con quién y cuándo); sin renglón ahí, la línea
 * se borró directo en Monday. */
export function marcarDivisionesBorradas(
  lines: { subitemId?: number }[], ajustes: AjusteDTO[], borrados: Map<number, { email: string; at: string }> = new Map(),
): AjusteDTO[] {
  const vivas = new Set(lines.map(l => l.subitemId).filter((id): id is number => id != null));
  return ajustes.map(a => {
    if (a.lineaOrigenId == null || vivas.has(a.lineaId)) return a;
    const b = borrados.get(a.lineaId);
    return { ...a, lineaBorrada: true, ...(b ? { borradaPor: b.email, borradaEn: b.at } : {}) };
  });
}

/** listAjustes + la marca de "línea hermana borrada" contra las líneas vivas
 * de la vigente. Lo usan listVersions (Oportunidad) y getVirtualLines
 * (Proyecto) — las dos superficies donde la cotización se ve. */
export async function listAjustesConEstado(
  env: Env, itemId: number, version: number, lines: { subitemId?: number }[],
): Promise<AjusteDTO[]> {
  const ajustes = await listAjustes(env, itemId, version);
  const vivas = new Set(lines.map(l => l.subitemId));
  const candidatas = ajustes.filter(a => a.lineaOrigenId != null && !vivas.has(a.lineaId)).map(a => a.lineaId);
  if (candidatas.length === 0) return ajustes;
  await ensureItemBorradoTable(env);
  const placeholders = candidatas.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT item_id, by_email, deleted_at FROM item_borrado WHERE board_id = ? AND item_id IN (${placeholders})`,
  ).bind(BOARDS.oportunidades_sub.id, ...candidatas).all<{ item_id: number; by_email: string | null; deleted_at: string }>();
  const borrados = new Map((results ?? []).map(r => [r.item_id, { email: r.by_email ?? '', at: r.deleted_at }] as const));
  return marcarDivisionesBorradas(lines, ajustes, borrados);
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
 * apuntar a la línea nueva y se asienta un ajuste más ("Línea restaurada").
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

  const cols = colsOf(origen);
  const antes = snapshot(cols);
  const producto = (despues.producto ?? '').trim();
  // Solo si el nombre registrado es un item del catálogo se re-liga a él (y
  // SKU/nombre salen de ahí); si no (división por color, mismo producto), la
  // línea nueva conserva el producto de la origen.
  const productoId = producto ? await productoIdPorNombre(env, producto) : undefined;
  const color = despues.color ?? antes.color;
  const nueva = await crearLineaHermana(env, itemId, cols, {
    cantidad, color,
    embLabel: despues.embellecimiento || antes.embellecimiento || EMB_LABEL_SIN,
    embDesc: despues.descripcionEmbellecimiento ?? antes.descripcionEmbellecimiento,
    productoId,
    productoNombre: producto || undefined,
  });

  // El ajuste original apunta ahora a la línea que sí existe (así el label
  // "Dividida" y la marca de "línea borrada" quedan coherentes) y el restaurado
  // queda como su propio renglón del historial.
  const restaurada: LineaSnapshot = {
    producto: nueva.nombre, color, cantidad,
    embellecimiento: despues.embellecimiento || antes.embellecimiento,
    descripcionEmbellecimiento: despues.descripcionEmbellecimiento ?? antes.descripcionEmbellecimiento,
  };
  await env.DB.prepare('UPDATE cotizacion_ajustes SET linea_id = ? WHERE id = ?').bind(nueva.nuevaLineaId, ajuste.id).run();
  const nextSub = await nextSubversion(env, itemId, version);
  await env.DB.prepare(
    `INSERT INTO cotizacion_ajustes (item_id, version, subversion, linea_id, linea_origen_id, resumen, campos_antes, campos_despues, viewer_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    itemId, version, nextSub, nueva.nuevaLineaId, ajuste.linea_origen_id,
    `Línea restaurada (${cantidad} uds) — ${nueva.nombre}${color ? ` · Color: ${color}` : ''} (la de la .${subversion} la habían borrado en Monday)`,
    JSON.stringify(despues), JSON.stringify(restaurada), viewer.email, new Date().toISOString(),
  ).run();
  return { itemId, lineaId: ajuste.linea_origen_id, nuevaLineaId: nueva.nuevaLineaId };
}
