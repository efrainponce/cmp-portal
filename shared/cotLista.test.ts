import { describe, expect, it } from 'vitest';
import type { MirrorItem } from './types';
import { cotizacionesDeOportunidad, folioDeArchivo, marcarReemplazadas, porFecha, unaFilaPorFolio } from './cotLista';

const M = 'https://mexicanaproteccion.monday.com/protected_static/1/resources';

function opp(itemId: number, folio: string, cols: { id: string; text?: string }[]): MirrorItem {
  return {
    board_id: 18395657596, item_id: itemId, parent_item_id: null, name: `${folio} - Uniformes`,
    group_id: null, vendedor_ids: '[]', monday_updated_at: null, synced_at: '', content_hash: '',
    columns: JSON.stringify([{ id: 'pulse_id_mm0qcq0m', text: folio }, ...cols]),
  };
}

describe('folioDeArchivo', () => {
  it('lee los dos formatos de nombre y la firmada (.pdf.pdf)', () => {
    expect(folioDeArchivo('cotizacion_1109_-_1.pdf')).toEqual({ folio: '1109-1', numero: '1109', version: 1, era: 1, clave: '1-1109-1' });
    expect(folioDeArchivo('cotización_0167 - 2.pdf')).toMatchObject({ folio: '0167-2', era: 0, clave: '0-0167-2' });
    expect(folioDeArchivo('cotizacion_0858_-_2.pdf.pdf')?.folio).toBe('0858-2');
  });
  it('deja fuera la solicitud de costeo y los PDFs subidos a mano', () => {
    expect(folioDeArchivo('cotizacion_0053_-_1_sin_precio.pdf')).toBeNull();
    expect(folioDeArchivo('COTIZACION GRAYKEY NUEVO LEON.pdf')).toBeNull();
  });
});

describe('cotizacionesDeOportunidad', () => {
  it('una fila por folio, juntando la sin firmar con la firmada', () => {
    const rows = cotizacionesDeOportunidad(opp(10, 'OPP-0858', [
      { id: 'file_mm0fgrzq', text: `${M}/1/cotizacion_0858_-_1.pdf, ${M}/2/cotizacion_0858_-_2.pdf` },
      { id: 'file_mm0zjras', text: `${M}/3/cotizacion_0858_-_1.pdf.pdf` },
      { id: 'lookup_mm1bs976', text: 'Municipio de Cuautlancingo' },
      { id: 'dropdown_mm03g067', text: 'Centro' },
      { id: 'deal_owner', text: 'Ana López' },
      { id: 'deal_stage', text: 'Ganada' },
    ]));
    expect(rows.map(r => r.folio)).toEqual(['0858-1', '0858-2']);
    expect(rows[0]).toMatchObject({
      institucion: 'Municipio de Cuautlancingo', zona: 'Centro', vendedor: 'Ana López', etapa: 'Ganada', llave: '1',
      url: '/api/files/oportunidades/10/cotizacion-no-firmada/cotizacion_0858_-_1.pdf',
      urlFirmada: '/api/files/oportunidades/10/cotizacion-firmada/cotizacion_0858_-_1.pdf.pdf',
    });
    expect(rows[1].urlFirmada).toBeNull();
  });
});

describe('unaFilaPorFolio', () => {
  it('la copia que se lleva una oportunidad duplicada se queda en la dueña del folio', () => {
    const original = opp(50, 'OPP-0624', [{ id: 'file_mm0fgrzq', text: `${M}/1/cotizacion_0624_-_1.pdf` }]);
    // El clon es más VIEJO por id a propósito: manda el folio, no el id.
    const clon = opp(20, 'OPP-1109', [{ id: 'file_mm0fgrzq', text: `${M}/9/cotizacion_0624_-_1.pdf, ${M}/8/cotizacion_1109_-_1.pdf` }]);
    const rows = unaFilaPorFolio([clon, original].flatMap(cotizacionesDeOportunidad));
    const r0624 = rows.find(r => r.folio === '0624-1')!;
    expect(r0624).toMatchObject({ oportunidadId: '50', llave: '1' });
    expect(r0624.tambienEn.map(t => t.oportunidadFolio)).toEqual(['OPP-1109']);
    expect(rows.find(r => r.folio === '1109-1')?.oportunidadId).toBe('20');
  });
  it('sin la dueña a la vista, gana la más vieja', () => {
    const a = opp(30, 'OPP-1108', [{ id: 'file_mm0fgrzq', text: `${M}/1/cotizacion_0624_-_1.pdf` }]);
    const b = opp(40, 'OPP-1109', [{ id: 'file_mm0fgrzq', text: `${M}/2/cotizacion_0624_-_1.pdf` }]);
    expect(unaFilaPorFolio([b, a].flatMap(cotizacionesDeOportunidad))[0].oportunidadId).toBe('30');
  });
});

describe('marcarReemplazadas + porFecha', () => {
  it('mismo folio en los dos formatos = dos cotizaciones; la de cmp-tallas es la vigente (OPP-0282)', () => {
    const rows = marcarReemplazadas(cotizacionesDeOportunidad(opp(10, 'OPP-0282', [
      { id: 'file_mm0fgrzq', text: `${M}/1/cotizaci%C3%B3n_0282%20-%201.pdf, ${M}/2/cotizaci%C3%B3n_0282%20-%202.pdf, ${M}/3/cotizacion_0282_-_1.pdf` },
    ])));
    expect(rows.map(r => [r.clave, r.reemplazadaPor])).toEqual([['0-0282-1', '0282-1'], ['0-0282-2', '0282-1'], ['1-0282-1', null]]);
    expect([...rows].sort(porFecha).map(r => r.clave)).toEqual(['1-0282-1', '0-0282-2', '0-0282-1']);
  });

  it('la versión más alta queda vigente; las demás apuntan a ella', () => {
    const rows = marcarReemplazadas(cotizacionesDeOportunidad(opp(10, 'OPP-0544', [
      { id: 'file_mm0fgrzq', text: `${M}/1/cotizacion_0544_-_1.pdf, ${M}/2/cotizacion_0544_-_4.pdf, ${M}/3/cotizacion_0544_-_2.pdf` },
    ])));
    expect(Object.fromEntries(rows.map(r => [r.folio, r.reemplazadaPor]))).toEqual({ '0544-1': '0544-4', '0544-2': '0544-4', '0544-4': null });
    expect([...rows].sort(porFecha).map(r => r.folio)).toEqual(['0544-4', '0544-2', '0544-1']);
  });
});
