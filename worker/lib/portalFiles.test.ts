// El key de un archivo entra por dos puertas con distinto escapado: el path de
// /api/files (Hono ya lo decodificó) y el body JSON de /api/documents (llega tal
// como lo armó el frontend, con encodeURIComponent). Al sellar una cotización
// para firmarla eso rompió la búsqueda del asset en el mirror — de ahí estos tests.
import { describe, it, expect } from 'vitest';
import { normalizeFileKey, isKnownFileCategory, OPP_FILE_COLS, PROYECTO_FILE_COLS } from './portalFiles';

describe('normalizeFileKey', () => {
  it('desescapa acentos y espacios del nombre de archivo', () => {
    expect(normalizeFileKey('oportunidades/123/cotizacion-no-firmada/cotizaci%C3%B3n_0167%20-%201.pdf'))
      .toBe('oportunidades/123/cotizacion-no-firmada/cotización_0167 - 1.pdf');
  });

  it('es idempotente sobre un key ya limpio', () => {
    const key = 'oportunidades/123/documento/OC firmada.pdf';
    expect(normalizeFileKey(key)).toBe(key);
    expect(normalizeFileKey(normalizeFileKey(key))).toBe(key);
  });

  it('no revienta con un escape inválido — devuelve el key tal cual', () => {
    expect(normalizeFileKey('oportunidades/1/oc/100%.pdf')).toBe('oportunidades/1/oc/100%.pdf');
  });
});

describe('categorías de archivo', () => {
  it('reconoce las que sirve /api/files y rechaza el resto', () => {
    for (const c of ['documento', 'embellecimiento', 'solicitud-costeo', 'cotizacion-no-firmada', 'cotizacion-firmada', 'tallas', 'oc']) {
      expect(isKnownFileCategory(c)).toBe(true);
    }
    // 'documentos/…' (los PDF del portal) tiene su propia ruta con scoping.
    expect(isKnownFileCategory('documentos')).toBe(false);
    expect(isKnownFileCategory('')).toBe(false);
  });

  it('cada categoría apunta a una columna de archivo de Monday distinta', () => {
    const ids = [...Object.values(OPP_FILE_COLS), ...Object.values(PROYECTO_FILE_COLS)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^file_/);
  });
});
