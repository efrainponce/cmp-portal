// worker/lib/analytics.ts — I/O del tablero de Análisis (admin). Solo arma las
// filas; los números los calcula shared/analytics.ts, que es puro y testeado.
//
// TODO sale de D1 (Efraín, 2026-08-17: "todo esto es D1 driven"): ni una
// lectura a Monday en este camino. Los hitos con fecha que el flujo estampa en
// la Oportunidad ya están en el mirror, y por eso el tablero nace con TODA la
// historia — no depende de haber instrumentado nada antes.
//
// Los montos NO pueden salir del padre: los mirrors de dinero de la Oportunidad
// (lookup_mm00p07m "Total", lookup_mkznd66k "Subtotal", lookup_mm4g2hqf
// "Utilidad Total"…) llegan VACÍOS en las 630 filas del mirror — es el mismo
// tope de la API de Monday que ya conocíamos de la analítica. Las fórmulas de
// la LÍNEA sí llegan con texto (2,964 de 2,964), así que el monto de una
// oportunidad es la suma de sus líneas vigentes.
//
// Ojo con lo que "vigente" significa: las líneas del mirror son las de la
// versión actual de la cotización. Las versiones superadas viven en
// cotizacion_versions (worker/lib/quoteVersions.ts) y NO se suman aquí — el
// pipeline es lo que se está vendiendo hoy, no la suma de todos los intentos.
import type { Env } from '../env';
import { puedeVerUtilidades } from '../../shared/visibility';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { scopeFor } from './dal';
import {
  ANALYTICS_OPP_COLS, ANALYTICS_LINE_COLS, buildAnalytics,
  type AnalyticsResponse, type GroupBy, type OppRow,
} from '../../shared/analytics';

export interface AnalyticsQuery {
  por: GroupBy;
  /** ISO o null. Filtran por FECHA DE CREACIÓN de la oportunidad: el embudo
   * sigue cohortes ("de las creadas en el periodo, cuántas llegaron a X"), no
   * fotos del momento — si filtrara por actividad reciente, una oportunidad
   * vieja que se ganó ayer inflaría la tasa de un periodo que no le toca. */
  desde: string | null;
  hasta: string | null;
}

const C = ANALYTICS_OPP_COLS;
const L = ANALYTICS_LINE_COLS;

// `MAX(CASE WHEN col = x THEN … END)` por columna: un solo barrido de json_each
// en vez de una subconsulta por cada una. Los ids se interpolan (no van como
// binds) porque son constantes del código, nunca entrada del usuario — los
// únicos binds son el board y las fechas del filtro.
const pickText = (colId: string) =>
  `MAX(CASE WHEN json_extract(j.value, '$.id') = '${colId}' THEN json_extract(j.value, '$.text') END)`;

/** Los tipos date/creation_log guardan el dato dentro de `value` (un JSON
 * *encodeado como string*), de ahí el json_extract anidado. */
const pickValue = (colId: string, key: 'created_at' | 'changed_at') =>
  `MAX(CASE WHEN json_extract(j.value, '$.id') = '${colId}'` +
  ` THEN json_extract(json_extract(j.value, '$.value'), '$.${key}') END)`;

const OPP_COL_IDS = Object.values(C).map(id => `'${id}'`).join(',');
const LINE_COL_IDS = [L.subtotal, L.utilidad].map(id => `'${id}'`).join(',');

/**
 * Una fila por oportunidad con sus hitos, su corte (zona/vendedor) y su monto.
 *
 * El scope del viewer se aplica sobre `items` sin alias porque scopeFor()
 * genera SQL que nombra la tabla así. No es cosmético: un admin fuera de la
 * whitelist de la Zona privada "Efrain" (worker/lib/zonas.ts) no debe ver esas
 * filas NI SIQUIERA agregadas — un total por zona que las incluyera filtraría
 * exactamente lo que esa zona existe para ocultar.
 */
async function fetchRows(env: Env, viewer: Identity, q: AnalyticsQuery): Promise<OppRow[]> {
  const scope = scopeFor('oportunidades', viewer);
  const binds: unknown[] = [BOARDS.oportunidades.id, ...scope.binds, BOARDS.oportunidades_sub.id];

  let filtro = '';
  if (q.desde) { filtro += ' AND h.creada >= ?'; }
  if (q.hasta) { filtro += ' AND h.creada <= ?'; }

  const sql = `
    WITH opp AS (
      SELECT items.item_id AS item_id, items.name AS name, items.columns AS columns
      FROM items
      WHERE items.board_id = ? AND (${scope.where})
    ),
    hitos AS (
      SELECT o.item_id AS item_id, o.name AS name,
        ${pickValue(C.creacion, 'created_at')} AS creada,
        ${pickValue(C.solicitudCosteo, 'changed_at')} AS sol_costeo,
        ${pickValue(C.validacionCosteo, 'changed_at')} AS val_costeo,
        ${pickValue(C.cotizacion, 'changed_at')} AS cotizada,
        ${pickText(C.etapa)} AS etapa,
        ${pickText(C.zona)} AS zona,
        ${pickText(C.vendedor)} AS vendedor
      FROM opp o, json_each(o.columns) j
      WHERE json_extract(j.value, '$.id') IN (${OPP_COL_IDS})
      GROUP BY o.item_id
    ),
    montos AS (
      SELECT s.parent_item_id AS opp_id,
        SUM(CASE WHEN json_extract(j.value, '$.id') = '${L.subtotal}'
                 THEN CAST(NULLIF(json_extract(j.value, '$.text'), '') AS REAL) END) AS monto,
        SUM(CASE WHEN json_extract(j.value, '$.id') = '${L.utilidad}'
                 THEN CAST(NULLIF(json_extract(j.value, '$.text'), '') AS REAL) END) AS utilidad
      FROM items s, json_each(s.columns) j
      WHERE s.board_id = ?
        AND s.parent_item_id IN (SELECT item_id FROM opp)
        AND json_extract(j.value, '$.id') IN (${LINE_COL_IDS})
      GROUP BY s.parent_item_id
    )
    SELECT h.item_id, h.name, h.creada, h.sol_costeo, h.val_costeo, h.cotizada,
           h.etapa, h.zona, h.vendedor, m.monto, m.utilidad
    FROM hitos h
    LEFT JOIN montos m ON m.opp_id = h.item_id
    WHERE 1=1${filtro}
  `;
  if (q.desde) binds.push(q.desde);
  if (q.hasta) binds.push(q.hasta);

  const { results } = await env.DB.prepare(sql).bind(...binds).all<{
    item_id: number; name: string; creada: string | null;
    sol_costeo: string | null; val_costeo: string | null; cotizada: string | null;
    etapa: string | null; zona: string | null; vendedor: string | null;
    monto: number | null; utilidad: number | null;
  }>();

  return (results ?? []).map(r => ({
    itemId: r.item_id,
    name: r.name,
    creada: r.creada,
    solCosteo: r.sol_costeo,
    valCosteo: r.val_costeo,
    cotizada: r.cotizada,
    etapa: r.etapa,
    zona: r.zona,
    vendedor: r.vendedor,
    monto: r.monto,
    utilidad: r.utilidad,
  }));
}

/** Qué tan fresco está el mirror del que salió el tablero — sin esto, un
 * reconcile caído se ve igual que "no hubo movimiento" (ver la nota de
 * reconcileAll cortándose a medias en CLAUDE.md). */
async function lastSync(env: Env): Promise<string | null> {
  const row = await env.DB.prepare('SELECT MAX(synced_at) AS at FROM items WHERE board_id = ?')
    .bind(BOARDS.oportunidades.id).first<{ at: string | null }>();
  return row?.at ?? null;
}

export async function buildAnalyticsResponse(
  env: Env, viewer: Identity, q: AnalyticsQuery,
): Promise<AnalyticsResponse> {
  const [rows, syncedAt] = await Promise.all([fetchRows(env, viewer, q), lastSync(env)]);
  // Utilidad solo para la whitelist por correo (Efraín, 2026-08-27). Se vacía
  // ANTES de agregar, no después: si solo se borrara `utilidadGanada` del
  // total, la misma cifra seguiría saliendo sumada por zona y por vendedor en
  // `grupos`. Con la columna en null, `buildAnalytics` produce 0 en todos lados
  // y el paso de abajo convierte esos ceros en "ausente", que es lo honesto —
  // este tablero es admin-only y hasta hoy le enseñaba la utilidad a cualquier
  // admin, PAM incluida.
  const conUtilidades = puedeVerUtilidades(viewer.email);
  const filas = conUtilidades ? rows : rows.map(r => ({ ...r, utilidad: null }));
  const out = buildAnalytics(filas, {
    por: q.por, desde: q.desde, hasta: q.hasta, syncedAt, generadoAt: new Date().toISOString(),
  });
  if (!conUtilidades) {
    delete out.utilidadGanada;
    for (const g of out.grupos) delete g.utilidadGanada;
  }
  return out;
}
