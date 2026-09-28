// Reacciones del feed (fase 3, Jorge 2026-09-25): viven en el portal y se
// juntan con los likes que alguien dé dentro de Monday (solo lectura).
import { describe, expect, it } from 'vitest';
import { agregarReacciones, alternarReaccion, esTipoReaccion, tipoDeMonday, REACCIONES } from './reacciones';

describe('tipos de reacción', () => {
  it('son los 6 del selector de Monday, en su orden', () => {
    expect(REACCIONES.map(r => r.emoji)).toEqual(['👍', '👏', '🙏', '❤️', '😃', '✅']);
  });
  it('solo acepta las claves de la lista', () => {
    expect(esTipoReaccion('heart')).toBe(true);
    expect(esTipoReaccion('❤️')).toBe(false);
    expect(esTipoReaccion('fire')).toBe(false);
    expect(esTipoReaccion(undefined)).toBe(false);
  });
  it('un like de Monday: "+1", el clásico (null) o uno desconocido cuentan como 👍', () => {
    expect(tipoDeMonday('+1')).toBe('+1');
    expect(tipoDeMonday(null)).toBe('+1');
    expect(tipoDeMonday('rocket')).toBe('+1');
    expect(tipoDeMonday('clap')).toBe('clap');
  });
});

describe('agregarReacciones', () => {
  const angel = { email: 'angel@cmp.com', nombre: 'Angel Omar Canto Cural' };
  const emy = { email: 'emy@cmp.com', nombre: 'EMILY MARTINEZ GONZALEZ' };

  it('una píldora por tipo, con conteo, nombres y si es mía', () => {
    const r = agregarReacciones(
      [{ ...angel, tipo: 'heart' }, { ...emy, tipo: '+1' }, { ...angel, tipo: '+1' }], [], 'EMY@cmp.com',
    );
    expect(r).toEqual([
      { tipo: '+1', count: 2, nombres: ['EMILY MARTINEZ GONZALEZ', 'Angel Omar Canto Cural'], mia: true },
      { tipo: 'heart', count: 1, nombres: ['Angel Omar Canto Cural'], mia: false },
    ]);
  });

  it('suma los likes de Monday, sin contar dos veces a quien reaccionó en los dos lados', () => {
    const r = agregarReacciones(
      [{ ...angel, tipo: '+1' }],
      [{ reactionType: '+1', nombre: 'Angel Omar Canto Cural' }, { reactionType: null, nombre: 'Elisa Vallado' }],
      'otro@cmp.com',
    );
    expect(r).toEqual([{ tipo: '+1', count: 2, nombres: ['Angel Omar Canto Cural', 'Elisa Vallado'], mia: false }]);
  });

  it('ignora filas con un tipo que ya no existe', () => {
    expect(agregarReacciones([{ ...angel, tipo: 'fire' }], [], 'x@cmp.com')).toEqual([]);
  });
});

describe('alternarReaccion (cambio optimista en pantalla)', () => {
  it('poner la primera reacción de un tipo crea la píldora en su lugar del orden', () => {
    const antes = [{ tipo: 'heart', count: 1, nombres: ['Angel'], mia: false }];
    expect(alternarReaccion(antes, '+1', true, 'Jorge Perez')).toEqual([
      { tipo: '+1', count: 1, nombres: ['Jorge Perez'], mia: true },
      { tipo: 'heart', count: 1, nombres: ['Angel'], mia: false },
    ]);
  });
  it('sumarse a una existente sube el conteo', () => {
    const antes = [{ tipo: 'check', count: 1, nombres: ['Angel'], mia: false }];
    expect(alternarReaccion(antes, 'check', true, 'Jorge Perez'))
      .toEqual([{ tipo: 'check', count: 2, nombres: ['Angel', 'Jorge Perez'], mia: true }]);
  });
  it('quitar la propia: baja el conteo, y si era la única desaparece la píldora', () => {
    const dos = [{ tipo: 'check', count: 2, nombres: ['Angel', 'Jorge Perez'], mia: true }];
    expect(alternarReaccion(dos, 'check', false, 'Jorge Perez'))
      .toEqual([{ tipo: 'check', count: 1, nombres: ['Angel'], mia: false }]);
    const una = [{ tipo: 'check', count: 1, nombres: ['Jorge Perez'], mia: true }];
    expect(alternarReaccion(una, 'check', false, 'Jorge Perez')).toEqual([]);
  });
  it('poner algo que ya es mío, o quitar algo que no es mío, no cambia nada', () => {
    const lista = [{ tipo: '+1', count: 1, nombres: ['Jorge Perez'], mia: true }];
    expect(alternarReaccion(lista, '+1', true, 'Jorge Perez')).toBe(lista);
    const ajena = [{ tipo: '+1', count: 1, nombres: ['Angel'], mia: false }];
    expect(alternarReaccion(ajena, '+1', false, 'Jorge Perez')).toBe(ajena);
  });
  it('si ya salía mi nombre por un like en Monday, ponerla desde el portal no me cuenta dos veces', () => {
    const lista = [{ tipo: '+1', count: 1, nombres: ['Jorge Perez'], mia: false }];
    expect(alternarReaccion(lista, '+1', true, 'Jorge Perez'))
      .toEqual([{ tipo: '+1', count: 1, nombres: ['Jorge Perez'], mia: true }]);
  });
});
