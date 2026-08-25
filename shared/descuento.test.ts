import { describe, it, expect } from 'vitest';
import { pctToFraccion, fraccionToPct, fraccionNum } from './descuento';

describe('descuento: la UI habla en %, la columna guarda fracción', () => {
  it('lo tecleado se guarda como fracción', () => {
    expect(pctToFraccion('18')).toBe('0.18');
    expect(pctToFraccion('10')).toBe('0.1');
    expect(pctToFraccion('7.5')).toBe('0.075');
    expect(pctToFraccion('0')).toBe('0');
    expect(pctToFraccion('100')).toBe('1');
  });

  it('lo guardado se muestra en % sin basura de coma flotante', () => {
    // 0.18 * 100 = 18.000000000000004 sin el redondeo.
    expect(fraccionToPct('0.18')).toBe('18');
    expect(fraccionToPct('0.07')).toBe('7');
    expect(fraccionToPct('0.075')).toBe('7.5');
    expect(fraccionToPct('0')).toBe('0');
  });

  it('ida y vuelta no mueve el valor', () => {
    for (const pct of ['0', '5', '7.5', '18', '33.33', '100']) {
      expect(fraccionToPct(pctToFraccion(pct))).toBe(pct === '33.33' ? '33.33' : pct);
    }
  });

  it('vacío y basura no ensucian la celda', () => {
    expect(pctToFraccion('')).toBe('');
    expect(pctToFraccion(undefined)).toBe('');
    expect(pctToFraccion('   ')).toBe('');
    expect(pctToFraccion('abc')).toBe('');
    expect(fraccionToPct('')).toBe('');
    expect(fraccionToPct(undefined)).toBe('');
  });

  it('un descuento mal capturado se VE, no se corrige solo', () => {
    // Un "10" crudo que quedó en la columna antes del fix significa 1000% —
    // el PDF ya calculaba (1 - 10) y hay que verlo para corregirlo a mano.
    expect(fraccionToPct('10')).toBe('1000');
  });

  it('fraccionNum sirve para el importe', () => {
    expect(fraccionNum('0.18')).toBeCloseTo(0.18);
    expect(fraccionNum('1,000')).toBe(1000);
    expect(fraccionNum(undefined)).toBe(0);
    expect(fraccionNum('abc')).toBe(0);
  });
});
