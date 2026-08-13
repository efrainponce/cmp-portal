// Rotulado de ajusteLabel sobre las líneas reales de la Cotización del
// Proyecto (worker/lib/proyectoCotizacionVirtual.ts) — la parte de negocio
// real (qué línea se pinta 'Editada'/'Dividida'), sin D1.
import { describe, it, expect } from 'vitest';
import type { AjusteDTO, QuoteLineSnapshot } from '../../shared/dto';
import { labelLines } from './proyectoCotizacionVirtual';

function linea(over: Partial<QuoteLineSnapshot> = {}): QuoteLineSnapshot {
  return {
    subitemId: 1001, productoItemId: 5001, producto: 'Camisa Taclite dama',
    sku: '62070ABR', color: 'Azul', cantidad: 20, embellecimiento: false,
    precioUnitario: 850,
    ...over,
  };
}

function ajuste(over: Partial<AjusteDTO> = {}): AjusteDTO {
  return { subversion: 1, resumen: '', viewerEmail: 'v@x.com', createdAt: '', lineaId: 1001, ...over };
}

describe('labelLines', () => {
  it('sin ajustes: no rotula nada', () => {
    const lines = [linea()];
    expect(labelLines(lines, [])).toEqual(lines);
  });

  it("'editar' (sin lineaOrigenId): rotula la línea como 'Editada'", () => {
    const result = labelLines([linea()], [ajuste({ lineaId: 1001 })]);
    expect(result[0].ajusteLabel).toBe('Editada');
  });

  it("'dividir' (con lineaOrigenId): rotula origen Y línea nueva como 'Dividida'", () => {
    const lines = [linea({ subitemId: 1001 }), linea({ subitemId: 2002, cantidad: 8 })];
    const result = labelLines(lines, [ajuste({ lineaId: 2002, lineaOrigenId: 1001 })]);
    expect(result.find(l => l.subitemId === 1001)?.ajusteLabel).toBe('Dividida');
    expect(result.find(l => l.subitemId === 2002)?.ajusteLabel).toBe('Dividida');
  });

  it("'Dividida' tiene prioridad sobre un 'editar' posterior de la misma línea", () => {
    const result = labelLines([linea()], [
      ajuste({ lineaId: 1001, lineaOrigenId: 9999, subversion: 1 }),
      ajuste({ lineaId: 1001, subversion: 2 }),
    ]);
    expect(result[0].ajusteLabel).toBe('Dividida');
  });

  it('línea sin ajuste no se toca', () => {
    const lines = [linea({ subitemId: 1001 }), linea({ subitemId: 2002 })];
    const result = labelLines(lines, [ajuste({ lineaId: 1001 })]);
    expect(result.find(l => l.subitemId === 2002)?.ajusteLabel).toBeUndefined();
  });
});
