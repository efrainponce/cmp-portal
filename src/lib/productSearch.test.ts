// El buscador del picker de productos: teclear un SKU, un pedazo del nombre o
// una mezcla de ambos tiene que llegar al mismo producto. Casos calcados de
// datos reales del catálogo (Productos 18395657591).
import { describe, it, expect } from 'vitest';
import { searchProductos, exactProducto, norm, alnum } from './productSearch';
import type { ItemDTO } from '../../shared/dto';

const producto = (id: string, name: string, sku: string, corto = '', marca = ''): ItemDTO => ({
  id, name, syncedAt: '', mondayUpdatedAt: null,
  cols: {
    product_and_service_sku: { text: sku, type: 'text' },
    text_mm0wvga2: { text: corto, type: 'text' },
    product_and_service_description: { text: marca, type: 'long_text' },
  },
});

const CAT: ItemDTO[] = [
  producto('1', '72002 - TDU ® Long Sleeve Shirt', '72002', 'TDU ® Long Sleeve Shirt', '5.11 Tactical'),
  producto('2', '12443 - ATAC 2.0 6 Shield Boot', '12443', 'ATAC 2.0 6 Shield Boot', '5.11 Tactical'),
  producto('3', 'Chaleco Cerbero IIIA', '', 'Chaleco Cerbero IIIA', 'CMP'),
  producto('4', '72002B - TDU Pant', '72002B', 'TDU Pant', '5.11 Tactical'),
];

const ids = (items: ItemDTO[]) => items.map((i) => i.id);

describe('searchProductos', () => {
  it('encuentra por SKU exacto y lo pone primero', () => {
    expect(ids(searchProductos(CAT, '72002'))).toEqual(['1', '4']);
  });

  it('encuentra por nombre, sin importar acentos ni mayúsculas', () => {
    expect(ids(searchProductos(CAT, 'CERBERO'))).toEqual(['3']);
    expect(ids(searchProductos(CAT, 'chaleco cerbero iiia'))).toEqual(['3']);
  });

  it('acepta palabras sueltas en cualquier orden y de campos distintos', () => {
    expect(ids(searchProductos(CAT, 'shirt tdu'))).toEqual(['1']);
    expect(ids(searchProductos(CAT, 'boot 12443'))).toEqual(['2']);
  });

  it('ignora puntuación: "511" llega a "5.11 Tactical"', () => {
    expect(ids(searchProductos(CAT, '511 boot'))).toEqual(['2']);
    expect(ids(searchProductos(CAT, '5.11 pant'))).toEqual(['4']);
  });

  it('todas las palabras deben coincidir (AND, no OR)', () => {
    expect(searchProductos(CAT, 'tdu inexistente')).toEqual([]);
  });

  it('sin query devuelve el catálogo alfabético y respeta el límite', () => {
    expect(ids(searchProductos(CAT, ''))).toEqual(['2', '1', '4', '3']);
    expect(searchProductos(CAT, '', 2)).toHaveLength(2);
  });

  it('un producto sin SKU sigue siendo buscable por nombre', () => {
    expect(ids(searchProductos(CAT, 'iiia'))).toEqual(['3']);
  });

  it('no truena con catálogo vacío', () => {
    expect(searchProductos([], 'lo que sea')).toEqual([]);
  });
});

describe('exactProducto', () => {
  it('resuelve por nombre completo y por SKU', () => {
    expect(exactProducto(CAT, '72002 - TDU ® Long Sleeve Shirt')?.id).toBe('1');
    expect(exactProducto(CAT, '  72002B ')?.id).toBe('4');
  });

  it('no resuelve un texto parcial (eso es texto libre, no un producto)', () => {
    expect(exactProducto(CAT, 'TDU')).toBeUndefined();
    expect(exactProducto(CAT, '')).toBeUndefined();
  });
});

describe('normalización', () => {
  it('norm quita acentos y colapsa espacios; alnum además quita puntuación', () => {
    expect(norm('  Camisa   Táctica ')).toBe('camisa tactica');
    expect(alnum('5.11 Tactical®')).toBe('511tactical');
  });
});
