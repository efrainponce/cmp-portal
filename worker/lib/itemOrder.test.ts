// El reacomodo del dragger de las OC (worker/lib/itemOrder.ts): lo que se
// arrastra es UNA tarjeta de proveedor, y lo que NO puede pasar es que eso
// mueva de lugar las líneas de los otros proveedores — el mismo orden lo leen
// Cotización y Tallas, y el PDF de todas las OC del Proyecto.
import { describe, it, expect } from 'vitest';
import { aplicarOrdenParcial, ordenarPorPosicion } from './itemOrder';

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

// La cotización nativa y la OC nativa traen las líneas DIRECTO de Monday y las
// reacomodan con esto (2026-09-28): Monday no deja reordenar subitems.
describe('ordenarPorPosicion', () => {
  const l = (id: string) => ({ id });
  it('acomoda según el orden del portal', () => {
    const orden = new Map([[3, 0], [1, 1], [2, 2]]);
    expect(ordenarPorPosicion([l('1'), l('2'), l('3')], orden).map(x => x.id)).toEqual(['3', '1', '2']);
  });
  it('las líneas sin lugar (recién creadas) van al final, en el orden de Monday', () => {
    const orden = new Map([[2, 0], [1, 1]]);
    expect(ordenarPorPosicion([l('9'), l('1'), l('8'), l('2')], orden).map(x => x.id)).toEqual(['2', '1', '9', '8']);
  });
  it('sin orden guardado, queda exactamente como vino de Monday', () => {
    const lineas = [l('5'), l('4')];
    expect(ordenarPorPosicion(lineas, new Map())).toBe(lineas);
  });
});
