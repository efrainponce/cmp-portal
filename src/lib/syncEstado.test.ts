import { describe, it, expect } from 'vitest';
import { esEscrituraDeFondo, faseDe, inicioEscritura, syncSnapshot, LENTO_MS, type SyncSnapshot } from './syncEstado';

const base: SyncSnapshot = { activas: 0, desde: null, ultimo: null, sinRed: false };

describe('faseDe', () => {
  it('oculta sin nada que decir', () => expect(faseDe(base, 1000)).toBe('oculta'));
  it('guardando y luego "no recargues" cuando tarda', () => {
    const s = { ...base, activas: 1, desde: 0 };
    expect(faseDe(s, LENTO_MS - 1)).toBe('guardando');
    expect(faseDe(s, LENTO_MS)).toBe('lento');
  });
  it('guardado se apaga solo; el fallo dura más', () => {
    expect(faseDe({ ...base, ultimo: { ok: true, at: 0 } }, 1000)).toBe('guardado');
    expect(faseDe({ ...base, ultimo: { ok: true, at: 0 } }, 3000)).toBe('oculta');
    expect(faseDe({ ...base, ultimo: { ok: false, at: 0 } }, 3000)).toBe('fallo');
    expect(faseDe({ ...base, ultimo: { ok: false, at: 0 } }, 7000)).toBe('oculta');
  });
  it('sin red gana a todo', () => expect(faseDe({ ...base, activas: 2, desde: 0, sinRed: true }, 10)).toBe('sinRed'));
});

describe('inicioEscritura', () => {
  it('cuenta en vuelo y cerrar dos veces no descuenta de más', () => {
    const a = inicioEscritura(100);
    const b = inicioEscritura(200);
    expect(syncSnapshot()).toMatchObject({ activas: 2, desde: 100 });
    a(true); a(true);
    expect(syncSnapshot()).toMatchObject({ activas: 1, desde: 200 });
    b(false);
    expect(syncSnapshot()).toMatchObject({ activas: 0, desde: null, ultimo: { ok: false } });
  });
});

describe('esEscrituraDeFondo', () => {
  it('telemetría, "visto" y campana no encienden la burbuja', () => {
    expect(esEscrituraDeFondo('/telemetry/error')).toBe(true);
    expect(esEscrituraDeFondo('/boards/oportunidades/items/1/updates/seen')).toBe(true);
    expect(esEscrituraDeFondo('/notifications/read-all?filter=importante')).toBe(true);
    expect(esEscrituraDeFondo('/boards/oportunidades/items/1')).toBe(false);
    expect(esEscrituraDeFondo('/boards/oportunidades/items/1/updates')).toBe(false);
  });
});
