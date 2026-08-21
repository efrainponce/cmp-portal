// worker/lib/lineaTotales.ts — Totales de UNA línea de cotización, materializados
// en la fila del subitem (columnas t_* de `items`) al sincronizarla.
//
// Por qué materializar y no sumar al vuelo: el mirror guarda `columns` como un
// array JSON, así que agregar por oportunidad exigía `json_each` sobre el board
// de subitems completo — MEDIDO el 2026-08-20 contra producción: 803 ms y
// 441,663 filas leídas por consulta, y la lista la pediría cada vez que el ETag
// se invalida. Con las columnas t_* el mismo agregado es un SUM sobre 3,652
// filas por índice (worker/lib/totales.ts).
//
// Las cinco cifras son las fórmulas que Monday ya calculó por línea (llegan con
// texto en el mirror, a diferencia de los espejos de dinero del item padre, que
// por API siempre vienen vacíos). Para una línea NATIVA (Zona Efrain) nadie las
// calculó: ahí se reconstruyen con shared/costeoFormulas.ts, la misma matemática
// que usa la grid de cotización.
import type { RawColumn } from './canon';
import { computeCostChain, computePriceChain } from '../../shared/costeoFormulas';

/** Fórmulas de Monday en el subitem (docs/monday-column-map.md). */
const F = {
  costo: 'formula_mkznrm5a',        // Costo Total (de la línea)
  subtotal: 'formula_mkznmjh6',     // Subtotal
  total: 'formula_mm00xy0n',        // Total (con IVA)
  utilidad: 'formula_mkznry25',     // Utilidad Total
  margenGob: 'formula_mkznsb7m',    // Margen Gob Total
} as const;

/** Inputs numéricos que el usuario captura — el respaldo para líneas nativas. */
const N = {
  cantidad: 'numeric_mkzm6399',
  costoDistr: 'numeric_mm0bph99',
  descuentoPct: 'numeric_mkzn2q51',
  conversion: 'numeric_mm0rvhgs',
  gastosPct: 'numeric_mkzngs9x',
  embellecimiento: 'numeric_mm0gxvpa',
  precio: 'numeric_mkzneg3d',
  margenGobPct: 'numeric_mkznnm5s',
  ivaPct: 'numeric_mm0cg0bm',
} as const;

export interface LineaTotales {
  costo: number;
  subtotal: number;
  total: number;
  utilidad: number;
  margenGob: number;
}

/** El número que trae una columna, ya sea en `text` ("14070") o en `value`
 * ("14070"). Monday manda las fórmulas como texto plano y los numbers como
 * string JSON; ambos parsean igual con parseFloat sobre el texto. */
function num(cols: Map<string, RawColumn>, id: string): number {
  const col = cols.get(id);
  if (!col) return 0;
  const n = parseFloat((col.text ?? '').replace(/,/g, ''));
  if (Number.isFinite(n)) return n;
  const v = parseFloat((col.value ?? '').replace(/["\s,]/g, ''));
  return Number.isFinite(v) ? v : 0;
}

/** ¿Monday ya calculó las fórmulas de esta línea? Una línea nativa no tiene
 * ninguna; una recién creada en Monday puede traerlas vacías por un instante. */
function tieneFormulas(cols: Map<string, RawColumn>): boolean {
  return Object.values(F).some(id => (cols.get(id)?.text ?? '').trim() !== '');
}

export function totalesDeLinea(columns: RawColumn[]): LineaTotales {
  const cols = new Map(columns.map(c => [c.id, c]));

  if (tieneFormulas(cols)) {
    return {
      costo: num(cols, F.costo),
      subtotal: num(cols, F.subtotal),
      total: num(cols, F.total),
      utilidad: num(cols, F.utilidad),
      margenGob: num(cols, F.margenGob),
    };
  }

  const cantidad = num(cols, N.cantidad);
  const cost = computeCostChain({
    cantidad,
    costoDistr: num(cols, N.costoDistr),
    descuentoPct: num(cols, N.descuentoPct),
    conversion: num(cols, N.conversion) || 1,
    gastosPct: num(cols, N.gastosPct),
    embellecimiento: num(cols, N.embellecimiento),
  });
  const price = computePriceChain({
    cantidad,
    precio: num(cols, N.precio),
    margenGobPct: num(cols, N.margenGobPct),
    costoTotalUnit: cost.costoTotalUnit,
    ivaPct: num(cols, N.ivaPct),
  });
  return {
    costo: cost.costoTotal,
    subtotal: price.subtotal,
    total: price.totalConIva,
    utilidad: price.utilidadTotal,
    margenGob: price.margenGobTotal,
  };
}
