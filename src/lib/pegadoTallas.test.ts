import { describe, it, expect } from 'vitest';
import { parsePegadoTallas } from './pegadoTallas';

const TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

describe('parsePegadoTallas', () => {
  it('una sola celda no es un bloque: pega el navegador', () => {
    expect(parsePegadoTallas('12', TALLAS, 0)).toBeNull();
  });

  it('fila de cantidades se reparte desde la cajita donde se pegó', () => {
    expect(parsePegadoTallas('5\t10\t\t3', TALLAS, 1)).toEqual({ S: '5', M: '10', XL: '3' });
  });

  it('lo que se sale de las tallas visibles se ignora', () => {
    expect(parsePegadoTallas('1\t2\t3', TALLAS, 5)).toEqual({ XXL: '1', '3XL': '2' });
  });

  it('encabezado + cantidades va por nombre de talla, y crea tallas nuevas', () => {
    expect(parsePegadoTallas('s\tM\t4XL\n7\t\t2\n', TALLAS, 3)).toEqual({ S: '7', '4XL': '2' });
  });

  it('dos columnas talla | cantidad', () => {
    expect(parsePegadoTallas('M\t12\r\nxl\t4\r\n32x30\t6', TALLAS, 0)).toEqual({ M: '12', XL: '4', '32X30': '6' });
  });

  it('texto que no es un desglose no se toca', () => {
    expect(parsePegadoTallas('hola\tmundo', TALLAS, 0)).toBeNull();
  });
});
