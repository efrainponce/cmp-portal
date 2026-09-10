// Mini versiones de Compras (Efraín, 2026-08-19): cambiar color o cantidad
// desde la grid de Cotización se asienta como V{n}.{m} y NO reinicia el ciclo
// de costeo. La parte que se puede probar sin D1 ni red es el predicado que
// decide cuál de los dos caminos toma el PATCH (worker/routes/boards.ts).
import { describe, it, expect } from 'vitest';
import {
  esAjusteInline, AJUSTE_INLINE_COLS, copyRemainingCols, textosDeProducto, marcarDivisionesBorradas, normalizarCantidad,
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

  it('línea nueva borrada directo en Monday (sin renglón en item_borrado) y origen viva: se marca', () => {
    const out = marcarDivisionesBorradas(vivas, [ajuste({ lineaId: 999, lineaOrigenId: 100 })]);
    expect(out[0].lineaBorrada).toBe(true);
  });

  it('borrada DESDE el portal no se marca: fue a propósito y quedó respaldada', () => {
    const out = marcarDivisionesBorradas(vivas, [ajuste({ lineaId: 999, lineaOrigenId: 100 })], new Set([999]));
    expect(out[0].lineaBorrada).toBeUndefined();
  });

  it('si la origen tampoco existe ya, no se marca (no hay qué restaurar)', () => {
    const out = marcarDivisionesBorradas(vivas, [ajuste({ lineaId: 999, lineaOrigenId: 555 })]);
    expect(out[0].lineaBorrada).toBeUndefined();
  });

  it('"Ya no aplica" (descartada por subversión) no se marca', () => {
    const out = marcarDivisionesBorradas(vivas, [ajuste({ subversion: 3, lineaId: 999, lineaOrigenId: 100 })], new Set(), new Set([3]));
    expect(out[0].lineaBorrada).toBeUndefined();
  });

  it('dos ajustes que apuntan a la misma línea (restaurar) dan UNA sola marca', () => {
    const out = marcarDivisionesBorradas(vivas, [
      ajuste({ subversion: 1, lineaId: 999, lineaOrigenId: 100 }),
      ajuste({ subversion: 5, lineaId: 999, lineaOrigenId: 100 }),
    ]);
    expect(out.filter(a => a.lineaBorrada)).toHaveLength(1);
  });

  it("un 'editar' de una línea que después se borró no es una división perdida", () => {
    const out = marcarDivisionesBorradas(vivas, [ajuste({ lineaId: 999 })]);
    expect(out[0].lineaBorrada).toBeUndefined();
  });
});

// La grid ya valida la cantidad, pero un pegado o un PATCH a mano llegaba tal
// cual a Monday (negativos, "1,000") — revisión 2026-09-10.
describe('normalizarCantidad', () => {
  it('quita comas de miles, recorta espacios y acepta 0', () => {
    expect(normalizarCantidad('1,000')).toBe('1000');
    expect(normalizarCantidad(' 25 ')).toBe('25');
    expect(normalizarCantidad('0')).toBe('0');
  });

  it('rechaza vacío, texto y negativos', () => {
    for (const v of ['', '  ', 'abc', '-3', null, undefined]) expect(normalizarCantidad(v), String(v)).toBeNull();
  });
});
