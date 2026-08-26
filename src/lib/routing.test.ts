import { describe, it, expect } from 'vitest';
import { parsePath, routePath } from './routing';

describe('parsePath', () => {
  it('board solo', () => {
    expect(parsePath('/costeo')).toEqual({ board: 'costeo', itemId: null, tab: null });
  });

  it('board + item (formato viejo, sigue funcionando)', () => {
    expect(parsePath('/ejecucion/11832754547')).toEqual({ board: 'ejecucion', itemId: '11832754547', tab: null });
  });

  it('board + item + pestaña', () => {
    expect(parsePath('/ejecucion/11832754547/cotizacion'))
      .toEqual({ board: 'ejecucion', itemId: '11832754547', tab: 'cotizacion' });
  });

  it('una pestaña sin item no existe', () => {
    expect(parsePath('/oportunidades//cotizacion').tab).toBeNull();
  });

  it('board desconocido cae a oportunidades', () => {
    expect(parsePath('/loquesea/123/tallas').board).toBe('oportunidades');
  });

  it('segmentos extra se ignoran', () => {
    expect(parsePath('/costeo/123/tallas/algo/mas'))
      .toEqual({ board: 'costeo', itemId: '123', tab: 'tallas' });
  });
});

describe('routePath', () => {
  it('ida y vuelta con parsePath', () => {
    const path = routePath('ejecucion', '11832754547', 'cotizacion');
    expect(path).toBe('/ejecucion/11832754547/cotizacion');
    expect(parsePath(path)).toEqual({ board: 'ejecucion', itemId: '11832754547', tab: 'cotizacion' });
  });

  it('sin item no arrastra pestaña', () => {
    expect(routePath('costeo', null, 'tallas')).toBe('/costeo');
  });

  it('sin pestaña deja la ruta corta de siempre', () => {
    expect(routePath('costeo', '123')).toBe('/costeo/123');
  });
});
