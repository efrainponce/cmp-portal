// Fase 5 "salir de Monday" (2026-08-13) — la parte pura de worker/lib/drive.ts:
// el resto (llamadas reales a Drive) se verificó EN VIVO de solo lectura antes
// de escribir el cliente (token exchange + GET de la carpeta padre real), mismo
// criterio que Eledo/Airtable/DocuSeal en las fases anteriores.
import { describe, it, expect } from 'vitest';
import { oportunidadRootFolderName, SUBFOLDERS } from './drive';

describe('oportunidadRootFolderName', () => {
  it('"{folio} - {nombre}" — mismo patrón que ya usan las carpetas creadas por Make', () => {
    expect(oportunidadRootFolderName('OPP-0881', 'WEB - secretaria de medio ambiente'))
      .toBe('OPP-0881 - WEB - secretaria de medio ambiente');
  });
});

describe('SUBFOLDERS', () => {
  it('12 subcarpetas, mismos nombres EXACTOS que create_subfolders.py (cmp-tallas)', () => {
    expect(SUBFOLDERS).toEqual([
      '01. BASES',
      '02. JA',
      '03. ACTA DE APERTURA',
      '04. FALLO',
      '05. CONTRATO FIRMADO',
      '06. ACTA DE ENTREGA',
      '07. CARPETA COMPLETA',
      '08. ODC PROVEEDOR',
      '09. RELACION DE TALLAS',
      '10. COT FINAL',
      '11. FIANZA',
      '12. FACTURA',
    ]);
  });
});
