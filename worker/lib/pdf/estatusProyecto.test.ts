// El PDF "Estatus de proyecto" es UN renglón por producto+color (Efraín,
// 2026-09-21: "POR producto y color NO TALLA!"). Estos tests cuidan el colapso
// de tallas, el texto de estatus, la fecha de lo que falta y que el Proveedor
// no salga para quien no lo recibe (ventas).
import { describe, it, expect } from 'vitest';
import {
  agruparPorProductoColor, buildEstatusProyectoBlocks, buildEstatusProyectoPdf, estatusDeLineas, fechaCorta,
  textoEmbellecimientos,
  type EstatusLinea, type EstatusProyecto,
} from './estatusProyecto';

const linea = (o: Partial<EstatusLinea>): EstatusLinea => ({
  producto: 'PANTALON TACLITE PRO', sku: '74273', color: 'NEGRO', cantidad: 5, unidad: 'PIEZA',
  proveedor: '5.11', estado: 'Entregado', comentario: '', entrega: '', ...o,
});

const proyecto = (lineas: EstatusLinea[], resumenes: Record<string, string> = {}): EstatusProyecto => ({
  folio: 'PRO-0101', nombre: 'Teotihuacan Transito', institucion: 'Municipio de Teotihuacan',
  vendedor: 'Ana', zona: 'Centro', estadoProyecto: 'Ejecución', fechaEntrega: '2026-10-28',
  documentacion: 'Documentacion Cargada', lineas, resumenes,
});

describe('agruparPorProductoColor', () => {
  it('suma las tallas en un solo renglón por producto+color', () => {
    const g = agruparPorProductoColor([
      linea({ cantidad: 5 }), linea({ cantidad: 10 }), linea({ color: 'negro ', cantidad: 5 }),
      linea({ color: 'KAKI', cantidad: 3 }),
    ], {});
    expect(g.map(x => [x.color, x.cantidad])).toEqual([['NEGRO', 20], ['KAKI', 3]]);
  });

  it('estados mezclados: piezas por estado, fecha de lo que falta y tono en proceso', () => {
    const [g] = agruparPorProductoColor([
      linea({ cantidad: 15, estado: 'Entregado', entrega: '2026-09-01' }),
      linea({ cantidad: 5, estado: 'En tránsito', entrega: '2026-10-28' }),
    ], { 'PANTALON TACLITE PRO|NEGRO': 'Quedan 5 piezas, llegan el 25 oct' });
    expect(g.estatus).toBe('Entregado 15 · En tránsito 5. Quedan 5 piezas, llegan el 25 oct');
    expect(g.entrega).toBe('28-oct-26');
    expect(g.tono).toBe('proceso');
    expect(g.entregadas).toBe(15);
  });

  it('todo entregado: verde y sin fecha; incidencia gana; sin estado = pendiente', () => {
    const [ok] = agruparPorProductoColor([linea({ entrega: '2026-09-01' })], {});
    expect([ok.tono, ok.entrega, ok.estatus]).toEqual(['entregado', '', 'Entregado']);
    const [mal] = agruparPorProductoColor([
      linea({}), linea({ estado: 'Incidencia/Retraso', comentario: 'Llegó talla equivocada' }),
    ], {});
    expect(mal.tono).toBe('incidencia');
    expect(mal.estatus).toContain('Llegó talla equivocada');
    const [pend] = agruparPorProductoColor([linea({ estado: '' })], {});
    expect([pend.tono, pend.estatus]).toEqual(['pendiente', 'Pendiente OC al Prov']);
  });
});

describe('buildEstatusProyectoBlocks', () => {
  const tabla = (p: EstatusProyecto) => {
    const t = buildEstatusProyectoBlocks({ proyectos: [p], fecha: '21/09/2026' }).find(b => b.kind === 'wrapTable');
    if (!t || t.kind !== 'wrapTable') throw new Error('sin tabla');
    return t;
  };

  it('sin proveedor visible (ventas) la columna Proveedor no sale', () => {
    expect(tabla(proyecto([linea({})])).columns.map(c => c.header)).toContain('Proveedor');
    const sin = tabla(proyecto([linea({ proveedor: '' })]));
    expect(sin.columns.map(c => c.header)).not.toContain('Proveedor');
    expect(sin.rows[0]).toHaveLength(sin.columns.length);
  });

  it('pinta un fondo por renglón y el PDF sale con varios proyectos', () => {
    const p = proyecto([linea({}), linea({ producto: 'KEPI', estado: 'En embellecimiento' })]);
    expect(tabla(p).rowFills).toEqual(['#d9f2d0', '#d6ecfa']);
    const bytes = buildEstatusProyectoPdf({ proyectos: [p, proyecto([])], alcance: 'Zona Centro', fecha: '21/09/2026' });
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('con fotos: columna Foto en la posición 1, una imagen por renglón y anchos que suman 1', () => {
    const img = { width: 2, height: 2, colorSpace: 'DeviceRGB' as const, filter: 'DCTDecode' as const, bytes: new Uint8Array(0) };
    const p = proyecto([linea({ sku: '74273' }), linea({ producto: 'KEPI', sku: 'SIN-FOTO' })]);
    for (const conProveedor of [true, false]) {
      const lineas = conProveedor ? p.lineas : p.lineas.map(l => ({ ...l, proveedor: '' }));
      const blocks = buildEstatusProyectoBlocks({
        proyectos: [{ ...p, lineas }], fecha: '21/09/2026', imagenes: new Map([['74273', img]]), fotosOmitidas: 3,
      });
      const t = blocks.find(b => b.kind === 'wrapTable');
      if (!t || t.kind !== 'wrapTable') throw new Error('sin tabla');
      expect(t.columns[1].header).toBe('Foto');
      expect(t.imageCol).toBe(1);
      expect(t.rowImages).toEqual([img, null]);
      expect(t.rows.every(r => r.length === t.columns.length)).toBe(true);
      expect(t.columns.reduce((s, c) => s + c.width, 0)).toBeCloseTo(1, 5);
      expect(t.wrapCols).toContain(2);
      const nota = blocks.find(b => b.kind === 'note');
      expect(nota && nota.kind === 'note' ? nota.text : '').toContain('3 más salen sin foto');
    }
    // Sin mapa de fotos (no se pidieron) la columna no existe y los anchos siguen sumando 1.
    const sin = tabla(p);
    expect(sin.columns.map(c => c.header)).not.toContain('Foto');
    expect(sin.imageCol).toBeUndefined();
    expect(sin.columns.reduce((s, c) => s + c.width, 0)).toBeCloseTo(1, 5);
  });
});

describe('embellecimientos en la celda del producto', () => {
  // Así vienen de Importar tallas (PRO real, 2026-09-29): el producto trae el
  // texto en su columna de zona y la línea "✨ <zona>" repite ese texto en Producto.
  const ESPALDA = 'long_text_mm1cqh8e';
  const FRENTE = 'long_text_mm1cyqts';
  const chaleco = (o: Partial<EstatusLinea>) => linea({
    producto: 'Chaleco', sku: 'CH1', estado: 'Pendiente de Recolectar',
    zonas: { [ESPALDA]: 'Parche POLICIA ESTATAL', [FRENTE]: 'N/A' }, ...o,
  });
  const casco = linea({ producto: 'Casco', sku: 'CA1', cantidad: 215, zonas: { [ESPALDA]: 'NA' } });
  const emb = (zona: string, texto: string, o: Partial<EstatusLinea> = {}) => linea({
    nombre: `✨ ${zona}`, producto: texto, sku: '', color: '', cantidad: 300, estado: 'En embellecimiento', ...o,
  });

  it('las líneas ✨ no son renglón: su estado va en la zona del producto', () => {
    const { grupos, sueltos } = estatusDeLineas([
      chaleco({ cantidad: 50 }), chaleco({ cantidad: 250 }), casco,
      emb('Espalda', 'Parche POLICIA ESTATAL'), emb('Frente derecho', 'N/A'), emb('Espalda', 'NA', { cantidad: 215 }),
    ], {});
    expect(grupos.map(g => [g.producto, g.cantidad])).toEqual([['Chaleco', 300], ['Casco', 215]]);
    expect(grupos[0].embellecimientos).toEqual([
      { zona: 'Espalda', texto: 'Parche POLICIA ESTATAL', estado: 'En embellecimiento' },
    ]);
    expect(grupos[1].embellecimientos).toEqual([]);
    expect(sueltos).toEqual([]);
  });

  it('una línea por zona; sin línea ✨ lo dice; incidencia del bordado pinta rojo', () => {
    const [g] = estatusDeLineas([
      chaleco({ zonas: { [ESPALDA]: 'Parche', [FRENTE]: 'Estrella' } }),
      emb('Espalda', 'Parche', { estado: 'Incidencia/Retraso' }),
    ], {}).grupos;
    expect(textoEmbellecimientos(g.embellecimientos)).toBe(
      '• Espalda: Parche — Incidencia/Retraso\n• Frente derecho: Estrella — sin línea en el proyecto');
    expect(g.tono).toBe('incidencia');
  });

  it('liga también por la columna de zona de la ✨ (Producto con descripción larga)', () => {
    // PRO-0141 real: la ✨ trae la especificación en Producto y el texto corto
    // del producto en su columna de zona.
    const [g] = estatusDeLineas([
      chaleco({ zonas: { [ESPALDA]: 'Texto bordado directo' } }),
      emb('Espalda', 'Camisa tactica En la espalda parte superior, bordado…', { zonas: { [ESPALDA]: 'Texto bordado directo' } }),
    ], {}).grupos;
    expect(g.embellecimientos).toEqual([{ zona: 'Espalda', texto: 'Texto bordado directo', estado: 'En embellecimiento' }]);
  });

  it('una ✨ que ningún producto reclama sale en sueltos, no se pierde', () => {
    const { sueltos } = estatusDeLineas([chaleco({}), emb('Otros', 'Código QR')], {});
    expect(sueltos).toEqual([{ zona: 'Otros', texto: 'Código QR', estado: 'En embellecimiento' }]);
  });

  it('PDF: columna Embellecimientos, anchos que suman 1 y separador por zona de venta', () => {
    const p = proyecto([chaleco({}), emb('Espalda', 'Parche POLICIA ESTATAL')]);
    const blocks = buildEstatusProyectoBlocks({ proyectos: [p, { ...p, zona: 'Norte' }], fecha: '29/09/2026' });
    const t = blocks.find(b => b.kind === 'wrapTable');
    if (!t || t.kind !== 'wrapTable') throw new Error('sin tabla');
    const iEmb = t.columns.findIndex(c => c.header === 'Embellecimientos');
    expect(iEmb).toBeGreaterThan(0);
    expect(t.wrapCols).toContain(iEmb);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0][iEmb]).toContain('Espalda: Parche POLICIA ESTATAL — En embellecimiento');
    expect(t.columns.reduce((s, c) => s + c.width, 0)).toBeCloseTo(1, 5);
    const zonas = blocks.filter(b => b.kind === 'text' && b.text.startsWith('Zona ')).map(b => b.kind === 'text' ? b.text : '');
    expect(zonas).toEqual(['Zona Centro', 'Zona Norte']);
    expect(blocks.filter(b => b.kind === 'pageBreak')).toHaveLength(1);
  });
});

describe('fechaCorta', () => {
  it('formatea ISO y deja pasar lo demás', () => {
    expect(fechaCorta('2026-09-24')).toBe('24-sep-26');
    expect(fechaCorta('pronto')).toBe('pronto');
  });
});
