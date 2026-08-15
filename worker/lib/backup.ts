// worker/lib/backup.ts — export semanal del mirror D1 a R2 (cron sábado 3am
// UTC — ver worker/index.ts: en Cloudflare "7" es sábado, no domingo). Esto NO es la red de seguridad para "borré algo por error hoy" —
// eso ya lo cubre D1 Time Travel (restore a cualquier minuto de los últimos 30 días,
// gratis, sin este archivo). Este dump es para retención más allá de esos 30 días:
// el día que Monday deje de ser la fuente de verdad, o si D1 mismo se pierde.
//
// Vuelca TODAS las tablas vía sqlite_master (no una lista hardcodeada) para no
// desincronizarse de las que se crean lazy en runtime (api_cache, documents, zonas,
// producto_propuesto, etc. — ver comentarios en worker/schema.sql).
import type { Env } from '../env';
import { logSync } from '../sync/log';

interface SqliteObject {
  type: string;
  name: string;
  sql: string | null;
}

const PAGE_SIZE = 500;

export async function backupD1ToR2(env: Env): Promise<void> {
  try {
    const dump = await buildDump(env);
    const key = `backups/d1/${new Date().toISOString().slice(0, 10)}.sql`;
    await env.FILES.put(key, dump, { httpMetadata: { contentType: 'application/sql' } });
    await logSync(env, 'backup', null, null, true, key);
  } catch (err) {
    await logSync(env, 'backup', null, null, false, String(err));
  }
}

async function buildDump(env: Env): Promise<string> {
  // `_cf_KV` (interna de D1) aparece en sqlite_master pero leerla lanza
  // "access to _cf_KV.key is prohibited: SQLITE_AUTH" y tumbaba el dump
  // completo — visto en vivo en la PRIMERA corrida real del cron
  // (2026-08-15T03:00 UTC). El ESCAPE es porque `_` es comodín en LIKE.
  const { results } = await env.DB.prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
     ORDER BY (type = 'table') DESC, name`,
  ).all<SqliteObject>();
  const objects = results ?? [];
  const tables = objects.filter(o => o.type === 'table');
  const rest = objects.filter(o => o.type !== 'table'); // índices y vistas

  const lines: string[] = [`-- D1 backup ${new Date().toISOString()}`];
  for (const t of tables) lines.push(`${t.sql};`);
  for (const t of tables) lines.push(...(await dumpTableRows(env, t.name)));
  for (const o of rest) lines.push(`${o.sql};`);

  return lines.join('\n');
}

async function dumpTableRows(env: Env, table: string): Promise<string[]> {
  const lines: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM "${table}" LIMIT ? OFFSET ?`,
    ).bind(PAGE_SIZE, offset).all<Record<string, unknown>>();
    const rows = results ?? [];
    for (const row of rows) lines.push(toInsert(table, row));
    if (rows.length < PAGE_SIZE) break;
  }
  return lines;
}

function toInsert(table: string, row: Record<string, unknown>): string {
  const cols = Object.keys(row);
  const values = cols.map(c => sqlLiteral(row[c]));
  return `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (value instanceof ArrayBuffer) return `X'${toHex(value)}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
