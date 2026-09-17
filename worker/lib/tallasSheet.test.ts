import { describe, it, expect } from 'vitest';
import { tieneSheet, PROYECTO_SHEET_LINK } from './tallasSheet';

describe('tieneSheet', () => {
  it('detecta el Sheet por el value JSON del link', () => {
    expect(tieneSheet([{ id: PROYECTO_SHEET_LINK, value: JSON.stringify({ url: 'https://docs.google.com/spreadsheets/d/abc', text: 'Tallas' }), text: 'Tallas - https://docs.google.com/spreadsheets/d/abc' }])).toBe(true);
  });
  it('cae al texto si el value no es JSON', () => {
    expect(tieneSheet([{ id: PROYECTO_SHEET_LINK, value: 'x', text: 'Tallas - https://docs.google.com/spreadsheets/d/abc' }])).toBe(true);
  });
  it('sin link o vacío = no hay Sheet', () => {
    expect(tieneSheet([])).toBe(false);
    expect(tieneSheet([{ id: PROYECTO_SHEET_LINK, value: null, text: '' }])).toBe(false);
    expect(tieneSheet([{ id: 'otra', value: '{"url":"https://docs.google.com/x"}', text: '' }])).toBe(false);
  });
});
