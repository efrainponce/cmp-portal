// Ancla las formas JSON que Monday espera por tipo de columna. Cada caso de aquí
// corresponde a un bug real que ya se pagó en vivo (ver comentarios en
// columnEncode.ts y CLAUDE.md "Reglas duras") — Monday acepta varias de las
// formas equivocadas SIN error y escribe basura, así que el typecheck no basta.
import { describe, it, expect } from 'vitest';
import { encodeColumnValue } from './columnEncode';

describe('encodeColumnValue', () => {
  it('status usa {label} singular, NUNCA {labels:[...]}', () => {
    // Regla dura de CLAUDE.md: con {labels:[...]} Monday no falla, asigna una
    // etiqueta arbitraria en silencio (visto en vivo: deal_stage → "Cancelada").
    const out = encodeColumnValue('status', 'En costeo');
    expect(out).toEqual({ label: 'En costeo' });
    expect(out).not.toHaveProperty('labels');
  });

  it('dropdown sí usa {labels:[...]} (es el shape contrario a status)', () => {
    expect(encodeColumnValue('dropdown', 'Azul')).toEqual({ labels: ['Azul'] });
  });

  it('board_relation: {item_ids}, y limpiar requiere [] y no cadena vacía', () => {
    expect(encodeColumnValue('board_relation', '12345')).toEqual({ item_ids: [12345] });
    expect(encodeColumnValue('board_relation', '')).toEqual({ item_ids: [] });
  });

  it('checkbox: null para desmarcar (ni "" ni {} sirven)', () => {
    expect(encodeColumnValue('checkbox', '')).toBeNull();
    expect(encodeColumnValue('checkbox', 'true')).toEqual({ checked: 'true' });
  });

  it('people usa personsAndTeams', () => {
    expect(encodeColumnValue('people', '98389537'))
      .toEqual({ personsAndTeams: [{ id: 98389537, kind: 'person' }] });
  });

  it('date envuelve en {date}', () => {
    expect(encodeColumnValue('date', '2026-07-24')).toEqual({ date: '2026-07-24' });
  });

  it('phone parte "CC:numero" y cae a MX sin prefijo', () => {
    expect(encodeColumnValue('phone', 'US:5551234567'))
      .toEqual({ phone: '5551234567', countryShortName: 'US' });
    expect(encodeColumnValue('phone', '9991234567'))
      .toEqual({ phone: '9991234567', countryShortName: 'MX' });
    expect(encodeColumnValue('phone', 'MX:')).toBe('');
  });

  it('email manda email y text', () => {
    expect(encodeColumnValue('email', 'a@b.com')).toEqual({ email: 'a@b.com', text: 'a@b.com' });
  });

  it('text/long_text pasan derecho y se recortan', () => {
    expect(encodeColumnValue('text', '  hola  ')).toBe('hola');
    expect(encodeColumnValue('long_text', 'x')).toBe('x');
  });

  it('vacío limpia como "" en los tipos simples', () => {
    for (const t of ['text', 'date', 'people', 'status', 'dropdown', 'email']) {
      expect(encodeColumnValue(t, '')).toBe('');
    }
  });
});
