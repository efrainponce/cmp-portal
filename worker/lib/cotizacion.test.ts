// Flujo nativo de "Generar Cotización" (Fase 2, plan "salir de Monday",
// 2026-08-12) — la parte pura: armar líneas desde subitems, totales, y el payload
// de Eledo con/sin precio. Ids de columna verificados contra
// shared/column-meta.gen.ts, mirror 1:1 de cmp-tallas api/generate_cotizacion.py.
import { describe, it, expect } from 'vitest';
import type { MondayCol, MondayItem } from './monday';
import { buildProductLines, computeTotals, buildEledoFile, type ProductLine } from './cotizacion';

const SUB_TIPO = 'lookup_mm07x7e7';
const SUB_AIRTABLE_ID = 'lookup_mm0z4exs';
const SUB_NOMBRE = 'text_mm0bkm1j';
const SUB_MARCA = 'lookup_mm0xn98d';
const SUB_SKU = 'lookup_mkzn7x9a';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_DESCRIPCION = 'lookup_mm0xw8p7';
const SUB_UNIDAD = 'lookup_mm0w4f4v';
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_PRECIO = 'numeric_mkzneg3d';

function col(id: string, text: string | null): MondayCol {
  return { id, type: 'text', text, value: null };
}

function subitem(id: string, name: string, fields: Record<string, string>): MondayItem {
  const cols: MondayCol[] = Object.entries(fields).map(([k, v]) => col(k, v));
  return { id, name, updated_at: '', group: null, parent_item: null, column_values: cols };
}

describe('buildProductLines', () => {
  it('una línea por subitem, NumPartida secuencial', () => {
    const subs = [
      subitem('1', 'Camisa', { [SUB_NOMBRE]: 'Camisa', [SUB_CANTIDAD]: '2', [SUB_PRECIO]: '100' }),
      subitem('2', 'Pantalón', { [SUB_NOMBRE]: 'Pantalón', [SUB_CANTIDAD]: '1', [SUB_PRECIO]: '200' }),
    ];
    const lines = buildProductLines(subs);
    expect(lines).toHaveLength(2);
    expect(lines[0].line.NumPartida).toBe(1);
    expect(lines[1].line.NumPartida).toBe(2);
  });

  it('salta líneas de Tipo "Embellecimiento" (case-insensitive) sin romper la numeración', () => {
    const subs = [
      subitem('1', 'Camisa', { [SUB_NOMBRE]: 'Camisa', [SUB_TIPO]: 'Producto' }),
      subitem('2', 'Bordado', { [SUB_NOMBRE]: 'Bordado', [SUB_TIPO]: 'EMBELLECIMIENTO' }),
      subitem('3', 'Pantalón', { [SUB_NOMBRE]: 'Pantalón', [SUB_TIPO]: 'Producto' }),
    ];
    const lines = buildProductLines(subs);
    expect(lines.map(l => l.line.Nombre)).toEqual(['Camisa', 'Pantalón']);
    expect(lines[1].line.NumPartida).toBe(2); // no hereda el hueco del saltado
  });

  it('trae el airtableId aparte de la línea (para resolver Url después, async)', () => {
    const subs = [subitem('1', 'Camisa', { [SUB_AIRTABLE_ID]: 'recABC123' })];
    const lines = buildProductLines(subs);
    expect(lines[0].airtableId).toBe('recABC123');
    expect(lines[0].line).not.toHaveProperty('airtableId');
  });

  it('lee marca/modelo/color/descripcion/unidad/cantidad (separador de miles se descarta)', () => {
    const subs = [subitem('1', 'x', {
      [SUB_MARCA]: 'ACME', [SUB_SKU]: 'SKU-1', [SUB_COLOR]: 'Azul',
      [SUB_DESCRIPCION]: 'Desc', [SUB_UNIDAD]: 'Pza', [SUB_CANTIDAD]: '1,234',
    })];
    const { line } = buildProductLines(subs)[0];
    expect(line).toMatchObject({ Marca: 'ACME', Modelo: 'SKU-1', Color: 'Azul', Descripcion: 'Desc', Unidad: 'Pza' });
    expect(line.Cantidad).toBe(1234);
  });
});

describe('computeTotals', () => {
  const line = (cantidad: number, precio: number): ProductLine => ({
    NumPartida: 1, Nombre: '', Marca: '', Modelo: '', Color: '', Url: '', Descripcion: '', Unidad: '', Cantidad: cantidad, Precio: precio,
  });

  it('subtotal = Σ(cantidad·precio), IVA 16%, total = subtotal+IVA', () => {
    const { subtotal, iva, total } = computeTotals([line(2, 100), line(1, 50)]);
    expect(subtotal).toBe(250);
    expect(iva).toBeCloseTo(40, 2);
    expect(total).toBeCloseTo(290, 2);
  });

  it('redondea a centavos', () => {
    const { subtotal, iva, total } = computeTotals([line(3, 33.333)]);
    expect(subtotal).toBe(100);
    expect(iva).toBe(16);
    expect(total).toBe(116);
  });

  it('sin líneas: todo en 0', () => {
    expect(computeTotals([])).toEqual({ subtotal: 0, iva: 0, total: 0 });
  });
});

describe('buildEledoFile', () => {
  const products: ProductLine[] = [
    { NumPartida: 1, Nombre: 'Camisa', Marca: 'ACME', Modelo: 'SKU-1', Color: 'Azul', Url: 'http://img', Descripcion: 'd', Unidad: 'Pza', Cantidad: 2, Precio: 100 },
  ];
  const base = {
    folioCotizacion: '0053 - 1', cliente: 'Cliente', cargo: 'Director', institucion: 'Institución X',
    vendedorName: 'Vendedor X', vigencia: '30 días', tiempoEntrega: '15 días', comentarios: 'nota', products,
    subtotal: 200, iva: 32, total: 232,
  };

  it('con precio: conserva Precio en cada línea y llena los totales + TotalPalabras', () => {
    const file = buildEledoFile({ ...base, conPrecio: true }) as { products: ProductLine[]; SubtotalTotal: unknown; TotalPalabras: unknown };
    expect(file.products[0].Precio).toBe(100);
    expect(file.SubtotalTotal).toBe(200);
    expect(file.TotalPalabras).toContain('DOSCIENTOS TREINTA Y DOS');
  });

  it('sin precio: quita Precio de cada línea, conserva Cantidad, totales vacíos', () => {
    const file = buildEledoFile({ ...base, conPrecio: false }) as {
      products: Array<Record<string, unknown>>; SubtotalTotal: unknown; IvaTotal: unknown; TotalTotal: unknown; TotalPalabras: unknown;
    };
    expect(file.products[0]).not.toHaveProperty('Precio');
    expect(file.products[0].Cantidad).toBe(2);
    expect(file.SubtotalTotal).toBe('');
    expect(file.IvaTotal).toBe('');
    expect(file.TotalTotal).toBe('');
    expect(file.TotalPalabras).toBe('');
  });
});
