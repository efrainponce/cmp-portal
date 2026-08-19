// Mini versiones de Compras (Efraín, 2026-08-19): cambiar color o cantidad
// desde la grid de Cotización se asienta como V{n}.{m} y NO reinicia el ciclo
// de costeo. La parte que se puede probar sin D1 ni red es el predicado que
// decide cuál de los dos caminos toma el PATCH (worker/routes/boards.ts).
import { describe, it, expect } from 'vitest';
import { esAjusteInlineCompras, AJUSTE_INLINE_COLS } from './lineaAjustes';
import { LINE_DEFINING_COLS } from './quoteVersions';

const COLOR = 'text_mm07s2mg';
const CANTIDAD = 'numeric_mkzm6399';
const PRODUCTO = 'board_relation_mkzmafgp';
const COSTO_DISTR = 'numeric_mm0bph99';

describe('esAjusteInlineCompras', () => {
  it('color y cantidad de Compras son mini versión, no versión nueva', () => {
    expect(esAjusteInlineCompras('compras', [COLOR])).toBe(true);
    expect(esAjusteInlineCompras('compras', [CANTIDAD])).toBe(true);
    expect(esAjusteInlineCompras('compras', [COLOR, CANTIDAD])).toBe(true);
  });

  it('el vendedor sigue versionando completo (Efraín, 2026-08-14)', () => {
    for (const role of ['vendedor', 'admin']) {
      expect(esAjusteInlineCompras(role, [COLOR]), role).toBe(false);
    }
  });

  it('si el PATCH además cambia producto o embellecimiento, versiona', () => {
    expect(esAjusteInlineCompras('compras', [COLOR, PRODUCTO])).toBe(false);
    expect(esAjusteInlineCompras('compras', [PRODUCTO])).toBe(false);
  });

  it('un write que no toca la línea (solo costos) no es un ajuste', () => {
    expect(esAjusteInlineCompras('compras', [COSTO_DISTR])).toBe(false);
    expect(esAjusteInlineCompras('compras', [])).toBe(false);
  });

  it('las dos mitades cubren exactamente LINE_DEFINING_COLS', () => {
    // lineaAjustes.ts enumera su mitad "versionable" a mano para no cerrar el
    // ciclo de imports con quoteVersions.ts — si allá se agrega una columna
    // definitoria y aquí no, este test truena en vez de dejar que esa columna
    // se cuele como mini versión de Compras.
    for (const id of AJUSTE_INLINE_COLS) expect(LINE_DEFINING_COLS.has(id), id).toBe(true);
    for (const id of LINE_DEFINING_COLS) {
      if (AJUSTE_INLINE_COLS.has(id)) continue;
      expect(esAjusteInlineCompras('compras', [id]), id).toBe(false);
    }
  });
});
