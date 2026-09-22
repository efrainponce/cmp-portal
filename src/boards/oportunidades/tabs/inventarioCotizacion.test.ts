// La pestaña Inventario 5.11 resuelve cada línea de la cotización a su producto
// de catálogo. Nada de esto lo cubre el typecheck (todo son strings y JSON), y
// ya falló una vez en producción: se leía `linkedPulseIds` (API vieja de
// Monday) en vez de `linked_item_ids`, y una cotización llena de 5.11 salía
// vacía (Efraín, 2026-09-21).
import { describe, it, expect } from 'vitest';
import type { ItemDTO } from '../../../../shared/dto';
import { es511, productForQuoteLine } from './InventarioCotizacionTab';

const producto = (id: string, name: string, marca: string): ItemDTO => ({
  id, name, cols: { product_and_service_description: { type: 'long_text', text: marca } },
} as unknown as ItemDTO);

const linea = (cols: Record<string, unknown>): ItemDTO => ({ id: 'l1', name: '1', cols } as unknown as ItemDTO);

const catalogo = [
  producto('11013755609', '74462 - Fast-Tac TDU Pant', '5.11 Tactical'),
  producto('11013730273', '1104 - Camisa Zero', 'Risk Top Tactical'),
];

describe('es511', () => {
  it('reconoce la marca aunque traiga puntos y espacios', () => {
    expect(es511(catalogo[0])).toBe(true);
    expect(es511(catalogo[1])).toBe(false);
  });
});

describe('productForQuoteLine', () => {
  it('resuelve por la relación real de Monday ({linked_item_ids})', () => {
    const row = linea({ board_relation_mkzmafgp: { type: 'board_relation', text: '', value: { linked_item_ids: ['11013755609'] } } });
    expect(productForQuoteLine(row, catalogo)?.id).toBe('11013755609');
  });

  it('cae al texto de la relación cuando el mirror trae el nombre corto', () => {
    const row = linea({
      board_relation_mkzmafgp: { type: 'board_relation', text: '74462 - Fast-Tac TDU Pant' },
      lookup_mm0x4kda: { type: 'mirror', text: 'Fast-Tac TDU Pant' },
    });
    expect(productForQuoteLine(row, catalogo)?.id).toBe('11013755609');
  });

  it('sin relación ni nombre conocido no inventa producto', () => {
    expect(productForQuoteLine(linea({ text_mm0bkm1j: { type: 'text', text: 'Algo libre' } }), catalogo)).toBeUndefined();
  });
});
