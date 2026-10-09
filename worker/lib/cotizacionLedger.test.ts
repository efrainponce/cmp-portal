import { describe, expect, it } from 'vitest';
import { siguienteFolio } from './cotizacionLedger';

describe('siguienteFolio', () => {
  const header = [['FolioOpp']];

  it('primera cotización de la oportunidad', () => {
    expect(siguienteFolio([...header, ['OPP-0001']], 'OPP-1189')).toBe('1189 - 1');
  });

  it('cuenta también los renglones con error (el folio quemado no se reusa)', () => {
    const filas = Array.from({ length: 9 }, () => ['OPP-1189']);
    expect(siguienteFolio([...header, ...filas, ['OPP-1196']], 'OPP-1189')).toBe('1189 - 10');
  });

  it('no cuenta el encabezado ni renglones vacíos', () => {
    expect(siguienteFolio([['OPP-1189'], [], ['OPP-1189']], 'OPP-1189')).toBe('1189 - 2');
  });
});
