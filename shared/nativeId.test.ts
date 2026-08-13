// La frontera entre "esto es de Monday" y "esto nació en el portal" (Zona Efrain,
// "salir de Monday") es un solo número — reconcile.ts y refetch.ts confían en
// isNativeId para NUNCA tratar un item nativo como huérfano de Monday y borrarlo
// del mirror (ver comentarios ahí). Vale la pena un test explícito del límite.
import { describe, it, expect } from 'vitest';
import { NATIVE_ID_FLOOR, isNativeId } from './nativeId';

describe('isNativeId', () => {
  it('un id real de Monday (orden de 10^9, muy por debajo del piso) no es nativo', () => {
    expect(isNativeId(18395657607)).toBe(false); // board id real, mismo orden que un item id
    expect(isNativeId(1234567890)).toBe(false);
  });

  it('el piso mismo ya cuenta como nativo', () => {
    expect(isNativeId(NATIVE_ID_FLOOR)).toBe(true);
  });

  it('cualquier id por encima del piso es nativo', () => {
    expect(isNativeId(NATIVE_ID_FLOOR + 1)).toBe(true);
    expect(isNativeId(NATIVE_ID_FLOOR + 999)).toBe(true);
  });

  it('justo debajo del piso no es nativo', () => {
    expect(isNativeId(NATIVE_ID_FLOOR - 1)).toBe(false);
  });
});
