// Zona Efrain: al elegir producto, la línea nativa queda COSTEADA de un jalón
// (Efraín, 2026-08-19) — en el pipeline normal eso lo hace "Mandar a costeo"
// con Compras de por medio, y ahí no cambia nada. Ids de columna verificados
// contra shared/column-meta.gen.ts (secciones "productos" y "oportunidades_sub").
import { describe, it, expect } from 'vitest';
import type { RawColumn } from './canon';
import { lineaColsDesdeProducto, elegirCosteoPrevio } from './nativeMirrors';

// Catálogo de Productos.
const P_COSTO = 'numeric_mkzpx7eb';
const P_DESCUENTO = 'numeric_mm0bgd2f';
const P_GASTOS = 'numeric_mm0bnkch';
const P_MONEDA = 'text_mkzp59zf';
const P_NOMBRE = 'text_mm0wvga2';
const P_SKU = 'product_and_service_sku';

// Línea de cotización.
const SNAP_COSTO = 'numeric_mm0bph99';
const SNAP_DESC_PCT = 'numeric_mkzn2q51';
const SNAP_GAST_PCT = 'numeric_mkzngs9x';
const SNAP_IVA = 'numeric_mm0cg0bm';
const SNAP_TC = 'numeric_mm0rvhgs';
const SNAP_PRECIO = 'numeric_mm2qzzbe';
const LINEA_MONEDA = 'color_mm5s709s';
const PRECIO_VENTA_CU = 'numeric_mkzneg3d';

function producto(vals: Record<string, string>, name = 'Producto'): { name: string; cols: Map<string, RawColumn> } {
  const cols = new Map<string, RawColumn>();
  for (const [id, text] of Object.entries(vals)) cols.set(id, { id, type: 'text', text, value: null });
  return { name, cols };
}

const byId = (cols: RawColumn[], id: string) => cols.find(c => c.id === id);

describe('lineaColsDesdeProducto', () => {
  it('estampa el costeo del catálogo al elegir producto (MXN)', () => {
    const { cols, nombre } = lineaColsDesdeProducto(producto({
      [P_NOMBRE]: 'Camisa Stryke', [P_SKU]: '62008',
      [P_COSTO]: '1530', [P_DESCUENTO]: '0.18', [P_GASTOS]: '0.05', [P_MONEDA]: 'MXN',
    }));

    expect(nombre).toBe('Camisa Stryke');
    expect(byId(cols, SNAP_COSTO)?.text).toBe('1530');
    expect(byId(cols, SNAP_DESC_PCT)?.text).toBe('18');   // fracción del catálogo → %
    expect(byId(cols, SNAP_GAST_PCT)?.text).toBe('5');
    expect(byId(cols, SNAP_IVA)?.text).toBe('16');
    expect(byId(cols, SNAP_TC)?.text).toBe('1');
    // (1+0.05)·(1530·0.82)·1·1.3
    expect(Number(byId(cols, SNAP_PRECIO)?.text)).toBeCloseTo(1712.53, 2);
    // El tipo es el REAL del board: serialize.ts solo parsea `value` de esos.
    expect(byId(cols, SNAP_COSTO)?.type).toBe('numbers');
  });

  it('USD: tipo de cambio 18 y la moneda de la línea sigue al catálogo', () => {
    const { cols } = lineaColsDesdeProducto(producto({
      [P_NOMBRE]: 'Bota', [P_COSTO]: '100', [P_MONEDA]: 'USD',
    }));
    expect(byId(cols, SNAP_TC)?.text).toBe('18');
    expect(byId(cols, LINEA_MONEDA)?.text).toBe('USD');
    // status = shape {index} de Monday, nunca el label suelto (nativeItems.ts).
    expect(JSON.parse(byId(cols, LINEA_MONEDA)!.value!)).toHaveProperty('index');
  });

  it('sin costo en el catálogo limpia el costeo en vez de dejar el del producto anterior', () => {
    const { cols } = lineaColsDesdeProducto(producto({ [P_NOMBRE]: 'Sin costo', [P_MONEDA]: 'MXN' }));
    for (const id of [SNAP_COSTO, SNAP_DESC_PCT, SNAP_GAST_PCT, SNAP_IVA, SNAP_TC, SNAP_PRECIO]) {
      expect(byId(cols, id)?.text).toBe('');
    }
  });

  it('nunca escribe el Precio de Venta C/U — esa columna la decide una persona', () => {
    const { cols } = lineaColsDesdeProducto(producto({
      [P_NOMBRE]: 'Camisa', [P_COSTO]: '1530', [P_DESCUENTO]: '0.18', [P_GASTOS]: '0.05', [P_MONEDA]: 'MXN',
    }));
    expect(byId(cols, PRECIO_VENTA_CU)).toBeUndefined();
  });

  // Elisa, 2026-09-25: la Bota 12477 no trae costo en el catálogo (baja de
  // Airtable vacío) pero ya se había costeado en 3340 con 18% en otra OPP.
  it('catálogo sin costo: siembra con el último costeo del producto', () => {
    const { cols } = lineaColsDesdeProducto(
      producto({ [P_NOMBRE]: 'Bota Lite Mid', [P_GASTOS]: '0.05', [P_MONEDA]: 'MXN' }),
      { costo: 3340, descPct: 18, moneda: '' },
    );
    expect(byId(cols, SNAP_COSTO)?.text).toBe('3340');
    expect(byId(cols, SNAP_DESC_PCT)?.text).toBe('18');
    expect(byId(cols, SNAP_GAST_PCT)?.text).toBe('5');
    expect(byId(cols, SNAP_TC)?.text).toBe('1');
    // (1+0.05)·(3340·0.82)·1·1.3
    expect(Number(byId(cols, SNAP_PRECIO)?.text)).toBeCloseTo(3738.46, 2);
    // El espejo "Costo (auto)" sigue diciendo lo que dice el catálogo: nada.
    expect(byId(cols, 'lookup_mm5ck4b3')).toBeUndefined();
  });

  it('el costeo previo en USD trae su moneda y su tipo de cambio', () => {
    const { cols } = lineaColsDesdeProducto(
      producto({ [P_NOMBRE]: 'Bota', [P_MONEDA]: 'MXN' }),
      { costo: 100, descPct: 0, moneda: 'USD' },
    );
    expect(byId(cols, SNAP_TC)?.text).toBe('18');
    expect(byId(cols, LINEA_MONEDA)?.text).toBe('USD');
  });

  it('con costo en el catálogo gana el catálogo, no el costeo previo', () => {
    const { cols } = lineaColsDesdeProducto(
      producto({ [P_NOMBRE]: 'Pantalón', [P_COSTO]: '1500', [P_DESCUENTO]: '0.18', [P_MONEDA]: 'MXN' }),
      { costo: 999, descPct: 50, moneda: 'USD' },
    );
    expect(byId(cols, SNAP_COSTO)?.text).toBe('1500');
    expect(byId(cols, SNAP_DESC_PCT)?.text).toBe('18');
    expect(byId(cols, LINEA_MONEDA)?.text).toBe('MXN');
  });
});

describe('elegirCosteoPrevio', () => {
  const linea = (itemId: number, productoId: number, costo: string, changedAt: string, extra: Record<string, string> = {}) => ({
    item_id: itemId,
    columns: JSON.stringify([
      { id: 'board_relation_mkzmafgp', type: 'board_relation', text: 'x', value: JSON.stringify({ linked_item_ids: [String(productoId)] }) },
      { id: SNAP_COSTO, type: 'numbers', text: costo, value: JSON.stringify(costo) },
      { id: 'color_mm084gvf', type: 'status', text: 'Listo', value: JSON.stringify({ index: 1, changed_at: changedAt }) },
      ...Object.entries(extra).map(([id, text]) => ({ id, type: 'text', text, value: null })),
    ]),
  });

  it('toma la línea costeada más reciente del MISMO producto', () => {
    const previo = elegirCosteoPrevio(12023585364, [
      linea(12355197671, 12023585364, '245', '2026-06-26T17:07:31Z'),
      linea(12959662757, 12023585364, '260', '2026-07-24T00:29:46Z', { [SNAP_DESC_PCT]: '10', [LINEA_MONEDA]: 'MXN' }),
      linea(12000000001, 12023585364, '0', '2026-09-01T00:00:00Z'),       // sin costo: no cuenta
      linea(12000000002, 99, '5000', '2026-09-02T00:00:00Z'),             // otro producto (el LIKE lo dejó pasar)
    ]);
    expect(previo).toEqual({ costo: 260, descPct: 10, moneda: 'MXN' });
  });

  it('sin líneas costeadas no inventa nada', () => {
    expect(elegirCosteoPrevio(1, [linea(2, 1, '', '2026-07-01T00:00:00Z')])).toBeNull();
  });
});
