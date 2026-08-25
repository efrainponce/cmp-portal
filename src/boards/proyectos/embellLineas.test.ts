import { describe, it, expect } from 'vitest';
import { emparejarEmbell, claveZona, esLineaEmbellecimiento, zonaDeNombre, type EmbLinea } from './embellLineas';

const linea = (id: string, zona: string, descripcion: string): EmbLinea => ({ id, zona, descripcion });

describe('esLineaEmbellecimiento / zonaDeNombre', () => {
  it('reconoce el prefijo ✨ y lo quita', () => {
    expect(esLineaEmbellecimiento('✨ Espalda')).toBe(true);
    expect(esLineaEmbellecimiento('Camisa táctica')).toBe(false);
    expect(zonaDeNombre('✨ Frente derecho')).toBe('Frente derecho');
    expect(zonaDeNombre('Camisa')).toBe('Camisa');
  });
});

describe('emparejarEmbell', () => {
  it('empareja por descripción aunque el nombre de la zona no case', () => {
    const zonas = [{ label: 'Manga derecha/costado derecho', value: 'Bordado del escudo, 5 cm' }];
    const lineas = [linea('1', 'Manga derecha', 'Bordado del escudo, 5 cm')];
    const { porZona, sobrantes } = emparejarEmbell(zonas, lineas);
    expect(porZona.get(claveZona(zonas[0]))?.id).toBe('1');
    expect(sobrantes).toEqual([]);
  });

  it('con dos líneas de la misma zona NO adivina por nombre — solo casa la que tiene el texto', () => {
    const zonas = [
      { label: 'Espalda', value: 'Parche POLICIA ESTATAL' },
      { label: 'Espalda', value: 'Leyenda bordada 10x4' },
    ];
    const lineas = [
      linea('1', 'Espalda', 'Parche POLICIA ESTATAL'),
      linea('2', 'Espalda', 'Leyenda bordada 10x4'),
    ];
    const { porZona, sobrantes } = emparejarEmbell(zonas, lineas);
    expect(porZona.get(claveZona(zonas[0]))?.id).toBe('1');
    expect(porZona.get(claveZona(zonas[1]))?.id).toBe('2');
    expect(sobrantes).toEqual([]);
  });

  it('no empareja por nombre cuando la zona está repetida con textos que no casan', () => {
    const zonas = [{ label: 'Espalda', value: 'Texto que ya cambió' }];
    const lineas = [linea('1', 'Espalda', 'Parche A'), linea('2', 'Espalda', 'Parche B')];
    const { porZona, sobrantes } = emparejarEmbell(zonas, lineas);
    expect(porZona.size).toBe(0);
    expect(sobrantes.map((l) => l.id)).toEqual(['1', '2']);
  });

  it('cae al nombre de la zona cuando esa zona tiene una sola línea en el proyecto', () => {
    const zonas = [{ label: 'Etiqueta de propiedad', value: 'Etiqueta tejida' }];
    const lineas = [linea('9', 'Etiqueta de propiedad', '')];
    const { porZona } = emparejarEmbell(zonas, lineas);
    expect(porZona.get(claveZona(zonas[0]))?.id).toBe('9');
  });

  it('la misma posición en dos productos comparte la MISMA línea (una sola llave)', () => {
    const z = { label: 'Frente izquierdo', value: 'Logo institucional' };
    const { porZona, sobrantes } = emparejarEmbell([z, { ...z }], [linea('7', 'Frente izquierdo', 'Logo institucional')]);
    expect(porZona.size).toBe(1);
    expect(porZona.get(claveZona(z))?.id).toBe('7');
    expect(sobrantes).toEqual([]);
  });

  it('las líneas que nadie reclama salen como sobrantes (no se esconden)', () => {
    const zonas = [{ label: 'Espalda', value: 'Parche grande' }];
    const lineas = [linea('1', 'Espalda', 'Parche grande'), linea('2', 'Etiqueta nombre', 'Nombre del elemento')];
    const { sobrantes } = emparejarEmbell(zonas, lineas);
    expect(sobrantes.map((l) => l.id)).toEqual(['2']);
  });

  it('ignora acentos, mayúsculas y puntuación al comparar', () => {
    const zonas = [{ label: 'Espalda', value: 'BORDADO  DIRECTO, 26x9 CM.' }];
    const lineas = [linea('1', 'espalda', 'Bordado directo 26x9 cm')];
    const { porZona } = emparejarEmbell(zonas, lineas);
    expect(porZona.get(claveZona(zonas[0]))?.id).toBe('1');
  });
});
