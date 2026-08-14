// La ficha comercial resuelta ANTES de guardar la línea en D1 (worker/lib/ficha.ts).
// Monday recalcula el mirror `lookup_mm0xw8p7` asíncrono y sin webhook, así que la
// línea recién ligada a su producto llegaba al mirror sin ficha y se quedaba
// marcada "Falta descripción" y bloqueada para costeo, con el catálogo lleno
// (Efraín, 2026-08-14). Es un GATE: vale un test.
import { describe, it, expect } from 'vitest';
import type { Env } from '../env';
import { hydrateFichaLineas, SUB_FICHA, SUB_PRODUCTO_REL, PRODUCTO_FICHA } from './ficha';

interface Col { id: string; type?: string; text?: string | null; value?: string | null }

const linea = (column_values: Col[]) => ({ column_values });
const relCol = (productoId: number): Col => ({
  id: SUB_PRODUCTO_REL, value: JSON.stringify({ linked_item_ids: [productoId] }),
});
const fichaDe = (l: { column_values: Col[] }) => l.column_values.find(c => c.id === SUB_FICHA)?.text ?? '';

/** env.DB mínimo: devuelve los productos pedidos y cuenta las consultas. */
const fakeEnv = (productos: { item_id: number; ficha: string }[]) => {
  const stats = { queries: 0 };
  const results = productos.map(p => ({
    item_id: p.item_id,
    columns: JSON.stringify([{ id: PRODUCTO_FICHA, text: p.ficha }]),
  }));
  const env = {
    DB: {
      prepare: () => {
        stats.queries++;
        return { bind: () => ({ all: async () => ({ results }) }) };
      },
    },
  } as unknown as Env;
  return { env, stats };
};

describe('hydrateFichaLineas', () => {
  it('toma la ficha del producto ligado cuando el mirror viene vacío', async () => {
    const { env } = fakeEnv([{ item_id: 500, ficha: 'Bota táctica FAST TAC de 6"' }]);
    const lineas = [linea([relCol(500), { id: SUB_FICHA, text: '' }])];
    await hydrateFichaLineas(env, lineas);
    expect(fichaDe(lineas[0])).toBe('Bota táctica FAST TAC de 6"');
  });

  it('agrega la columna si la línea ni siquiera la trae', async () => {
    const { env } = fakeEnv([{ item_id: 500, ficha: 'ficha' }]);
    const lineas = [linea([relCol(500)])];
    await hydrateFichaLineas(env, lineas);
    expect(fichaDe(lineas[0])).toBe('ficha');
  });

  it('no pisa el mirror bueno de Monday (ni consulta D1)', async () => {
    const { env, stats } = fakeEnv([{ item_id: 500, ficha: 'del catálogo' }]);
    const lineas = [linea([relCol(500), { id: SUB_FICHA, text: 'del mirror' }])];
    await hydrateFichaLineas(env, lineas);
    expect(fichaDe(lineas[0])).toBe('del mirror');
    expect(stats.queries).toBe(0);
  });

  it('sin producto ligado no inventa nada', async () => {
    const { env, stats } = fakeEnv([]);
    const lineas = [linea([{ id: SUB_FICHA, text: '' }])];
    await hydrateFichaLineas(env, lineas);
    expect(fichaDe(lineas[0])).toBe('');
    expect(stats.queries).toBe(0);
  });

  it('producto sin descripción en el catálogo: sigue faltando (el aviso es real)', async () => {
    const { env } = fakeEnv([{ item_id: 500, ficha: '' }]);
    const lineas = [linea([relCol(500), { id: SUB_FICHA, text: '' }])];
    await hydrateFichaLineas(env, lineas);
    expect(fichaDe(lineas[0])).toBe('');
  });

  it('varias líneas del mismo producto: UNA sola consulta a D1', async () => {
    const { env, stats } = fakeEnv([{ item_id: 500, ficha: 'ficha' }]);
    const lineas = [linea([relCol(500), { id: SUB_FICHA, text: '' }]), linea([relCol(500)])];
    await hydrateFichaLineas(env, lineas);
    expect(stats.queries).toBe(1);
    expect(lineas.map(fichaDe)).toEqual(['ficha', 'ficha']);
  });
});
