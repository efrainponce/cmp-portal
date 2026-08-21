// Los totales por línea son la fuente de las métricas que la lista pinta por
// oportunidad: si aquí se cuela un cero, el board enseña una cotización en $0
// sin que nada falle. Estos casos anclan las dos rutas — la fórmula que Monday
// ya calculó y el respaldo local para una línea nativa.
import { describe, it, expect } from 'vitest';
import { totalesDeLinea } from './lineaTotales';
import type { RawColumn } from './canon';

const col = (id: string, text: string | null, value: string | null = null): RawColumn =>
  ({ id, type: 'formula', text, value });

describe('totalesDeLinea', () => {
  it('usa las fórmulas de Monday cuando la línea las trae', () => {
    // Valores reales de una línea del mirror (board 18395657607).
    const t = totalesDeLinea([
      col('formula_mkznrm5a', '11938.5'),
      col('formula_mkznmjh6', '14070'),
      col('formula_mm00xy0n', '16321.2'),
      col('formula_mkznry25', '2131.5'),
      col('formula_mkznsb7m', '0'),
      col('numeric_mkzm6399', '42', '"42"'),
    ]);
    expect(t).toEqual({ costo: 11938.5, subtotal: 14070, total: 16321.2, utilidad: 2131.5, margenGob: 0 });
  });

  it('aguanta el formato con comas que a veces manda Monday', () => {
    const t = totalesDeLinea([col('formula_mkznmjh6', '1,932,000')]);
    expect(t.subtotal).toBe(1932000);
  });

  it('reconstruye los totales de una línea NATIVA (sin fórmulas)', () => {
    // Zona Efrain: la línea no existe en Monday, así que nadie calculó nada.
    // 10 piezas, costo 100 con 10% de descuento, 5% de gastos, precio 200,
    // margen gob 5%, IVA 16%.
    const t = totalesDeLinea([
      col('numeric_mkzm6399', '10'),
      col('numeric_mm0bph99', '100'),
      col('numeric_mkzn2q51', '10'),
      col('numeric_mm0rvhgs', '1'),
      col('numeric_mkzngs9x', '5'),
      col('numeric_mm0gxvpa', '0'),
      col('numeric_mkzneg3d', '200'),
      col('numeric_mkznnm5s', '5'),
      col('numeric_mm0cg0bm', '16'),
    ]);
    expect(t.subtotal).toBe(2000);
    expect(t.total).toBe(2320);
    expect(t.costo).toBeCloseTo(945, 6);        // 90 * 1.05 * 10
    expect(t.margenGob).toBe(100);              // 5% de 200, por 10
    expect(t.utilidad).toBeCloseTo(955, 6);     // (200 - 10 - 94.5) * 10
  });

  it('una línea vacía da ceros, nunca NaN', () => {
    const t = totalesDeLinea([col('text_mm0bkm1j', 'Solo el nombre')]);
    expect(t).toEqual({ costo: 0, subtotal: 0, total: 0, utilidad: 0, margenGob: 0 });
  });
});
