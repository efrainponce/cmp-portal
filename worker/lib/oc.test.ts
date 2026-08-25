// Flujo nativo de "Generar OC" (Fase 4, plan "salir de Monday", 2026-08-12) —
// la parte pura: agrupar subitems por proveedor, totales, payload de Eledo.
// Ids de columna verificados contra shared/column-meta.gen.ts, mirror 1:1 de
// cmp-tallas api/generate_oc.py.
import { describe, it, expect } from 'vitest';
import type { MondayCol, MondayItem } from './monday';
import { groupSubitemsByProveedor, groupTotals, buildEledoOcFile, type ProveedorGroup, nombreArchivoOc } from './oc';

const SUB_PRODUCTO = 'text_mm0hs17x';
const SUB_MONEDA = 'text_mm1gdsvg';
const SUB_PRECIO = 'numeric_mm1dj4fp';
const SUB_CANTIDAD = 'numeric_mm0hj2q4';
const SUB_DESCUENTO = 'numeric_mm1dmsaz';
const SUB_PROVEEDOR_REL = 'board_relation_mm1cfgv5';

function col(id: string, text: string | null, value: string | null = null): MondayCol {
  return { id, type: 'text', text, value };
}

function subitemConProveedor(id: string, proveedorId: string, fields: Record<string, string>): MondayItem {
  const cols: MondayCol[] = [
    col(SUB_PROVEEDOR_REL, 'Proveedor', JSON.stringify({ linked_item_ids: [proveedorId] })),
    ...Object.entries(fields).map(([k, v]) => col(k, v)),
  ];
  return { id, name: id, updated_at: '', group: null, parent_item: null, column_values: cols };
}

describe('groupSubitemsByProveedor', () => {
  it('agrupa por el primer proveedor ligado; sin proveedor se salta', () => {
    const subs: MondayItem[] = [
      subitemConProveedor('1', '100', { [SUB_PRODUCTO]: 'Camisa', [SUB_CANTIDAD]: '2', [SUB_PRECIO]: '50' }),
      subitemConProveedor('2', '100', { [SUB_PRODUCTO]: 'Pantalón', [SUB_CANTIDAD]: '1', [SUB_PRECIO]: '80' }),
      subitemConProveedor('3', '200', { [SUB_PRODUCTO]: 'Botas', [SUB_CANTIDAD]: '1', [SUB_PRECIO]: '300' }),
      { id: '4', name: 'sin-proveedor', updated_at: '', group: null, parent_item: null, column_values: [col(SUB_PRODUCTO, 'Suelto')] },
    ];
    const groups = groupSubitemsByProveedor(subs);
    expect(groups.size).toBe(2);
    expect(groups.get('100')!.lines).toHaveLength(2);
    expect(groups.get('200')!.lines).toHaveLength(1);
  });

  it('onlyProveedor filtra a un solo grupo', () => {
    const subs: MondayItem[] = [
      subitemConProveedor('1', '100', { [SUB_PRODUCTO]: 'Camisa' }),
      subitemConProveedor('2', '200', { [SUB_PRODUCTO]: 'Botas' }),
    ];
    const groups = groupSubitemsByProveedor(subs, '200');
    expect([...groups.keys()]).toEqual(['200']);
  });

  it('Subtotal = cantidad·precio·(1-descuento), moneda default MXN', () => {
    const subs: MondayItem[] = [
      subitemConProveedor('1', '100', { [SUB_PRODUCTO]: 'Camisa', [SUB_CANTIDAD]: '10', [SUB_PRECIO]: '20', [SUB_DESCUENTO]: '0.1' }),
    ];
    const line = groupSubitemsByProveedor(subs).get('100')!.lines[0];
    // 10 * 20 * 0.9 = 180
    expect(line.Subtotal).toBeCloseTo(180, 2);
    expect(line.descuento).toBe('10%');
    expect(line.Moneda).toBe('MXN');
  });

  it('sin descuento: "0%" y Subtotal = cantidad·precio', () => {
    const subs: MondayItem[] = [
      subitemConProveedor('1', '100', { [SUB_PRODUCTO]: 'Camisa', [SUB_CANTIDAD]: '3', [SUB_PRECIO]: '10', [SUB_MONEDA]: 'USD' }),
    ];
    const line = groupSubitemsByProveedor(subs).get('100')!.lines[0];
    expect(line.Subtotal).toBe(30);
    expect(line.descuento).toBe('0%');
    expect(line.Moneda).toBe('USD');
  });
});

describe('groupTotals', () => {
  it('monto = Σ Subtotal, moneda de la primera línea', () => {
    const group: ProveedorGroup = {
      proveedorId: '1', proveedorNombre: 'ACME', proveedorRZ: 'ACME SA',
      lines: [
        { Producto: 'a', SKU: '', Color: '', Talla: '', Unidad: '', Moneda: 'USD', Precio: 10, Cantidad: 2, descuento: '0%', Subtotal: 20 },
        { Producto: 'b', SKU: '', Color: '', Talla: '', Unidad: '', Moneda: 'USD', Precio: 5, Cantidad: 1, descuento: '0%', Subtotal: 5 },
      ],
    };
    expect(groupTotals(group)).toEqual({ monto: 25, moneda: 'USD' });
  });

  it('sin líneas: 0 y MXN por default', () => {
    expect(groupTotals({ proveedorId: '1', proveedorNombre: '', proveedorRZ: '', lines: [] })).toEqual({ monto: 0, moneda: 'MXN' });
  });
});

describe('buildEledoOcFile', () => {
  it('importe_en_letras se calcula sobre monto+IVA(16%), no sobre el subtotal', () => {
    const file = buildEledoOcFile({
      folioOrden: 'OC-1', folioProyecto: 'PRO-1', folioOpp: 'OPP-1', nombreProyecto: 'X', nombreCompras: 'Y',
      proveedorNombre: 'ACME', proveedorRZ: 'ACME SA', comentarios: '', metodoPago: 'Transferencia', condPago: '50/50',
      signers: { elaborado: { name: 'A', email: 'a@x.com' }, revisado: { name: 'B', email: 'b@x.com' }, autorizado: { name: 'C', email: 'c@x.com' } },
      products: [], monto: 100, moneda: 'MXN',
    }) as { importe_en_letras: string; NombreElaborado: string; NombreRevisado: string; NombreAutorizado: string };
    // 100 * 1.16 = 116 -> "CIENTO DIECISEIS PESOS 00/100 M.N." (ver worker/lib/importeEnLetras.test.ts)
    expect(file.importe_en_letras).toBe('CIENTO DIECISEIS PESOS 00/100 M.N.');
    expect(file.NombreElaborado).toBe('A');
    expect(file.NombreRevisado).toBe('B');
    expect(file.NombreAutorizado).toBe('C');
  });
});

describe('nombreArchivoOc', () => {
  it('pasa los acentos a ASCII en vez de perderlos', () => {
    // "México" con `\w` a secas quedaba "M_xico" y el tab ya no reconocía de
    // quién era la orden (findLatestOcFile compara contra el nombre real).
    expect(nombreArchivoOc('OC-226', '5.11 Tactical de México SA De CV'))
      .toBe('OC_OC-226_5_11 Tactical de Mexico SA De CV.pdf');
  });

  it('la copia sin costos lleva el MISMO folio y el sufijo al final', () => {
    expect(nombreArchivoOc('OC-226', 'ABRAHAM FARID', true)).toBe('OC_OC-226_ABRAHAM FARID_SIN-COSTOS.pdf');
  });

  it('recorta razones sociales larguísimas sin dejar el nombre a medias', () => {
    const n = nombreArchivoOc('OC-1', 'A'.repeat(80));
    expect(n.endsWith('.pdf')).toBe(true);
    expect(n.length).toBeLessThan(60);
  });
});
