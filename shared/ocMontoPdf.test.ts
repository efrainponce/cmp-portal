import { describe, expect, it } from 'vitest';
import { fechaDeTextoOc, fechaValida, montoDeTextoOc, montoCuadra } from './ocMontoPdf';

// Textos REALES, tal como los entrega pdfjs (fragmentos unidos con " | ").
const LINEAS = 'PRODUCTO | MODELO/COLOR | UNIDAD | MONEDA | TALLA | CANTIDAD | PRECIO | DESCUENTO | SUBTOTAL | Sudadera | AZUL | PIEZA | MXN | CH | 13 | $295.00 | 0% | $3,835.00 | ';

describe('montoDeTextoOc', () => {
  it('formato vigente (OC-317): SUBTOTAL | IVA | TOTAL | UNIDADES y los tres importes', () => {
    const t = LINEAS + 'Importe en letras: SESENTA Y CUATRO MIL | SUBTOTAL | IVA (16%) | TOTAL | UNIDADES | $55,455.00 | $8,872.80 | $64,327.80 | Muestra de cmp';
    expect(montoDeTextoOc(t)).toEqual({ subtotal: 55455, iva: 8872.8, total: 64327.8, moneda: 'MXN' });
  });

  it('el SUBTOTAL del encabezado de la tabla no se confunde con el bloque de totales', () => {
    const t = LINEAS + 'SUBTOTAL | IVA (16%) | TOTAL | $499.00 | $79.84 | $578.84 | Elaborado por:';
    expect(montoDeTextoOc(t)?.subtotal).toBe(499);
  });

  it('formato viejo (OC-63): el rótulo TOTAL cae entre los importes', () => {
    const t = LINEAS + 'SUBTOTAL | IVA (16%) | $9,120.00 | $1,459.20 M.N. | TOTAL | $10,579.20 | Elaborado por:';
    expect(montoDeTextoOc(t)).toMatchObject({ subtotal: 9120, iva: 1459.2, total: 10579.2 });
  });

  it('OC en dólares', () => {
    const t = LINEAS.replace('MXN', 'USD') + 'SUBTOTAL | IVA (16%) | TOTAL | $1,000.00 | $160.00 | $1,160.00';
    expect(montoDeTextoOc(t)?.moneda).toBe('USD');
  });

  it('negativos (OC-147, descuento de 125%): se muestra lo que dice el papel', () => {
    const t = LINEAS + 'SUBTOTAL | IVA (16%) | TOTAL | $-825.00 | $-132.00 | $-957.00';
    expect(montoDeTextoOc(t)).toMatchObject({ subtotal: -825, total: -957 });
  });

  it('sin bloque de totales (OC-200 a 205) → null, no un monto inventado', () => {
    expect(montoDeTextoOc(LINEAS + 'Importe en letras: CUATROCIENTOS VEINTITRES MIL PESOS 88/100 M.N. Elaborado por:')).toBeNull();
  });

  it('si los tres importes no cuadran entre sí → null', () => {
    expect(montoDeTextoOc(LINEAS + 'SUBTOTAL | IVA (16%) | TOTAL | $100.00 | $16.00 | $999.00')).toBeNull();
    expect(montoCuadra(100, 16, 116.01)).toBe(true);
    expect(montoCuadra(100, 16, 117)).toBe(false);
  });
});

describe('fechaDeTextoOc', () => {
  it('lee la fecha impresa (texto real de OC-317) como aaaa-mm-dd', () => {
    expect(fechaDeTextoOc('Elizabeth Ocaña Roldan |  | FOLIO ORDEN |  | OC-317 |  | FECHA |  | 18-09-2026 |  | PRODUCTO')).toBe('2026-09-18');
  });
  it('sin rótulo FECHA, o con una fecha imposible → null', () => {
    expect(fechaDeTextoOc('FOLIO ORDEN | OC-1 | 18-09-2026')).toBeNull();
    expect(fechaDeTextoOc('FECHA | 31-02-2026')).toBeNull();
    expect(fechaValida('2026-13-01')).toBe(false);
    expect(fechaValida('2026-09-18')).toBe(true);
  });
});
