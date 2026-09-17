import { describe, it, expect } from 'vitest';
import { beginWrite, hasActiveWrites, readIsCurrent, readRevision } from './readConsistency';

describe('readConsistency', () => {
  it('una lectura sin escrituras en medio es vigente', () => {
    const at = readRevision();
    expect(readIsCurrent(at)).toBe(true);
  });
  it('una lectura que arrancó antes de un write NO se aplica, ni durante ni después', () => {
    const at = readRevision();
    const fin = beginWrite();
    expect(hasActiveWrites()).toBe(true);
    expect(readIsCurrent(at)).toBe(false);
    fin();
    expect(hasActiveWrites()).toBe(false);
    expect(readIsCurrent(at)).toBe(false); // el snapshot es de antes del write
    expect(readIsCurrent(readRevision())).toBe(true); // la siguiente lectura sí
  });
  it('terminar dos veces no descuenta de más', () => {
    const fin = beginWrite();
    fin(); fin();
    expect(hasActiveWrites()).toBe(false);
  });
  it('varios writes en vuelo: vigente solo cuando terminan todos', () => {
    const a = beginWrite(); const b = beginWrite();
    a();
    expect(hasActiveWrites()).toBe(true);
    b();
    expect(hasActiveWrites()).toBe(false);
  });
});
