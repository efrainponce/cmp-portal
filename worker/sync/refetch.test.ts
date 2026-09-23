// refetchItemTree: el tope de parámetros de D1 y el modo `soloLineas`.
//
// El 2026-09-16 "Generar OC" respondió 500 cinco veces seguidas en un Proyecto
// de 101 líneas: la OC sí se generó en cmp-tallas, pero la relectura del árbol
// armaba UN `IN (...)` con todos los ids de las líneas y D1 lo rechazó ("too
// many SQL variables"). Hoy hay 4 Proyectos con más de 99 líneas.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { MondayItem } from '../lib/monday';
import { fetchItemWithSubitems, fetchSubitemsOf } from '../lib/monday';
import { upsertItem, upsertItemsBulk } from './upsert';
import { confirmOutboxEcho } from './echo';
import { refetchItemTree, lineasSobrantes } from './refetch';
import { BOARDS } from '../../shared/boards';

vi.mock('../lib/monday', () => ({
  fetchItem: vi.fn(),
  fetchItemsByIds: vi.fn(),
  fetchItemWithSubitems: vi.fn(),
  fetchSubitemsOf: vi.fn(),
  ITEMS_BY_IDS_MAX: 100,
}));
vi.mock('./upsert', async importOriginal => ({
  ...await importOriginal<typeof import('./upsert')>(),
  upsertItem: vi.fn(async () => ({ changed: false })),
  upsertItemsBulk: vi.fn(async () => ({ changed: [] })),
}));
vi.mock('./echo', () => ({ confirmOutboxEcho: vi.fn(), confirmOutboxEchoMany: vi.fn() }));
vi.mock('./log', () => ({ logSync: vi.fn() }));
vi.mock('../lib/itemOrder', () => ({ upsertMondayOrder: vi.fn() }));

const PADRE = 555;
const item = (id: number): MondayItem => ({
  id: String(id), name: `L${id}`, updated_at: '', group: null,
  parent_item: { id: String(PADRE) }, column_values: [],
});

/** D1 de mentira: registra cada statement (sql + parámetros) y contesta el
 * SELECT de líneas del padre con `enEspejo`. */
function fakeDb(enEspejo: number[]) {
  const stmts: { sql: string; args: unknown[] }[] = [];
  const batches: { sql: string; args: unknown[] }[][] = [];
  const prepare = (sql: string) => ({
    bind: (...args: unknown[]) => {
      const st = { sql, args };
      stmts.push(st);
      return {
        __st: st,
        all: async () => ({ results: sql.startsWith('SELECT item_id FROM items') ? enEspejo.map(item_id => ({ item_id })) : [] }),
        run: async () => ({ meta: {} }),
        first: async () => null,
      };
    },
  });
  const batch = async (list: { __st: { sql: string; args: unknown[] } }[]) => {
    batches.push(list.map(s => s.__st));
    return [];
  };
  return { env: { DB: { prepare, batch } } as unknown as Env, stmts, batches };
}

beforeEach(() => vi.clearAllMocks());

describe('refetchItemTree', () => {
  it('un Proyecto de 150 líneas no pasa de 100 parámetros en ninguna consulta', async () => {
    const vivos = Array.from({ length: 150 }, (_, i) => 1000 + i);
    const sobran = [9001, 9002, 9003];
    vi.mocked(fetchItemWithSubitems).mockResolvedValue({ item: item(PADRE), subitems: vivos.map(item) });
    const { env, stmts, batches } = fakeDb([...vivos, ...sobran]);

    await refetchItemTree(env, BOARDS.proyectos.id, PADRE);

    for (const st of stmts) expect(st.args.length).toBeLessThanOrEqual(100);
    // Todas las líneas por el camino por lote, de un solo jalón.
    expect(upsertItemsBulk).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upsertItemsBulk).mock.calls[0][1]).toBe('proyectos_sub');
    expect(vi.mocked(upsertItemsBulk).mock.calls[0][2]).toHaveLength(150);
    // Solo se borran las que Monday ya no devolvió, y solo bajo ESTE padre.
    const borrados = batches.flat().filter(s => s.sql.startsWith('DELETE'));
    expect(borrados).toHaveLength(1);
    expect(borrados[0].args).toEqual([BOARDS.proyectos_sub.id, PADRE, ...sobran]);
    // El padre sí se relee en el modo normal.
    expect(upsertItem).toHaveBeenCalledTimes(1);
    expect(confirmOutboxEcho).toHaveBeenCalledTimes(1);
  });

  it('sin líneas sobrantes no manda ningún DELETE', async () => {
    const vivos = [1, 2, 3];
    vi.mocked(fetchItemWithSubitems).mockResolvedValue({ item: item(PADRE), subitems: vivos.map(item) });
    const { env, stmts, batches } = fakeDb(vivos);
    await refetchItemTree(env, BOARDS.oportunidades.id, PADRE);
    expect([...stmts, ...batches.flat()].some(s => s.sql.startsWith('DELETE'))).toBe(false);
  });

  it('soloLineas: no relee ni toca la fila del padre', async () => {
    vi.mocked(fetchSubitemsOf).mockResolvedValue([item(1), item(2)]);
    const { env } = fakeDb([1, 2]);

    await refetchItemTree(env, BOARDS.oportunidades.id, PADRE, { soloLineas: true });

    expect(fetchItemWithSubitems).not.toHaveBeenCalled();
    expect(fetchSubitemsOf).toHaveBeenCalledWith(env, PADRE);
    expect(upsertItem).not.toHaveBeenCalled();
    expect(confirmOutboxEcho).not.toHaveBeenCalled();
    expect(vi.mocked(upsertItemsBulk).mock.calls[0][1]).toBe('oportunidades_sub');
  });

  it('un item nativo nunca va a Monday', async () => {
    const { env, stmts } = fakeDb([]);
    await refetchItemTree(env, BOARDS.oportunidades.id, 900000000123);
    expect(fetchItemWithSubitems).not.toHaveBeenCalled();
    expect(stmts).toHaveLength(0);
  });
});

describe('lineasSobrantes', () => {
  it('devuelve solo lo que está en el espejo y ya no vive en Monday', () => {
    expect(lineasSobrantes([1, 2, 3, 4], new Set([2, 4, 5]))).toEqual([1, 3]);
    expect(lineasSobrantes([], new Set([1]))).toEqual([]);
  });
});
