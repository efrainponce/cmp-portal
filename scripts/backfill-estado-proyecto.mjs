#!/usr/bin/env node
// scripts/backfill-estado-proyecto.mjs — siembra en D1 (`activity_log`) el
// historial de "Estado Proyecto" (project_status) y "Fecha Entrega"
// (date_mm0m1vfv) de TODOS los Proyectos, leído del activity log de Monday
// (Efraín, 2026-09-29: "cada movimiento de estado se debe guardar, sobre todo
// en D1"). Desde ese día el delta sync los guarda solo (WHITELIST.proyectos en
// worker/lib/activityLog.ts); esto cubre lo anterior.
//
// Solo INSERT OR IGNORE con la MISMA dedupe_key que arma el delta sync
// (board:item:evento:columna:tick), así que correrlo dos veces —o encima de lo
// que el sync ya guardó— no duplica nada. No toca Monday (solo lee).
//
//   node scripts/backfill-estado-proyecto.mjs            # dry-run: cuenta y muestra
//   node scripts/backfill-estado-proyecto.mjs --aplicar  # escribe en D1 remoto
//
// Necesita `.dev.vars` (MONDAY_API_KEY + wrangler). Si wrangler pide cuenta,
// exporta CLOUDFLARE_ACCOUNT_ID; si el .env del repo secuestra el token, corre
// con `env -u CLOUDFLARE_API_TOKEN`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APLICAR = process.argv.includes('--aplicar');
const BOARD = 18395657594;
const COLUMNAS = { project_status: 'Estado Proyecto', date_mm0m1vfv: 'Fecha Entrega' };

const vars = Object.fromEntries(readFileSync(join(REPO, '.dev.vars'), 'utf8').split('\n')
  .map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
const KEY = process.env.MONDAY_API_KEY || vars.MONDAY_API_KEY;
if (!KEY) throw new Error('falta MONDAY_API_KEY en .dev.vars');

async function gql(query) {
  for (let intento = 0; ; intento++) {
    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { Authorization: KEY, 'Content-Type': 'application/json', 'API-Version': '2025-04' },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    if (!json.errors) return json.data;
    if (intento < 4) { await new Promise(r => setTimeout(r, 2000 * 2 ** intento)); continue; }
    throw new Error(JSON.stringify(json.errors));
  }
}

// Ticks de 100 ns desde epoch → ISO (mismo cálculo que ticksToIso).
const ticksToIso = t => new Date(Number(BigInt(t) / 10000n)).toISOString();
const texto = v => {
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (v.label) return v.label.text ?? null;
  if (v.date) return v.date;
  return null;
};

// Paginado por `page`: activity_logs corta en silencio a 10k eventos por
// consulta, y filtrado a dos columnas del board sobra con páginas de 500.
const eventos = [];
for (let page = 1; ; page++) {
  const d = await gql(`{ boards(ids:${BOARD}){ activity_logs(column_ids:${JSON.stringify(Object.keys(COLUMNAS))}, from:"2025-01-01T00:00:00Z", limit:500, page:${page}){ event user_id created_at data } } }`);
  const logs = d.boards[0]?.activity_logs ?? [];
  eventos.push(...logs);
  process.stdout.write(`\rpágina ${page}: ${eventos.length} eventos`);
  if (logs.length < 500) break;
}
console.log();

const filas = [];
for (const e of eventos) {
  if (e.event !== 'update_column_value') continue;
  let d;
  try { d = JSON.parse(e.data); } catch { continue; }
  const col = d.column_id;
  if (!COLUMNAS[col] || !d.pulse_id) continue;
  filas.push({
    item: Number(d.pulse_id), col, titulo: d.column_title || COLUMNAS[col],
    antes: d.previous_textual_value ?? texto(d.previous_value),
    despues: d.textual_value ?? texto(d.value),
    user: Number(e.user_id) || null,
    creado: ticksToIso(e.created_at),
    llave: `${BOARD}:${d.pulse_id}:update_column_value:${col}:${e.created_at}`,
  });
}
const proyectos = new Set(filas.map(f => f.item)).size;
console.log(`${filas.length} cambios de ${proyectos} proyectos (${filas.filter(f => f.col === 'project_status').length} de estado)`);
console.log(`del ${filas.map(f => f.creado).sort()[0]} al ${filas.map(f => f.creado).sort().at(-1)}`);
for (const f of filas.slice(0, 5)) console.log(' ', f.creado, f.item, f.titulo, f.antes, '→', f.despues);

if (!APLICAR) {
  console.log('\nDry-run. Para escribir en D1: --aplicar');
  process.exit(0);
}

const q = s => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const sql = filas.map(f => `INSERT OR IGNORE INTO activity_log
  (board_id, item_id, event, column_id, column_title, previous_text, new_text, user_id, created_at, dedupe_key)
  VALUES (${BOARD}, ${f.item}, 'update_column_value', ${q(f.col)}, ${q(f.titulo)}, ${q(f.antes)}, ${q(f.despues)}, ${f.user ?? 'NULL'}, ${q(f.creado)}, ${q(f.llave)});`).join('\n');
const archivo = join(mkdtempSync(join(tmpdir(), 'estado-proyecto-')), 'backfill.sql');
writeFileSync(archivo, sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--remote', '--env-file=.dev.vars', `--file=${archivo}`],
  { cwd: REPO, stdio: 'inherit' });
console.log(`Listo: ${filas.length} filas (las repetidas se ignoran).`);
