// Flujo nativo de "Mandar a costeo" (Fase 1, plan "salir de Monday", 2026-08-12) —
// computeSnapshot/checkSubitemNative son la parte pura (fórmula de precio, reglas
// de validación) que reemplaza a cmp-tallas' validar_costeo.py cuando
// env.COSTEO_NATIVE='1'. Ids de columna verificados contra
// shared/column-meta.gen.ts (sección "oportunidades_sub") — nunca inventados.
import { describe, it, expect } from 'vitest';
import type { MondayCol } from './monday';
import { checkSubitemNative } from './costeo';
import { computeSnapshot } from './costeoSnapshot';

const SCOL_COSTO = 'lookup_mm5ck4b3';
const SCOL_MONEDA = 'lookup_mm11t8gj';
const SCOL_DESCUENTO = 'lookup_mm0bdwb5';
const SCOL_GASTOS = 'lookup_mm0bbz02';
const SCOL_PRODUCTO_NOMBRE = 'lookup_mm0x4kda';
const SCOL_SKU = 'lookup_mkzn7x9a';
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_COLORES_DISP = 'lookup_mkznm0h3';
const SUB_FICHA = 'lookup_mm0xw8p7';
const SUB_EMB_DESC = 'long_text_mm1bj4pt';

function col(id: string, text: string | null): MondayCol {
  return { id, type: 'text', text, value: null };
}

describe('computeSnapshot', () => {
  it('MXN: TC=1, precio = (1+gastos)·(costo·(1-desc))·1·1.3', () => {
    const cols = [
      col(SCOL_PRODUCTO_NOMBRE, 'Camisa'),
      col(SCOL_SKU, 'SKU-1'),
      col(SCOL_COSTO, '100'),
      col(SCOL_MONEDA, 'MXN'),
      col(SCOL_DESCUENTO, '0.1'),   // 10%
      col(SCOL_GASTOS, '0.2'),      // 20%
    ];
    const snap = computeSnapshot(cols);
    // (1.2) * (100 * 0.9) * 1 * 1.3 = 1.2 * 90 * 1.3 = 140.4
    expect(snap.precio).toBeCloseTo(140.4, 2);
    expect(snap.tc).toBe(1);
    expect(snap.descPct).toBe(10);
    expect(snap.gastPct).toBe(20);
    expect(snap.nombre).toBe('Camisa');
    expect(snap.sku).toBe('SKU-1');
  });

  it('USD (case-insensitive): TC=18', () => {
    const cols = [col(SCOL_COSTO, '10'), col(SCOL_MONEDA, 'usd'), col(SCOL_DESCUENTO, '0'), col(SCOL_GASTOS, '0')];
    // 1 * (10*1) * 18 * 1.3 = 234
    expect(computeSnapshot(cols).precio).toBeCloseTo(234, 2);
    expect(computeSnapshot(cols).tc).toBe(18);
  });

  it('costo/descuento/gastos vacíos: caen a 0, no truena', () => {
    const snap = computeSnapshot([col(SCOL_MONEDA, 'MXN')]);
    expect(snap.precio).toBe(0);
  });
});

describe('checkSubitemNative', () => {
  // MondayCol[] no es un dict — checkSubitemNative usa .find() (primer match), así
  // que los "overrides" tienen que REEMPLAZAR por id, no solo aparecer después.
  const okCols = (over: MondayCol[] = []): MondayCol[] => {
    const base = new Map<string, MondayCol>([
      [SUB_CANTIDAD, col(SUB_CANTIDAD, '5')],
      [SUB_COLOR, col(SUB_COLOR, 'Azul')],
      [SUB_COLORES_DISP, col(SUB_COLORES_DISP, 'Azul, Rojo')],
      [SUB_FICHA, col(SUB_FICHA, 'Descripción del producto')],
      [SUB_EMB_DESC, col(SUB_EMB_DESC, '')],
    ]);
    for (const c of over) base.set(c.id, c);
    return [...base.values()];
  };

  it('línea completa: ok, sin reparación', () => {
    const r = checkSubitemNative(okCols(), 'Camisa');
    expect(r.ok).toBe(true);
    expect(r.line).toContain('✅ OK');
    expect(r.embellRepairedText).toBeUndefined();
  });

  it('cantidad <= 0: error', () => {
    const r = checkSubitemNative(okCols([col(SUB_CANTIDAD, '0')]), 'Camisa');
    expect(r.ok).toBe(false);
    expect(r.line).toContain('Cantidad incorrecta');
  });

  it('color fuera de la lista disponible: error (case-insensitive)', () => {
    const r1 = checkSubitemNative(okCols([col(SUB_COLOR, 'verde')]), 'Camisa');
    expect(r1.ok).toBe(false);
    expect(r1.line).toContain('Verificar color');

    // Coincide ignorando mayúsculas — no debe marcar error.
    const r2 = checkSubitemNative(okCols([col(SUB_COLOR, 'AZUL')]), 'Camisa');
    expect(r2.ok).toBe(true);
  });

  it('sin colores disponibles listados: no valida contra nada (columna vacía)', () => {
    const r = checkSubitemNative(okCols([col(SUB_COLORES_DISP, '')]), 'Camisa');
    expect(r.ok).toBe(true);
  });

  it('sin ficha comercial: error', () => {
    const r = checkSubitemNative(okCols([col(SUB_FICHA, '')]), 'Camisa');
    expect(r.ok).toBe(false);
    expect(r.line).toContain('ficha comercial');
  });

  it('embellecimiento reparable: repara y queda ok, con nota', () => {
    const r = checkSubitemNative(okCols([col(SUB_EMB_DESC, 'Espalda:Bordado')]), 'Camisa');
    expect(r.ok).toBe(true);
    expect(r.embellRepairedText).toContain('Espalda:Bordado');
    expect(r.embellRepairedText).toContain('Otros:');
    expect(r.line).toContain('reparado');
  });

  it('embellecimiento sin ninguna clave reconocida: error, sin reparar', () => {
    const r = checkSubitemNative(okCols([col(SUB_EMB_DESC, 'Texto libre sin formato')]), 'Camisa');
    expect(r.ok).toBe(false);
    expect(r.embellRepairedText).toBeUndefined();
  });

  it('varios errores en una línea: se acumulan en un solo mensaje', () => {
    const r = checkSubitemNative(okCols([col(SUB_CANTIDAD, '0'), col(SUB_FICHA, '')]), 'Camisa');
    expect(r.ok).toBe(false);
    expect(r.line).toContain('Cantidad incorrecta');
    expect(r.line).toContain('ficha comercial');
  });
});
