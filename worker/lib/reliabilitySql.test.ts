// Ejecuta el SQL de producción en SQLite real, sin Monday ni D1 de producción.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { submitWrite } from './outbox';
import { resolverPendiente } from '../wa/estado';
import { getItem } from './dal';

vi.mock('./dal', async importOriginal => ({
  ...await importOriginal<typeof import('./dal')>(), getItem: vi.fn(),
}));

let db: DatabaseSync;
let env: Env;
const viewer: Identity = { email: 'sales@example.test', role: 'vendedor', monday_user_id: 1, active: true };
const item: MirrorItem = {
  board_id: BOARDS.oportunidades.id, item_id: 123, parent_item_id: null, name: 'Prueba', group_id: null,
  vendedor_ids: '[1]', monday_updated_at: null, synced_at: '', content_hash: '', columns: '[]',
};

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE items (board_id INTEGER, item_id INTEGER, name TEXT, columns TEXT, synced_at TEXT);
    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id INTEGER, item_id INTEGER,
      cols TEXT, content_hash TEXT, author_email TEXT, status TEXT, attempts INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE wa_pendiente (id INTEGER PRIMARY KEY, resuelto_at TEXT, respuesta TEXT, expira_at TEXT);
    INSERT INTO wa_pendiente (id, expira_at) VALUES (42, '2999-01-01T00:00:00.000Z'), (43, '2000-01-01T00:00:00.000Z');
  `);
  db.prepare('INSERT INTO items VALUES (?, ?, ?, ?, ?)').run(item.board_id, item.item_id, item.name, item.columns, '');
  const prepare = (sql: string) => ({
    bind: (...values: SQLInputValue[]) => ({
      run: async () => {
        const r = db.prepare(sql).run(...values);
        return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      first: async () => db.prepare(sql).get(...values) ?? null,
    }),
  });
  env = { DB: { prepare } } as unknown as Env;
  vi.mocked(getItem).mockResolvedValue(item);
});
afterEach(() => db.close());

describe('recibos y confirmaciones — SQL real', () => {
  it('cada escritura al mismo item devuelve SU id de outbox sin un SELECT adicional', async () => {
    const ctx = { waitUntil: vi.fn() } as unknown as Parameters<typeof submitWrite>[1];
    const first = await submitWrite(env, ctx, 'oportunidades', 123, { deal_stage: 'Cancelada' }, viewer, { skipFlush: true });
    const second = await submitWrite(env, ctx, 'oportunidades', 123, { deal_stage: 'Perdida' }, viewer, { skipFlush: true });
    expect(first).toMatchObject({ pending: true, outboxId: 1 });
    expect(second).toMatchObject({ pending: true, outboxId: 2 });
    const rows = db.prepare('SELECT id, cols, status FROM outbox ORDER BY id').all();
    expect(rows.map(r => JSON.parse(String(r.cols)).deal_stage)).toEqual(['Cancelada', 'Perdida']);
    expect(rows.map(r => r.status)).toEqual(['pending', 'pending']);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
  it('dos confirmaciones simultáneas solo permiten una ejecución', async () => {
    expect(await Promise.all([resolverPendiente(env, 42, 'si'), resolverPendiente(env, 42, 'si')])).toEqual([true, false]);
    expect(db.prepare('SELECT respuesta FROM wa_pendiente WHERE id = 42').get()).toMatchObject({ respuesta: 'si' });
  });
  it('una confirmación vencida entre leer y resolver no ejecuta', async () => {
    expect(await resolverPendiente(env, 43, 'si')).toBe(false);
    expect(db.prepare('SELECT resuelto_at FROM wa_pendiente WHERE id = 43').get()).toMatchObject({ resuelto_at: null });
  });
  it('NO gana a un SÍ posterior y conserva el rechazo', async () => {
    expect(await resolverPendiente(env, 42, 'no')).toBe(true);
    expect(await resolverPendiente(env, 42, 'si')).toBe(false);
    expect(db.prepare('SELECT respuesta FROM wa_pendiente WHERE id = 42').get()).toMatchObject({ respuesta: 'no' });
  });
});
