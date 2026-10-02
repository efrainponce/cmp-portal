// "No quiero que nunca se pierda lo costeado y el precio" (Efraín, 2026-08-19).
// El snapshot de "Mandar a costeo" siembra la línea con los valores del catálogo,
// y desde que el versionado automático regresa a "No iniciado" SOLO la línea
// editada, ese estado ya no significa "nunca se costeó": re-estamparlo pisaba el
// costo que Compras había capturado a mano (con ceros, si el espejo del catálogo
// venía vacío).
import { describe, it, expect } from 'vitest';
import {
  debeEstamparSnapshot, snapshotColumnValues, computeSnapshot, costeoDesdeCatalogo,
  SNAP_COSTO, SNAP_SKU, SNAP_NOMBRE, SNAP_DESC_PCT, SNAP_GAST_PCT, SNAP_IVA, SNAP_TC, SNAP_PRECIO, IVA_DEFAULT, SCOL_SKU, SCOL_PRODUCTO_NOMBRE, SCOL_COSTO,
} from './costeoSnapshot';
import type { MondayCol } from './monday';

const col = (id: string, text: string): MondayCol => ({ id, type: 'text', text, value: null });

// Línea ya costeada por Compras: costo capturado + producto congelado que
// coincide con el catálogo.
// `over` REEMPLAZA la columna del mismo id — cvText se queda con la primera
// coincidencia, y en Monday un id sale una sola vez por línea.
const costeada = (over: MondayCol[] = []): MondayCol[] => {
  const base = [
    col(SNAP_COSTO, '542'),
    col(SNAP_SKU, 'CH5160'), col(SCOL_SKU, 'CH5160'),
    col(SNAP_NOMBRE, 'Chamarra Mak'), col(SCOL_PRODUCTO_NOMBRE, 'Chamarra Mak'),
  ];
  const pisados = new Set(over.map(c => c.id));
  return [...over, ...base.filter(c => !pisados.has(c.id))];
};

describe('debeEstamparSnapshot', () => {
  it('siembra la línea que nunca se costeó', () => {
    expect(debeEstamparSnapshot([col(SCOL_SKU, 'CH5160')])).toBe(true);
    expect(debeEstamparSnapshot([col(SNAP_COSTO, '0')])).toBe(true);
  });

  it('NO pisa el costo capturado cuando el producto es el mismo', () => {
    // El caso que Efraín mandó resolver: la línea volvió a "No iniciado" porque
    // le cambiaron el color, y al remandarla a costeo perdía los 542.
    expect(debeEstamparSnapshot(costeada())).toBe(false);
  });

  it('sí re-siembra cuando cambió el producto (el costo era de otro SKU)', () => {
    expect(debeEstamparSnapshot(costeada([col(SCOL_SKU, 'PANT-PA4')]))).toBe(true);
    expect(debeEstamparSnapshot(costeada([col(SCOL_PRODUCTO_NOMBRE, 'Pantalón Comando')]))).toBe(true);
  });

  it('ante un espejo vacío o incomparable, conserva lo capturado', () => {
    // Monday no siempre tiene el mirror recalculado; ahí re-estampar escribiría
    // ceros encima de un costo negociado. Perder eso es más caro que no sembrar.
    expect(debeEstamparSnapshot(costeada([col(SCOL_SKU, ''), col(SCOL_PRODUCTO_NOMBRE, '')]))).toBe(false);
    expect(debeEstamparSnapshot([col(SNAP_COSTO, '542')])).toBe(false);
  });
});

describe('el snapshot nunca toca el Precio de Venta C/U', () => {
  it('numeric_mkzneg3d no está entre las columnas que escribe', () => {
    // numeric_mkzneg3d = precio que valida dirección (solo admin lo escribe,
    // shared/visibility.ts). El snapshot escribe numeric_mm2qzzbe, que es otra
    // columna con nombre parecido — confundirlas pisaría el precio negociado.
    const escritas = Object.keys(snapshotColumnValues(computeSnapshot([col(SCOL_COSTO, '100')])));
    expect(escritas).not.toContain('numeric_mkzneg3d');
    expect(escritas).toContain('numeric_mm2qzzbe');
  });
});

// PAM, 2026-10-02: "no me jala los costos del airtable" — elegir producto con
// la oportunidad ya en costeo dejaba el costo vacío aunque el catálogo lo trajera.
describe('costeoDesdeCatalogo', () => {
  const producto = (over: Record<string, string> = {}): MondayCol[] => Object.entries({
    numeric_mkzpx7eb: '1050', numeric_mm0bgd2f: '0', numeric_mm0bnkch: '0.05', text_mkzp59zf: 'MXN',
    text_mm0wvga2: 'Fast-Tac Cargo Pant', product_and_service_sku: '74439', ...over,
  }).map(([id, text]) => col(id, text));

  it('estampa costo, descuento, gastos, IVA, TC y precio sugerido del catálogo', () => {
    expect(costeoDesdeCatalogo(producto())).toEqual({
      [SNAP_COSTO]: '1050', [SNAP_DESC_PCT]: '0', [SNAP_GAST_PCT]: '5', [SNAP_IVA]: IVA_DEFAULT,
      [SNAP_TC]: '1', [SNAP_PRECIO]: String(Math.round(1.05 * 1050 * 1.3 * 100) / 100),
    });
  });

  it('USD → TC 18', () => {
    expect(costeoDesdeCatalogo(producto({ text_mkzp59zf: 'USD' }))[SNAP_TC]).toBe('18');
  });

  it('no toca nombre ni SKU (los pone textosDerivadosDeProducto)', () => {
    const out = costeoDesdeCatalogo(producto());
    expect(out).not.toHaveProperty(SNAP_NOMBRE);
    expect(out).not.toHaveProperty(SNAP_SKU);
  });

  it('sin costo en el catálogo no inventa nada (queda el aviso "Falta costo en Airtable")', () => {
    expect(costeoDesdeCatalogo(producto({ numeric_mkzpx7eb: '' }))).toEqual({});
    expect(costeoDesdeCatalogo(producto({ numeric_mkzpx7eb: '0' }))).toEqual({});
  });
});
