// El nombre del adjunto viaja en Content-Disposition y se lista en la tarjeta
// de la OC; el tipo se decide por la firma de los bytes (worker/lib/ocAdjuntos.ts).
import { describe, it, expect } from 'vitest';
import { esPdf, limpiarNombrePdf, esProveedorIdUsable } from './ocAdjuntos';

describe('esPdf', () => {
  it('reconoce la firma %PDF-', () => {
    expect(esPdf(new TextEncoder().encode('%PDF-1.7\n%âãÏÓ'))).toBe(true);
  });
  it('rechaza cualquier otra cosa, incluso un PNG o un docx renombrado', () => {
    expect(esPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
    expect(esPdf(new TextEncoder().encode('PK\u0003\u0004...'))).toBe(false);
    expect(esPdf(new Uint8Array())).toBe(false);
  });
});

describe('limpiarNombrePdf', () => {
  it('quita la ruta, normaliza espacios y garantiza .pdf', () => {
    expect(limpiarNombrePdf('C:\\Users\\pam\\ficha  tecnica.PDF', 'x')).toBe('ficha tecnica.pdf');
    expect(limpiarNombrePdf('plano bordado', 'x')).toBe('plano bordado.pdf');
  });
  it('sin nombre usable cae al de respaldo', () => {
    expect(limpiarNombrePdf('   ', 'Adjunto 2026-09-22')).toBe('Adjunto 2026-09-22.pdf');
    expect(limpiarNombrePdf('.pdf', 'Adjunto 2026-09-22')).toBe('Adjunto 2026-09-22.pdf');
  });
  it('acota el largo y quita comillas (rompen Content-Disposition)', () => {
    expect(limpiarNombrePdf('a'.repeat(200) + '.pdf', 'x')).toHaveLength(104);
    expect(limpiarNombrePdf('co"tiza<ción>.pdf', 'x')).toBe('cotización.pdf');
  });
});

describe('esProveedorIdUsable', () => {
  it('solo ids numéricos de Monday', () => {
    expect(esProveedorIdUsable('18395657607')).toBe(true);
    expect(esProveedorIdUsable('sin-proveedor')).toBe(false);
    expect(esProveedorIdUsable('')).toBe(false);
  });
});
