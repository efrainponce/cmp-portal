// El folio del portal sale del Sheet de cmp-tallas con la MISMA regla que
// allá (`folio = fila - 1`); estas son las partes puras de esa regla.
import { describe, it, expect } from 'vitest';
import { filaDeUpdatedRange, filaLedger, OC_SHEET_HEADER } from './ocSheetLedger';

describe('filaDeUpdatedRange', () => {
  it('saca la fila del rango que devuelve el append', () => {
    expect(filaDeUpdatedRange('historial!A321:O321')).toBe(321);
    expect(filaDeUpdatedRange("'historial'!A2:O2")).toBe(2);
    expect(filaDeUpdatedRange('historial!A5')).toBe(5);
  });
  it('rechaza rangos sin fila o en el encabezado', () => {
    expect(() => filaDeUpdatedRange('historial!A:O')).toThrow();
    expect(() => filaDeUpdatedRange('historial!A1:O1')).toThrow();
  });
});

describe('filaLedger', () => {
  const r = {
    proyectoId: 12246996354, proveedorId: '12286317709', proveedorNombre: 'TEST',
    proveedorRZ: '5.11 Tactical de México SA De CV', folioProyecto: 'PRO-0054', folioOpp: 'OPP-0497',
    monto: 9594, moneda: 'MXN',
  };
  it('respeta el orden A…O de cmp-tallas, con Key = proyecto__proveedor y Status Generando', () => {
    const fila = filaLedger(r, 'OC-320', '2026-09-22T14:00:00.000Z');
    expect(fila).toHaveLength(OC_SHEET_HEADER.length);
    expect(fila[0]).toBe('OC-320');
    expect(fila[1]).toBe('12246996354__12286317709');
    expect(fila[2]).toBe('PRO-0054');
    expect(fila[3]).toBe('OPP-0497');
    expect(fila[8]).toBe(9594);
    expect(fila[10]).toBe('2026-09-22');
    expect(fila[11]).toBe('Generando');
    expect(fila[12]).toBe('');
  });
});
