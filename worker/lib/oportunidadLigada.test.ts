// La liga Proyecto → Oportunidad pinta un dato de una fila de OTRO board, así que
// podría sacar por la puerta de atrás lo que dal.ts cierra: se ancla que la
// consulta lleve el scope del viewer y que una oportunidad que no regresa
// (fuera de su scope) no aparezca.
import { describe, it, expect } from 'vitest';
import { oportunidadesLigadas, folioDe, OPP_FOLIO_COL } from './oportunidadLigada';
import { PROYECTO_OPP_REL } from './dal';
import { BOARDS } from '../../shared/boards';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';

function fila(itemId: number, columns: unknown[]): MirrorItem {
  return {
    board_id: BOARDS.proyectos.id, item_id: itemId, parent_item_id: null, name: `P${itemId}`,
    group_id: null, vendedor_ids: '[]', monday_updated_at: null, synced_at: '', content_hash: '',
    columns: JSON.stringify(columns),
  };
}

/** Proyecto ligado a `oppId` (sin `oppId`, hecho desde cero). Monday manda los
 * ids ligados como strings dentro de un value JSON-encodeado. */
function proyecto(itemId: number, oppId?: number): MirrorItem {
  return fila(itemId, oppId == null ? [] : [{
    id: PROYECTO_OPP_REL, type: 'board_relation', text: '',
    value: JSON.stringify({ linked_item_ids: [String(oppId)] }),
  }]);
}

/** D1 de mentiras: graba cada consulta y regresa las filas dadas — lo que el
 * scope del SQL habría dejado pasar. */
function envFalso(filas: { item_id: number; folio: string | null }[]) {
  const consultas: { sql: string; binds: unknown[] }[] = [];
  const prepare = (sql: string) => ({
    bind: (...binds: unknown[]) => ({
      all: async () => {
        consultas.push({ sql, binds });
        return { results: filas };
      },
    }),
  });
  return { env: { DB: { prepare } } as unknown as Env, consultas };
}

const vendedor: Identity = { email: 'v@cmp.mx', monday_user_id: 77, role: 'vendedor', active: true };

describe('oportunidadesLigadas', () => {
  it('cruza cada proyecto con el folio de su oportunidad, en una sola consulta', async () => {
    const { env, consultas } = envFalso([
      { item_id: 500, folio: 'OPP-0085' },
      { item_id: 600, folio: ' OPP-0254 ' },
    ]);
    const m = await oportunidadesLigadas(env, vendedor, [proyecto(1, 500), proyecto(2, 500), proyecto(3, 600)]);
    expect(m.get(1)).toEqual({ id: '500', folio: 'OPP-0085' });
    expect(m.get(2)).toEqual({ id: '500', folio: 'OPP-0085' });
    expect(m.get(3)).toEqual({ id: '600', folio: 'OPP-0254' });
    expect(consultas).toHaveLength(1);
    // Los ids viajan en UN bind (arreglo JSON), sin repetir la oportunidad compartida.
    const [col, board, ids] = consultas[0].binds;
    expect([col, board]).toEqual([OPP_FOLIO_COL, BOARDS.oportunidades.id]);
    expect(JSON.parse(ids as string)).toEqual([500, 600]);
  });

  it('lleva el scope del viewer sobre Oportunidades y omite lo que no regresa', async () => {
    const { env, consultas } = envFalso([{ item_id: 500, folio: 'OPP-0085' }]);
    const m = await oportunidadesLigadas(env, vendedor, [proyecto(1, 500), proyecto(2, 900)]);
    expect(consultas[0].sql).toContain('vendedor_ids');
    expect(consultas[0].binds).toContain(vendedor.monday_user_id);
    expect(m.has(1)).toBe(true);
    // La 900 no regresó (fuera de su scope): el proyecto 2 se queda sin liga,
    // no con un folio vacío.
    expect(m.has(2)).toBe(false);
  });

  it('sin proyectos ligados no consulta nada', async () => {
    const { env, consultas } = envFalso([]);
    const m = await oportunidadesLigadas(env, vendedor, [proyecto(1), proyecto(2)]);
    expect(m.size).toBe(0);
    expect(consultas).toHaveLength(0);
  });

  it('un rol que no lee la relación ni el folio (almacén) no recibe nada', async () => {
    const { env, consultas } = envFalso([{ item_id: 500, folio: 'OPP-0085' }]);
    const almacen: Identity = { ...vendedor, role: 'almacen' };
    const m = await oportunidadesLigadas(env, almacen, [proyecto(1, 500)]);
    expect(m.size).toBe(0);
    expect(consultas).toHaveLength(0);
  });
});

describe('folioDe', () => {
  it('lee el texto de la columna Folio', () => {
    expect(folioDe(fila(500, [{ id: OPP_FOLIO_COL, type: 'item_id', text: 'OPP-0085' }]))).toBe('OPP-0085');
  });

  it('vacío si no viene o si las columnas están corruptas', () => {
    expect(folioDe(fila(500, []))).toBe('');
    expect(folioDe({ ...fila(500, []), columns: '{no es json' })).toBe('');
  });
});
