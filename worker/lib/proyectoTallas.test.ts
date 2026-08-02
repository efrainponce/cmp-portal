// Captura de tallas por boxes (worker/lib/proyectoTallas.ts) — la parte pura:
// qué filas se capturan, cómo se identifica una talla ya existente (para no
// duplicar al reenviar el mismo box) y qué columnas se arman por subitem. Todo
// lo demás en ese archivo es I/O contra D1/Monday.
import { describe, it, expect } from 'vitest';
import { identityKey, filterWanted, buildTallaColumns, type CosteoEnrichment } from './proyectoTallas';
import type { TallaBoxInput } from '../../shared/dto';

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
});
