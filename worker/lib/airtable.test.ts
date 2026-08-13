// buildTallasPortalValue (worker/lib/airtable.ts) — la transformación pura del
// write-back Portal→Airtable de Tallas. Todo lo demás del archivo es I/O contra
// Airtable/D1.
import { describe, it, expect } from 'vitest';
import { buildTallasPortalValue } from './airtable';

describe('buildTallasPortalValue', () => {
  it('sin género, deja la lista tal cual (solo normaliza espacios)', () => {
    expect(buildTallasPortalValue('XCH,CH,M,G,XG,2XG', false)).toBe('XCH,CH,M,G,XG,2XG');
    expect(buildTallasPortalValue(' XCH , CH ,M', false)).toBe('XCH,CH,M');
  });

  it('con género, antepone M- a todas las tallas y luego F- a todas', () => {
    expect(buildTallasPortalValue('XCH,CH,M,G,XG,2XG', true))
      .toBe('M-XCH,M-CH,M-M,M-G,M-XG,M-2XG,F-XCH,F-CH,F-M,F-G,F-XG,F-2XG');
  });

  it('talla única con género', () => {
    expect(buildTallasPortalValue('unitalla', true)).toBe('M-unitalla,F-unitalla');
  });

  it('vacío o solo comas no truena', () => {
    expect(buildTallasPortalValue('', false)).toBe('');
    expect(buildTallasPortalValue('', true)).toBe('');
    expect(buildTallasPortalValue(',,', true)).toBe('');
  });
});
