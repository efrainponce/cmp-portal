// identidadConZona (2026-09-30) contra SQLite real: identidad + zona en UN
// viaje a D1 tiene que dar EXACTAMENTE el viewer que armaba el camino de dos
// viajes (`{ ...fila, ...zonaScopeFields(fila) }`). Es autorización: un scope
// de más aquí enseña o deja editar lo ajeno en todo el portal.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { identidadConZona, zonaScopeFields } from './zonas';

let db: DatabaseSync;
let env: Env;

function sentencia(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...v: SQLInputValue[]) => sentencia(sql, v),
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    first: async () => db.prepare(sql).get(...values) ?? null,
  };
}

const PERSONAS: [string, number, string, number][] = [
  ['lider@x.test', 10, 'vendedor', 1],
  ['miembro1@x.test', 22, 'vendedor', 1],
  ['miembro2@x.test', 33, 'vendedor', 1],
  ['inactivo@x.test', 34, 'vendedor', 0],
  ['auxiliar@x.test', 44, 'vendedor', 1],
  ['solo@x.test', 55, 'vendedor', 1],
  ['efrain.ponces@gmail.com', 98389537, 'admin', 1],       // admin en la whitelist de la zona privada
  ['compras@x.test', 66, 'compras', 1],
  ['admin@x.test', 77, 'admin', 1],
  ['privado@x.test', 88, 'vendedor', 1],
  ['otro-correo-del-lider@x.test', 10, 'vendedor', 1],     // mismo monday_user_id que el líder
];

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE identity (email TEXT PRIMARY KEY, phone TEXT UNIQUE, nombre TEXT, monday_user_id INTEGER NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE zonas (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, lider_email TEXT);
    CREATE TABLE zona_miembros (zona_id INTEGER NOT NULL, email TEXT NOT NULL, PRIMARY KEY (zona_id, email));
    CREATE TABLE zona_auxiliares (zona_id INTEGER NOT NULL, email TEXT NOT NULL, PRIMARY KEY (zona_id, email));
    INSERT INTO zonas (id, nombre, lider_email) VALUES (1, 'Centro', 'lider@x.test'), (2, 'Efrain', NULL);
    INSERT INTO zona_miembros VALUES (1, 'miembro1@x.test'), (1, 'miembro2@x.test'), (1, 'inactivo@x.test'), (2, 'privado@x.test');
    INSERT INTO zona_auxiliares VALUES (1, 'auxiliar@x.test');
  `);
  const ins = db.prepare('INSERT INTO identity (email, monday_user_id, role, active) VALUES (?,?,?,?)');
  for (const p of PERSONAS) ins.run(...p);
  env = {
    DB: {
      prepare: (sql: string) => sentencia(sql),
      batch: async (stmts: ReturnType<typeof sentencia>[]) => Promise.all(stmts.map(s => s.all())),
    },
  } as unknown as Env;
});
afterAll(() => db.close());

async function caminoDeDosViajes(email: string): Promise<Identity | null> {
  const fila = db.prepare('SELECT * FROM identity WHERE email = ? AND active = 1').get(email) as Identity | undefined;
  if (!fila) return null;
  return { ...fila, ...(await zonaScopeFields(env, fila)) };
}

const orden = (v: Identity | null) => v && ({
  ...v,
  scope_user_ids: [...(v.scope_user_ids ?? [])].sort(),
  write_user_ids: [...(v.write_user_ids ?? [])].sort(),
  hidden_owner_ids: [...(v.hidden_owner_ids ?? [])].sort(),
});

describe('identidadConZona = identidad y luego zona', () => {
  it.each(PERSONAS.map(p => p[0]).concat(['no-existe@x.test']))('%s', async email => {
    expect(orden(await identidadConZona(env, email))).toEqual(orden(await caminoDeDosViajes(email)));
  });

  it('casos que importan, explícitos', async () => {
    expect(orden(await identidadConZona(env, 'lider@x.test'))?.scope_user_ids).toEqual([10, 22, 33]);
    expect(orden(await identidadConZona(env, 'auxiliar@x.test'))?.write_user_ids).toEqual([10, 22, 33, 44]);
    expect((await identidadConZona(env, 'solo@x.test'))?.scope_user_ids).toEqual([55]);
    expect((await identidadConZona(env, 'admin@x.test'))?.hidden_owner_ids).toEqual([88]);
    expect((await identidadConZona(env, 'compras@x.test'))?.hidden_owner_ids).toEqual([88]);
    expect((await identidadConZona(env, 'efrain.ponces@gmail.com'))?.hidden_owner_ids).toEqual([]);
    expect((await identidadConZona(env, 'solo@x.test'))?.hidden_owner_ids).toEqual([]);
    expect(await identidadConZona(env, 'inactivo@x.test')).toBeNull();
  });
});
