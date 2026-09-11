// El aviso de "dueño" (costeo confirmado, cotización lista…) cuando el id del
// Vendedor es PRESTADO: le llega a quien creó la oportunidad, no a quien prestó
// el id (Rodrigo, 2026-09-11 — nunca le había llegado ninguno).
import { describe, it, expect } from 'vitest';
import { elegirDueno } from './itemCreador';

const EFRAIN = 'salinasefrain@mexicanadeproteccion.com';
const EFRAIN_GMAIL = 'efrain.ponces@gmail.com';
const RODRIGO = 'coordinador2.centro@mexicanadeproteccion.com';

describe('elegirDueno', () => {
  it('id compartido + creador conocido → solo el creador', () => {
    expect(elegirDueno([EFRAIN, EFRAIN_GMAIL, RODRIGO], RODRIGO)).toBe(RODRIGO);
  });

  it('sin creador registrado → la primera, igual que antes', () => {
    expect(elegirDueno([EFRAIN, EFRAIN_GMAIL, RODRIGO], null)).toBe(EFRAIN);
  });

  it('creador que ya no comparte el id (le cambiaron el Vendedor) → la primera', () => {
    expect(elegirDueno([EFRAIN, RODRIGO], 'otro@mexicanadeproteccion.com')).toBe(EFRAIN);
  });

  it('id de una sola persona → esa persona, aunque el creador sea otro', () => {
    expect(elegirDueno(['ventas.norte@mexicanadeproteccion.com'], RODRIGO)).toBe('ventas.norte@mexicanadeproteccion.com');
  });

  it('nadie con ese id → nadie', () => {
    expect(elegirDueno([], RODRIGO)).toBeNull();
  });
});
