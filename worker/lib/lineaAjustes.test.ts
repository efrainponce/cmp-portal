// Mini versiones de Compras (Efraín, 2026-08-19): cambiar color o cantidad
// desde la grid de Cotización se asienta como V{n}.{m} y NO reinicia el ciclo
// de costeo. La parte que se puede probar sin D1 ni red es el predicado que
// decide cuál de los dos caminos toma el PATCH (worker/routes/boards.ts).
import { describe, it, expect } from 'vitest';
import {
  esAjusteInline, AJUSTE_INLINE_COLS, copyRemainingCols, textosDeProducto, marcarDivisionesBorradas,
} from './lineaAjustes';
import { LINE_DEFINING_COLS } from './quoteVersions';
import type { RawCol } from './serialize';
import type { AjusteDTO } from '../../shared/dto';

const COLOR = 'text_mm07s2mg';
const CANTIDAD = 'numeric_mkzm6399';
const PRODUCTO = 'board_relation_mkzmafgp';
const COSTO_DISTR = 'numeric_mm0bph99';
const SKU_TXT = 'text_mm0bxy39';

function col(id: string, type: string, text: string): [string, RawCol] {
  return [id, { id, type, text, value: JSON.stringify(text) }];
}

// OPP-0970 (Pam, 2026-08-26): al dividir "Performance Short Sleeve Polo 71049"
// en 650 caballero + 250 dama (61165), la línea nueva nacía con el SKU 71049
// copiado de la origen — así salió en el archivo de tallas y así se capturaron
// las tallas del Proyecto. El SKU es explícito desde 2026-09-10: del catálogo
// si el producto cambia, de la origen si no.
describe('copyRemainingCols', () => {
  it('no arrastra el SKU texto de la línea origen (es del producto, no de la captura)', () => {
    const cols = new Map<string, RawCol>([
      col(SKU_TXT, 'text', '71049'),
      col(COSTO_DISTR, 'numbers', '882.44'),
    ]);
    const out = copyRemainingCols(cols);
    expect(out[SKU_TXT]).toBeUndefined();
    expect(out[COSTO_DISTR]).toBe('882.44');
  });
});

describe('textosDeProducto', () => {
  it('SKU del catálogo (product_and_service_sku) y nombre = name del item', () => {
    const producto = {
      name: "61165 - Women's Performance Short Sleeve POLO",
      columns: JSON.stringify([{ id: 'product_and_service_sku', type: 'text', text: '61165', value: '"61165"' }]),
    };
    expect(textosDeProducto(producto)).toEqual({ nombre: "61165 - Women's Performance Short Sleeve POLO", sku: '61165' });
  });

  it('sin columna de SKU, lo saca del prefijo "SKU - Nombre"', () => {
    expect(textosDeProducto({ name: '62070ABR - Camisa Taclite Pro Manga Larga Mujer', columns: '[]' }))
      .toEqual({ nombre: '62070ABR - Camisa Taclite Pro Manga Larga Mujer', sku: '62070ABR' });
    expect(textosDeProducto({ name: 'Producto sin sku', columns: 'no-json' }).sku).toBe('');
  });
});

function ajuste(over: Partial<AjusteDTO>): AjusteDTO {
  return { subversion: 1, resumen: '', viewerEmail: 'v@x.com', createdAt: '', lineaId: 1, ...over };
}

// Las 4 líneas de dama de OPP-0970 se borraron directo en Monday el mismo día:
// la cotización se quedó con las origen recortadas y nadie lo vio hasta el
// archivo de tallas dos semanas después.
describe('marcarDivisionesBorradas', () => {
  const vivas = [{ subitemId: 100 }, { subitemId: 200 }];

  it("un 'dividir' cuya línea nueva sigue viva no se marca", () => {
    const out = marcarDivisionesBorradas(vivas, [ajuste({ lineaId: 200, lineaOrigenId: 100 })]);
    expect(out[0].lineaBorrada).toBeUndefined();
  });

  it("un 'dividir' cuya línea nueva ya no existe se marca; sin renglón en item_borrado = se borró en Monday", () => {
    const out = marcarDivisionesBorradas(vivas, [ajuste({ lineaId: 999, lineaOrigenId: 100 })]);
    expect(out[0].lineaBorrada).toBe(true);
    expect(out[0].borradaPor).toBeUndefined();
  });

  it('si el portal la borró (item_borrado), dice quién y cuándo', () => {
    const borrados = new Map([[999, { email: 'pam@x.com', at: '2026-08-26T22:38:45Z' }]]);
    const out = marcarDivisionesBorradas(vivas, [ajuste({ lineaId: 999, lineaOrigenId: 100 })], borrados);
    expect(out[0]).toMatchObject({ lineaBorrada: true, borradaPor: 'pam@x.com', borradaEn: '2026-08-26T22:38:45Z' });
  });

  it("un 'editar' de una línea que después se borró no es una división perdida", () => {
    const out = marcarDivisionesBorradas(vivas, [ajuste({ lineaId: 999 })]);
    expect(out[0].lineaBorrada).toBeUndefined();
  });
});

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
