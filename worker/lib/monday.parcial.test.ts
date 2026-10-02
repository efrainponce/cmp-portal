// Un campo que el token no puede leer no debe tumbar la consulta entera
// (2026-10-01: el feed de Actualizaciones de tres items se quedó en "No se
// pudieron cargar" por el `creator` de UN "me gusta").
import { describe, it, expect } from 'vitest';
import { erroresDeCampo } from './monday';

const noAutorizado = (path: (string | number)[]) => ({
  message: 'User unauthorized to perform action', path,
  extensions: { code: 'UserUnauthorizedException' },
});

describe('erroresDeCampo', () => {
  const data = { items: [{ updates: [] }] };

  it('tolera el error real de producción (creator de un like en una respuesta)', () => {
    const errors = [noAutorizado(['items', 'updates', 5, 'replies', 0, 'likes', 0, 'creator'])];
    expect(erroresDeCampo(errors, data)).toBe(true);
  });

  it('tolera varios campos no autorizados a la vez', () => {
    const errors = [
      noAutorizado(['items', 'updates', 0, 'replies', 1, 'likes', 0, 'creator']),
      noAutorizado(['items', 'updates', 2, 'likes', 0, 'creator']),
    ];
    expect(erroresDeCampo(errors, data)).toBe(true);
  });

  it('NO tolera si Monday no devolvió data', () => {
    expect(erroresDeCampo([noAutorizado(['items'])], null)).toBe(false);
    expect(erroresDeCampo([noAutorizado(['items'])], undefined)).toBe(false);
  });

  it('NO tolera un error que no es de autorización de campo', () => {
    const limite = { message: 'Complexity budget exhausted', extensions: { code: 'ComplexityException' } };
    expect(erroresDeCampo([limite], data)).toBe(false);
    // Mezclado con uno tolerable sigue siendo un fallo: no se sabe qué falta.
    expect(erroresDeCampo([noAutorizado(['items', 'updates', 0, 'creator']), limite], data)).toBe(false);
  });

  it('NO tolera un no-autorizado SIN path (la consulta entera fue rechazada)', () => {
    const sinPath = { message: 'User unauthorized to perform action', extensions: { code: 'UserUnauthorizedException' } };
    expect(erroresDeCampo([sinPath], data)).toBe(false);
    expect(erroresDeCampo([], data)).toBe(false);
  });
});
