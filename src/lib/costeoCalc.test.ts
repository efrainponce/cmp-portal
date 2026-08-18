import { describe, it, expect } from 'vitest';
import type { ItemDTO } from './api';
import { previewRow, COL } from './costeoCalc';

// Líneas nativas (Zona Efrain): no existen en Monday, así que sus columnas de
// fórmula nunca llegan en `cols` — con el filtro normal el preview salía vacío
// y la grid se quedaba en "—"/$0 (Efraín, 2026-08-18).
describe('previewRow sobre una línea nativa (sin columnas de fórmula)', () => {
  const nativa = {
    id: '900000000001', name: 'Taclite', cols: {
      [COL.cantidad]: { text: '10', type: 'numeric' },
      [COL.costoDistr]: { text: '1170', type: 'numeric' },
      [COL.precio]: { text: '2490', type: 'numeric' },
      [COL.ivaPct]: { text: '16', type: 'numeric' },
    },
  } as unknown as ItemDTO;

  it('sin `todas` no devuelve nada — el mirror no trae las fórmulas', () => {
    expect(Object.keys(previewRow(nativa, {}))).toHaveLength(0);
  });

  it('con `todas` calcula subtotal, IVA y utilidad', () => {
    const out = previewRow(nativa, {}, true);
    expect(out[COL.subtotal]?.value).toBe(24900);
    expect(out[COL.iva]?.value).toBe(3984);
    expect(out[COL.totalConIva]?.value).toBeCloseTo(28884, 6);
    expect(out[COL.costoTotal]?.value).toBe(11700);
    expect(out[COL.utilidadTotal]?.value).toBe(13200);
  });
});
