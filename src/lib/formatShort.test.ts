// El dinero abreviado de la lista (Efraín, 2026-08-20: "$500K para facilitar
// la lectura"). Solo se usa para leer de reojo — la cotización y los PDFs
// siguen con fmtMoney, que no redondea.
import { describe, it, expect } from 'vitest';
import { fmtMoneyShort, marginColor } from './format';

describe('fmtMoneyShort', () => {
  it('abrevia miles y millones', () => {
    expect(fmtMoneyShort(500_000)).toBe('$500K');
    expect(fmtMoneyShort(1_302_519.3)).toBe('$1.3M');
    expect(fmtMoneyShort(15_718.5)).toBe('$15.7K');
    expect(fmtMoneyShort(2_241_120)).toBe('$2.2M');
  });

  it('deja los montos chicos completos y no inventa decimales', () => {
    expect(fmtMoneyShort(718)).toBe('$718');
    expect(fmtMoneyShort(0)).toBe('$0');
    expect(fmtMoneyShort(2_000_000)).toBe('$2M');
  });

  it('conserva el signo de una utilidad negativa', () => {
    expect(fmtMoneyShort(-1_250_000)).toBe('-$1.3M');
    expect(fmtMoneyShort(-450)).toBe('-$450');
  });
});

describe('marginColor', () => {
  it('rojo si se pierde, ámbar abajo de 20, verde arriba', () => {
    expect(marginColor(-3)).toBe('#ce3048');
    expect(marginColor(15)).toBe('#e99729');
    expect(marginColor(24.07)).toBe('#00b461');
  });
});
