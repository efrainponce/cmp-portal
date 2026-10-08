// La cascada viaja con rutas reales de la carga: el guardarraíl es que ningún
// id, folio, correo ni query llegue a D1, y que un recurso malformado se tire
// sin tumbar el resto.
import { describe, it, expect } from 'vitest';
import { encima, nombreRecurso, normalizarRuta, validarCascada, CASCADA_MAX_RECURSOS } from './perfCascada';

const O = 'https://portal.mexicanadeproteccion.com';

describe('nombreRecurso', () => {
  it('colapsa ids y tira la query; de otro origen solo el host', () => {
    expect(nombreRecurso(`${O}/api/boards/oportunidades/items/12898219669?fresh=1`, O)).toBe('/api/boards/oportunidades/items/:id');
    expect(nombreRecurso(`${O}/api/files/oportunidades/OPP-1234/cotizacion.pdf`, O)).toBe('/api/files/oportunidades/:id/:id');
    expect(nombreRecurso(`${O}/assets/index-B3x_k9Qa.js`, O)).toBe('/assets/index-B3x_k9Qa.js');
    expect(nombreRecurso('https://www.clarity.ms/tag/abc?ref=x@y.com', O)).toBe('//www.clarity.ms');
    expect(nombreRecurso('data:image/png;base64,AAA', O)).toBeNull();
  });
  it('un correo en la ruta nunca pasa', () => {
    expect(normalizarRuta('/api/identity/ana@mexicanadeproteccion.com')).toBe('/api/identity/:id');
  });
});

describe('encima', () => {
  it('detecta cruces con periodos abiertos', () => {
    expect(encima(100, 200, [[150, Infinity]])).toBe(true);
    expect(encima(100, 200, [[0, 99], [201, 300]])).toBe(false);
  });
});

describe('validarCascada', () => {
  it('normaliza de nuevo en el servidor y descarta lo malformado', () => {
    const c = validarCascada({
      pantalla: 'costeo', nav: 'navigate', oculta: false, ect: '3g', down: 0.4, rtt: 900,
      hitos: { ttfb: 1200, lcp: 9000, lista: 15000, cliente: 'Hospital' },
      recursos: [
        { n: '/api/boards/costeo/items/123', i: 'fetch', s: 3000, w: 2500, d: 9000, b: 40000, e: 39000 },
        { n: 'https://evil.com/x', i: 'fetch', s: 1, d: 1 },
        { n: '/assets/a.js', i: 'script', s: 500, w: 9999, d: 800, b: 0, e: 0, m: 'GET' },
        { n: '/api/x', i: 'fetch', s: 'x', d: 1 },
      ],
    });
    expect(c?.recursos).toEqual([
      { n: '/api/boards/costeo/items/:id', i: 'fetch', s: 3000, w: 2500, d: 9000, b: 40000, e: 39000 },
      { n: '/assets/a.js', i: 'script', s: 500, w: 800, d: 800, b: 0, e: 0 },
    ]);
    expect(c?.hitos).toEqual({ ttfb: 1200, lcp: 9000, lista: 15000 });
    expect(c?.ect).toBe('3g');
  });
  it('topa el número de recursos y rechaza sin recursos', () => {
    const muchos = Array.from({ length: CASCADA_MAX_RECURSOS + 50 }, (_, i) => ({ n: '/a.js', i: 'script', s: i, d: 1 }));
    expect(validarCascada({ pantalla: 'inicio', recursos: muchos })?.recursos).toHaveLength(CASCADA_MAX_RECURSOS);
    expect(validarCascada({ pantalla: 'inicio', recursos: [] })).toBeNull();
    expect(validarCascada([1])).toBeNull();
  });
});
