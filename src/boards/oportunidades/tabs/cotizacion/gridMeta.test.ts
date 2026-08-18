// Ancla la grid de la Zona Efrain: es Costeo + Validación en una sola pantalla
// (Efraín, 2026-08-18). Si alguien vuelve a esconder el precio o el
// embellecimiento ahí, o le quita una columna de costo, estos tests truenan.
import { describe, it, expect } from 'vitest';
import { COL } from '../../../../lib/costeoCalc';
import {
  inlineEditableCols, GRID_COLS_ZONA, GRID_COLS_COSTEO, GRID_COLS_VENTA, EMB_STATUS_COL,
} from './gridMeta';

const CANTIDAD = 'numeric_mkzm6399';

describe('inlineEditableCols', () => {
  it('no deja tocar el precio en el pipeline normal', () => {
    expect(inlineEditableCols(true).has(COL.precio)).toBe(false);
    expect(inlineEditableCols(false).has(COL.precio)).toBe(false);
  });

  it('abre el precio solo cuando se le pide (Zona Efrain)', () => {
    expect(inlineEditableCols(true, true).has(COL.precio)).toBe(true);
    // ...sin desbloquear de paso la edición de líneas: son ejes independientes.
    expect(inlineEditableCols(false, true).has(CANTIDAD)).toBe(false);
    expect(inlineEditableCols(false, true).has(COL.precio)).toBe(true);
  });

  it('mantiene los costos editables en ambos modos', () => {
    for (const cols of [inlineEditableCols(true), inlineEditableCols(true, true)]) {
      expect(cols.has(COL.costoDistr)).toBe(true);
      expect(cols.has(COL.gastosPct)).toBe(true);
    }
  });
});

describe('GRID_COLS_ZONA', () => {
  it('trae todas las columnas de Costeo', () => {
    const zona = new Set(GRID_COLS_ZONA.map((c) => c.id));
    for (const c of GRID_COLS_COSTEO) expect(zona.has(c.id)).toBe(true);
  });

  it('agrega "Con Embellecimiento" (que Costeo no pinta) justo después de Cantidad', () => {
    expect(GRID_COLS_COSTEO.some((c) => c.id === EMB_STATUS_COL)).toBe(false);
    expect(GRID_COLS_VENTA.some((c) => c.id === EMB_STATUS_COL)).toBe(true);
    const cant = GRID_COLS_ZONA.findIndex((c) => c.id === CANTIDAD);
    expect(GRID_COLS_ZONA[cant + 1].id).toBe(EMB_STATUS_COL);
  });

  it('incluye Precio de Venta (numeric_mkzneg3d)', () => {
    expect(GRID_COLS_ZONA.some((c) => c.id === COL.precio)).toBe(true);
  });
});
