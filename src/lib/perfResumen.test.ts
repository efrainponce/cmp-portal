// La medición de rendimiento real (src/lib/perfReal.ts) solo sirve si agrupa
// bien: un endpoint partido en mil slugs (uno por item) o un 304 contado como
// descarga completa darían un reporte que miente sin tronar nada.
import { describe, it, expect } from 'vitest';
import {
  acumularCls, calcularInp, clasificarRecurso, esNoModificado, nuevoCls, percentil,
  resumirApi, resumirAssets, type RecursoMedido,
} from './perfResumen';
import { isValidTarget, sanitizeMeta } from '../../shared/telemetry';

const ORIGEN = 'https://portal.mexicanadeproteccion.com';

function rec(p: Partial<RecursoMedido>): RecursoMedido {
  return {
    name: `${ORIGEN}/x`, startTime: 0, duration: 100, responseStart: 50,
    transferSize: 1000, encodedBodySize: 800, decodedBodySize: 4000, ...p,
  };
}

describe('clasificarRecurso', () => {
  it('normaliza los endpoints al mismo slug que ya usa ux_event, con el board aparte', () => {
    expect(clasificarRecurso(`${ORIGEN}/api/boards/oportunidades/items?cols=name&since=2026`, ORIGEN))
      .toEqual({ tipo: 'api', target: 'api:get:boards:slug:items', board: 'oportunidades' });
    expect(clasificarRecurso(`${ORIGEN}/api/boards/proyectos/items/12898219669`, ORIGEN))
      .toEqual({ tipo: 'api', target: 'api:get:boards:slug:items:id', board: 'proyectos' });
    expect(clasificarRecurso(`${ORIGEN}/api/notifications`, ORIGEN))
      .toEqual({ tipo: 'api', target: 'api:get:notifications' });
  });

  it('usa el método anotado (un PATCH no es la lectura del detalle)', () => {
    expect(clasificarRecurso(`${ORIGEN}/api/boards/oportunidades/items/1`, ORIGEN, 'PATCH'))
      .toMatchObject({ target: 'api:patch:boards:slug:items:id' });
  });

  it('ids distintos caen en el mismo grupo', () => {
    const a = clasificarRecurso(`${ORIGEN}/api/oportunidades/111/enviar-costeo`, ORIGEN, 'POST');
    const b = clasificarRecurso(`${ORIGEN}/api/oportunidades/999999/enviar-costeo`, ORIGEN, 'POST');
    expect(a).toEqual(b);
  });

  it('el target siempre pasa el vocabulario del worker', () => {
    for (const u of ['/api/documents/9f8b7a6c-1234-4def-8888-aabbccddeeff', '/api/identity/alguien@ejemplo.com', '/api/me']) {
      const c = clasificarRecurso(ORIGEN + u, ORIGEN);
      expect(c?.tipo).toBe('api');
      if (c?.tipo === 'api') expect(isValidTarget(c.target)).toBe(true);
    }
  });

  it('no mide la telemetría, Access ni otros orígenes', () => {
    expect(clasificarRecurso(`${ORIGEN}/api/telemetry`, ORIGEN)).toBeNull();
    expect(clasificarRecurso(`${ORIGEN}/cdn-cgi/access/get-identity`, ORIGEN)).toBeNull();
    expect(clasificarRecurso('https://www.clarity.ms/tag/abc.js', ORIGEN)).toBeNull();
  });

  it('clasifica los estáticos por extensión', () => {
    expect(clasificarRecurso(`${ORIGEN}/assets/index-abc123.js`, ORIGEN)).toEqual({ tipo: 'asset', clase: 'js' });
    expect(clasificarRecurso(`${ORIGEN}/assets/index-abc123.css`, ORIGEN)).toEqual({ tipo: 'asset', clase: 'css' });
    expect(clasificarRecurso(`${ORIGEN}/fonts/inter.woff2`, ORIGEN)).toEqual({ tipo: 'asset', clase: 'font' });
    expect(clasificarRecurso(`${ORIGEN}/logo.png`, ORIGEN)).toEqual({ tipo: 'asset', clase: 'img' });
  });
});

describe('esNoModificado', () => {
  it('con responseStatus es exacto', () => {
    expect(esNoModificado(rec({ responseStatus: 304 }))).toBe(true);
    expect(esNoModificado(rec({ responseStatus: 200, encodedBodySize: 0 }))).toBe(false);
  });
  it('sin responseStatus: hubo tráfico pero sin cuerpo', () => {
    expect(esNoModificado(rec({ transferSize: 350, encodedBodySize: 0 }))).toBe(true);
    expect(esNoModificado(rec({}))).toBe(false);
    expect(esNoModificado(rec({ transferSize: 0, encodedBodySize: 0 }))).toBe(false);
  });
});

describe('percentil', () => {
  it('rango más cercano', () => {
    const xs = [10, 20, 30, 40];
    expect(percentil(xs, 0.5)).toBe(20);
    expect(percentil(xs, 0.75)).toBe(30);
    expect(percentil(xs, 1)).toBe(40);
    expect(percentil([], 0.5)).toBe(0);
    expect(percentil([7], 0.75)).toBe(7);
  });
});

describe('resumirApi', () => {
  it('un renglón por endpoint+board, y los 304 aparte de las descargas completas', () => {
    const t = 'api:get:boards:slug:items';
    const out = resumirApi([
      { target: t, board: 'oportunidades', r: rec({ duration: 4000, responseStart: 600, transferSize: 90_000, responseStatus: 200 }) },
      { target: t, board: 'oportunidades', r: rec({ duration: 5000, responseStart: 700, transferSize: 91_000, responseStatus: 200 }) },
      { target: t, board: 'oportunidades', r: rec({ duration: 300, responseStart: 290, transferSize: 300, encodedBodySize: 0, responseStatus: 304 }) },
      { target: t, board: 'oportunidades', r: rec({ duration: 310, responseStart: 300, transferSize: 300, encodedBodySize: 0, responseStatus: 304 }) },
      { target: t, board: 'oportunidades', r: rec({ duration: 320, responseStart: 310, transferSize: 300, encodedBodySize: 0, responseStatus: 304 }) },
      { target: t, board: 'proyectos', r: rec({ duration: 200 }) },
    ], true);
    expect(out).toHaveLength(3);
    const completa = out.find(r => r.board === 'oportunidades' && !r.meta.nm)!;
    // La bajada real no se diluye entre los 304 (con todo junto el p50 sería 310).
    expect(completa.meta).toEqual({ n: 2, nm: false, p50: 4000, p75: 5000, max: 5000, ttfb: 600, bytes: 181_000, fria: true });
    const nm = out.find(r => r.board === 'oportunidades' && r.meta.nm)!;
    expect(nm.meta).toEqual({ n: 3, nm: true, p50: 310, p75: 320, max: 320, ttfb: 300, bytes: 900, fria: true });
    expect(nm.p50).toBe(310);
  });

  it('el meta sobrevive entero al saneador del worker (≤ 8 llaves, solo números/booleanos)', () => {
    const [r] = resumirApi([{ target: 'api:get:me', r: rec({}) }], false);
    expect(JSON.parse(sanitizeMeta(r.meta)!)).toEqual(r.meta);
  });

  it('sin entradas no hay renglones', () => {
    expect(resumirApi([], false)).toEqual([]);
  });
});

describe('resumirAssets', () => {
  it('cuenta bytes por clase y los que vinieron de caché', () => {
    const s = resumirAssets([
      { clase: 'js', r: rec({ transferSize: 0, decodedBodySize: 50_000, duration: 5 }) },
      { clase: 'js', r: rec({ transferSize: 120_000, duration: 2500 }) },
      { clase: 'css', r: rec({ transferSize: 10_000 }) },
      { clase: 'font', r: rec({ transferSize: 30_000 }) },
    ], true)!;
    expect(s).toEqual({ n: 4, cache: 1, bytes: 160_000, js: 120_000, css: 10_000, font: 30_000, max: 2500, fria: true });
    expect(JSON.parse(sanitizeMeta({ ...s })!)).toEqual(s);
  });
  it('sin estáticos no hay renglón', () => {
    expect(resumirAssets([], false)).toBeNull();
  });
});

describe('calcularInp', () => {
  it('la peor interacción cuando son pocas', () => {
    expect(calcularInp([40, 300, 120])).toBe(300);
    expect(calcularInp([])).toBe(0);
  });
  it('ignora 1 de cada 50 en sesiones largas', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(calcularInp(xs)).toBe(98);
  });
});

describe('acumularCls', () => {
  it('toma la peor ventana, no la suma del día', () => {
    let s = nuevoCls();
    s = acumularCls(s, 0, 0.05);
    s = acumularCls(s, 500, 0.05);     // misma ventana → 0.10
    s = acumularCls(s, 10_000, 0.02);  // ventana nueva
    s = acumularCls(s, 20_000, 0.03);  // otra
    expect(s.valor).toBeCloseTo(0.1);
  });
  it('una ventana no pasa de 5 s aunque los brincos sigan', () => {
    let s = nuevoCls();
    for (let t = 0; t <= 6000; t += 900) s = acumularCls(s, t, 0.01);
    // 0, 900 … 4500 (6 brincos) en la primera ventana; 5400 abre otra.
    expect(s.valor).toBeCloseTo(0.06);
  });
});
