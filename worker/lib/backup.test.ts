// Respaldo por rowid (2026-09-30): mismo contenido que el de OFFSET, sin la
// columna auxiliar y sin repetir ni perder filas entre páginas.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { backupD1ToR2 } from './backup';

function envCon(db: DatabaseSync, guardado: { key?: string; body?: string }) {
  const sentencia = (sql: string, values: SQLInputValue[] = []) => ({
    bind: (...v: SQLInputValue[]) => sentencia(sql, v),
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => { db.prepare(sql).run(...values); return { meta: {} }; },
  });
  return {
    DB: { prepare: (sql: string) => sentencia(sql) },
    FILES: { put: async (key: string, body: string) => { guardado.key = key; guardado.body = body; } },
  } as unknown as Env;
}

describe('backupD1ToR2', () => {
  it('vuelca todas las filas una sola vez, con huecos de rowid y más de una página', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, board_id INTEGER, item_id INTEGER, ok INTEGER NOT NULL, detail TEXT, at TEXT NOT NULL);
             CREATE TABLE notas (clave TEXT, texto TEXT)`);
    const ins = db.prepare('INSERT INTO notas VALUES (?, ?)');
    for (let i = 0; i < 1234; i++) ins.run(`k${i}`, `it's ${i}`);
    db.exec('DELETE FROM notas WHERE rowid % 7 = 0');
    const guardado: { key?: string; body?: string } = {};
    await backupD1ToR2(envCon(db, guardado));
    const inserts = (guardado.body ?? '').split('\n').filter(l => l.startsWith('INSERT INTO "notas"'));
    const esperadas = db.prepare('SELECT COUNT(*) AS n FROM notas').get() as { n: number };
    expect(inserts).toHaveLength(esperadas.n);
    expect(new Set(inserts).size).toBe(inserts.length);
    expect(guardado.body).not.toContain('__rid');
    expect(inserts[0]).toBe(`INSERT INTO "notas" ("clave", "texto") VALUES ('k0', 'it''s 0');`);
  });
});
