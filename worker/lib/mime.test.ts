import { describe, it, expect } from 'vitest';
import { contentTypeFor, isGenericType } from './mime';

describe('contentTypeFor', () => {
  it('infiere el tipo desde un key de R2 completo', () => {
    expect(contentTypeFor('oportunidades/123/embellecimiento/9/Frente/logo.PNG')).toBe('image/png');
    expect(contentTypeFor('cotizacion.pdf')).toBe('application/pdf');
    expect(contentTypeFor('foto.jpeg')).toBe('image/jpeg');
  });

  it('deja svg y desconocidos como descarga', () => {
    expect(contentTypeFor('logo.svg')).toBe('application/octet-stream');
    expect(contentTypeFor('archivo.dwg')).toBe('application/octet-stream');
    expect(contentTypeFor('sin-extension')).toBe('application/octet-stream');
  });
});

describe('isGenericType', () => {
  it('marca los tipos que no dicen nada', () => {
    expect(isGenericType(null)).toBe(true);
    expect(isGenericType('')).toBe(true);
    expect(isGenericType('application/octet-stream')).toBe(true);
    expect(isGenericType('binary/octet-stream')).toBe(true);
  });

  it('respeta un tipo real, con o sin parámetros', () => {
    expect(isGenericType('image/png')).toBe(false);
    expect(isGenericType('application/pdf; charset=binary')).toBe(false);
  });
});
