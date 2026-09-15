// Ancla de las piezas puras de worker/lib/drive.ts (2026-09-15): el nombre de
// la carpeta del Proyecto, el id que se saca de la URL que Monday guarda en la
// columna link, el escape de la cláusula `q` de Drive y el mapa categoría →
// subcarpeta (las 12 subcarpetas son la convención del equipo; una categoría
// apuntando a una subcarpeta que no existe dejaría el depósito en silencio).
import { describe, it, expect } from 'vitest';
import {
  CATEGORIA_SUBCARPETA, COLUMNAS_SINCRONIZABLES, SUBFOLDERS, driveQuote, folderIdFromUrl, oportunidadRootFolderName, proyectoRootFolderName,
} from './drive';

// Fase 5 "salir de Monday" (2026-08-13) — la parte pura del cliente de la
// Oportunidad: el resto (llamadas reales a Drive) se verificó EN VIVO de solo
// lectura antes de escribir el cliente (token exchange + GET de la carpeta
// padre real), mismo criterio que Eledo/Airtable/DocuSeal.
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

describe('proyectoRootFolderName', () => {
  it('"PRO - OPP - nombre", quitando el OPP que el nombre ya trae (Efraín: "tipo PRO-XXX - OPP-XXX")', () => {
    expect(proyectoRootFolderName('PRO-0202', 'OPP-1015', 'OPP-1015 - UNIFORMES CORRALON NOGALES'))
      .toBe('PRO-0202 - OPP-1015 - UNIFORMES CORRALON NOGALES');
    expect(proyectoRootFolderName('PRO-0196', 'OPP-0236', 'CHALECOS FOFIS SONORA - OPP-0236'))
      .toBe('PRO-0196 - OPP-0236 - CHALECOS FOFIS SONORA');
    expect(proyectoRootFolderName('PRO-0210', 'OPP-1041', 'OPP-1041 - OPP-0823 - Uniforme PC (copy)'))
      .toBe('PRO-0210 - OPP-1041 - OPP-0823 - Uniforme PC (copy)');
    expect(proyectoRootFolderName('PRO-0020', 'OPP-0112', 'OPP-0112 BOTAS PC SAN PEDRO'))
      .toBe('PRO-0020 - OPP-0112 - BOTAS PC SAN PEDRO');
  });
  it('no confunde OPP-101 con OPP-1015', () => {
    expect(proyectoRootFolderName('PRO-1', 'OPP-101', 'OPP-1015 - X')).toBe('PRO-1 - OPP-101 - OPP-1015 - X');
  });
  it('sin oportunidad ligada: "PRO - nombre"; sin folio: el nombre', () => {
    expect(proyectoRootFolderName('PRO-0203', '', 'PRUEBAS DE LABORATORIO')).toBe('PRO-0203 - PRUEBAS DE LABORATORIO');
    expect(proyectoRootFolderName('', '', '  Chalecos ')).toBe('Chalecos');
  });
});

describe('folderIdFromUrl', () => {
  it('lee el id de las formas que Monday/Drive guardan', () => {
    expect(folderIdFromUrl('https://drive.google.com/drive/folders/1iRQVA_iJKJVWgDoYLAeNl2QnF0HMfA5O')).toBe('1iRQVA_iJKJVWgDoYLAeNl2QnF0HMfA5O');
    expect(folderIdFromUrl('https://drive.google.com/drive/u/0/folders/1abc-DEF_9?usp=sharing')).toBe('1abc-DEF_9');
    expect(folderIdFromUrl('https://drive.google.com/open?id=1abc-DEF_9')).toBe('1abc-DEF_9');
  });
  it('null si no hay URL de carpeta', () => {
    expect(folderIdFromUrl(null)).toBeNull();
    expect(folderIdFromUrl('')).toBeNull();
    expect(folderIdFromUrl('https://docs.google.com/spreadsheets/d/1xyz/edit')).toBeNull();
  });
});

describe('driveQuote', () => {
  it('escapa comillas simples y diagonales invertidas', () => {
    expect(driveQuote(`OC O'Brien \\ final.pdf`)).toBe(`'OC O\\'Brien \\\\ final.pdf'`);
  });
});

describe('categoría → subcarpeta', () => {
  it('toda categoría depositable apunta a una de las 12 subcarpetas', () => {
    for (const [cat, sub] of Object.entries(CATEGORIA_SUBCARPETA)) {
      expect(SUBFOLDERS, `categoría ${cat}`).toContain(sub);
    }
  });
  it('toda columna sincronizable tiene subcarpeta destino', () => {
    for (const cols of Object.values(COLUMNAS_SINCRONIZABLES)) {
      for (const { colId, categoria } of cols) {
        expect(CATEGORIA_SUBCARPETA[categoria], `columna ${colId}`).toBeDefined();
      }
    }
  });
  it('la solicitud de costeo y el inventario NO se depositan (interno / no es documento)', () => {
    expect(CATEGORIA_SUBCARPETA['solicitud-costeo']).toBeUndefined();
    expect(CATEGORIA_SUBCARPETA['inventario']).toBeUndefined();
  });
});
