// Moneda por línea (Efraín, 2026-07-30): la columna que se ve en Costeo dejó de
// ser el mirror del catálogo (no escribible) y pasó a ser `color_mm5s709s`, con
// el mirror como herencia. Estas dos reglas —de dónde sale la moneda mostrada y
// cuándo la línea grita por el tipo de cambio— son lógica pura; el typecheck no
// las cubre (todo son strings de columnas de Monday).
import { describe, it, expect } from 'vitest';
import type { ColVal, ItemDTO } from '../../../../lib/api';
import { monedaDe, getLineWarnings, MONEDA_COL, MONEDA_MIRROR_COL, EMPTY_ROW } from './gridMeta';
import { COL } from '../../../../lib/costeoCalc';

const linea = (cols: Record<string, ColVal>): ItemDTO => ({
  id: '1', name: 'línea', cols: {
    // Mínimo para que los otros warnings de Costeo no ensucien el caso: producto
    // con relación al catálogo y cantidad > 0.
    lookup_mm0x4kda: { text: 'Bota 5.11', type: 'mirror' },
    board_relation_mkzmafgp: { text: '', type: 'board_relation', value: { linked_item_ids: [99] } },
    numeric_mkzm6399: { text: '30', type: 'numbers', value: 30 },
    numeric_mm0bph99: { text: '100', type: 'numbers', value: 100 },
    ...cols,
  },
} as unknown as ItemDTO);

// Producto de catálogo ya confirmado por Compras — si no, todas las líneas
// arrastran "Sin confirmar" y el caso a probar se pierde entre avisos.
const catalogo = [{ id: '99', name: 'Bota 5.11', cols: { boolean_mm5cqtjs: { text: 'v', type: 'checkbox' } } }] as unknown as ItemDTO[];

describe('monedaDe', () => {
  it('la moneda de la línea gana sobre la del catálogo', () => {
    const row = linea({
      [MONEDA_COL]: { text: 'USD', type: 'status' },
      [MONEDA_MIRROR_COL]: { text: 'MXN', type: 'mirror' },
    });
    expect(monedaDe(row)).toEqual({ label: 'USD', heredada: false });
  });

  it('sin moneda propia se hereda la del catálogo', () => {
    const row = linea({ [MONEDA_MIRROR_COL]: { text: 'EUR', type: 'mirror' } });
    expect(monedaDe(row)).toEqual({ label: 'EUR', heredada: true });
  });

  it('el preview local gana sobre lo guardado (aún no llegó el echo de Monday)', () => {
    const row = linea({ [MONEDA_COL]: { text: 'MXN', type: 'status' } });
    expect(monedaDe(row, { [MONEDA_COL]: { text: 'USD', type: 'status' } }).label).toBe('USD');
  });
});

describe('aviso "Falta conversión"', () => {
  const warn = (cols: Record<string, ColVal>) => getLineWarnings(linea(cols), EMPTY_ROW, 'costeo', catalogo);

  it('avisa cuando la moneda no es MXN y la conversión sigue en 1', () => {
    expect(warn({
      [MONEDA_COL]: { text: 'USD', type: 'status' },
      [COL.conversion]: { text: '1', type: 'numbers', value: 1 },
    })).toContain('Falta conversión');
  });

  it('no avisa con el tipo de cambio capturado', () => {
    expect(warn({
      [MONEDA_COL]: { text: 'USD', type: 'status' },
      [COL.conversion]: { text: '19', type: 'numbers', value: 19 },
    })).not.toContain('Falta conversión');
  });

  it('no avisa en pesos, que es justo cuando la conversión vale 1', () => {
    expect(warn({
      [MONEDA_COL]: { text: 'MXN', type: 'status' },
      [COL.conversion]: { text: '1', type: 'numbers', value: 1 },
    })).not.toContain('Falta conversión');
  });

  it('la moneda heredada del catálogo también dispara el aviso', () => {
    // El caso real de las líneas viejas: nadie eligió moneda en la línea, pero
    // el producto del catálogo se compra en dólares.
    expect(warn({
      [MONEDA_MIRROR_COL]: { text: 'USD', type: 'mirror' },
      [COL.conversion]: { text: '1', type: 'numbers', value: 1 },
    })).toContain('Falta conversión');
  });

  it('sin moneda por ningún lado no inventa avisos', () => {
    expect(warn({ [COL.conversion]: { text: '1', type: 'numbers', value: 1 } })).not.toContain('Falta conversión');
  });
});
