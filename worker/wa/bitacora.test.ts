// Costo estimado por llamada al modelo (docs/plan-wa-cartera.md §8): la
// bitácora guarda dólares por fila para poder contestar "cuánto gastamos".
import { describe, it, expect } from 'vitest';
import { costoUsd, PRECIO_HAIKU } from './bitacora';

describe('costoUsd', () => {
  it('suma entrada, salida y caché con los precios de Haiku 4.5', () => {
    expect(costoUsd({ input_tokens: 1_000_000 })).toBe(PRECIO_HAIKU.in);
    expect(costoUsd({ output_tokens: 1_000_000 })).toBe(PRECIO_HAIKU.out);
    expect(costoUsd({ cache_read_input_tokens: 1_000_000 })).toBe(PRECIO_HAIKU.cacheRead);
    expect(costoUsd({ input_tokens: 500, cache_read_input_tokens: 5000, output_tokens: 150 })).toBeCloseTo(0.0005 + 0.0005 + 0.00075, 6);
  });
  it('usage vacío o nulo = 0', () => {
    expect(costoUsd({})).toBe(0);
    expect(costoUsd({ input_tokens: null, output_tokens: null })).toBe(0);
  });
});
