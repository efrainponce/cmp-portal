// El backfill reconstruye 219 órdenes leyendo NOMBRES DE ARCHIVO del espejo. Si
// ese parseo se equivoca, el ledger nace con datos inventados — que es peor que
// no tenerlo. Estos tests fijan qué reconoce y qué NO.
import { describe, it, expect } from 'vitest';
import { ocDeColumna, numeroDeFolio } from './ocLedger';

describe('numeroDeFolio', () => {
  it('saca el número para poder ordenar y detectar huecos', () => {
    expect(numeroDeFolio('OC-235')).toBe(235);
    expect(numeroDeFolio('oc-7')).toBe(7);
  });

  it('devuelve 0 para lo que no es un folio (nunca lanza)', () => {
    expect(numeroDeFolio('OC-')).toBe(0);
    expect(numeroDeFolio('cotizacion.pdf')).toBe(0);
    expect(numeroDeFolio('')).toBe(0);
  });
});

describe('ocDeColumna', () => {
  it('reconoce una OC en la columna de archivos del Proyecto', () => {
    const url = 'https://cmp.monday.com/protected_static/1/resources/9/OC_OC-235_ATHLETIC FOOTWEAR.pdf';
    expect(ocDeColumna(url)).toEqual([
      { folio: 'OC-235', proveedor: 'ATHLETIC FOOTWEAR', archivo: 'OC_OC-235_ATHLETIC FOOTWEAR.pdf', sinCostos: false },
    ]);
  });

  it('separa las dos copias de la MISMA orden', () => {
    const texto = 'x/OC_OC-236_ABRAHAM.pdf,x/OC_OC-236_ABRAHAM_SIN-COSTOS.pdf';
    const r = ocDeColumna(texto);
    expect(r.map(o => o.folio)).toEqual(['OC-236', 'OC-236']);
    expect(r.map(o => o.sinCostos)).toEqual([false, true]);
    // El sufijo NO se queda pegado al nombre del proveedor.
    expect(r[1].proveedor).toBe('ABRAHAM');
  });

  it('devuelve los guiones bajos del saneo como espacios', () => {
    // `nombreArchivoOc` cambia "." por "_": "5.11" quedó "5_11" en el archivo.
    const r = ocDeColumna('x/OC_OC-100_5_11 Tactical de Mexico SA De CV.pdf');
    expect(r[0].proveedor).toBe('5 11 Tactical de Mexico SA De CV');
  });

  it('encuentra varias OC en la misma columna', () => {
    const r = ocDeColumna('a/OC_OC-1_UNO.pdf,b/OC_OC-2_DOS.pdf,c/OC_OC-3_TRES.pdf');
    expect(r.map(o => o.folio)).toEqual(['OC-1', 'OC-2', 'OC-3']);
  });

  it('ignora lo que no es una OC', () => {
    expect(ocDeColumna('x/COTIZACION_C-12_Cliente.pdf,y/tallas.pdf')).toEqual([]);
    expect(ocDeColumna('')).toEqual([]);
  });
});
