// Lo que decide QUÉ renglones se reescriben cuando Compras cambia el producto
// de una OC (falta de inventario, Efraín 2026-08-25). Es la pieza donde un
// error no se ve: cambiar de más arrastra tallas de otro producto, cambiar de
// menos deja media OC con el producto viejo y parte el grupo producto+color.
import { describe, it, expect } from 'vitest';
import { lineasDelGrupo, avisosDeEstado } from './proyectoLineaProducto';
import type { MirrorItem } from '../../shared/types';

const S_PRODUCTO = 'text_mm0hs17x';
const S_COLOR = 'text_mm0h4a1c';
const S_TALLA = 'text_mm1antcb';
const S_ESTADO = 'color_mm0hqf79';

function linea(
  itemId: number, producto: string, color: string, talla: string, estado = '', name?: string,
): MirrorItem {
  const cols = [
    { id: S_PRODUCTO, type: 'text', text: producto, value: null },
    { id: S_COLOR, type: 'text', text: color, value: null },
    { id: S_TALLA, type: 'text', text: talla, value: null },
    { id: S_ESTADO, type: 'color', text: estado, value: null },
  ];
  return { item_id: itemId, name: name ?? producto, columns: JSON.stringify(cols) } as unknown as MirrorItem;
}

// Desglose real: un producto en dos colores + otro producto suelto.
const HIJOS = [
  linea(1, 'Camisola Táctica', 'Negro', 'CH'),
  linea(2, 'Camisola Táctica', 'Negro', 'M'),
  linea(3, 'Camisola Táctica', 'Negro', 'G'),
  linea(4, 'Camisola Táctica', 'Azul', 'M'),
  linea(5, 'Pantalón Cargo', 'Negro', 'M'),
];

describe('lineasDelGrupo', () => {
  it('toma todas las tallas del producto+color y ninguna más', () => {
    const g = lineasDelGrupo(HIJOS, 'Camisola Táctica', 'Negro');
    expect(g.map(l => l.item_id)).toEqual([1, 2, 3]);
  });

  it('el color separa grupos — cambiar el negro no toca el azul', () => {
    expect(lineasDelGrupo(HIJOS, 'Camisola Táctica', 'Azul').map(l => l.item_id)).toEqual([4]);
  });

  it('acentos, mayúsculas y espacios de más no parten el grupo', () => {
    // El texto llega del catálogo de cmp-tallas y de la celda inline: si el
    // match fuera exacto, "camisola  tactica" cambiaría 0 líneas en silencio.
    expect(lineasDelGrupo(HIJOS, '  camisola  tactica ', 'NEGRO').map(l => l.item_id)).toEqual([1, 2, 3]);
  });

  it('sin color pedido solo caen las líneas sin color', () => {
    const conSinColor = [...HIJOS, linea(6, 'Camisola Táctica', '', 'M')];
    expect(lineasDelGrupo(conSinColor, 'Camisola Táctica', '').map(l => l.item_id)).toEqual([6]);
  });

  it('cae al name del item cuando la columna Producto está vacía', () => {
    // Las líneas importadas por cmp-tallas a veces solo traen el nombre del
    // subitem; la UI ya usa ese mismo fallback para agrupar.
    const sinCol = [linea(7, '', 'Negro', 'M', '', 'Camisola Táctica')];
    expect(lineasDelGrupo(sinCol, 'Camisola Táctica', 'Negro').map(l => l.item_id)).toEqual([7]);
  });

  it('soloLineaId acota a una talla PERO solo dentro del grupo', () => {
    expect(lineasDelGrupo(HIJOS, 'Camisola Táctica', 'Negro', 2).map(l => l.item_id)).toEqual([2]);
    // Un id de otro producto no puede colarse: el grupo manda, no el id.
    expect(lineasDelGrupo(HIJOS, 'Camisola Táctica', 'Negro', 5)).toEqual([]);
  });

  it('un producto que ya no existe en el proyecto no cambia nada', () => {
    expect(lineasDelGrupo(HIJOS, 'Chamarra', 'Negro')).toEqual([]);
  });
});

describe('avisosDeEstado', () => {
  it('avisa cuando la OC del producto anterior ya salió, agrupando por estado', () => {
    const avisos = avisosDeEstado([
      linea(1, 'Camisola', 'Negro', 'CH', 'OC Proveedor enviada'),
      linea(2, 'Camisola', 'Negro', 'M', 'OC Proveedor enviada'),
      linea(3, 'Camisola', 'Negro', 'G', 'En produccion'),
    ]);
    expect(avisos).toHaveLength(2);
    expect(avisos.join(' ')).toContain('2 líneas ya van en "OC Proveedor enviada"');
    expect(avisos.join(' ')).toContain('1 línea ya va en "En produccion"');
  });

  it('no avisa cuando nada ha salido todavía', () => {
    expect(avisosDeEstado([
      linea(1, 'Camisola', 'Negro', 'CH', 'Pendiente OC al Prov'),
      linea(2, 'Camisola', 'Negro', 'M', ''),
    ])).toEqual([]);
  });
});
