// El partidor de tandas de la captura de tallas (shared/dto.ts). Existe porque
// partir mal no truena: se guardarían menos tallas de las capturadas y el hueco
// aparecería hasta la OC del proveedor.
import { describe, it, expect } from 'vitest';
import { enTandas, MAX_TALLAS_POR_REQUEST } from './dto';

const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('enTandas', () => {
  it('no pierde ni reordena renglones', () => {
    const rows = seq(250);
    const tandas = enTandas(rows, 100);
    expect(tandas.flat()).toEqual(rows);
  });

  it('respeta el tope de cada tanda', () => {
    const tandas = enTandas(seq(250), 100);
    expect(tandas.map(t => t.length)).toEqual([100, 100, 50]);
  });

  it('una captura que cabe en una sola llamada se manda entera', () => {
    expect(enTandas(seq(MAX_TALLAS_POR_REQUEST)).length).toBe(1);
    expect(enTandas(seq(MAX_TALLAS_POR_REQUEST + 1)).length).toBe(2);
  });

  it('sin renglones no manda nada', () => {
    expect(enTandas([])).toEqual([]);
  });

  it('rechaza un tamaño inválido en vez de colgarse en un loop infinito', () => {
    expect(() => enTandas(seq(3), 0)).toThrow();
  });
});
