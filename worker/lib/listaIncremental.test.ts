// Los caminos "en lote" del 2026-09-30 (rendimiento) contra SQLite real: la
// lista incremental (dal.ts listItemsDesde), la lectura de varios items
// (getItemsMany) y el chequeo de validación de varias oportunidades
// (costeo.ts checkValidacionMany). Lo que se ancla es que devuelven LO MISMO
// que el camino de antes — mismo scope por viewer incluido: son atajos de
// lectura, no pueden enseñar un renglón de más ni cambiar un resultado.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { getItem, getItemsMany, listItems, listItemsDesde } from './dal';
import { checkValidacion, checkValidacionMany } from './costeo';

let db: DatabaseSync;
let env: Env;

const OPP = BOARDS.oportunidades.id;
const SUB = BOARDS.oportunidades_sub.id;
const PROD = BOARDS.productos.id;

const admin: Identity = { email: 'admin@example.test', role: 'admin', monday_user_id: 1, active: true };
const vendedor: Identity = { email: 'ray@example.test', role: 'vendedor', monday_user_id: 11, active: true };

function sentencia(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...v: SQLInputValue[]) => sentencia(sql, v),
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    first: async () => db.prepare(sql).get(...values) ?? null,
    run: async () => { db.prepare(sql).run(...values); return { meta: {} }; },
  };
}

function item(boardId: number, id: number, o: { parent?: number; name?: string; vendedores?: number[]; updated?: string; synced?: string; cols?: unknown[] } = {}) {
  db.prepare(`INSERT INTO items (board_id, item_id, parent_item_id, name, group_id, vendedor_ids, monday_updated_at, synced_at, content_hash, columns)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    boardId, id, o.parent ?? null, o.name ?? `item ${id}`, null, JSON.stringify(o.vendedores ?? []),
    o.updated ?? '2026-09-01T00:00:00Z', o.synced ?? '2026-09-01T00:00:00.000Z', '', JSON.stringify(o.cols ?? []),
  );
}

const relProducto = (id: number) => ({ id: 'board_relation_mkzmafgp', type: 'board_relation', text: '', value: JSON.stringify({ linked_item_ids: [id] }) });
const productoCols = (o: { confirmado?: boolean; tallas?: string; proveedor?: number }) => [
  { id: 'boolean_mm5cqtjs', type: 'checkbox', text: o.confirmado ? 'v' : '', value: null },
  { id: 'text_mm5v6jhj', type: 'text', text: o.tallas ?? '', value: null },
  { id: 'board_relation_mm1cwqky', type: 'board_relation', text: '', value: o.proveedor ? JSON.stringify({ linked_item_ids: [o.proveedor] }) : null },
];

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE items (board_id INTEGER NOT NULL, item_id INTEGER NOT NULL, parent_item_id INTEGER, name TEXT NOT NULL,
    group_id TEXT, vendedor_ids TEXT NOT NULL DEFAULT '[]', monday_updated_at TEXT, synced_at TEXT NOT NULL,
    content_hash TEXT NOT NULL, columns TEXT NOT NULL, PRIMARY KEY (board_id, item_id))`);
  // itemOrder.ts la crea una sola vez por proceso (bandera de módulo) y aquí
  // cada test estrena base: se crea a mano.
  db.exec(`CREATE TABLE item_order (board_id INTEGER NOT NULL, item_id INTEGER NOT NULL, parent_item_id INTEGER NOT NULL,
    monday_order INTEGER, manual_order INTEGER, updated_at TEXT NOT NULL, PRIMARY KEY (board_id, item_id))`);
  const DB = {
    prepare: (sql: string) => sentencia(sql),
    batch: async (stmts: ReturnType<typeof sentencia>[]) => Promise.all(stmts.map(s => s.all())),
  };
  env = { DB } as unknown as Env;
});
afterEach(() => db.close());

describe('listItemsDesde — la lista incremental sin leer el board entero', () => {
  beforeEach(() => {
    item(OPP, 1, { vendedores: [11], updated: '2026-09-03T00:00:00Z', synced: '2026-09-10T00:00:00.000Z' });
    item(OPP, 2, { vendedores: [22], updated: '2026-09-05T00:00:00Z', synced: '2026-09-20T00:00:00.000Z' });
    item(OPP, 3, { vendedores: [11], updated: '2026-09-04T00:00:00Z', synced: '2026-09-20T00:00:00.000Z' });
    item(OPP, 4, { vendedores: [11], updated: '2026-09-01T00:00:00Z', synced: '2026-09-02T00:00:00.000Z', name: 'Bota táctica' });
  });

  it('el orden y las filas cambiadas son los de la lista completa filtrada en JS', async () => {
    const since = '2026-09-15T00:00:00.000Z';
    for (const viewer of [admin, vendedor]) {
      const completa = await listItems(env, 'oportunidades', viewer);
      const { orden, cambiadas } = await listItemsDesde(env, 'oportunidades', viewer, since);
      expect(orden.map(r => r.item_id)).toEqual(completa.map(r => r.item_id));
      expect(cambiadas).toEqual(completa.filter(r => r.synced_at >= since));
    }
  });

  it('respeta el scope: un vendedor no recibe ni el id de lo ajeno', async () => {
    const { orden, cambiadas } = await listItemsDesde(env, 'oportunidades', vendedor, '2026-09-15T00:00:00.000Z');
    expect(orden.map(r => r.item_id)).toEqual([3, 1, 4]);
    expect(cambiadas.map(r => r.item_id)).toEqual([3]);
  });

  it('`>=`: una fila con exactamente la marca del cliente vuelve a viajar', async () => {
    const { cambiadas } = await listItemsDesde(env, 'oportunidades', admin, '2026-09-20T00:00:00.000Z');
    expect(cambiadas.map(r => r.item_id).sort()).toEqual([2, 3]);
  });

  it('sin cambios desde la marca: orden completo y ninguna fila', async () => {
    const { orden, cambiadas } = await listItemsDesde(env, 'oportunidades', admin, '2026-09-25T00:00:00.000Z');
    expect(orden).toHaveLength(4);
    expect(cambiadas).toEqual([]);
  });

  it('con búsqueda, las dos consultas filtran igual', async () => {
    const completa = await listItems(env, 'oportunidades', admin, 'bota');
    const { orden, cambiadas } = await listItemsDesde(env, 'oportunidades', admin, '2026-09-01T00:00:00.000Z', 'bota');
    expect(orden.map(r => r.item_id)).toEqual(completa.map(r => r.item_id));
    expect(cambiadas.map(r => r.item_id)).toEqual([4]);
  });
});

describe('getItemsMany', () => {
  it('lo mismo que getItem uno por uno, con scope y sin los que no existen', async () => {
    item(OPP, 1, { vendedores: [11] });
    item(OPP, 2, { vendedores: [22] });
    const ids = [1, 2, 99, 1];
    for (const viewer of [admin, vendedor]) {
      const lote = await getItemsMany(env, 'oportunidades', ids, viewer);
      for (const id of new Set(ids)) {
        expect(lote.get(id) ?? null).toEqual(await getItem(env, 'oportunidades', id, viewer));
      }
    }
    expect([...(await getItemsMany(env, 'oportunidades', ids, vendedor)).keys()]).toEqual([1]);
  });

  it('más de 40 ids van en varios lotes', async () => {
    for (let i = 1; i <= 95; i++) item(PROD, i);
    const lote = await getItemsMany(env, 'productos', Array.from({ length: 95 }, (_, i) => i + 1), vendedor);
    expect(lote.size).toBe(95);
  });
});

describe('checkValidacionMany — mismo resultado que checkValidacion una por una', () => {
  it('ok, sin líneas, sin producto, producto incompleto y producto repetido', async () => {
    item(PROD, 500, { cols: productoCols({ confirmado: true, tallas: 'CH,M,G', proveedor: 9 }) });
    item(PROD, 501, { cols: productoCols({ confirmado: false, tallas: 'error' }) });
    // 100: todo en orden (mismo producto en dos líneas). 101: sin líneas.
    // 102: una línea sin producto y otra con producto incompleto. 103: producto que no existe.
    for (const id of [100, 101, 102, 103]) item(OPP, id, { vendedores: [11] });
    item(SUB, 1001, { parent: 100, name: 'Camisa', cols: [relProducto(500)] });
    item(SUB, 1002, { parent: 100, name: 'Camisa dama', cols: [relProducto(500)] });
    item(SUB, 1021, { parent: 102, name: 'Nueva línea', cols: [] });
    item(SUB, 1022, { parent: 102, name: 'Bota', cols: [relProducto(501)] });
    item(SUB, 1031, { parent: 103, name: 'Fantasma', cols: [relProducto(777)] });

    const ids = [100, 101, 102, 103];
    for (const viewer of [admin, vendedor]) {
      const lote = await checkValidacionMany(env, ids, viewer);
      for (const id of ids) expect(lote.get(id)).toEqual(await checkValidacion(env, id, viewer));
    }
    const lote = await checkValidacionMany(env, ids, admin);
    expect(lote.get(100)).toEqual({ ok: true });
    expect(lote.get(101)?.errors).toEqual(['La oportunidad no tiene líneas de producto.']);
    expect(lote.get(102)?.errors).toEqual([
      '#1 "Nueva línea": sin producto de catálogo vinculado.',
      '#2 "Bota": descripción y tallas sin confirmar.',
      '#2 "Bota": el producto no tiene tallas definidas en el catálogo.',
      '#2 "Bota": el producto no tiene proveedor asignado en el catálogo.',
    ]);
    expect(lote.get(103)?.ok).toBe(false);
  });

  it('sin oportunidades no consulta nada', async () => {
    expect((await checkValidacionMany(env, [], admin)).size).toBe(0);
  });
});
