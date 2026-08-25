// El nombre del archivo se IMPRIME como "Referencia" en la ficha de la OC que
// recibe el proveedor (worker/lib/proyectoImagenes.ts), así que lo que se
// guarda no puede ser el nombre crudo del archivo.
import { describe, it, expect } from 'vitest';
import { limpiarNombre } from './proyectoImagenes';

describe('limpiarNombre', () => {
  it('quita la extensión y vuelve legible el nombre del archivo', () => {
    expect(limpiarNombre('render-frente.png', 'x')).toBe('render frente');
    expect(limpiarNombre('muestra_aprobada_final.JPG', 'x')).toBe('muestra aprobada final');
  });

  it('un nombre que ya venía escrito a mano se respeta', () => {
    expect(limpiarNombre('Bordado escudo municipal', 'x')).toBe('Bordado escudo municipal');
  });

  it('sin nombre usable cae al de respaldo', () => {
    expect(limpiarNombre('   ', 'Imagen CT17')).toBe('Imagen CT17');
    expect(limpiarNombre('.png', 'Imagen CT17')).toBe('Imagen CT17');
  });

  it('acota el largo: la ficha tiene un renglón, no un párrafo', () => {
    expect(limpiarNombre('a'.repeat(200), 'x')).toHaveLength(60);
  });
});
