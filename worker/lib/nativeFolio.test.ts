import { describe, expect, it } from 'vitest';
import { formatFolioNativo, nombreConFolio } from './nativeFolio';

describe('folio de Oportunidad nativa', () => {
  it('OPP-E + 4 dígitos, sin chocar con la numeración de Monday', () => {
    expect(formatFolioNativo(1)).toBe('OPP-E0001');
    expect(formatFolioNativo(12345)).toBe('OPP-E12345');
  });
  it('antepone el folio al nombre una sola vez, como Monday', () => {
    expect(nombreConFolio('OPP-E0003', 'ESPOSAS CINCHOS')).toBe('OPP-E0003 - ESPOSAS CINCHOS');
    expect(nombreConFolio('OPP-E0003', 'OPP-E0003 - ESPOSAS CINCHOS')).toBe('OPP-E0003 - ESPOSAS CINCHOS');
  });
});
