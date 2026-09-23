import { describe, expect, it } from 'vitest';
import { compactText, searchMatches } from './textMatch';

describe('searchMatches', () => {
  const oc = ['OC-317', 'GDL TACTICAL', 'Uniformes Torreón', 'PRO-0042'];

  it('encuentra el folio escrito como sea (2026-09-23: "#317" no salía)', () => {
    for (const q of ['317', 'OC-317', 'oc317', 'OC 317', '#317', 'oc-317']) expect(searchMatches(oc, q)).toBe(true);
    expect(searchMatches(oc, '318')).toBe(false);
  });

  it('cada palabra en cualquier campo, sin acentos', () => {
    expect(searchMatches(oc, 'gdl torreon')).toBe(true);
    expect(searchMatches(oc, 'gdl monterrey')).toBe(false);
    expect(searchMatches(oc, '  ')).toBe(true);
  });
});

it('compactText une variantes del mismo proveedor', () => {
  expect(compactText('FRANCISCO JAVIER GONZALEZ CASTAÑEDA')).toBe(compactText('FRANCISCO JAVIER GONZALEZ CASTANEDA'));
});
