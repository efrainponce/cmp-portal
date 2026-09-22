import { describe, it, expect } from 'vitest';
import { llaveFotoOc } from './ocFotoLlave';

describe('llaveFotoOc', () => {
  it('con SKU, el SKU manda', () => {
    expect(llaveFotoOc(' 74434 ', 'Pantalón táctico')).toBe('74434');
  });

  // 2026-09-21: una línea manual sin SKU no aparecía en la tira de fotos.
  it('sin SKU, la llave es el nombre del producto', () => {
    expect(llaveFotoOc('', ' BORDADO DIRECTO EN LA ESPALDA ')).toBe('BORDADO DIRECTO EN LA ESPALDA');
    expect(llaveFotoOc(undefined, null)).toBe('');
  });
});
