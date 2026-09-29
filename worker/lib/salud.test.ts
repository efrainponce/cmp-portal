// Las partes puras de la revisión de salud (worker/lib/salud.ts): comparar
// tallas contra la cotización, clasificar un 'conflict' del outbox y agrupar
// rutas. Nacen de OPP-0970 / PRO-0171 (2026-09-10): la cotización y las
// tallas dejaron de cuadrar y nadie lo vio en dos semanas.
import { describe, it, expect } from 'vitest';
import { archivosSinMover, compararTallas, diferenciasOutbox, normalizarRuta, zonasHabituales } from './salud';

describe('compararTallas', () => {
  it('cuadra: misma cantidad por SKU y color (sin distinguir mayúsculas ni acentos)', () => {
    const cot = [{ sku: '71049', color: 'BLACK', cantidad: 650 }];
    const pro = [
      { sku: '71049', color: 'Black', cantidad: 600 },
      { sku: '71049', color: 'black ', cantidad: 50 },
    ];
    expect(compararTallas(cot, pro)).toEqual([]);
  });

  it('OPP-0970: el modelo de dama cotizado no está en el Proyecto y el de caballero trae de más', () => {
    const cot = [
      { sku: '71049', color: 'BLACK', cantidad: 650 },
      { sku: '61165', color: 'BLACK', cantidad: 250 },
    ];
    const pro = [{ sku: '71049', color: 'BLACK', cantidad: 900 }];
    const difs = compararTallas(cot, pro);
    expect(difs).toContainEqual({ sku: '71049', color: 'BLACK', cotizado: 650, enProyecto: 900 });
    expect(difs).toContainEqual({ sku: '61165', color: 'BLACK', cotizado: 250, enProyecto: 0 });
  });

  it('un color que la cotización no tiene, de un producto cotizado, también sale', () => {
    const difs = compararTallas(
      [{ sku: '72175', color: 'Black', cantidad: 10 }],
      [{ sku: '72175', color: 'Black', cantidad: 10 }, { sku: '72175', color: 'Khaki', cantidad: 4 }],
    );
    expect(difs).toEqual([{ sku: '72175', color: 'Khaki', cotizado: 0, enProyecto: 4 }]);
  });

  it('sin ninguna talla de los productos cotizados todavía: nada que comparar', () => {
    expect(compararTallas([{ sku: '72175', color: 'Black', cantidad: 10 }], [])).toEqual([]);
    expect(compararTallas(
      [{ sku: '72175', color: 'Black', cantidad: 10 }],
      [{ sku: 'BORDADO DIRECTO', color: 'VARIOS', cantidad: 10 }],
    )).toEqual([]);
  });

  it('las líneas de embellecimiento del Proyecto (SKU que no está cotizado) se ignoran', () => {
    const difs = compararTallas(
      [{ sku: '72175', color: 'Black', cantidad: 10 }],
      [{ sku: '72175', color: 'Black', cantidad: 10 }, { sku: 'BORDADO DIRECTO', color: 'BLANCO', cantidad: 10 }],
    );
    expect(difs).toEqual([]);
  });
});

describe('diferenciasOutbox', () => {
  const columnas = JSON.stringify([
    { id: 'numeric_mkzneg3d', text: '1,490', value: '"1490"' },
    { id: 'deal_stage', text: 'Costeo Confirmado', value: '{"index":9}' },
    { id: 'board_relation_mkzmafgp', text: 'X', value: '{"linked_item_ids":["11946234945"]}' },
  ]);

  it('un conflicto que al final sí quedó igual no es una diferencia', () => {
    expect(diferenciasOutbox({ numeric_mkzneg3d: '1490', deal_stage: 'costeo confirmado' }, null, columnas)).toEqual({});
    expect(diferenciasOutbox({ board_relation_mkzmafgp: '11946234945' }, null, columnas)).toEqual({});
  });

  it('un valor distinto en Monday sí es una diferencia', () => {
    expect(diferenciasOutbox({ numeric_mkzneg3d: '890' }, null, columnas))
      .toEqual({ numeric_mkzneg3d: { enviado: '890', actual: '1,490' } });
  });

  it('el nombre se compara contra el nombre del item', () => {
    expect(diferenciasOutbox({ name: 'Nueva' }, 'Otra', columnas)).toEqual({ name: { enviado: 'Nueva', actual: 'Otra' } });
  });
});

describe('normalizarRuta', () => {
  it('cambia los ids largos por :id para agrupar', () => {
    expect(normalizarRuta('/api/oportunidades/lineas/12720269241/ajustar')).toBe('/api/oportunidades/lineas/:id/ajustar');
    expect(normalizarRuta('/api/boards/oportunidades_sub/items/13021725464')).toBe('/api/boards/oportunidades_sub/items/:id');
  });
});

describe('zonasHabituales', () => {
  it('toma la zona con 60 % o más de las filas de la persona (mínimo 3)', () => {
    const filas = [
      ...Array(4).fill({ personas: [1], zona: 'Sureste' }),
      { personas: [1], zona: 'Sur' },
      ...Array(2).fill({ personas: [2], zona: 'Centro' }), // solo 2: no alcanza
      ...Array(3).fill({ personas: [3], zona: 'Centro' }),
      ...Array(3).fill({ personas: [3], zona: 'Norte' }),  // 50/50: sin zona habitual
      { personas: [1], zona: '' },
    ];
    const z = zonasHabituales(filas);
    expect(z.get(1)).toBe('Sureste');
    expect(z.has(2)).toBe(false);
    expect(z.has(3)).toBe(false);
  });
});

describe('archivosSinMover', () => {
  const ahora = Date.UTC(2026, 8, 29, 18);
  const hace = (min: number) => ahora - min * 60_000;
  it('solo archivos ASSET subidos hace más del tope', () => {
    const valor = JSON.stringify({ files: [
      { name: 'OC.pdf', fileType: 'ASSET', assetId: 1, createdAt: hace(120) },
      { name: 'recien.pdf', fileType: 'ASSET', assetId: 2, createdAt: hace(5) },
      { name: 'doc', fileType: 'MONDAY_DOC', createdAt: hace(500) },
    ] });
    expect(archivosSinMover(valor, ahora)).toEqual(['OC.pdf']);
  });
  it('columna vacía o inválida = nada', () => {
    expect(archivosSinMover(null, ahora)).toEqual([]);
    expect(archivosSinMover('{}', ahora)).toEqual([]);
    expect(archivosSinMover('no json', ahora)).toEqual([]);
  });
});
