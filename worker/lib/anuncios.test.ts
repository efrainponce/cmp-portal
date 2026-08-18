// La audiencia de un anuncio es la única regla de alcance que tiene la feature
// (no hay scoping por renglón detrás): si se afloja, un comunicado dirigido a
// una zona termina en la pantalla de todo el portal. Por eso queda anclada aquí.
import { describe, it, expect } from 'vitest';
import type { Role } from '../../shared/types';
import { anuncioAlcanzaA } from './anuncios';

const TODOS = { roles: [] as Role[], zonaIds: [] as number[] };

describe('anuncioAlcanzaA', () => {
  it('sin audiencia, alcanza a cualquiera', () => {
    expect(anuncioAlcanzaA(TODOS, 'vendedor', [])).toBe(true);
    expect(anuncioAlcanzaA(TODOS, 'almacen', [7])).toBe(true);
  });

  it('filtra por rol', () => {
    const soloCompras = { roles: ['compras'] as Role[], zonaIds: [] };
    expect(anuncioAlcanzaA(soloCompras, 'compras', [])).toBe(true);
    expect(anuncioAlcanzaA(soloCompras, 'vendedor', [])).toBe(false);
  });

  it('filtra por zona, y el que no está en ninguna no lo recibe', () => {
    const zona3 = { roles: [], zonaIds: [3] };
    expect(anuncioAlcanzaA(zona3, 'vendedor', [3])).toBe(true);
    expect(anuncioAlcanzaA(zona3, 'vendedor', [1, 2])).toBe(false);
    expect(anuncioAlcanzaA(zona3, 'vendedor', [])).toBe(false);
  });

  it('rol Y zona se cumplen a la vez, no una u otra', () => {
    const vendedoresDeZona3 = { roles: ['vendedor'] as Role[], zonaIds: [3] };
    expect(anuncioAlcanzaA(vendedoresDeZona3, 'vendedor', [3])).toBe(true);
    expect(anuncioAlcanzaA(vendedoresDeZona3, 'vendedor', [4])).toBe(false);   // rol sí, zona no
    expect(anuncioAlcanzaA(vendedoresDeZona3, 'compras', [3])).toBe(false);    // zona sí, rol no
  });
});
