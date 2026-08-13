// worker/lib/proyectoCotizacionVirtual.ts — Cotización del Proyecto (post-venta).
// Muestra las MISMAS líneas vigentes de la Oportunidad ligada (childrenOf), y
// "Editar/Dividir" aquí reusa el mismo motor de escritura real a Monday que
// "Ajustar línea" en Oportunidades (worker/lib/lineaAjustes.ts, diseñado
// explícitamente para funcionar incluso con la Oportunidad Ganada — el mismo
// escenario que un Proyecto post-venta) — no hay capa D1-only aparte (Efraín,
// 2026-08-13: "tiene que cambiar Monday también", porque Tallas importa su
// desglose de subitems reales y una edición que se quedara solo en D1 nunca
// se reflejaba ahí).
//
// El chequeo de PERMISOS sí se queda propio de este archivo: el Proyecto tiene
// su propia columna de Compras (`project_owner`, copiada de la Oportunidad
// solo una vez al Ganar — worker/lib/ganarOportunidad.ts — y reasignable
// después para post-venta), distinta de la columna Compras de la Oportunidad
// (`multiple_person_mm03qyw9`). Delegar el chequeo de propiedad al de
// Oportunidades dejaría fuera a alguien dueño del Proyecto pero no de la
// Oportunidad original — por eso `ajustarLineaVirtual` autoriza contra el
// Proyecto y solo REUSA la escritura de `applyAjusteLinea`.
//
// Solo permite versiones intermedias (V{mayor}.{n}) — no hay "+ Nueva
// versión" aquí, la versión mayor la decide Oportunidades (Efraín,
// 2026-08-10: "en Proyecto no se puede pasar de 1 a 2, pero sí de 1.0 a 1.1").
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { AjusteDTO, AjustarLineaRequest, AjustarLineaResponse, CotizacionVirtualDTO, QuoteLineSnapshot } from '../../shared/dto';
import { getItem, getItemTrusted, childrenOf, linkedItemId, PROYECTO_OPP_REL } from './dal';
import { snapshotLine } from './quoteVersions';
import { applyAjusteLinea, currentMajorVersion, listAjustes } from './lineaAjustes';

export class ProyectoCotizacionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const AJUSTE_ROLES = ['vendedor', 'compras', 'admin'];

/** Reconstruye `ajusteLabel` ('Editada'/'Dividida') por línea a partir del log
 * de ajustes de la versión vigente — puro, sin I/O, para poder testearlo sin
 * D1. 'Dividida' tiene prioridad: la línea origen de un 'dividir' se pinta
 * 'Dividida' aunque después también tenga su propio ajuste de 'editar'. */
export function labelLines(lines: QuoteLineSnapshot[], ajustes: AjusteDTO[]): QuoteLineSnapshot[] {
  const labels = new Map<number, 'Dividida' | 'Editada'>();
  for (const a of ajustes) {
    if (a.lineaOrigenId != null) {
      labels.set(a.lineaOrigenId, 'Dividida');
      labels.set(a.lineaId, 'Dividida');
    } else if (labels.get(a.lineaId) !== 'Dividida') {
      labels.set(a.lineaId, 'Editada');
    }
  }
  return lines.map(l => {
    const label = l.subitemId != null ? labels.get(l.subitemId) : undefined;
    return label ? { ...l, ajusteLabel: label } : l;
  });
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

/** Vista efectiva: líneas reales vigentes de la Oportunidad, rotuladas con el
 * log de ajustes (editar/dividir) de la versión mayor vigente — mismo log que
 * alimenta los pills "V{n}.{m}" en VersionChips del lado Oportunidades. */
export async function getVirtualLines(env: Env, oportunidadId: number, viewer: Identity): Promise<{ lines: QuoteLineSnapshot[]; ajustes: AjusteDTO[] }> {
  const lineasReales = await childrenOf(env, 'oportunidades', oportunidadId, viewer);
  const base = lineasReales.map(snapshotLine);

  const vigenteVersion = await currentMajorVersion(env, oportunidadId);
  const ajustes = await listAjustes(env, oportunidadId, vigenteVersion);

  return { lines: labelLines(base, ajustes), ajustes };
}

export async function listCotizacionVirtual(env: Env, proyectoId: number, viewer: Identity): Promise<CotizacionVirtualDTO> {
  const oportunidadId = await resolveOportunidadId(env, proyectoId, viewer, 'read');
  return getVirtualLines(env, oportunidadId, viewer);
}

/** "Ajustar línea" desde el Proyecto — mismas reglas que ajustarLinea
 * (Oportunidades): dividir exige cantidad < actual, nunca toca precio. Escribe
 * de verdad a Monday reusando `applyAjusteLinea` (worker/lib/lineaAjustes.ts);
 * el chequeo de propiedad es el del Proyecto (ver comentario de archivo), no
 * el de `oportunidades_sub`. `lineaId` es siempre un subitem real de la
 * Oportunidad ligada. */
export async function ajustarLineaVirtual(
  env: Env, ctx: ExecutionContext, proyectoId: number, lineaId: number, viewer: Identity, input: AjustarLineaRequest,
): Promise<AjustarLineaResponse & { itemId?: number }> {
  if (!AJUSTE_ROLES.includes(viewer.role)) throw new ProyectoCotizacionError(403, 'forbidden');
  const oportunidadId = await resolveOportunidadId(env, proyectoId, viewer, 'own');

  const linea = await getItemTrusted(env, 'oportunidades_sub', lineaId);
  if (!linea || linea.parent_item_id !== oportunidadId) throw new ProyectoCotizacionError(404, 'Línea no encontrada.');

  const result = await applyAjusteLinea(env, ctx, oportunidadId, lineaId, linea, viewer, input);
  return { ok: true, itemId: result.itemId, lineaId: result.lineaId, nuevaLineaId: result.nuevaLineaId, costoDivergente: result.costoDivergente };
}
