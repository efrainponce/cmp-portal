// Umbral ±10% de "Costo Distribuidor" al cambiar de producto (worker/lib/costoDivergencia.ts) —
// lógica de negocio real (el número del umbral), no I/O: cubre el borde exacto.
import { describe, it, expect } from 'vitest';
import { computeDivergencia } from './costoDivergencia';

describe('computeDivergencia', () => {
  it('sin diferencia: no diverge', () => {
    expect(computeDivergencia({ nombre: 'A', costo: 100 }, { nombre: 'B', costo: 100 })).toBeUndefined();
  });

  it('justo en el umbral (10%): NO diverge — el chequeo es estrictamente mayor', () => {
    expect(computeDivergencia({ nombre: 'A', costo: 100 }, { nombre: 'B', costo: 110 })).toBeUndefined();
  });

  it('un centavo arriba del umbral: sí diverge', () => {
    const d = computeDivergencia({ nombre: 'A', costo: 100 }, { nombre: 'B', costo: 110.01 });
    expect(d).toBeDefined();
    expect(d!.pctDiff).toBeCloseTo(0.1001, 4);
  });

  it('diferencia hacia abajo también cuenta (valor absoluto)', () => {
    const d = computeDivergencia({ nombre: 'A', costo: 200 }, { nombre: 'B', costo: 150 });
    expect(d).toBeDefined();
    expect(d!.pctDiff).toBeCloseTo(0.25, 4);
  });

  it('divergencia grande trae los nombres/costos originales en el DTO', () => {
    const d = computeDivergencia({ nombre: 'Camisa dama', costo: 850 }, { nombre: 'Camisa caballero', costo: 1200 });
    expect(d).toEqual({
      productoAnterior: 'Camisa dama', productoNuevo: 'Camisa caballero',
      costoAnterior: 850, costoNuevo: 1200, pctDiff: expect.closeTo(0.4117, 3),
    });
  });
});
