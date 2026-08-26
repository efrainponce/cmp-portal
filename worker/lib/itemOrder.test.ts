// El reacomodo del dragger de las OC (worker/lib/itemOrder.ts): lo que se
// arrastra es UNA tarjeta de proveedor, y lo que NO puede pasar es que eso
// mueva de lugar las líneas de los otros proveedores — el mismo orden lo leen
// Cotización y Tallas, y el PDF de todas las OC del Proyecto.
import { describe, it, expect } from 'vitest';
import { aplicarOrdenParcial } from './itemOrder';

describe('aplicarOrdenParcial', () => {
  it('permuta solo los lugares que ocupaban las líneas movidas', () => {
    // A y C son del proveedor que se arrastró; B y D son de otro y quedan
    // exactamente donde estaban (posiciones 1 y 3).
    expect(aplicarOrdenParcial([1, 2, 3, 4], [3, 1])).toEqual([3, 2, 1, 4]);
  });

  it('deja el orden igual si el subset ya viene acomodado', () => {
    expect(aplicarOrdenParcial([1, 2, 3, 4], [1, 3])).toEqual([1, 2, 3, 4]);
  });

  it('acomoda el proyecto entero cuando todas las líneas son del mismo proveedor', () => {
    expect(aplicarOrdenParcial([1, 2, 3], [3, 2, 1])).toEqual([3, 2, 1]);
  });

  it('no pierde ni duplica líneas', () => {
    const actual = [10, 20, 30, 40, 50];
    const out = aplicarOrdenParcial(actual, [50, 30, 10]);
    expect(out).toEqual([50, 20, 30, 40, 10]);
    expect([...out].sort((a, b) => a - b)).toEqual(actual);
  });

  it('ignora un subset vacío', () => {
    expect(aplicarOrdenParcial([1, 2, 3], [])).toEqual([1, 2, 3]);
  });
});
