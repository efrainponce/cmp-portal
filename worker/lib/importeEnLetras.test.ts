// Casos generados corriendo cmp-tallas' importe_en_letras real (Python) contra los
// mismos montos — no inventados. Ancla el puerto exacto, rarezas gramaticales
// incluidas ("UN PESOS", no "UN PESO" — así lo dice el documento legal desde
// siempre, no es un bug a corregir aquí).
import { describe, it, expect } from 'vitest';
import { importeEnLetras } from './importeEnLetras';

describe('importeEnLetras', () => {
  const casosMXN: [number, string][] = [
    [0, 'CERO PESOS 00/100 M.N.'],
    [1, 'UN PESOS 00/100 M.N.'],
    [15, 'QUINCE PESOS 00/100 M.N.'],
    [16, 'DIECISEIS PESOS 00/100 M.N.'],
    [20, 'VEINTE PESOS 00/100 M.N.'],
    [21, 'VEINTIUN PESOS 00/100 M.N.'],
    [29, 'VEINTINUEVE PESOS 00/100 M.N.'],
    [30, 'TREINTA PESOS 00/100 M.N.'],
    [45, 'CUARENTA Y CINCO PESOS 00/100 M.N.'],
    [99, 'NOVENTA Y NUEVE PESOS 00/100 M.N.'],
    [100, 'CIEN PESOS 00/100 M.N.'],
    [101, 'CIENTO UN PESOS 00/100 M.N.'],
    [116, 'CIENTO DIECISEIS PESOS 00/100 M.N.'],
    [199, 'CIENTO NOVENTA Y NUEVE PESOS 00/100 M.N.'],
    [200, 'DOSCIENTOS PESOS 00/100 M.N.'],
    [234, 'DOSCIENTOS TREINTA Y CUATRO PESOS 00/100 M.N.'],
    [999, 'NOVECIENTOS NOVENTA Y NUEVE PESOS 00/100 M.N.'],
    [1000, 'MIL PESOS 00/100 M.N.'],
    [1001, 'MIL UN PESOS 00/100 M.N.'],
    [1116, 'MIL CIENTO DIECISEIS PESOS 00/100 M.N.'],
    [21000, 'VEINTIUN MIL PESOS 00/100 M.N.'],
    [100000, 'CIEN MIL PESOS 00/100 M.N.'],
    [999999, 'NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE PESOS 00/100 M.N.'],
    [1000000, 'UN MILLON PESOS 00/100 M.N.'],
    [1234567.5, 'UN MILLON DOSCIENTOS TREINTA Y CUATRO MIL QUINIENTOS SESENTA Y SIETE PESOS 50/100 M.N.'],
    [2000000, 'DOS MILLONES PESOS 00/100 M.N.'],
  ];

  it.each(casosMXN)('%d MXN -> %s', (monto, esperado) => {
    expect(importeEnLetras(monto, 'MXN')).toBe(esperado);
  });

  it('USD: "DOLARES"/"USD" en vez de "PESOS"/"M.N."', () => {
    expect(importeEnLetras(1500.5, 'USD')).toBe('MIL QUINIENTOS DOLARES 50/100 USD');
  });

  it('moneda case-insensitive ("mxn")', () => {
    expect(importeEnLetras(100, 'mxn')).toBe('CIEN PESOS 00/100 M.N.');
  });
});
