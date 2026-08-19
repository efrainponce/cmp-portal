import { describe, it, expect } from 'vitest';
import { rejectUnknownQuery } from './http';

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
