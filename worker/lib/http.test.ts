import { describe, it, expect } from 'vitest';
import { rejectUnknownQuery, etagCoincide } from './http';

const BASE = 'https://portal.mexicanadeproteccion.com/api/boards/oportunidades_sub/items';

describe('rejectUnknownQuery', () => {
  it('deja pasar una query vacía', () => {
    expect(rejectUnknownQuery(BASE, ['q', 'cols'])).toBeNull();
  });

  it('deja pasar solo los params permitidos', () => {
    expect(rejectUnknownQuery(`${BASE}?q=bota&cols=name,text_mm07s2mg`, ['q', 'cols'])).toBeNull();
  });

  it('acepta un permitido con valor vacío (?cols= significa NINGUNA columna)', () => {
    expect(rejectUnknownQuery(`${BASE}?cols=`, ['q', 'cols'])).toBeNull();
  });

  // El caso del incidente 2026-08-18: `parent` no existe en esta ruta. Antes se
  // ignoraba y la respuesta traía el board COMPLETO; ahora corta en 400.
  it('rechaza el ?parent= que provocó el borrado masivo', async () => {
    const res = rejectUnknownQuery(`${BASE}?parent=12719242508`, ['q', 'cols']);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json() as { error: string };
    expect(body.error).toContain('parent');
    expect(body.error).toContain('q, cols');
  });

  it('rechaza aunque venga mezclado con params válidos', () => {
    expect(rejectUnknownQuery(`${BASE}?cols=name&parent=123`, ['q', 'cols'])?.status).toBe(400);
  });

  it('nombra TODOS los desconocidos, sin repetirlos', async () => {
    const res = rejectUnknownQuery(`${BASE}?parent=1&parent=2&limit=5`, ['q', 'cols']);
    const body = await res!.json() as { error: string };
    expect(body.error).toContain('parent, limit');
  });

  it('distingue mayúsculas — ?Q= no es ?q=', () => {
    expect(rejectUnknownQuery(`${BASE}?Q=bota`, ['q', 'cols'])?.status).toBe(400);
  });
});

describe('etagCoincide', () => {
  it('empata el ETag débil que devuelve el navegador tras la compresión de Cloudflare', () => {
    // El caso real de producción: el worker manda "abc", Cloudflare lo
    // degrada a W/"abc" al comprimir y el navegador devuelve ése.
    expect(etagCoincide('W/"abc"', '"abc"')).toBe(true);
  });

  it('empata el fuerte tal cual (local, sin compresión)', () => {
    expect(etagCoincide('"abc"', '"abc"')).toBe(true);
  });

  it('no empata otro ETag', () => {
    expect(etagCoincide('W/"abd"', '"abc"')).toBe(false);
  });

  it('sin header no hay 304', () => {
    expect(etagCoincide(undefined, '"abc"')).toBe(false);
    expect(etagCoincide('', '"abc"')).toBe(false);
  });

  it('acepta listas separadas por comas', () => {
    expect(etagCoincide('"x", W/"abc"', '"abc"')).toBe(true);
  });
});
