// Replay del log de ajustes virtuales del Proyecto (worker/lib/proyectoCotizacionVirtual.ts)
// sobre las líneas reales base — la parte de negocio real (el merge), sin D1.
import { describe, it, expect } from 'vitest';
import type { QuoteLineSnapshot } from '../../shared/dto';
import { applyAjustesVirtuales } from './proyectoCotizacionVirtual';

function linea(over: Partial<QuoteLineSnapshot> = {}): QuoteLineSnapshot {
  return {
    subitemId: 1001, productoItemId: 5001, producto: 'Camisa Taclite dama',
    sku: '62070ABR', color: 'Azul', cantidad: 20, embellecimiento: false,
    precioUnitario: 850,
    ...over,
  };
}

describe('applyAjustesVirtuales', () => {
  it('sin ajustes: devuelve la base tal cual (cero staleness)', () => {
    const base = [linea()];
    expect(applyAjustesVirtuales(base, [])).toEqual(base);
  });

  it("'editar': cambia solo los campos que trae el ajuste", () => {
    const base = [linea()];
    const rows = [{
      id: 1, linea_id: 1001, linea_origen_id: null, modo: 'editar', subversion: 1,
      campos: JSON.stringify({ cantidad: 20, color: 'Verde' }),
      resumen: '', viewer_email: 'v@x.com', created_at: '',
    }];
    const result = applyAjustesVirtuales(base, rows);
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe('Verde');
    expect(result[0].producto).toBe('Camisa Taclite dama'); // sin tocar
  });

  it("'dividir': resta de la línea origen y crea una línea virtual con id negativo", () => {
    const base = [linea({ cantidad: 20 })];
    const rows = [{
      id: 7, linea_id: -7, linea_origen_id: 1001, modo: 'dividir', subversion: 1,
      campos: JSON.stringify({ cantidad: 8, color: 'Rojo' }),
      resumen: '', viewer_email: 'v@x.com', created_at: '',
    }];
    const result = applyAjustesVirtuales(base, rows);
    const origen = result.find((l) => l.subitemId === 1001)!;
    const nueva = result.find((l) => l.subitemId === -7)!;
    expect(origen.cantidad).toBe(12);
    expect(nueva).toBeDefined();
    expect(nueva.cantidad).toBe(8);
    expect(nueva.color).toBe('Rojo');
    expect(nueva.producto).toBe('Camisa Taclite dama'); // heredado de la línea origen
    expect(nueva.precioUnitario).toBe(850); // precio nunca se toca, siempre heredado
  });

  it("dividir una línea que YA es virtual (cadena de divisiones)", () => {
    const base = [linea({ cantidad: 20 })];
    const rows = [
      {
        id: 1, linea_id: -1, linea_origen_id: 1001, modo: 'dividir', subversion: 1,
        campos: JSON.stringify({ cantidad: 12, color: 'Rojo' }),
        resumen: '', viewer_email: 'v@x.com', created_at: '',
      },
      // Divide la línea virtual recién creada (-1), no la real.
      {
        id: 2, linea_id: -2, linea_origen_id: -1, modo: 'dividir', subversion: 2,
        campos: JSON.stringify({ cantidad: 5, color: 'Verde' }),
        resumen: '', viewer_email: 'v@x.com', created_at: '',
      },
    ];
    const result = applyAjustesVirtuales(base, rows);
    const origenReal = result.find((l) => l.subitemId === 1001)!;
    const virtual1 = result.find((l) => l.subitemId === -1)!;
    const virtual2 = result.find((l) => l.subitemId === -2)!;
    expect(origenReal.cantidad).toBe(8); // 20 - 12
    expect(virtual1.cantidad).toBe(7);   // 12 - 5
    expect(virtual2.cantidad).toBe(5);
    expect(virtual2.color).toBe('Verde');
  });

  it('línea consumida a 0 desaparece de la vista', () => {
    const base = [linea({ cantidad: 5 })];
    const rows = [{
      id: 1, linea_id: -1, linea_origen_id: 1001, modo: 'dividir', subversion: 1,
      campos: JSON.stringify({ cantidad: 5 }),
      resumen: '', viewer_email: 'v@x.com', created_at: '',
    }];
    const result = applyAjustesVirtuales(base, rows);
    expect(result.find((l) => l.subitemId === 1001)).toBeUndefined();
    expect(result.find((l) => l.subitemId === -1)?.cantidad).toBe(5);
  });

  it('ajuste huérfano (línea origen ya no existe) se ignora sin lanzar', () => {
    const base = [linea()];
    const rows = [{
      id: 1, linea_id: -1, linea_origen_id: 9999, modo: 'dividir', subversion: 1,
      campos: JSON.stringify({ cantidad: 1 }),
      resumen: '', viewer_email: 'v@x.com', created_at: '',
    }];
    expect(() => applyAjustesVirtuales(base, rows)).not.toThrow();
    expect(applyAjustesVirtuales(base, rows)).toEqual(base);
  });
});
