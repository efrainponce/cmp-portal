// Preferencias por número (docs/plan-wa-cartera.md §7): el gate del resumen y
// el parser del menú, puros.
import { describe, it, expect } from 'vitest';
import { tocaResumen, parseComandoPref, puedeRecibirAviso, renderMenu, PREF_DEFAULT, type Preferencias } from './preferencias';

const AHORA = new Date('2026-09-14T13:30:00.000Z'); // lunes 08:30 CDMX
const pref = (over: Partial<Preferencias> = {}): Preferencias => ({ email: 'v@x', ...PREF_DEFAULT, updatedAt: null, ...over });

describe('tocaResumen', () => {
  it('apagado por default (opt-in)', () => {
    expect(tocaResumen(pref(), 8, 1, AHORA)).toEqual({ toca: false, motivo: 'resumen apagado' });
  });
  it('prendido: a su hora y las dos siguientes, L–V', () => {
    const p = pref({ resumen: true, hora: 8 });
    expect(tocaResumen(p, 8, 1, AHORA).toca).toBe(true);
    expect(tocaResumen(p, 10, 1, AHORA).toca).toBe(true);
    expect(tocaResumen(p, 11, 1, AHORA).toca).toBe(false);
    expect(tocaResumen(p, 7, 1, AHORA).toca).toBe(false);
    expect(tocaResumen(p, 8, 0, AHORA)).toEqual({ toca: false, motivo: 'domingo' });
    expect(tocaResumen(p, 8, 6, AHORA)).toEqual({ toca: false, motivo: 'sábado apagado' });
    expect(tocaResumen(pref({ resumen: true, sabado: true }), 8, 6, AHORA).toca).toBe(true);
  });
  it('pausa vigente y "parar" ganan', () => {
    expect(tocaResumen(pref({ resumen: true, pausaHasta: '2026-09-20T00:00:00.000Z' }), 8, 1, AHORA).motivo).toMatch(/pausa hasta 2026-09-20/);
    expect(tocaResumen(pref({ resumen: true, pausaHasta: '2026-09-01T00:00:00.000Z' }), 8, 1, AHORA).toca).toBe(true);
    expect(tocaResumen(pref({ resumen: true, todoApagado: true }), 8, 1, AHORA).motivo).toMatch(/parar/);
  });
});

describe('puedeRecibirAviso', () => {
  it('avisos prendidos por default; "parar" los apaga aunque avisos siga en 1', () => {
    expect(puedeRecibirAviso(pref())).toBe(true);
    expect(puedeRecibirAviso(pref({ avisos: false }))).toBe(false);
    expect(puedeRecibirAviso(pref({ todoApagado: true }))).toBe(false);
  });
});

describe('parseComandoPref', () => {
  const cerrado = { menuAbierto: false, esperandoHora: false };
  it('palabras del menú, parar, reanudar, pausa', () => {
    expect(parseComandoPref('Ajustes', cerrado)).toEqual({ tipo: 'menu' });
    expect(parseComandoPref('configuración', cerrado)).toEqual({ tipo: 'menu' });
    expect(parseComandoPref('PARAR', cerrado)).toEqual({ tipo: 'parar' });
    expect(parseComandoPref('stop', cerrado)).toEqual({ tipo: 'parar' });
    expect(parseComandoPref('reanudar', cerrado)).toEqual({ tipo: 'reanudar' });
    expect(parseComandoPref('pausa', cerrado)).toEqual({ tipo: 'pausa', dias: null });
    expect(parseComandoPref('pausa 2 semanas', cerrado)).toEqual({ tipo: 'pausa', dias: 14 });
    expect(parseComandoPref('pausar 3 dias', cerrado)).toEqual({ tipo: 'pausa', dias: 3 });
  });
  it('un número suelto solo es opción con el menú abierto; la hora solo cuando se pidió', () => {
    expect(parseComandoPref('3', cerrado)).toBeNull();
    expect(parseComandoPref('3', { menuAbierto: true, esperandoHora: false })).toEqual({ tipo: 'opcion', n: 3 });
    expect(parseComandoPref('9', { menuAbierto: false, esperandoHora: true })).toEqual({ tipo: 'hora', hora: 9 });
    expect(parseComandoPref('9:00', { menuAbierto: false, esperandoHora: true })).toEqual({ tipo: 'hora', hora: 9 });
    expect(parseComandoPref('hola', { menuAbierto: true, esperandoHora: false })).toBeNull();
  });
});

describe('renderMenu', () => {
  it('muestra el estado de las 5 opciones y la pausa', () => {
    const t = renderMenu(pref({ resumen: true, hora: 9, pausaHasta: '2026-09-20T00:00:00.000Z' }), AHORA);
    expect(t).toContain('1. Resumen matutino ✅');
    expect(t).toContain('2. Propuesta de cierre ⛔');
    expect(t).toContain('4. Hora del resumen: 9:00');
    expect(t).toContain('En pausa hasta 2026-09-20');
  });
});
