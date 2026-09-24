import { describe, expect, it } from 'vitest';
import { fechaDeTextoCot, monedaDeTextoCot, montoDeTextoCot } from './cotMontoPdf';

// Texto real (recortado) del PDF de la cotización 1109 - 1, 2026-09-24.
const PDF = 'Cliente: | Lic. Sonia Ayala Gonzalez | Institución: | Secretaría De Seguridad Pública Del Estado De Sonora | Cotizacion: | 1109 - 1 | Fecha: | 24-09-2026 | PRESENTE | Partida | Imagen del Producto | Descripción | Cantidad | Unidad | Precio | Unitario | Subtotal | 1 | Taclite | 2400 | Pieza | $1,980.00 | $4,752,000.00'
  + ' | Son: VEINTISEIS MILLONES SETECIENTOS VEINTINUEVE MIL DOSCIENTOS TRECE PESOS 00/100 M.N. | Tiempo de entrega: 45 - 65 Días hábiles | Subtotal: | IVA: | Total: | $23,042,425.00 | $3,686,788.00 | $26,729,213.00 | **CONDICIONES COMERCIALES**';

describe('cotización: texto del PDF', () => {
  it('saca fecha y totales del bloque final, no del encabezado de la tabla', () => {
    expect(fechaDeTextoCot(PDF)).toBe('2026-09-24');
    expect(montoDeTextoCot(PDF)).toEqual({ subtotal: 23042425, iva: 3686788, total: 26729213, moneda: 'MXN' });
  });

  it('"Sonora" no es el "Son:" del importe en letras', () => {
    expect(monedaDeTextoCot('Estado De Sonora | Son: Veintinueve pesos 00/100 MXN |')).toBe('MXN');
    expect(monedaDeTextoCot('Estado De Sonora | nada más')).toBeNull();
    expect(monedaDeTextoCot('Son: MIL DÓLARES 00/100 USD |')).toBe('USD');
  });

  it('cifras que no cuadran o fecha imposible: nada', () => {
    expect(montoDeTextoCot('Subtotal: | IVA: | Total: | $100.00 | $16.00 | $200.00')).toBeNull();
    expect(fechaDeTextoCot('Fecha: | 31-02-2026')).toBeNull();
    expect(montoDeTextoCot('sin bloque de totales')).toBeNull();
  });
});
