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

const pct = (n: number) => n / 100;

export function cellNumber(product: ItemDTO, colId: string): number {
  const v = product.cols[colId]?.value;
  if (typeof v === 'number') return v;
  const n = parseFloat(product.cols[colId]?.text ?? '');
  return Number.isFinite(n) ? n : 0;
}

export interface CostChain {
  descuento: number;
  costoReal: number;
  costoConvertido: number;
  costoTotalUnit: number;
  costoTotal: number;
}

export function computeCostChain(input: {
  cantidad: number; costoDistr: number; descuentoPct: number;
  conversion: number; gastosPct: number; embellecimiento: number;
}): CostChain {
  const descuento = pct(input.descuentoPct) * input.costoDistr;
  const costoReal = input.costoDistr - descuento;
  const costoConvertido = costoReal * input.conversion;
  const costoTotalUnit = (1 + pct(input.gastosPct)) * costoReal * input.conversion + input.embellecimiento;
  const costoTotal = input.cantidad * costoTotalUnit;
  return { descuento, costoReal, costoConvertido, costoTotalUnit, costoTotal };
}

export interface PriceChain {
  subtotal: number;
  iva: number;
  totalConIva: number;
  margenGobUnit: number;
  margenGobTotal: number;
  diferencia: number;
  utilidad: number;
  utilidadTotal: number;
  utilidadPct: number;
}

export function computePriceChain(input: {
  cantidad: number; precio: number; margenGobPct: number;
  costoTotalUnit: number; ivaPct: number;
}): PriceChain {
  const subtotal = input.precio * input.cantidad;
  const iva = subtotal * pct(input.ivaPct);
  const totalConIva = subtotal * (1 + pct(input.ivaPct));
  const margenGobUnit = pct(input.margenGobPct) * input.precio;
  const margenGobTotal = input.cantidad * margenGobUnit;
  const diferencia = input.precio - margenGobUnit;
  const utilidad = diferencia - input.costoTotalUnit;
  const utilidadTotal = utilidad * input.cantidad;
  const utilidadPct = subtotal > 0 ? Math.round((utilidadTotal / subtotal) * 10000) / 100 : 0;
  return { subtotal, iva, totalConIva, margenGobUnit, margenGobTotal, diferencia, utilidad, utilidadTotal, utilidadPct };
}

const moneyCol = (n: number): ColVal => ({ text: fmtMoney(n), value: n, type: 'formula' });
const pctCol = (n: number): ColVal => ({ text: `${n}%`, value: n, type: 'formula' });

/**
 * Recomputes every derived formula column for one subitem row given the raw
 * inputs the user just edited (merged over the row's current values), and
 * returns only the formula column ids the row already carries — so a role
 * that can't see a column (e.g. vendedor and Margen/Utilidad) never gets a
 * preview value for it either, matching the server whitelist.
 */
export function previewRow(product: ItemDTO, edited: Record<string, number>): Record<string, ColVal> {
  const get = (colId: string) => edited[colId] ?? cellNumber(product, colId);
  const has = (colId: string) => colId in product.cols;

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
