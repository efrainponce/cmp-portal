// worker/lib/totales.ts — Totales de la cotización por oportunidad, para pintarlos
// en la lista (StageBoardList) como los ve Monday en su vista de tablero.
//
// En Monday esas seis cifras son columnas ESPEJO del item padre, y los espejos de
// dinero llegan vacíos por la API — nunca se pudieron leer. Aquí se calculan:
// cada línea guarda sus totales al sincronizarse (worker/lib/lineaTotales.ts) y
// esto los suma por oportunidad. La Utilidad % es PONDERADA (utilidad/subtotal),
// no el promedio de los porcentajes de cada línea — igual que la fila de totales
// del tab Cotización (src/.../TotalsRow.tsx) y que Monday.
//
// La suma sale de las líneas VIGENTES (el mirror siempre es la versión vigente:
// las versiones superadas viven archivadas en `cotizacion_versions`, ver
// worker/lib/quoteVersions.ts), así que es la cotización que está sobre la mesa.
import type { Env } from '../env';
import type { Identity, MirrorItem, Role } from '../../shared/types';
import type { TotalesDTO } from '../../shared/dto';
import { BOARDS } from '../../shared/boards';
import { canRead } from '../../shared/visibility';
import { linkedItemId, scopeFor, PROYECTO_OPP_REL } from './dal';

// Las mismas columnas de línea que ya gatea shared/visibility.ts: Subtotal y
// Total los ve el vendedor (es lo que cotiza al cliente); Costo, Utilidad y
// Margen Gob son de compras/admin. El gate se hereda de ahí en vez de repetir
// una whitelist — "Ventas: cero costos" no puede quedar en dos lugares.
const COSTO_COL = 'formula_mkznrm5a';
const SUBTOTAL_COL = 'formula_mkznmjh6';
const TOTAL_COL = 'formula_mm00xy0n';
const UTILIDAD_COL = 'formula_mkznry25';
const MARGEN_GOB_COL = 'formula_mkznsb7m';

interface Fila {
  pid: number | null;
  costo: number; subtotal: number; total: number; utilidad: number; margen: number; lineas: number;
}

/**
 * Mapa itemId (oportunidad) -> totales, filtrado DOS veces: por lo que el rol
 * puede leer (columnas) y por las oportunidades que el viewer ya recibió
 * (renglones). Lo segundo no es cosmético: sin ese filtro un vendedor que ve 71
 * oportunidades se llevaba el subtotal y el total de las 608 del board, indexados
 * por id — el mismo agujero que `dal.ts` cierra para los items, por la puerta de
 * atrás. Probado en local el 2026-08-20 antes de que llegara a producción.
 *
 * El filtro va en JS y no en el SQL a propósito: ~600 ids no caben en los ~100
 * binds que aguanta una consulta de D1.
 *
 * Un solo SUM sobre el board de líneas agrupado por padre — sin `json_each`, que
 * medido en producción costaba 803 ms y 441,663 filas leídas por consulta; así
 * son 44 ms y 7,304.
 */
export async function totalesPorOportunidad(
  env: Env,
  role: Role,
  visibles: Set<number>,
): Promise<Record<string, TotalesDTO>> {
  const puede = (colId: string) => canRead('oportunidades_sub', colId, role);
  // Sin una sola métrica legible (almacén) no hay nada que mandar ni que consultar.
  if (![COSTO_COL, SUBTOTAL_COL, TOTAL_COL, UTILIDAD_COL, MARGEN_GOB_COL].some(puede)) return {};

  const res = await env.DB.prepare(
    `SELECT parent_item_id AS pid,
            SUM(COALESCE(t_costo, 0))      AS costo,
            SUM(COALESCE(t_subtotal, 0))   AS subtotal,
            SUM(COALESCE(t_total, 0))      AS total,
            SUM(COALESCE(t_utilidad, 0))   AS utilidad,
            SUM(COALESCE(t_margen_gob, 0)) AS margen,
            COUNT(*)                       AS lineas
       FROM items
      WHERE board_id = ? AND parent_item_id IS NOT NULL
      GROUP BY parent_item_id`,
  ).bind(BOARDS.oportunidades_sub.id).all<Fila>();

  const out: Record<string, TotalesDTO> = {};
  for (const f of res.results ?? []) {
    if (f.pid == null || !visibles.has(f.pid)) continue;
    const dto: TotalesDTO = { lineas: f.lineas };
    if (puede(SUBTOTAL_COL)) dto.subtotal = f.subtotal;
    if (puede(TOTAL_COL)) dto.total = f.total;
    if (puede(COSTO_COL)) dto.costo = f.costo;
    if (puede(UTILIDAD_COL)) {
      dto.utilidad = f.utilidad;
      // Ponderada sobre el subtotal, y solo si hay subtotal: una cotización sin
      // precios capturados daría 0/0 y pintaría un "0.0%" que parece un dato.
      if (f.subtotal > 0) dto.utilidadPct = (f.utilidad / f.subtotal) * 100;
    }
    if (puede(MARGEN_GOB_COL)) dto.margenGob = f.margen;
    out[String(f.pid)] = dto;
  }
  return out;
}

/** MAX(synced_at) del board de líneas — entra al ETag de la lista cuando se
 * piden totales: sin esto, editar una línea no invalida la llave (el ETag mira
 * el board de OPORTUNIDADES) y los totales se quedarían congelados tras un 304. */
export async function totalesVersion(env: Env): Promise<string> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) AS c, MAX(synced_at) AS m FROM items WHERE board_id = ?')
    .bind(BOARDS.oportunidades_sub.id)
    .first<{ c: number; m: string | null }>();
  return `${row?.c ?? 0}.${row?.m ?? ''}`;
}

/**
 * Lo mismo, pero indexado por PROYECTO (Efraín, 2026-08-27): el Reporte de
 * Proyectos pinta las mismas seis cifras que Validación de Costeo, una por
 * proyecto. El dinero no vive en el board Proyectos — vive en las líneas de la
 * Oportunidad ligada (`board_relation_mm0hf0y3`), así que esto solo re-indexa
 * el agregado de arriba: proyecto -> oportunidad -> totales de sus líneas.
 *
 * Dos filtros, igual que en `totalesPorOportunidad`:
 *  - Por COLUMNA, heredado de shared/visibility.ts (lo hace la función de arriba).
 *  - Por RENGLÓN, y aquí van los DOS extremos de la cadena: solo entran los
 *    proyectos que el viewer ya recibió (`rows` viene scopeado por dal.ts) Y
 *    solo las oportunidades que el viewer podría leer por su cuenta. Lo segundo
 *    no es redundante: un proyecto visible puede apuntar a una oportunidad de la
 *    zona privada (worker/lib/zonas.ts), y sin este segundo filtro el dinero de
 *    esa oportunidad saldría por la puerta de atrás del board Proyectos.
 *
 * La lista de oportunidades legibles se pide de una sola consulta (una columna,
 * índice por board) en vez de un `IN (...)` con un bind por proyecto: no caben
 * ~600 ids en los ~100 binds que aguanta D1.
 */
export async function totalesPorProyecto(
  env: Env,
  viewer: Identity,
  rows: MirrorItem[],
): Promise<Record<string, TotalesDTO>> {
  // proyecto -> oportunidad ligada. Un proyecto creado desde cero
  // (CrearProyectoModal) no tiene relación: se queda sin cifras, no en ceros.
  const oppDe = new Map<number, number>();
  for (const row of rows) {
    const oppId = linkedItemId(row, PROYECTO_OPP_REL);
    if (oppId != null) oppDe.set(row.item_id, oppId);
  }
  if (oppDe.size === 0) return {};

  const scope = scopeFor('oportunidades', viewer);
  const res = await env.DB
    .prepare(`SELECT item_id FROM items WHERE board_id = ? AND (${scope.where})`)
    .bind(BOARDS.oportunidades.id, ...scope.binds)
    .all<{ item_id: number }>();
  const legibles = new Set((res.results ?? []).map(r => r.item_id));

  const pedidas = new Set([...oppDe.values()].filter(id => legibles.has(id)));
  if (pedidas.size === 0) return {};
  const porOpp = await totalesPorOportunidad(env, viewer.role, pedidas);

  const out: Record<string, TotalesDTO> = {};
  for (const [proyectoId, oppId] of oppDe) {
    const t = porOpp[String(oppId)];
    if (t) out[String(proyectoId)] = t;
  }
  return out;
}
