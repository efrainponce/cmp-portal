import { describe, expect, it } from 'vitest';
import { etiquetaLinea, notasDeLineas, COMENTARIOS_VENTAS_COL } from './updatesLineas';

const cols = (m: Record<string, string>) => JSON.stringify(Object.entries(m).map(([id, text]) => ({ id, text })));

describe('etiquetaLinea', () => {
  it('Oportunidad: producto en texto + color, no el name numérico', () => {
    expect(etiquetaLinea('oportunidades_sub', { name: '1', columns: cols({ text_mm0bkm1j: 'Botiquín IFAK', text_mm07s2mg: 'Negro' }) }))
      .toBe('Botiquín IFAK · Negro');
  });
  it('sin texto cae al espejo del catálogo, y sin nada al name', () => {
    expect(etiquetaLinea('oportunidades_sub', { name: '1', columns: cols({ lookup_mm0x4kda: 'Kepi' }) })).toBe('Kepi');
    expect(etiquetaLinea('oportunidades_sub', { name: '3', columns: '[]' })).toBe('3');
  });
  it('Proyecto: producto · color · talla', () => {
    expect(etiquetaLinea('proyectos_sub', { name: 'x', columns: cols({ text_mm0hs17x: 'Camisa', text_mm0h4a1c: 'Azul', text_mm1antcb: 'M' }) }))
      .toBe('Camisa · Azul · M');
  });
});

describe('notasDeLineas', () => {
  it('solo líneas con Comentarios Ventas, sin repetir la misma nota del mismo producto', () => {
    const rows = [
      { item_id: 1, name: '1', columns: cols({ text_mm0bkm1j: 'Kepi', [COMENTARIOS_VENTAS_COL]: 'bordado al frente' }) },
      { item_id: 2, name: '2', columns: cols({ text_mm0bkm1j: 'Kepi', [COMENTARIOS_VENTAS_COL]: 'bordado al frente' }) },
      { item_id: 3, name: '3', columns: cols({ text_mm0bkm1j: 'Botas' }) },
      { item_id: 4, name: '4', columns: cols({ text_mm0bkm1j: 'Botas', [COMENTARIOS_VENTAS_COL]: '  ' }) },
    ];
    expect(notasDeLineas(rows)).toEqual([{ id: '1', etiqueta: 'Kepi', texto: 'bordado al frente' }]);
  });
});
