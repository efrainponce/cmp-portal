// worker/lib/proyectoCotizacionVirtual.ts — Cotización del Proyecto (post-venta),
// capa 100% D1: a diferencia de "Ajustar línea" en Oportunidades
// (lineaAjustes.ts), esto NUNCA crea ni edita nada en Monday. Trae las MISMAS
// líneas vigentes de la Oportunidad ligada y les aplica encima un log de
// operaciones (editar/dividir) guardado en `proyecto_cotizacion_ajustes` —
// mientras nadie ajusta nada, la vista es siempre el mirror real tal cual (cero
// staleness, mismo espíritu que quoteVersions.ts: "la vigente siempre es el
// mirror"); en cuanto se aplica el primer ajuste, esa línea específica vive
// solo en D1 de ahí en adelante. Solo permite versiones intermedias
// (V{mayor}.{n}) — no hay "+ Nueva versión" aquí, la versión mayor la decide
// Oportunidades (Efraín, 2026-08-10: "en Proyecto no se puede pasar de 1 a 2,
// pero sí de 1.0 a 1.1").
//
// Líneas virtuales (nacidas de un 'dividir' hecho aquí, no en Monday) usan un
// id NEGATIVO — nunca chocan con un subitem real (siempre positivo), mismo
// esquema que ya usa createNativeIdentity para monday_user_id sintéticos
// (worker/lib/dal.ts).
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { AjusteDTO, AjustarLineaRequest, AjustarLineaResponse, CotizacionVirtualDTO, QuoteLineSnapshot } from '../../shared/dto';
import { getItem, childrenOf, linkedItemId, PROYECTO_OPP_REL } from './dal';
import { snapshotLine } from './quoteVersions';
import { checkCostoDivergente } from './costoDivergencia';

export class ProyectoCotizacionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const AJUSTE_ROLES = ['vendedor', 'compras', 'admin'];

let tableReady = false;

export async function ensureProyectoCotizacionTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS proyecto_cotizacion_ajustes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      oportunidad_id   INTEGER NOT NULL,
      linea_id         INTEGER NOT NULL,
      linea_origen_id  INTEGER,
      modo             TEXT NOT NULL,
      subversion       INTEGER NOT NULL,
      campos           TEXT NOT NULL,
      resumen          TEXT NOT NULL,
      viewer_email     TEXT NOT NULL,
      created_at       TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_proycot_opp ON proyecto_cotizacion_ajustes(oportunidad_id)'),
  ]);
  tableReady = true;
}

interface CamposAjuste {
  producto?: string;
  productoItemId?: number;
  color?: string;
  cantidad: number;
  embellecimiento?: boolean;
  descripcionEmbellecimiento?: string;
}

interface AjusteRow {
  id: number;
  linea_id: number;
  linea_origen_id: number | null;
  modo: string;
  subversion: number;
  campos: string;
  resumen: string;
  viewer_email: string;
  created_at: string;
}

/** Parte pura del replay (testeada sin D1): reproduce el log de ajustes
 * (`rows`, en orden cronológico) sobre las líneas reales base. Mientras `rows`
 * esté vacío, devuelve `base` tal cual — cero staleness. Exportada aparte de
 * getVirtualLines porque esta sí es la lógica de negocio (el merge), no I/O. */
export function applyAjustesVirtuales(base: QuoteLineSnapshot[], rows: AjusteRow[]): QuoteLineSnapshot[] {
  const map = new Map<number, QuoteLineSnapshot>();
  for (const l of base) map.set(l.subitemId ?? -1, { ...l });

  for (const row of rows) {
    const campos = JSON.parse(row.campos) as CamposAjuste;
    if (row.modo === 'dividir' && row.linea_origen_id != null) {
      const origen = map.get(row.linea_origen_id);
      if (!origen) continue; // línea origen ya no existe (borrada de Monday mientras tanto) — ajuste huérfano, se ignora
      origen.cantidad = Math.max(0, origen.cantidad - campos.cantidad);
      origen.ajusteLabel = 'Dividida';
      map.set(row.linea_id, {
        subitemId: row.linea_id,
        productoItemId: campos.productoItemId ?? origen.productoItemId,
        producto: campos.producto ?? origen.producto,
        sku: origen.sku,
        color: campos.color ?? origen.color,
        cantidad: campos.cantidad,
        embellecimiento: campos.embellecimiento ?? origen.embellecimiento,
        descripcionEmbellecimiento: campos.descripcionEmbellecimiento ?? origen.descripcionEmbellecimiento,
        precioUnitario: origen.precioUnitario,
        etapaCosteo: origen.etapaCosteo,
        ajusteLabel: 'Dividida',
      });
    } else {
      const target = map.get(row.linea_id);
      if (!target) continue; // línea editada ya no existe (huérfano) — se ignora
      if (campos.producto !== undefined) target.producto = campos.producto;
      if (campos.productoItemId !== undefined) target.productoItemId = campos.productoItemId;
      if (campos.color !== undefined) target.color = campos.color;
      target.cantidad = campos.cantidad;
      if (campos.embellecimiento !== undefined) target.embellecimiento = campos.embellecimiento;
      if (campos.descripcionEmbellecimiento !== undefined) target.descripcionEmbellecimiento = campos.descripcionEmbellecimiento;
      if (target.ajusteLabel !== 'Dividida') target.ajusteLabel = 'Editada';
    }
  }

  return [...map.values()].filter(l => l.cantidad > 0);
}

/** Proyecto → Oportunidad ligada, re-validando el scoping del viewer sobre
 * AMBOS items (mismo criterio que GET /api/proyectos/:id/oportunidad,
 * worker/routes/oportunidades.ts). `mode: 'own'` para toda escritura. */
async function resolveOportunidadId(env: Env, proyectoId: number, viewer: Identity, mode: 'read' | 'own'): Promise<number> {
  const proyecto = await getItem(env, 'proyectos', proyectoId, viewer, mode);
  if (!proyecto) throw new ProyectoCotizacionError(404, 'not found');
  const oppId = linkedItemId(proyecto, PROYECTO_OPP_REL);
  if (oppId === null) throw new ProyectoCotizacionError(404, 'Este proyecto no tiene una Oportunidad ligada.');
  const opp = await getItem(env, 'oportunidades', oppId, viewer);
  if (!opp) throw new ProyectoCotizacionError(404, 'not found');
  return oppId;
}

async function nextSubversion(env: Env, oportunidadId: number): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COALESCE(MAX(subversion), 0) as m FROM proyecto_cotizacion_ajustes WHERE oportunidad_id = ?')
    .bind(oportunidadId)
    .first<{ m: number }>();
  return (row?.m ?? 0) + 1;
}

function resumenDe(antes: QuoteLineSnapshot, campos: CamposAjuste, dividida: boolean): string {
  const cambios: string[] = [];
  if (campos.producto && campos.producto !== antes.producto) cambios.push(`Producto cambiado a ${campos.producto}`);
  if (campos.color !== undefined && campos.color !== antes.color) cambios.push(`Color: ${campos.color || '—'}`);
  if (campos.embellecimiento !== undefined && campos.embellecimiento !== antes.embellecimiento) {
    cambios.push(`Embellecimiento: ${campos.embellecimiento ? 'Con' : 'Sin'} Embellecimiento`);
  }
  if (!dividida && campos.cantidad !== antes.cantidad) cambios.push(`Cantidad: ${antes.cantidad} → ${campos.cantidad}`);
  const base = cambios.length > 0 ? cambios.join(' · ') : 'Línea ajustada';
  return dividida ? `Línea dividida (${campos.cantidad} uds) — ${base}` : base;
}

/** Vista efectiva: líneas reales vigentes de la Oportunidad + el log de ajustes
 * del Proyecto reproducido encima. Nunca escribe nada — solo lee. */
export async function getVirtualLines(env: Env, oportunidadId: number, viewer: Identity): Promise<{ lines: QuoteLineSnapshot[]; ajustes: AjusteDTO[] }> {
  const lineasReales = await childrenOf(env, 'oportunidades', oportunidadId, viewer);
  const base = lineasReales.map(snapshotLine);

  await ensureProyectoCotizacionTable(env);
  const { results } = await env.DB
    .prepare('SELECT id, linea_id, linea_origen_id, modo, subversion, campos, resumen, viewer_email, created_at FROM proyecto_cotizacion_ajustes WHERE oportunidad_id = ? ORDER BY id')
    .bind(oportunidadId)
    .all<AjusteRow>();
  const rows = results ?? [];

  const lines = applyAjustesVirtuales(base, rows);
  const ajustes: AjusteDTO[] = rows.map(r => ({
    subversion: r.subversion, resumen: r.resumen, viewerEmail: r.viewer_email, createdAt: r.created_at,
    lineaId: r.linea_id, lineaOrigenId: r.linea_origen_id ?? undefined,
  }));
  return { lines, ajustes };
}

export async function listCotizacionVirtual(env: Env, proyectoId: number, viewer: Identity): Promise<CotizacionVirtualDTO> {
  const oportunidadId = await resolveOportunidadId(env, proyectoId, viewer, 'read');
  return getVirtualLines(env, oportunidadId, viewer);
}

/** "Ajustar línea" — versión virtual (Proyecto). Mismas reglas que
 * lineaAjustes.ajustarLinea (dividir exige cantidad < actual; nunca toca
 * precio) pero solo INSERTa en `proyecto_cotizacion_ajustes`, nunca escribe a
 * Monday. `lineaId` puede ser un subitem real (positivo, de la Oportunidad) o
 * una línea virtual nacida de un 'dividir' anterior (negativa). */
export async function ajustarLineaVirtual(
  env: Env, proyectoId: number, lineaId: number, viewer: Identity, input: AjustarLineaRequest,
): Promise<AjustarLineaResponse> {
  if (!AJUSTE_ROLES.includes(viewer.role)) throw new ProyectoCotizacionError(403, 'forbidden');
  const oportunidadId = await resolveOportunidadId(env, proyectoId, viewer, 'own');

  const { lines } = await getVirtualLines(env, oportunidadId, viewer);
  const antes = lines.find(l => (l.subitemId ?? null) === lineaId);
  if (!antes) throw new ProyectoCotizacionError(404, 'Línea no encontrada.');

  const cantidadInput = input.cantidad != null && Number.isFinite(input.cantidad) ? input.cantidad : undefined;
  if (cantidadInput != null && cantidadInput <= 0) throw new ProyectoCotizacionError(400, 'La cantidad debe ser mayor a cero.');

  await ensureProyectoCotizacionTable(env);
  const subversion = await nextSubversion(env, oportunidadId);
  const createdAt = new Date().toISOString();

  const costoDivergente = input.productoId != null && input.productoId !== antes.productoItemId
    ? await checkCostoDivergente(env, oportunidadId, viewer, antes.productoItemId, input.productoId, antes.producto)
    : undefined;

  if (input.modo === 'dividir') {
    if (cantidadInput == null || cantidadInput >= antes.cantidad) {
      throw new ProyectoCotizacionError(400, 'Para dividir, la cantidad debe ser menor a la cantidad actual de la línea.');
    }
    const campos: CamposAjuste = {
      cantidad: cantidadInput,
      color: input.color ?? antes.color,
      embellecimiento: input.embellecimiento?.estado !== undefined ? input.embellecimiento.estado === 'con' : antes.embellecimiento,
      descripcionEmbellecimiento: input.embellecimiento?.descripcion ?? antes.descripcionEmbellecimiento,
    };
    if (input.productoId != null) {
      campos.productoItemId = input.productoId;
      campos.producto = input.productoNombre || antes.producto;
    }
    const resumen = resumenDe(antes, campos, true);

    // linea_id de la fila nueva se resuelve DESPUÉS del insert (autoincrement) —
    // arranca en 0 y se corrige a -id en un segundo UPDATE, mismo id que se
    // devuelve al front como la línea recién creada.
    const insertResult = await env.DB.prepare(
      `INSERT INTO proyecto_cotizacion_ajustes (oportunidad_id, linea_id, linea_origen_id, modo, subversion, campos, resumen, viewer_email, created_at)
       VALUES (?, 0, ?, 'dividir', ?, ?, ?, ?, ?)`,
    ).bind(oportunidadId, lineaId, subversion, JSON.stringify(campos), resumen, viewer.email, createdAt).run();
    const newRowId = insertResult.meta.last_row_id;
    const nuevaLineaId = -newRowId;
    await env.DB.prepare('UPDATE proyecto_cotizacion_ajustes SET linea_id = ? WHERE id = ?').bind(nuevaLineaId, newRowId).run();

    return { ok: true, lineaId, nuevaLineaId, costoDivergente };
  }

  // modo 'editar': misma línea (real o virtual), un solo registro.
  const campos: CamposAjuste = { cantidad: cantidadInput ?? antes.cantidad };
  if (input.color != null) campos.color = input.color;
  if (input.embellecimiento?.estado !== undefined) campos.embellecimiento = input.embellecimiento.estado === 'con';
  if (input.embellecimiento?.descripcion !== undefined) campos.descripcionEmbellecimiento = input.embellecimiento.descripcion;
  if (input.productoId != null) {
    campos.productoItemId = input.productoId;
    campos.producto = input.productoNombre || antes.producto;
  }
  const resumen = resumenDe(antes, campos, false);

  await env.DB.prepare(
    `INSERT INTO proyecto_cotizacion_ajustes (oportunidad_id, linea_id, linea_origen_id, modo, subversion, campos, resumen, viewer_email, created_at)
     VALUES (?, ?, NULL, 'editar', ?, ?, ?, ?, ?)`,
  ).bind(oportunidadId, lineaId, subversion, JSON.stringify(campos), resumen, viewer.email, createdAt).run();

  return { ok: true, lineaId, costoDivergente };
}
