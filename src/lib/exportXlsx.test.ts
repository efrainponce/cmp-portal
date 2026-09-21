import { describe, it, expect } from 'vitest';
import { columnasDeCifras, columnasDeItems, hojaDe, nombreExport, valorDeCelda } from './exportXlsx';
import { escribirXlsx } from '../../shared/xlsxWrite';
import type { ColMeta, ItemDTO } from '../../shared/dto';

const item = (name: string, cols: ItemDTO['cols']): ItemDTO => ({ id: name, name, syncedAt: '', mondayUpdatedAt: null, cols });

const PRECIO: ColMeta = { id: 'n1', title: 'Precio de venta', type: 'numbers' };
const PIEZAS: ColMeta = { id: 'n2', title: 'Piezas', type: 'numbers' };
const FECHA: ColMeta = { id: 'd1', title: 'Entrega', type: 'date' };

describe('valorDeCelda', () => {
  it('numbers sale como número: del value parseado o del texto con comas', () => {
    expect(valorDeCelda(PIEZAS, { text: '1,250', value: '1250', type: 'numbers' })).toBe(1250);
    expect(valorDeCelda(PIEZAS, { text: '1,250.5', type: 'numbers' })).toBe(1250.5);
    expect(valorDeCelda(PIEZAS, { text: '0', value: 0, type: 'numbers' })).toBe(0);
  });
  it('vacío es celda vacía (no 0) y lo que no es número se queda en texto', () => {
    expect(valorDeCelda(PIEZAS, { text: '', type: 'numbers' })).toBeNull();
    expect(valorDeCelda(PIEZAS, undefined)).toBeNull();
    expect(valorDeCelda(PIEZAS, { text: 'N/A', type: 'numbers' })).toBe('N/A');
    expect(valorDeCelda(FECHA, { text: '2026-09-21', type: 'date' })).toBe('2026-09-21');
  });
});

describe('hojaDe', () => {
  it('Nombre va primero, solo las columnas que se le pasan, y el dinero con formato', () => {
    const items = [
      item('OPP-1 - Conos', { n1: { text: '1500', value: '1500', type: 'numbers' }, n2: { text: '3', value: '3', type: 'numbers' }, secreto: { text: 'no', type: 'text' } }),
      item('OPP-2', { d1: { text: '2026-10-01', type: 'date' } }),
    ];
    const { filas, anchos } = hojaDe(columnasDeItems([PRECIO, PIEZAS, FECHA, { id: 'b', title: 'Botón', type: 'button' }]), items);
    expect(filas[0]).toEqual(['Nombre', 'Precio de venta', 'Piezas', 'Entrega'].map(v => ({ v, estilo: 'titulo' })));
    expect(filas[1]).toEqual(['OPP-1 - Conos', { v: 1500, estilo: 'moneda' }, 3, null]);
    expect(filas[2]).toEqual(['OPP-2', null, null, '2026-10-01']);
    expect(anchos).toHaveLength(4);
    // Y lo acepta el escritor tal cual.
    expect(escribirXlsx([{ nombre: 'Lista', filas, anchos }])[0]).toBe(0x50);
  });

  it('cifras aparte de cols: ausente = vacía, el porcentaje sin formato de moneda', () => {
    const totales: Record<string, { subtotal?: number; utilidadPct?: number }> = { a: { subtotal: 100, utilidadPct: 12.5 } };
    const cols = columnasDeCifras(
      [{ key: 'subtotal', titulo: 'Subtotal' }, { key: 'utilidadPct', titulo: 'Utilidad %' }] as const,
      (id: string, key) => totales[id]?.[key],
    );
    const { filas } = hojaDe(cols, ['a', 'b']);
    expect(filas[1]).toEqual([{ v: 100, estilo: 'moneda' }, 12.5]);
    expect(filas[2]).toEqual([null, null]);
  });
});

describe('nombreExport', () => {
  it('<título>-<fecha local>.xlsx, sin caracteres ilegales', () => {
    expect(nombreExport('Documentación / Tallas', new Date(2026, 8, 1, 23, 30))).toBe('Documentación Tallas-2026-09-01.xlsx');
  });
});
