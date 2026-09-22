import { describe, expect, it } from 'vitest';
import type { MirrorItem } from '../../shared/types';
import { agruparLineas, conEstados, lineaEstadoDe, marcarReemplazadas, ordenesDeProyecto, porFechaDeCreacion, proveedorDeLinea, unaFilaPorFolio } from './ocLista';

const M = 'https://mexicanaproteccion.monday.com/protected_static/1/resources';

function proyecto(cols: { id: string; text?: string; value?: string }[], itemId = 555): MirrorItem {
  return {
    board_id: 18395657594, item_id: itemId, parent_item_id: null, name: 'Uniformes Tlajomulco',
    group_id: null, vendedor_ids: '[]', monday_updated_at: null, synced_at: '', content_hash: '',
    columns: JSON.stringify(cols),
  };
}

describe('ordenesDeProyecto', () => {
  it('saca una fila por folio, con proyecto, zona y proveedor', () => {
    const rows = ordenesDeProyecto(proyecto([
      { id: 'file_mm0hj9pn', text: `${M}/11/OC_OC-305_ATHLETIC%20FOOTWEAR.pdf, ${M}/12/OC_OC-307_GAPPY%20ARMOR.pdf` },
      { id: 'dropdown_mm0hnyv', text: 'Centro' },
      { id: 'pulse_id_mm1a12gy', text: 'PRO-0042' },
    ]));
    expect(rows.map(r => r.folio)).toEqual(['OC-305', 'OC-307']);
    expect(rows[0]).toMatchObject({
      proveedor: 'ATHLETIC FOOTWEAR', proyectoId: '555', proyecto: 'Uniformes Tlajomulco',
      proyectoFolio: 'PRO-0042', zona: 'Centro', pagada: false, urlSinCostos: null,
    });
  });

  it('las dos copias de una orden (con y sin costos) son UNA fila', () => {
    const rows = ordenesDeProyecto(proyecto([
      { id: 'file_mm0hj9pn', text: `${M}/1/OC_OC-310_GDL_TACTICAL_SIN-COSTOS.pdf, ${M}/2/OC_OC-310_GDL_TACTICAL.pdf` },
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('/api/files/proyectos/555/oc/OC_OC-310_GDL_TACTICAL.pdf');
    expect(rows[0].proveedor).toBe('GDL TACTICAL');
    expect(rows[0].urlSinCostos).toBe('/api/files/proyectos/555/oc/OC_OC-310_GDL_TACTICAL_SIN-COSTOS.pdf');
  });

  it('el link cuelga SIEMPRE del proyecto, aunque tenga Oportunidad ligada', () => {
    // El key por oportunidad hace que /api/files adivine el proyecto, y con
    // proyectos clonados (misma oportunidad) caía en el otro: 404.
    const rows = ordenesDeProyecto(proyecto([
      { id: 'file_mm0hj9pn', text: `${M}/3144927875/OC_OC-9_ACME.pdf` },
      { id: 'board_relation_mm0hf0y3', text: 'OPP', value: JSON.stringify({ linked_item_ids: [777] }) },
    ]));
    expect(rows[0].url).toBe('/api/files/proyectos/555/oc/OC_OC-9_ACME.pdf');
    expect(rows[0].assetId).toBe('3144927875');
    expect(rows[0].zona).toBeNull();
  });

  it('el clon de Monday guarda "….pdf.pdf": el link lleva el nombre COMPLETO', () => {
    const rows = ordenesDeProyecto(proyecto([
      { id: 'file_mm0hj9pn', text: `${M}/1/OC_OC-107_ARMOR%20LIFE%20LAB.pdf.pdf` },
    ]));
    expect(rows[0]).toMatchObject({ folio: 'OC-107', proveedor: 'ARMOR LIFE LAB' });
    expect(rows[0].url).toBe('/api/files/proyectos/555/oc/OC_OC-107_ARMOR%20LIFE%20LAB.pdf.pdf');
  });

  it('un proyecto sin OC, o con columnas ilegibles, no produce filas', () => {
    expect(ordenesDeProyecto(proyecto([{ id: 'file_mm0hj9pn', text: '' }]))).toEqual([]);
    expect(ordenesDeProyecto({ ...proyecto([]), columns: '{roto' })).toEqual([]);
  });
});

describe('unaFilaPorFolio', () => {
  it('el mismo folio en el original y en su clon es UNA orden (no se paga dos veces)', () => {
    const archivo = { id: 'file_mm0hj9pn', text: `${M}/1/OC_OC-40_ZAPATOS.pdf` };
    const clon = ordenesDeProyecto({ ...proyecto([archivo, { id: 'pulse_id_mm1a12gy', text: 'PRO-0091' }], 900), name: 'Zapato (copy)' });
    const original = ordenesDeProyecto(proyecto([archivo, { id: 'pulse_id_mm1a12gy', text: 'PRO-0082' }], 800));
    const filas = unaFilaPorFolio([...clon, ...original]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ proyectoId: '800', proyectoFolio: 'PRO-0082' });
    expect(filas[0].tambienEn).toEqual([{ proyectoId: '900', proyectoFolio: 'PRO-0091', proyecto: 'Zapato (copy)' }]);
  });
});

describe('marcarReemplazadas', () => {
  const filas = (itemId: number, archivos: string[]) =>
    ordenesDeProyecto(proyecto([{ id: 'file_mm0hj9pn', text: archivos.map((a, i) => `${M}/${i}/${a}`).join(', ') }], itemId));

  it('de un proveedor en un proyecto solo la OC más reciente queda vigente', () => {
    const out = marcarReemplazadas(filas(555, ['OC_OC-312_DIANA LAURA.pdf', 'OC_OC-317_DIANA LAURA.pdf', 'OC_OC-313_DIANA LAURA.pdf', 'OC_OC-310_GDL TACTICAL.pdf']));
    expect(Object.fromEntries(out.map(o => [o.folio, o.reemplazadaPor]))).toEqual({
      'OC-312': 'OC-317', 'OC-313': 'OC-317', 'OC-317': null, 'OC-310': null,
    });
  });

  it('el mismo proveedor en OTRO proyecto es otra compra', () => {
    const out = marcarReemplazadas([...filas(555, ['OC_OC-10_ACME.pdf']), ...filas(556, ['OC_OC-20_ACME.pdf'])]);
    expect(out.every(o => o.reemplazadaPor === null)).toBe(true);
  });

  it('el saneo del nombre de archivo no parte al proveedor en dos', () => {
    const out = marcarReemplazadas(filas(555, ['OC_OC-21_5_11 Tactical de México SA.pdf', 'OC_OC-31_5 11 TACTICAL DE MEXICO SA.pdf']));
    expect(out.find(o => o.folio === 'OC-21')?.reemplazadaPor).toBe('OC-31');
  });
});

describe('porFechaDeCreacion', () => {
  const fila = (folio: string, fecha: string | null) =>
    ({ ...ordenesDeProyecto(proyecto([{ id: 'file_mm0hj9pn', text: `${M}/1/OC_${folio}_ACME.pdf` }]))[0], fecha });

  it('la más reciente primero; mismo día → folio más alto primero', () => {
    const out = [fila('OC-10', '2026-09-01'), fila('OC-12', '2026-09-18'), fila('OC-11', '2026-09-18')].sort(porFechaDeCreacion);
    expect(out.map(o => o.folio)).toEqual(['OC-12', 'OC-11', 'OC-10']);
  });

  it('una orden sin fecha (PDF aún sin leer) se acomoda por folio, no se va al fondo', () => {
    const out = [fila('OC-10', '2026-09-01'), fila('OC-11', null), fila('OC-12', '2026-09-18')].sort(porFechaDeCreacion);
    expect(out.map(o => o.folio)).toEqual(['OC-12', 'OC-11', 'OC-10']);
  });
});

describe('estado de los productos de la OC', () => {
  const linea = (parent: number, proveedor: string, rz: string, estado: string, cantidad: string): MirrorItem => ({
    ...proyecto([
      { id: 'board_relation_mm1cfgv5', text: proveedor }, { id: 'lookup_mm1d2y9b', text: rz },
      { id: 'color_mm0hqf79', text: estado }, { id: 'numeric_mm0hj2q4', text: cantidad },
    ], 1), board_id: 18395657609, parent_item_id: parent,
  });
  const ordenes = (archivos: string[]) => marcarReemplazadas(
    ordenesDeProyecto(proyecto([{ id: 'file_mm0hj9pn', text: archivos.map((a, i) => `${M}/${i}/${a}`).join(', ') }])));

  it('suma PIEZAS por etiqueta de las líneas del proveedor, empatando por razón social', () => {
    const lineas = [
      linea(555, 'UNIMX', 'Diana Laura Morales del Razo', 'Entregado', '13'),
      linea(555, 'UNIMX', 'Diana Laura Morales del Razo', 'Entregado', '34'),
      linea(555, 'UNIMX', 'Diana Laura Morales del Razo', 'En tránsito', '21'),
      linea(555, 'GDL', 'GDL TACTICAL', 'Entregado', '99'), // otro proveedor
      linea(777, 'UNIMX', 'Diana Laura Morales del Razo', 'Entregado', '500'), // otro proyecto
    ].map(l => lineaEstadoDe(l)!);
    const [o] = conEstados(ordenes(['OC_OC-317_DIANA LAURA MORALES DEL RAZO.pdf']), lineas);
    expect(o.estados).toEqual([{ label: 'Entregado', piezas: 47 }, { label: 'En tránsito', piezas: 21 }]);
  });

  it('una re-emisión no lleva estado: es el de la orden vigente', () => {
    const lineas = [lineaEstadoDe(linea(555, 'ACME', 'ACME', 'Entregado', '5'))!];
    const out = conEstados(ordenes(['OC_OC-10_ACME.pdf', 'OC_OC-12_ACME.pdf']), lineas);
    expect(out.find(o => o.folio === 'OC-10')?.estados).toBeNull();
    expect(out.find(o => o.folio === 'OC-12')?.estados).toEqual([{ label: 'Entregado', piezas: 5 }]);
  });

  it('razón social cortada a 40 en el nombre del archivo: empata por prefijo', () => {
    const rz = 'CREACIONES Y DISEÑOS SAN ANTONIO DE PADUA SA DE CV';
    const lineas = [lineaEstadoDe(linea(555, 'Creaciones', rz, 'En produccion', '8'))!];
    const [o] = conEstados(ordenes([`OC_OC-178_${rz.slice(0, 40).trim()}.pdf`]), lineas);
    expect(o.estados).toEqual([{ label: 'En produccion', piezas: 8 }]);
  });

  it('un nombre corto no empata por prefijo con medio mundo; sin líneas → null', () => {
    const lineas = [lineaEstadoDe(linea(555, 'GRUPO TEXTIL BEGOSA', 'GRUPO TEXTIL BEGOSA SA', 'Entregado', '5'))!];
    expect(conEstados(ordenes(['OC_OC-1_GRUPO.pdf']), lineas)[0].estados).toBeNull();
    expect(lineaEstadoDe(linea(555, '', '', 'Entregado', '5'))).toBeNull();
  });

  it('agruparLineas: lo que se guarda en caché da el MISMO estado que las líneas sueltas', () => {
    const sueltas = [
      linea(555, 'UNIMX', 'Diana Laura Morales del Razo', 'Entregado', '13'),
      linea(555, 'UNIMX', 'Diana Laura Morales del Razo', 'Entregado', '34'),
      linea(555, 'UNIMX', 'Diana Laura Morales del Razo', 'En tránsito', '21'),
      linea(777, 'UNIMX', 'Diana Laura Morales del Razo', 'Entregado', '500'),
    ].map(l => lineaEstadoDe(l)!);
    const agrupadas = agruparLineas(sueltas);
    expect(agrupadas).toHaveLength(3);
    const oc = ordenes(['OC_OC-317_DIANA LAURA MORALES DEL RAZO.pdf']);
    // Sobrevive a guardarse como JSON, que es como vive en oc_lista_cache.
    expect(conEstados(oc, JSON.parse(JSON.stringify(agrupadas)))).toEqual(conEstados(oc, sueltas));
  });
});

describe('proveedorDeLinea (filtro Proveedor del Reporte de Proyectos)', () => {
  const sub = (parent: number | null, cols: { id: string; text?: string }[]): MirrorItem => ({
    board_id: 1, item_id: 1, parent_item_id: parent, name: 'Bota', group_id: null, vendedor_ids: '[]',
    monday_updated_at: null, synced_at: '', content_hash: '', columns: JSON.stringify(cols),
  });

  it('usa el nombre de la relación; la razón social solo si viene vacía', () => {
    expect(proveedorDeLinea(sub(555, [
      { id: 'board_relation_mm1cfgv5', text: 'UNIMX' }, { id: 'lookup_mm1d2y9b', text: 'Diana Laura Morales' },
    ]))).toEqual({ proyectoId: '555', proveedor: 'UNIMX' });
    expect(proveedorDeLinea(sub(555, [{ id: 'lookup_mm1d2y9b', text: 'Diana Laura Morales' }])))
      .toEqual({ proyectoId: '555', proveedor: 'Diana Laura Morales' });
  });

  it('sin proveedor o sin proyecto padre → null', () => {
    expect(proveedorDeLinea(sub(555, []))).toBeNull();
    expect(proveedorDeLinea(sub(null, [{ id: 'board_relation_mm1cfgv5', text: 'UNIMX' }]))).toBeNull();
  });
});
