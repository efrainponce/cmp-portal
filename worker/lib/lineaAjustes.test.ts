// Mini versiones de Compras (Efraín, 2026-08-19): cambiar color o cantidad
// desde la grid de Cotización se asienta como V{n}.{m} y NO reinicia el ciclo
// de costeo. La parte que se puede probar sin D1 ni red es el predicado que
// decide cuál de los dos caminos toma el PATCH (worker/routes/boards.ts).
import { describe, it, expect } from 'vitest';
import { esAjusteInline, AJUSTE_INLINE_COLS } from './lineaAjustes';
import { LINE_DEFINING_COLS } from './quoteVersions';

const COLOR = 'text_mm07s2mg';
const CANTIDAD = 'numeric_mkzm6399';
const PRODUCTO = 'board_relation_mkzmafgp';
const COSTO_DISTR = 'numeric_mm0bph99';

describe('esAjusteInline', () => {
  it('color y cantidad de Compras Y de admin son mini versión, no versión nueva', () => {
    // Efraín, 2026-08-19: "los admins pueden hacer todo esto igual".
    for (const role of ['compras', 'admin']) {
      expect(esAjusteInline(role, [COLOR]), role).toBe(true);
      expect(esAjusteInline(role, [CANTIDAD]), role).toBe(true);
      expect(esAjusteInline(role, [COLOR, CANTIDAD]), role).toBe(true);
    }
  });

  it('el vendedor sigue versionando completo (Efraín, 2026-08-14)', () => {
    expect(esAjusteInline('vendedor', [COLOR])).toBe(false);
    expect(esAjusteInline('almacen', [COLOR])).toBe(false);
  });

  it('si el PATCH además cambia producto o embellecimiento, versiona', () => {
    expect(esAjusteInline('compras', [COLOR, PRODUCTO])).toBe(false);
    expect(esAjusteInline('admin', [PRODUCTO])).toBe(false);
  });

  it('un write que no toca la línea (solo costos) no es un ajuste', () => {
    expect(esAjusteInline('compras', [COSTO_DISTR])).toBe(false);
    expect(esAjusteInline('admin', [])).toBe(false);
  });

  it('las dos mitades cubren exactamente LINE_DEFINING_COLS', () => {
    // lineaAjustes.ts enumera su mitad "versionable" a mano para no cerrar el
    // ciclo de imports con quoteVersions.ts — si allá se agrega una columna
    // definitoria y aquí no, este test truena en vez de dejar que esa columna
    // se cuele como mini versión de Compras.
    for (const id of AJUSTE_INLINE_COLS) expect(LINE_DEFINING_COLS.has(id), id).toBe(true);
    for (const id of LINE_DEFINING_COLS) {
      if (AJUSTE_INLINE_COLS.has(id)) continue;
      expect(esAjusteInline('compras', [id]), id).toBe(false);
    }
  });
});
