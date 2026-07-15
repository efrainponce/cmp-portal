#!/usr/bin/env node
// scripts/hydrate.mjs — full pull of the 7 Monday boards into D1-ready SQL.
// Usage: node --env-file=.env scripts/hydrate.mjs [--exec]
//   (no flag) writes .wrangler/hydrate-N.sql and prints the wrangler commands.
//   --exec    also runs `npx wrangler d1 execute ... --file=...` for each chunk.
//
// Reuses the real sync code (Node 25 loads .ts modules with no cross-file value
// imports directly, no bundler needed) so the hash/shape here always matches
// what worker/sync writes at runtime.
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { BOARDS } from '../shared/boards.ts';
import { fetchItems } from '../worker/lib/monday.ts';
import { rawHash } from '../worker/lib/canon.ts';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
if (!MONDAY_API_KEY) {
  console.error('MONDAY_API_KEY missing — run with: node --env-file=.env scripts/hydrate.mjs');
  process.exit(1);
}
const env = { MONDAY_API_KEY };
const EXEC = process.argv.includes('--exec');
const OUT_DIR = fileURLToPath(new URL('../.wrangler/', import.meta.url));
const CHUNK_LIMIT = 90 * 1024;

const sqlEscape = (s) => String(s).replace(/'/g, "''");

// Same rule as worker/sync/upsert.ts's extractVendedorIds — duplicated here since
// that file has cross-module value imports Node can't resolve without a bundler.
function extractVendedorIds(item, authzCols) {
  const ids = new Set();
  for (const col of item.column_values) {
    if (!authzCols.includes(col.id) || !col.value) continue;
    try {
      const parsed = JSON.parse(col.value);
      for (const p of parsed.personsAndTeams ?? []) {
        const n = Number(p.id);
        if (!Number.isNaN(n)) ids.add(n);
      }
    } catch { /* not JSON */ }
  }
  return [...ids];
}

function buildRow(def, item) {
  const columns = item.column_values.map(c => ({ id: c.id, type: c.type, text: c.text, value: c.value }));
  return {
    board_id: def.id,
    item_id: Number(item.id),
    parent_item_id: item.parent_item?.id ? Number(item.parent_item.id) : null,
    name: item.name,
    group_id: item.group?.id ?? null,
    vendedor_ids: JSON.stringify(def.parent ? [] : extractVendedorIds(item, def.authzCols ?? [])),
    monday_updated_at: item.updated_at ?? null,
    synced_at: new Date().toISOString(),
    content_hash: rawHash(columns),
    columns: JSON.stringify(columns),
  };
}

function buildInsert(row) {
  const vals = [
    row.board_id, row.item_id,
    row.parent_item_id === null ? 'NULL' : row.parent_item_id,
    `'${sqlEscape(row.name)}'`,
    row.group_id === null ? 'NULL' : `'${sqlEscape(row.group_id)}'`,
    `'${sqlEscape(row.vendedor_ids)}'`,
    row.monday_updated_at === null ? 'NULL' : `'${sqlEscape(row.monday_updated_at)}'`,
    `'${sqlEscape(row.synced_at)}'`,
    `'${sqlEscape(row.content_hash)}'`,
    `'${sqlEscape(row.columns)}'`,
  ];
  return `INSERT OR REPLACE INTO items (board_id,item_id,parent_item_id,name,group_id,vendedor_ids,monday_updated_at,synced_at,content_hash,columns) VALUES (${vals.join(',')});`;
}

async function main() {
  const statements = [];
  for (const def of Object.values(BOARDS)) {
    let cursor;
    let count = 0;
    do {
      const page = await fetchItems(env, def.id, cursor);
      for (const item of page.items) statements.push(buildInsert(buildRow(def, item)));
      count += page.items.length;
      cursor = page.cursor;
    } while (cursor);
    console.log(`${def.slug} (${def.id}): ${count} items`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) if (/^hydrate-\d+\.sql$/.test(f)) unlinkSync(OUT_DIR + f);

  const chunks = [];
  let cur = '';
  for (const stmt of statements) {
    if (cur.length && cur.length + stmt.length + 1 > CHUNK_LIMIT) { chunks.push(cur); cur = ''; }
    cur += stmt + '\n';
  }
  if (cur) chunks.push(cur);

  const paths = chunks.map((content, i) => {
    const p = `${OUT_DIR}hydrate-${i + 1}.sql`;
    writeFileSync(p, content);
    return p;
  });
  console.log(`\nWrote ${paths.length} chunk file(s) (${statements.length} rows total) to ${OUT_DIR}`);

  if (EXEC) {
    for (const p of paths) {
      console.log(`Executing ${p} ...`);
      execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--local', `--file=${p}`, '--env-file=/dev/null'], { stdio: 'inherit' });
    }
    console.log('Done.');
  } else {
    console.log('Run each with:');
    for (const p of paths) console.log(`  npx wrangler d1 execute cmp-portal --local --file=${p} --env-file=/dev/null`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
