import { describe, it, expect } from 'vitest';
import { filaASheetTalla, spreadsheetIdDe, fusionarFilas } from './tallasDesdeSheet';
import { identityKey } from './proyectoTallas';

describe('filaASheetTalla', () => {
  it('convierte una fila Data!A:Q con cantidad', () => {
    const f = filaASheetTalla(['Playera Polo Piqué', 'USWCS24002', 'AZUL MARINO', 'Mujer', 'M', '12', '11112827710', '5.11', '13055770958', 'Espalda: logo', '', '', '', '', '', '', 'otros']);
    expect(f).toMatchObject({ producto: 'Playera Polo Piqué', sku: 'USWCS24002', color: 'AZUL MARINO', genero: 'Mujer', talla: 'M', cantidad: 12, subitemId: 13055770958 });
    expect(f?.extras).toEqual({ long_text_mm1cqh8e: 'Espalda: logo', long_text_mm2077h1: 'otros' });
  });
  it('descarta filas sin cantidad, con cantidad 0 o sin talla', () => {
    expect(filaASheetTalla(['P', 'S', 'C', '', 'M', ''])).toBeNull();
    expect(filaASheetTalla(['P', 'S', 'C', '', 'M', '0'])).toBeNull();
    expect(filaASheetTalla(['P', 'S', 'C', '', '', '5'])).toBeNull();
  });
  it('acepta números con coma y filas cortas', () => {
    expect(filaASheetTalla(['P', '', '', '', 'UNITALLA', '1,200'])?.cantidad).toBe(1200);
  });
});

describe('identityKey con género', () => {
  it('hombre y mujer del mismo producto+color+talla son líneas distintas', () => {
    expect(identityKey('P', 'S', 'C', 'M', 'Hombre')).not.toBe(identityKey('P', 'S', 'C', 'M', 'Mujer'));
  });
  it('sin género es la llave de siempre', () => {
    expect(identityKey('P', 'S', 'C', 'M', '')).toBe(identityKey('P', 'S', 'C', 'M'));
  });
});

describe('spreadsheetIdDe', () => {
  it('extrae el id de la URL', () => {
    expect(spreadsheetIdDe('https://docs.google.com/spreadsheets/d/1FC_k2dnU50C8D-oJ43Z7jN7rjN67H0d1pXORDRtZajE/edit#gid=0')).toBe('1FC_k2dnU50C8D-oJ43Z7jN7rjN67H0d1pXORDRtZajE');
    expect(spreadsheetIdDe('Tallas')).toBeNull();
  });
});

describe('fusionarFilas', () => {
  it('suma cantidades de bloques distintos con la misma identidad (línea dividida sin cambiar producto)', () => {
    const out = fusionarFilas([
      { subitemId: 1, producto: 'Playera Polo', sku: 'X', color: 'AZUL', talla: 'M', cantidad: 10, extras: { a: 'Espalda: logo' } },
      { subitemId: 2, producto: 'playera polo', sku: 'x', color: 'azul', talla: 'm', cantidad: 5, extras: { a: 'Espalda: logo', b: 'Frente' } },
      { subitemId: 1, producto: 'Playera Polo', sku: 'X', color: 'AZUL', talla: 'L', cantidad: 3 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ subitemId: 1, talla: 'M', cantidad: 15, extras: { a: 'Espalda: logo', b: 'Frente' } });
    expect(out[1]).toMatchObject({ talla: 'L', cantidad: 3 });
  });
  it('no toca filas distintas', () => {
    expect(fusionarFilas([
      { subitemId: 1, producto: 'P', talla: 'M', cantidad: 1, genero: 'Hombre' },
      { subitemId: 1, producto: 'P', talla: 'M', cantidad: 2, genero: 'Mujer' },
    ])).toHaveLength(2);
  });
});
