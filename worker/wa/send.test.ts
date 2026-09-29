import { describe, it, expect } from 'vitest';
import { templateNoDisponible } from './send';

describe('templateNoDisponible', () => {
  it('cae al template de respaldo solo si Meta dice que el template no se puede usar', () => {
    expect(templateNoDisponible(new Error('WhatsApp send failed (404): {"error":{"code":132001,"message":"Template name does not exist in the translation"}}'))).toBe(true);
    expect(templateNoDisponible(new Error('... "code":132015 ...'))).toBe(true);
    expect(templateNoDisponible(new Error('... "code":132016 ...'))).toBe(true);
  });
  it('un error de destinatario o de red NO reintenta', () => {
    expect(templateNoDisponible(new Error('(400): {"error":{"code":131026}}'))).toBe(false);
    expect(templateNoDisponible(new Error('(400): {"error":{"code":131049}}'))).toBe(false);
    expect(templateNoDisponible(new Error('fetch failed'))).toBe(false);
  });
});
