// Ancla la grid de la Zona Efrain: es Costeo + Validación en una sola pantalla
// (Efraín, 2026-08-18). Si alguien vuelve a esconder el precio o el
// embellecimiento ahí, o le quita una columna de costo, estos tests truenan.
import { describe, it, expect } from 'vitest';
import type { ColVal, ItemDTO } from '../../../../lib/api';
import { COL } from '../../../../lib/costeoCalc';
import {
  inlineEditableCols, GRID_COLS_ZONA, GRID_COLS_COSTEO, GRID_COLS_VENTA, EMB_STATUS_COL,
  COLOR_COL, PRODUCTO_COL, getLineWarnings, EMPTY_ROW,
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

  it('Compras/admin: color y cantidad aunque el board sea de solo lectura (Efraín, 2026-08-19)', () => {
    const compras = inlineEditableCols(false, false, true);
    expect(compras.has(COLOR_COL)).toBe(true);
    expect(compras.has(CANTIDAD)).toBe(true);
    // ...sin abrirle producto ni embellecimiento (eso es de Ventas), ni el precio.
    expect(compras.has(PRODUCTO_COL)).toBe(false);
    expect(compras.has(EMB_STATUS_COL)).toBe(false);
    expect(compras.has(COL.precio)).toBe(false);
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

// El aviso de la línea sin costo: "Pendiente de costeo" solo cuando de verdad
// falta costear. Si el CATÁLOGO nunca tuvo costo, el arreglo está en Airtable
// (el portal no escribe esa columna) — Efraín, 2026-08-19.
describe('aviso de costo faltante', () => {
  const CATALOGO_COSTO = 'numeric_mkzpx7eb';
  const linea = (productoId: number | null): ItemDTO => ({
    id: '1', name: 'línea', cols: {
      lookup_mm0x4kda: { text: 'Bota 5.11', type: 'mirror' },
      numeric_mkzm6399: { text: '30', type: 'numbers', value: 30 },
      ...(productoId == null
        ? {}
        : { board_relation_mkzmafgp: { text: '', type: 'board_relation', value: { linked_item_ids: [productoId] } } }),
    },
  } as unknown as ItemDTO);
  const producto = (cols: Record<string, ColVal>): ItemDTO[] =>
    [{ id: '99', name: 'Bota 5.11', cols: { boolean_mm5cqtjs: { text: 'v', type: 'checkbox' }, ...cols } }] as unknown as ItemDTO[];
  const warn = (row: ItemDTO, catalog: ItemDTO[]) => getLineWarnings(row, EMPTY_ROW, 'costeo', catalog);

  it('sin costo en el catálogo: manda a Airtable', () => {
    expect(warn(linea(99), producto({ [CATALOGO_COSTO]: { text: '', type: 'numbers' } })))
      .toContain('Falta costo en Airtable');
  });

  it('con costo en el catálogo sigue siendo "Pendiente de costeo"', () => {
    const avisos = warn(linea(99), producto({ [CATALOGO_COSTO]: { text: '1530', type: 'numbers', value: 1530 } }));
    expect(avisos).toContain('Pendiente de costeo');
    expect(avisos).not.toContain('Falta costo en Airtable');
  });

  it('si no se puede saber (rol sin esa columna, o sin producto ligado) no afirma nada', () => {
    expect(warn(linea(99), producto({}))).toContain('Pendiente de costeo');
    expect(warn(linea(null), producto({}))).toContain('Pendiente de costeo');
  });
});
