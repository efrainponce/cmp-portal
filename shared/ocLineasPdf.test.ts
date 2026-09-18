import { describe, expect, it } from 'vitest';
import { lineasCuadran, lineasDeItemsOc, type PdfItem } from './ocLineasPdf';
// Items REALES (posición redondeada) de dos PDFs de producción.
import fixture from './ocLineasPdf.fixture.json';

const F = fixture as Record<string, PdfItem[]>;
const H = (y: number, cols: [string, number][]): PdfItem[] => cols.map(([str, x]) => ({ str, x, y, page: 1 }));
const ENCABEZADO = H(621, [['PRODUCTO', 27], ['MODELO/COLOR', 114], ['UNIDAD', 215], ['MONEDA', 258], ['TALLA', 305], ['CANTIDAD', 356], ['PRECIO', 417], ['DESCUENTO', 470], ['SUBTOTAL', 533]]);

describe('lineasDeItemsOc', () => {
  it('formato vigente (geometría de OC-317): el modelo envuelto en dos líneas es UNA celda', () => {
    const r = lineasDeItemsOc([
      ...ENCABEZADO,
      ...H(599, [['Sudadera', 27], ['PIEZA', 215], ['MXN', 258], ['CH', 305], ['13', 371], ['$295.00', 418], ['0%', 486], ['$3,835.00', 533]]),
      { str: 'SUDCABO005, AZUL', x: 114, y: 597, page: 1 }, { str: 'MARINO', x: 114, y: 586, page: 1 },
      ...H(565, [['Sudadera', 27], ['PIEZA', 215], ['MXN', 258], ['M', 305], ['34', 371], ['$295.00', 418], ['0%', 486], ['$10,030.00', 533]]),
      { str: 'Método de pago:', x: 27, y: 300, page: 1 },
      // El bloque de totales NO es un renglón.
      ...H(250, [['SUBTOTAL', 400], ['$13,865.00', 533]]),
    ]);
    expect(r?.lineas).toEqual([
      { producto: 'Sudadera', modelo: 'SUDCABO005, AZUL MARINO', unidad: 'PIEZA', talla: 'CH', cantidad: 13, precio: 295, descuento: '0%', subtotal: 3835 },
      { producto: 'Sudadera', modelo: '', unidad: 'PIEZA', talla: 'M', cantidad: 34, precio: 295, descuento: '0%', subtotal: 10030 },
    ]);
    expect(r?.suma).toBe(13865);
    expect(lineasCuadran(r!, 13865)).toBe(true);
    expect(lineasCuadran(r!, 20000)).toBe(false);
  });

  it('OC-63 real: encabezado viejo sin UNIDAD y producto/talla envueltos en 5 líneas', () => {
    const r = lineasDeItemsOc(F['OC-63'])!;
    expect(r.lineas[0]).toEqual({
      producto: 'VINIL REFLEJANTE EN ESPALDA / FRASE "POLICIA MUNICIPAL" A 2 LINEAS', modelo: 'VARIOS', unidad: '',
      talla: '27 CM ANCHO X 12 CM ALTO', cantidad: 48, precio: 40, descuento: '0%', subtotal: 1920,
    });
    expect(lineasCuadran(r, 9120)).toBe(true); // el subtotal que dice ese PDF
  });

  it('OC-204 real: tabla rota (solo PRODUCTO | UNIDAD | MONEDA) → null, no renglones inventados', () => {
    expect(lineasDeItemsOc(F['OC-204'])).toBeNull();
  });

  it('sin encabezado → null', () => {
    expect(lineasDeItemsOc([{ str: 'hola', x: 1, y: 1, page: 1 }])).toBeNull();
  });
});
