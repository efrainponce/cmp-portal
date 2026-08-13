// Reparación/validación de embellecimiento (worker/lib/costeo.ts, flujo nativo de
// "Mandar a costeo") — mirror 1:1 de validar_costeo.py's _try_repair_embellecimiento
// / _validate_embellecimiento. Ancla el formato exacto (separador "\n,,", todas las
// claves aunque vacías) porque Monday no perdona un JSON mal formado en silencio.
import { describe, it, expect } from 'vitest';
import { repairEmbellecimiento, embellecimientoTemplateError, parseEmbellecimiento } from './embellecimiento';

describe('repairEmbellecimiento', () => {
  it('texto vacío: no repara', () => {
    expect(repairEmbellecimiento('')).toEqual({ text: '', repaired: false });
    expect(repairEmbellecimiento(undefined)).toEqual({ text: '', repaired: false });
  });

  it('sin ninguna clave de plantilla reconocida: no repara (nada que preservar)', () => {
    const raw = 'Otra cosa cualquiera';
    expect(repairEmbellecimiento(raw)).toEqual({ text: raw, repaired: false });
  });

  it('ya completa (las 8 claves presentes): no repara', () => {
    const raw = 'Espalda:x,,Frente derecho:,,Frente izquierdo:,,Manga derecha/costado derecho:,,'
      + 'Manga izquierda/costado izquierdo:,,Etiqueta del fabricante:,,Etiqueta de propiedad:,,Otros:';
    expect(repairEmbellecimiento(raw).repaired).toBe(false);
  });

  it('con al menos una clave conocida con valor y claves faltantes: repara agregando TODAS las claves', () => {
    const raw = 'Espalda:Bordado logo';
    const { text, repaired } = repairEmbellecimiento(raw);
    expect(repaired).toBe(true);
    // Separador "\n,," (no ",," a secas — distinto de serializeEmbellecimiento).
    expect(text).toBe(
      'Espalda:Bordado logo\n,,Frente derecho:\n,,Frente izquierdo:\n,,'
      + 'Manga derecha/costado derecho:\n,,Manga izquierda/costado izquierdo:\n,,'
      + 'Etiqueta del fabricante:\n,,Etiqueta de propiedad:\n,,Otros:',
    );
    // El texto reparado sigue siendo parseable y conserva el valor original.
    expect(parseEmbellecimiento(text).Espalda).toBe('Bordado logo');
  });

  it('clave conocida presente pero vacía: cuenta como "nada que preservar" si es la única', () => {
    const raw = 'Espalda:';
    expect(repairEmbellecimiento(raw).repaired).toBe(false);
  });
});

describe('embellecimientoTemplateError', () => {
  it('vacío: sin error (no bloquea una línea sin embellecimiento)', () => {
    expect(embellecimientoTemplateError('')).toBeNull();
    expect(embellecimientoTemplateError(undefined)).toBeNull();
  });

  it('faltan claves: error nombrando hasta 2', () => {
    const err = embellecimientoTemplateError('Espalda:x');
    expect(err).toContain('faltan');
    expect(err).toContain('Frente derecho');
  });

  it('las 8 claves presentes pero todas vacías: error de "al menos un valor"', () => {
    const raw = 'Espalda:,,Frente derecho:,,Frente izquierdo:,,Manga derecha/costado derecho:,,'
      + 'Manga izquierda/costado izquierdo:,,Etiqueta del fabricante:,,Etiqueta de propiedad:,,Otros:';
    expect(embellecimientoTemplateError(raw)).toMatch(/al menos un valor/);
  });

  it('completa y con al menos un valor: sin error', () => {
    const raw = 'Espalda:Bordado,,Frente derecho:,,Frente izquierdo:,,Manga derecha/costado derecho:,,'
      + 'Manga izquierda/costado izquierdo:,,Etiqueta del fabricante:,,Etiqueta de propiedad:,,Otros:';
    expect(embellecimientoTemplateError(raw)).toBeNull();
  });
});
