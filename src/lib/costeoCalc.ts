// src/lib/costeoCalc.ts — costeo formulas for the Oportunidades subitem board
// (18395657607). Verified 2026-07-15 directly against Monday's own formula
// columns (settings_str + live display_value on real rows), not guessed —
// see docs/monday-column-map.md. Columns with a "%" unit (Descuento Distr.%,
// Gastos%, Margen Gob%, IVA%) are STORED as the whole number (18 = 18%) but
// Monday's formulas use them divided by 100 — confirmed numerically, not
// assumed.
//
// This module is purely local preview: nothing it computes is ever sent back
// to Monday. Only the raw numeric inputs the user edits are PATCHed; Monday
// recomputes its own formula columns independently and the mirror catches up
// on the next refetch. The goal here is just for the preview to look right
// instantly, using the exact same math Monday uses.
import type { ColVal, ItemDTO } from './api';
import { fmtMoney } from './format';
import { computeCostChain, computePriceChain } from '../../shared/costeoFormulas';

export const COL = {
  cantidad: 'numeric_mkzm6399',
  costoDistr: 'numeric_mm0bph99',
  descuentoPct: 'numeric_mkzn2q51',
  conversion: 'numeric_mm0rvhgs',
  gastosPct: 'numeric_mkzngs9x',
  embellecimiento: 'numeric_mm0gxvpa',
  precio: 'numeric_mkzneg3d',
  margenGobPct: 'numeric_mkznnm5s',
  ivaPct: 'numeric_mm0cg0bm',

  descuento: 'formula_mkznqx51',
  costoReal: 'formula_mkzngnjm',
  costoConvertido: 'formula_mm0rqjv1',
  costoTotalUnit: 'formula_mkznpfgg',
  costoTotal: 'formula_mkznrm5a',
  subtotal: 'formula_mkznmjh6',
  iva: 'formula_mm0rtdqp',
  totalConIva: 'formula_mm00xy0n',
  margenGobUnit: 'formula_mkznpp33',
  margenGobTotal: 'formula_mkznsb7m',
  diferencia: 'formula_mkzn28xk',
  utilidad: 'formula_mkzne7gd',
  utilidadTotal: 'formula_mkznry25',
  utilidadPct: 'formula_mkznpw5p',
} as const;

export function cellNumber(product: ItemDTO, colId: string): number {
  const v = product.cols[colId]?.value;
  if (typeof v === 'number') return v;
  const n = parseFloat(product.cols[colId]?.text ?? '');
  return Number.isFinite(n) ? n : 0;
}

// La matemática vive en shared/costeoFormulas.ts desde 2026-08-20 (el worker
// la necesita para materializar los totales de cada línea); aquí se re-exporta
// para no cambiarle el import a media UI.
export { computeCostChain, computePriceChain } from '../../shared/costeoFormulas';
export type { CostChain, PriceChain } from '../../shared/costeoFormulas';

const moneyCol = (n: number): ColVal => ({ text: fmtMoney(n), value: n, type: 'formula' });
const pctCol = (n: number): ColVal => ({ text: `${n}%`, value: n, type: 'formula' });

/**
 * Recomputes every derived formula column for one subitem row given the raw
 * inputs the user just edited (merged over the row's current values), and
 * returns only the formula column ids the row already carries — so a role
 * that can't see a column (e.g. vendedor and Margen/Utilidad) never gets a
 * preview value for it either, matching the server whitelist.
 *
 * `todas` = true para una línea NATIVA (Zona Efrain): esas líneas no existen
 * en Monday, así que nadie calcula sus fórmulas y no llegan en `cols` — sin
 * esto, "solo las que ya trae" significa "ninguna" y la grid se queda con "—"
 * y TOTAL $0 aunque el costo y el precio estén capturados (Efraín,
 * 2026-08-18). Qué columnas se PINTAN lo sigue decidiendo el meta del board
 * que filtra el server (visibleCols en CotizacionTab), no esto.
 */
export function previewRow(product: ItemDTO, edited: Record<string, number>, todas = false): Record<string, ColVal> {
  const get = (colId: string) => edited[colId] ?? cellNumber(product, colId);
  const has = (colId: string) => todas || colId in product.cols;

  const cantidad = get(COL.cantidad);
  const cost = computeCostChain({
    cantidad,
    costoDistr: get(COL.costoDistr),
    descuentoPct: get(COL.descuentoPct),
    conversion: get(COL.conversion) || 1,
    gastosPct: get(COL.gastosPct),
    embellecimiento: get(COL.embellecimiento),
  });
  const price = computePriceChain({
    cantidad,
    precio: get(COL.precio),
    margenGobPct: get(COL.margenGobPct),
    costoTotalUnit: cost.costoTotalUnit,
    ivaPct: get(COL.ivaPct),
  });

  const out: Record<string, ColVal> = {};
  if (has(COL.descuento)) out[COL.descuento] = moneyCol(cost.descuento);
  if (has(COL.costoReal)) out[COL.costoReal] = moneyCol(cost.costoReal);
  if (has(COL.costoConvertido)) out[COL.costoConvertido] = moneyCol(cost.costoConvertido);
  if (has(COL.costoTotalUnit)) out[COL.costoTotalUnit] = moneyCol(cost.costoTotalUnit);
  if (has(COL.costoTotal)) out[COL.costoTotal] = moneyCol(cost.costoTotal);
  if (has(COL.subtotal)) out[COL.subtotal] = moneyCol(price.subtotal);
  if (has(COL.iva)) out[COL.iva] = moneyCol(price.iva);
  if (has(COL.totalConIva)) out[COL.totalConIva] = moneyCol(price.totalConIva);
  if (has(COL.margenGobUnit)) out[COL.margenGobUnit] = moneyCol(price.margenGobUnit);
  if (has(COL.margenGobTotal)) out[COL.margenGobTotal] = moneyCol(price.margenGobTotal);
  if (has(COL.diferencia)) out[COL.diferencia] = moneyCol(price.diferencia);
  if (has(COL.utilidad)) out[COL.utilidad] = moneyCol(price.utilidad);
  if (has(COL.utilidadTotal)) out[COL.utilidadTotal] = moneyCol(price.utilidadTotal);
  if (has(COL.utilidadPct)) out[COL.utilidadPct] = pctCol(price.utilidadPct);
  return out;
}
