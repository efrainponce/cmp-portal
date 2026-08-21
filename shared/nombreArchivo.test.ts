import { describe, expect, it } from 'vitest';
import { nombreDescarga, limpiarNombreArchivo, extensionDe } from './nombreArchivo';

describe('nombreDescarga', () => {
  it('antepone el item (que ya trae el folio) a la etiqueta', () => {
    expect(nombreDescarga({ item: 'OPP-0947 - CONOS-TRAFITAMBOS TORREON', etiqueta: 'Cotización sin firmar' }))
      .toBe('OPP-0947 - CONOS-TRAFITAMBOS TORREON - Cotización sin firmar.pdf');
  });

  it('el caso de Elizabeth: "sin_firmar.pdf" deja de salir sin folio', () => {
    expect(nombreDescarga({ item: 'OPP-0934 - UNIFORME KEVIN VERGAS', etiqueta: 'Cotización sin firmar' }))
      .toMatch(/^OPP-0934 /);
  });

  it('no duplica el folio si el archivo ya viene identificado por cmp-tallas', () => {
    expect(nombreDescarga({ item: 'OPP-0934 - UNIFORME KEVIN VERGAS', etiqueta: 'Cotizacion OPP 0934 firmada.pdf' }))
      .toBe('Cotizacion OPP 0934 firmada.pdf');
  });

  it('sin item usa solo la etiqueta, y sin etiqueta solo el item', () => {
    expect(nombreDescarga({ etiqueta: 'Orden de compra' })).toBe('Orden de compra.pdf');
    expect(nombreDescarga({ item: 'OPP-0001 - Prueba' })).toBe('OPP-0001 - Prueba.pdf');
    expect(nombreDescarga({})).toBe('archivo.pdf');
  });

  it('respeta la extensión real del archivo', () => {
    expect(nombreDescarga({ item: 'OPP-0100 - X', etiqueta: 'inventario.jpg', ext: 'jpg' }))
      .toBe('OPP-0100 - X - inventario.jpg');
  });

  it('quita lo que Windows no acepta pero conserva acentos', () => {
    expect(limpiarNombreArchivo('Cotización: 50/50 <final>?')).toBe('Cotización 50 50 final');
  });

  it('acota el largo para que Windows pueda guardarlo', () => {
    const largo = nombreDescarga({ item: 'OPP-0500 - ' + 'A'.repeat(300), etiqueta: 'B'.repeat(300) });
    expect(largo.length).toBeLessThanOrEqual(160);
  });
});

describe('extensión', () => {
  it('no repite la extensión que Monday ya traía duplicada', () => {
    expect(nombreDescarga({ item: 'OPP-0601 - Sureste', etiqueta: 'cotizacion_0601_-_1.pdf.pdf', ext: 'pdf' }))
      .toBe('OPP-0601 - Sureste - cotizacion_0601_-_1.pdf');
  });

  it('no inventa extensión donde hay un número de versión', () => {
    expect(extensionDe('INVENTARIO 5.11')).toBe('');
    expect(extensionDe('INVENTARIO 5.11.pdf')).toBe('pdf');
    expect(extensionDe('sin punto')).toBe('');
  });
});
