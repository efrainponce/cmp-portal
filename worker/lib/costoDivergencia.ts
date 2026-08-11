// worker/lib/costoDivergencia.ts — al cambiar el producto de una línea de
// cotización ("Ajustar línea"), compara el Costo Distribuidor del catálogo
// (Productos, numeric_mkzpx7eb, siempre oculto) entre el SKU anterior y el
// nuevo. Nunca bloquea el ajuste — si divergen más del umbral, solo avisa a
// Compras (mención en Monday + notificación del portal), mismo patrón que
// notifyComprador en productosPropuestos.ts. Compartido por lineaAjustes.ts
// (Oportunidades, línea real) y proyectoCotizacionVirtual.ts (Proyecto, línea
// virtual D1) — el chequeo de costo es el mismo sin importar dónde vive la línea
// que cambió (Efraín, 2026-08-10).
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { CostoDivergenciaDTO } from '../../shared/dto';
import { getItem } from './dal';
import { createUpdate, type MentionInput } from './monday';
import { emitNotification, personIdsFromColumns } from './notify';
import { logSync } from '../sync/log';
import { BOARDS } from '../../shared/boards';
import type { RawCol } from './serialize';

// Productos (18395657591) — docs/monday-column-map.md, siempre 🔒.
const PRODUCTO_COSTO_DISTRIBUIDOR_COL = 'numeric_mkzpx7eb';
// "Compras" de Oportunidades (people) — mismo id que productosPropuestos.ts.
const OPP_COMPRAS_COL = 'multiple_person_mm03qyw9';

const UMBRAL_PCT = 0.10;

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

async function costoDistribuidorDe(env: Env, productoId: number, viewer: Identity): Promise<{ nombre: string; costo: number } | null> {
  const producto = await getItem(env, 'productos', productoId, viewer);
  if (!producto) return null;
  const costo = Number((colsOf(producto).get(PRODUCTO_COSTO_DISTRIBUIDOR_COL)?.text ?? '').replace(/,/g, '')) || 0;
  if (costo <= 0) return null; // sin costo capturado en catálogo — no se puede comparar, no se avisa
  return { nombre: producto.name, costo };
}

/** Parte pura del chequeo (testeada sin D1): `undefined` cuando la diferencia
 * cae dentro del umbral ±10%. Exportada aparte de checkCostoDivergente porque
 * esta sí es lógica de negocio real (el umbral), no I/O. */
export function computeDivergencia(
  anterior: { nombre: string; costo: number },
  nuevo: { nombre: string; costo: number },
): CostoDivergenciaDTO | undefined {
  const pctDiff = Math.abs(nuevo.costo - anterior.costo) / anterior.costo;
  if (pctDiff <= UMBRAL_PCT) return undefined;
  return {
    productoAnterior: anterior.nombre, productoNuevo: nuevo.nombre,
    costoAnterior: anterior.costo, costoNuevo: nuevo.costo, pctDiff,
  };
}

/** monday_user_id>0: usuarios nativos del portal (sin cuenta real de Monday, ver
 * createNativeIdentity en dal.ts) no se pueden @mencionar. */
async function identitiesByMondayUserIds(env: Env, ids: number[]): Promise<{ id: number; nombre: string | null; email: string }[]> {
  const reales = ids.filter(id => id > 0);
  if (reales.length === 0) return [];
  const placeholders = reales.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT monday_user_id, nombre, email FROM identity WHERE active = 1 AND monday_user_id IN (${placeholders})`,
  ).bind(...reales).all<{ monday_user_id: number; nombre: string | null; email: string }>();
  return (results ?? []).map(r => ({ id: r.monday_user_id, nombre: r.nombre, email: r.email }));
}

/** Best-effort: compara el Costo Distribuidor del producto anterior vs el nuevo
 * en una línea que cambió de SKU. `undefined` cuando no aplica (sin cambio de
 * producto, algún costo no capturado en catálogo, o la diferencia cae dentro
 * del umbral). Cuando diverge, además avisa a Compras — nunca lanza, nunca
 * bloquea el ajuste que lo llamó. */
export async function checkCostoDivergente(
  env: Env, oportunidadItemId: number, viewer: Identity,
  oldProductoId: number | undefined | null, newProductoId: number | undefined | null,
  lineaLabel: string,
): Promise<CostoDivergenciaDTO | undefined> {
  if (oldProductoId == null || newProductoId == null || oldProductoId === newProductoId) return undefined;
  try {
    const [anterior, nuevo] = await Promise.all([
      costoDistribuidorDe(env, oldProductoId, viewer),
      costoDistribuidorDe(env, newProductoId, viewer),
    ]);
    if (!anterior || !nuevo) return undefined;
    const divergencia = computeDivergencia(anterior, nuevo);
    if (!divergencia) return undefined;
    const pctDiff = divergencia.pctDiff;

    const opp = await getItem(env, 'oportunidades', oportunidadItemId, viewer);
    if (!opp) return divergencia;
    const compradorIds = personIdsFromColumns(opp.columns, OPP_COMPRAS_COL);
    const compradores = await identitiesByMondayUserIds(env, compradorIds);
    if (compradores.length === 0) return divergencia; // sin comprador asignado, nadie a quien avisar

    const actorName = viewer.nombre || viewer.email;
    const pctTxt = Math.round(pctDiff * 100);
    const mentions: MentionInput[] = compradores.filter(c => c.nombre).map(c => ({ id: c.id, nombre: c.nombre as string }));
    const marcadores = mentions.map(m => `@${m.nombre}`).join(' ');
    const body = `${marcadores ? marcadores + ' — ' : ''}${actorName} cambió el producto de "${lineaLabel}" `
      + `(${anterior.nombre} → ${nuevo.nombre}): el Costo Distribuidor pasó de $${anterior.costo.toLocaleString()} `
      + `a $${nuevo.costo.toLocaleString()} (${pctTxt}% de diferencia). Revisa si aplica ajuste de costeo.`;
    if (mentions.length > 0) {
      await createUpdate(env, oportunidadItemId, body, mentions);
    }

    for (const c of compradores) {
      if (c.email === viewer.email) continue;
      await emitNotification(env, {
        recipientEmail: c.email,
        severity: 'importante',
        kind: 'costo_divergente',
        title: `Costo distribuidor cambió ${pctTxt}% en ${opp.name}`,
        body: `${lineaLabel}: ${anterior.nombre} → ${nuevo.nombre}`,
        boardKey: 'oportunidades',
        boardId: BOARDS.oportunidades.id,
        itemId: oportunidadItemId,
        actor: actorName,
        dedupeKey: `costo_divergente:${oportunidadItemId}:${lineaLabel}:${newProductoId}:${c.email}`,
      });
    }
    return divergencia;
  } catch (err) {
    await logSync(env, 'manual', BOARDS.oportunidades.id, oportunidadItemId, false, 'costoDivergencia: ' + err);
    return undefined;
  }
}
