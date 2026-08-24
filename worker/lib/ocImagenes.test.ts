// Las tres piezas puras de la foto de producto. `sniffTipo` es la que más pesa:
// es lo único que impide que un .webp renombrado a .jpg se guarde bien y después
// salga como recuadro gris en la OC, sin que nadie sepa por qué.
import { describe, it, expect } from 'vitest';
import { skuKey, isSkuUsable, sniffTipo } from './ocImagenes';

describe('skuKey', () => {
  it('es la misma foto sin importar cómo escribieron el SKU en la línea', () => {
    expect(skuKey(' 74434 ')).toBe('74434');
    expect(skuKey('abc-1')).toBe(skuKey('ABC-1'));
  });
});

describe('isSkuUsable', () => {
  it('acepta los SKUs reales del catálogo', () => {
    expect(isSkuUsable('74434')).toBe(true);
    expect(isSkuUsable('TDU-511.2')).toBe(true);
  });

  it('rechaza lo que rompería un key de R2 o un LIKE de SQLite', () => {
    expect(isSkuUsable('')).toBe(false);
    expect(isSkuUsable('a b')).toBe(false);
    expect(isSkuUsable('74%34')).toBe(false);
    expect(isSkuUsable('../../etc')).toBe(false);
    expect(isSkuUsable('x'.repeat(80))).toBe(false);
  });
});

describe('sniffTipo', () => {
  it('reconoce JPEG y PNG por sus bytes, no por el nombre', () => {
    expect(sniffTipo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffTipo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('un WEBP (o cualquier otra cosa) se rechaza en la subida', () => {
    // "RIFF....WEBP" — el motor de PDF no lo sabe embeber, así que aceptarlo
    // solo cambiaría el error de sitio: saldría como placeholder en la OC.
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffTipo(webp)).toBeNull();
    expect(sniffTipo(new Uint8Array([]))).toBeNull();
  });
});
