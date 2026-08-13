// Captura de tallas por boxes (worker/lib/proyectoTallas.ts) — la parte pura:
// qué filas se capturan, cómo se identifica una talla ya existente (para no
// duplicar al reenviar el mismo box) y qué columnas se arman por subitem. Todo
// lo demás en ese archivo es I/O contra D1/Monday.
import { describe, it, expect } from 'vitest';
import { identityKey, filterWanted, buildTallaColumns, needsUpdate, type CosteoEnrichment } from './proyectoTallas';
import type { TallaBoxInput } from '../../shared/dto';
import type { RawCol } from './serialize';

const row = (over: Partial<TallaBoxInput> = {}): TallaBoxInput => ({
  subitemId: 1, producto: 'Kepi Transito', sku: 'KEP-01', color: 'Azul Media Noche', talla: 'XL', cantidad: 8,
  ...over,
});

describe('identityKey', () => {
  it('misma talla en mayúsculas/espacios distintos = misma identidad', () => {
    expect(identityKey('Kepi Transito', 'KEP-01', 'Azul', 'XL'))
      .toBe(identityKey(' kepi transito ', 'kep-01', ' AZUL ', 'xl'));
  });

  it('cambia si cambia cualquier campo', () => {
    const base = identityKey('Kepi', 'SKU1', 'Azul', 'XL');
    expect(identityKey('Kepi', 'SKU1', 'Azul', 'S')).not.toBe(base);
    expect(identityKey('Kepi', 'SKU1', 'Rojo', 'XL')).not.toBe(base);
    expect(identityKey('Kepi', 'SKU2', 'Azul', 'XL')).not.toBe(base);
    expect(identityKey('Gorra', 'SKU1', 'Azul', 'XL')).not.toBe(base);
  });

  it('sku/color ausentes no truenan y no colisionan con sku/color vacíos explícitos', () => {
    expect(identityKey('Kepi', undefined, undefined, 'XL')).toBe(identityKey('Kepi', '', '', 'XL'));
  });
});

describe('filterWanted', () => {
  it('descarta cantidad <= 0, talla vacía o producto vacío', () => {
    const rows = [
      row({ cantidad: 0 }),
      row({ cantidad: -3 }),
      row({ talla: '   ' }),
      row({ producto: '' }),
      row({ talla: 'S', cantidad: 2 }),
    ];
    const wanted = filterWanted(rows);
    expect(wanted).toHaveLength(1);
    expect(wanted[0].talla).toBe('S');
  });

  it('conserva todas las filas válidas', () => {
    const rows = [row({ talla: 'S', cantidad: 2 }), row({ talla: 'M', cantidad: 3 })];
    expect(filterWanted(rows)).toHaveLength(2);
  });
});

describe('buildTallaColumns', () => {
  it('siempre manda producto/talla/cantidad', () => {
    const cols = buildTallaColumns(row(), undefined);
    expect(cols).toMatchObject({
      text_mm0hs17x: 'Kepi Transito',
      text_mm1antcb: 'XL',
      numeric_mm0hj2q4: 8,
    });
  });

  it('sku/color se recortan y se omiten si vienen vacíos', () => {
    const conDatos = buildTallaColumns(row({ sku: '  KEP-01  ', color: '  Azul  ' }), undefined);
    expect(conDatos.text_mm0hyrfs).toBe('KEP-01');
    expect(conDatos.text_mm0h4a1c).toBe('Azul');

    const sinDatos = buildTallaColumns(row({ sku: '  ', color: undefined }), undefined);
    expect(sinDatos.text_mm0hyrfs).toBeUndefined();
    expect(sinDatos.text_mm0h4a1c).toBeUndefined();
  });

  it('sin enriquecimiento no manda costo/moneda/descuento/unidad — nunca inventa un default', () => {
    const cols = buildTallaColumns(row(), undefined);
    expect(cols.numeric_mm1dj4fp).toBeUndefined();
    expect(cols.text_mm1gdsvg).toBeUndefined();
    expect(cols.numeric_mm1dmsaz).toBeUndefined();
    expect(cols.text_mm56dbkm).toBeUndefined();
  });

  it('copia el costeo de la línea de cotización cuando hay match', () => {
    const enr: CosteoEnrichment = { costo: '150.5', moneda: 'MXN', descuento: '0.1', unidad: 'pieza' };
    const cols = buildTallaColumns(row(), enr);
    expect(cols).toMatchObject({
      numeric_mm1dj4fp: '150.5',
      text_mm1gdsvg: 'MXN',
      numeric_mm1dmsaz: '0.1',
      text_mm56dbkm: 'pieza',
    });
  });

  it('copia el proveedor del producto de catálogo cuando hay match', () => {
    const cols = buildTallaColumns(row(), { proveedorId: 123 });
    expect(cols.board_relation_mm1cfgv5).toEqual({ item_ids: [123] });
  });

  it('sin proveedor en el catálogo no manda la columna — nunca inventa un default', () => {
    const cols = buildTallaColumns(row(), undefined);
    expect(cols.board_relation_mm1cfgv5).toBeUndefined();
  });
});

// Reconciliación real por identidad (Fase 3, plan "salir de Monday", 2026-08-12,
// mirror de import_tallas.py's _needs_update/_norm): decide si una fila que ya
// existe en el Proyecto se actualiza o se deja tal cual.
describe('needsUpdate', () => {
  const raw = (id: string, text: string | null, value: string | null = null): RawCol => ({ id, type: 'text', text, value });

  it('sin diferencias: no hace falta actualizar', () => {
    const cols = new Map([['numeric_mm0hj2q4', raw('numeric_mm0hj2q4', '8')]]);
    expect(needsUpdate(cols, { numeric_mm0hj2q4: 8 })).toBe(false);
  });

  it('cantidad distinta: sí hace falta actualizar', () => {
    const cols = new Map([['numeric_mm0hj2q4', raw('numeric_mm0hj2q4', '8')]]);
    expect(needsUpdate(cols, { numeric_mm0hj2q4: 12 })).toBe(true);
  });

  it('"8" (texto) == 8 (número) == "8.0" — no cuenta como cambio (ruido de formato)', () => {
    const cols = new Map([['numeric_mm0hj2q4', raw('numeric_mm0hj2q4', '8.0')]]);
    expect(needsUpdate(cols, { numeric_mm0hj2q4: 8 })).toBe(false);
    expect(needsUpdate(cols, { numeric_mm0hj2q4: '8' })).toBe(false);
  });

  it('board_relation: mismo id, no cambia aunque el orden del array difiera', () => {
    const cols = new Map([
      ['board_relation_mm1cfgv5', raw('board_relation_mm1cfgv5', null, JSON.stringify({ linked_item_ids: ['2', '1'] }))],
    ]);
    expect(needsUpdate(cols, { board_relation_mm1cfgv5: { item_ids: [1, 2] } })).toBe(false);
  });

  it('board_relation: id distinto sí es cambio', () => {
    const cols = new Map([
      ['board_relation_mm1cfgv5', raw('board_relation_mm1cfgv5', null, JSON.stringify({ linked_item_ids: ['1'] }))],
    ]);
    expect(needsUpdate(cols, { board_relation_mm1cfgv5: { item_ids: [2] } })).toBe(true);
  });

  it('columna ausente en el mirror vs. valor deseado vacío: no es cambio', () => {
    const cols = new Map<string, RawCol>();
    expect(needsUpdate(cols, { text_mm0hyrfs: '' })).toBe(false);
  });

  it('columna ausente en el mirror vs. valor deseado con contenido: sí es cambio', () => {
    const cols = new Map<string, RawCol>();
    expect(needsUpdate(cols, { text_mm0hyrfs: 'KEP-01' })).toBe(true);
  });
});
