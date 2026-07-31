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
//     copia producto/color/embellecimiento/precio/Etapa Costeo de la línea
//     origen salvo lo que vino en el body, y resta esa cantidad de la origen.
//
// Cada ajuste queda registrado en cotizacion_ajustes como V{mayor}.{n} — no es
// una versión real (no pasa por costeo), solo trazabilidad de que la vigente
// tuvo retoques; quoteVersions.ts (listVersions) la adjunta a la vigente para
// mostrarla en VersionChips.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { AjusteDTO, AjustarLineaRequest } from '../../shared/dto';
import { getItem } from './dal';
import { submitWrite, flushOutbox } from './outbox';
import { createSubitem } from './monday';
import { upsertItem } from '../sync';
import type { RawCol } from './serialize';

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
const SUB_PRECIO = 'numeric_mkzneg3d';
const SUB_ETAPA_COSTEO = 'color_mm084gvf';

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
async function currentMajorVersion(env: Env, itemId: number): Promise<number> {
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

export interface AjustarLineaResult { itemId: number; lineaId: number; nuevaLineaId?: number }

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
  const itemId = linea.parent_item_id;

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

    const subCols: Record<string, unknown> = {
      [SUB_CANTIDAD]: String(cantidadInput),
      [SUB_COLOR]: color,
      [SUB_EMB_STATUS]: { label: embLabel },
    };
    if (embDesc) subCols[SUB_EMB_DESC] = embDesc;
    const precioText = cols.get(SUB_PRECIO)?.text;
    if (precioText) subCols[SUB_PRECIO] = precioText;
    const etapaCosteo = cols.get(SUB_ETAPA_COSTEO)?.text;
    if (etapaCosteo) subCols[SUB_ETAPA_COSTEO] = { label: etapaCosteo };

    if (input.productoId != null) {
      subCols[SUB_PRODUCTO_REL] = { item_ids: [input.productoId] };
    } else {
      const relId = linkedProductoId(cols.get(SUB_PRODUCTO_REL));
      if (relId != null) subCols[SUB_PRODUCTO_REL] = { item_ids: [relId] };
      else if (cols.get(SUB_PRODUCTO_TXT)?.text) subCols[SUB_PRODUCTO_TXT] = cols.get(SUB_PRODUCTO_TXT)!.text;
    }

    const nombreNueva = (input.productoId != null ? input.productoNombre : antes.producto) || antes.producto || 'Producto';
    const nuevaLinea = await createSubitem(env, itemId, nombreNueva, subCols);
    await upsertItem(env, 'oportunidades_sub', nuevaLinea);

    // Resta de la línea origen la cantidad que se movió a la nueva — trusted:
    // esto es parte de la misma operación compuesta, no un PATCH suelto del
    // cliente.
    await submitWrite(env, ctx, 'oportunidades_sub', lineaId, { [SUB_CANTIDAD]: String(antes.cantidad - cantidadInput) }, viewer, { trusted: true, skipFlush: true });
    await flushOutbox(env);

    const nuevaLineaId = Number(nuevaLinea.id);
    const despues: LineaSnapshot = { producto: nombreNueva, color, cantidad: cantidadInput, embellecimiento: embLabel, descripcionEmbellecimiento: embDesc };
    await registrarAjuste(env, itemId, nuevaLineaId, lineaId, antes, despues, viewer);
    return { itemId, lineaId, nuevaLineaId };
  }

  // modo 'editar': PATCH en el sitio, misma línea.
  const writeCols: Record<string, string> = {};
  if (cantidadInput != null) writeCols[SUB_CANTIDAD] = String(cantidadInput);
  if (input.color != null) writeCols[SUB_COLOR] = input.color;
  if (input.embellecimiento?.estado !== undefined) {
    writeCols[SUB_EMB_STATUS] = input.embellecimiento.estado === 'con' ? EMB_LABEL_CON : EMB_LABEL_SIN;
  }
  if (input.embellecimiento?.descripcion !== undefined) writeCols[SUB_EMB_DESC] = input.embellecimiento.descripcion;
  if (input.productoId != null) writeCols[SUB_PRODUCTO_REL] = String(input.productoId);

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
  return { itemId, lineaId };
}

/** Ajustes (subversiones V{version}.{n}) de la versión mayor indicada — usado
 * por quoteVersions.ts's listVersions para adjuntarlos a la vigente. */
export async function listAjustes(env: Env, itemId: number, version: number): Promise<AjusteDTO[]> {
  await ensureAjustesTable(env);
  const { results } = await env.DB.prepare(
    'SELECT subversion, resumen, viewer_email, created_at FROM cotizacion_ajustes WHERE item_id = ? AND version = ? ORDER BY subversion',
  ).bind(itemId, version).all<{ subversion: number; resumen: string; viewer_email: string; created_at: string }>();
  return (results ?? []).map(r => ({ subversion: r.subversion, resumen: r.resumen, viewerEmail: r.viewer_email, createdAt: r.created_at }));
}
