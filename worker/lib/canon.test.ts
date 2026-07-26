// El contrato que hace funcionar el echo del outbox: canonValue(write-shape) debe
// dar EXACTAMENTE lo mismo que canonValue(read-shape) una vez que Monday nos
// devuelve el valor. Si esto se rompe, los writes quedan colgados en 'sent' para
// siempre (o peor, se marcan como conflicto) — ver docs/dev-contracts.md.
import { describe, it, expect } from 'vitest';
import { md5, canonValue, writeHash, rawHash } from './canon';

describe('md5', () => {
  // Vectores oficiales de RFC 1321 — el MD5 está escrito a mano para el runtime
  // de Workers, así que vale la pena anclarlo contra la especificación.
  it('coincide con los vectores del RFC 1321', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))
      .toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('maneja UTF-8 multibyte (acentos: los boards vienen en español)', () => {
    // Longitud en BYTES, no en code points — un bug clásico de padding.
    expect(md5('Consolidación')).toHaveLength(32);
    expect(md5('á')).toBe(md5('á'));
    expect(md5('a')).not.toBe(md5('á'));
  });

  it('cruza el límite de bloque de 64 bytes correctamente', () => {
    for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      expect(md5('x'.repeat(n))).toMatch(/^[0-9a-f]{32}$/);
    }
    // 56 es el caso borde del padding (necesita un bloque extra).
    expect(md5('x'.repeat(56))).not.toBe(md5('x'.repeat(55)));
  });
});

describe('canonValue — equivalencia write ↔ read (contrato del echo)', () => {
  it('texto: la forma escrita y la que Monday regresa canonizan igual', () => {
    expect(canonValue('text', '  hola  ')).toBe(canonValue('text', { text: 'hola', value: '"hola"' }));
  });

  it('numbers: ignora separadores de miles y ".0" espurio', () => {
    expect(canonValue('numbers', '1,234')).toBe('1234');
    expect(canonValue('numbers', '1234.0')).toBe('1234');
    expect(canonValue('numbers', '1234')).toBe(canonValue('numbers', { text: '1234', value: '"1234"' }));
    expect(canonValue('numbers', '99.5')).toBe('99.5');
  });

  it('board_relation: id suelto al escribir vs linked_item_ids al leer', () => {
    const escrito = canonValue('board_relation', '12345');
    const leido = canonValue('board_relation', {
      text: 'Chaleco Cerbero IIIA',
      value: JSON.stringify({ linked_item_ids: ['12345'] }),
    });
    expect(escrito).toBe(leido);
  });

  it('board_relation: ordena los ids para que el hash no dependa del orden', () => {
    const a = canonValue('board_relation', { text: '', value: JSON.stringify({ linked_item_ids: ['2', '1'] }) });
    const b = canonValue('board_relation', { text: '', value: JSON.stringify({ linked_item_ids: ['1', '2'] }) });
    expect(a).toBe(b);
  });

  it('checkbox: acepta "true" Y "1" como marcado (doble canonicalización de submitWrite)', () => {
    // submitWrite canoniza una vez para el mirror y otra dentro de writeHash: si
    // la segunda pasada no aceptara '1', el content_hash saldría mal y el echo
    // nunca confirmaría. Esto está documentado en canon.ts y aquí queda anclado.
    expect(canonValue('checkbox', 'true')).toBe('1');
    expect(canonValue('checkbox', '1')).toBe('1');
    expect(canonValue('checkbox', '')).toBe('');
    expect(canonValue('checkbox', { text: 'v', value: '{"checked":"true"}' })).toBe('1');
    expect(canonValue('checkbox', { text: '', value: null })).toBe('');
  });

  it('valores vacíos/nulos colapsan a cadena vacía', () => {
    expect(canonValue('text', { text: null, value: null })).toBe('');
    expect(canonValue('numbers', { text: null, value: null })).toBe('');
  });
});

describe('writeHash / rawHash', () => {
  it('es estable ante el orden de las columnas', () => {
    const types = { a: 'text', b: 'numbers' };
    expect(writeHash({ a: 'x', b: '1' }, types)).toBe(writeHash({ b: '1', a: 'x' }, types));
  });

  it('cambia cuando cambia un valor', () => {
    const types = { a: 'text' };
    expect(writeHash({ a: 'x' }, types)).not.toBe(writeHash({ a: 'y' }, types));
  });

  it('rawHash no depende del orden del array de columnas', () => {
    const c1 = { id: 'a', type: 'text', text: '1', value: null };
    const c2 = { id: 'b', type: 'text', text: '2', value: null };
    expect(rawHash([c1, c2])).toBe(rawHash([c2, c1]));
  });
});
