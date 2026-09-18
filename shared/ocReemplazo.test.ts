import { describe, expect, it } from 'vitest';
import { esReemplazoDudoso } from './ocReemplazo';

describe('esReemplazoDudoso', () => {
  it('una corrección (montos parecidos) no se pinta', () => {
    expect(esReemplazoDudoso(55193, 55455)).toBe(false); // OC-312 → OC-317
    expect(esReemplazoDudoso(45600, 45600)).toBe(false); // OC-305 → OC-306
  });
  it('montos muy distintos sí: puede ser una orden aparte', () => {
    expect(esReemplazoDudoso(92312.43, 6007.8)).toBe(true);  // OC-100 → OC-109
    expect(esReemplazoDudoso(471467.2, 328500.2)).toBe(true); // OC-17 → OC-31
    expect(esReemplazoDudoso(0, 34060)).toBe(true);           // OC-81 → OC-82
  });
  it('sin monto leído en alguna de las dos, no se pinta', () => {
    expect(esReemplazoDudoso(null, 100)).toBe(false);
    expect(esReemplazoDudoso(100, null)).toBe(false);
  });
});
