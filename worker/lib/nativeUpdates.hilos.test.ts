// Hilos en items NATIVOS (Zona Efrain, 2026-09-25): no hay Monday detrás, así
// que listUpdates arma las respuestas a partir de native_updates.parent_id y
// devuelve el MISMO shape que Monday (`replies`), para que el feed no distinga.
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { listUpdates } from './nativeUpdates';
import { NATIVE_ID_FLOOR } from '../../shared/nativeId';

const ITEM = NATIVE_ID_FLOOR + 5;
const fila = (id: string, created_at: string, parent_id: string | null = null) => ({
  id, item_id: ITEM, author_name: 'Elisa Vallado', body: `texto ${id}`, created_at, attachments: '[]', parent_id,
});

function envCon(rows: ReturnType<typeof fila>[]): Env {
  const stmt = { bind: () => stmt, run: async () => ({}), all: async () => ({ results: rows }), first: async () => null };
  return { DB: { prepare: () => stmt, batch: async () => [] } } as unknown as Env;
}

describe('listUpdates nativo con hilos', () => {
  it('las respuestas salen dentro de su comentario, no sueltas en la lista', async () => {
    const lista = await listUpdates(envCon([
      fila('3', '2026-09-25T12:00:00Z', '1'),
      fila('2', '2026-09-25T11:00:00Z'),
      fila('1', '2026-09-25T10:00:00Z'),
    ]), ITEM);
    expect(lista.map(u => u.id)).toEqual(['2', '1']);
    expect(lista[1].replies?.map(r => r.id)).toEqual(['3']);
    expect(lista[0].replies).toEqual([]);
  });

  it('una respuesta cuyo comentario no vino (fuera del límite) no aparece suelta', async () => {
    const lista = await listUpdates(envCon([fila('9', '2026-09-25T12:00:00Z', '404')]), ITEM);
    expect(lista).toEqual([]);
  });
});
