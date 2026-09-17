#!/usr/bin/env node
// scripts/limpiar-pruebas.mjs — Borra de Monday y de D1 los items de PRUEBA
// (nombre con test / prueba / borrar) de Oportunidades, Proyectos, Contactos e
// Instituciones, con sus líneas (Efraín, 2026-09-16). Lógica y guardas en
// worker/lib/limpieza.ts.
//
//   node scripts/limpiar-pruebas.mjs             # solo lista (dry run)
//   node scripts/limpiar-pruebas.mjs --encolar   # mete la lista a limpieza_cola;
//                                                # el cron de 15 min borra 10 por corrida
//   node scripts/limpiar-pruebas.mjs --estado    # avance de la cola
//   node scripts/limpiar-pruebas.mjs --borrar    # directo por POST /api/admin/limpieza/borrar
//                                                # (necesita sesión de Access: node scripts/prod-login.mjs)
//
// La selección sale de la D1 de producción (wrangler, igual que salud.mjs).
// Se excluyen "PRUEBAS DE LAB…" (proyectos y productos reales de laboratorio)
// y no se tocan productos ni proveedores. El worker re-verifica id+nombre,
// que no haya firma manual y el tope de 40 borrados por hora.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODO = ['--encolar', '--estado', '--borrar'].find(f => process.argv.includes(f)) ?? '--dry';
const EMAIL = process.env.LIMPIEZA_EMAIL ?? 'efrain.ponces@gmail.com';
const BOARDS = {
  oportunidades: 18395657596, proyectos: 18395657594, contactos: 18395657595, instituciones: 18395657597,
};
const ORDEN = ['oportunidades', 'proyectos', 'contactos', 'instituciones'];
const q = s => `'${String(s).replace(/'/g, "''")}'`;

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--remote', '--env-file=.dev.vars', '--json', '--command', sql], {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? '40a5f9802bef8075fb322a54615bbcf6' },
  });
  return JSON.parse(out)[0]?.results ?? [];
}

if (MODO === '--estado') {
  const filas = d1(`SELECT slug, item_id, nombre, procesado_at, resultado FROM limpieza_cola ORDER BY id`);
  const hechas = filas.filter(f => f.procesado_at);
  const ok = hechas.filter(f => f.resultado?.startsWith('ok'));
  console.log(`cola: ${filas.length} · procesados ${hechas.length} (ok ${ok.length}, con error ${hechas.length - ok.length}) · pendientes ${filas.length - hechas.length}`);
  for (const f of hechas.filter(f => !f.resultado?.startsWith('ok'))) console.log(`  ✗ ${f.slug} ${f.item_id} "${f.nombre}" → ${f.resultado}`);
  const ultimo = hechas.at(-1);
  if (ultimo) console.log(`último procesado: ${ultimo.procesado_at}`);
  process.exit(0);
}

const candidatos = d1(`SELECT board_id, item_id, name,
    (SELECT count(*) FROM items s WHERE s.parent_item_id = p.item_id) AS lineas
  FROM items p WHERE parent_item_id IS NULL AND board_id IN (${Object.values(BOARDS).join(',')})
    AND (lower(name) LIKE '%test%' OR lower(name) LIKE '%borrar%' OR lower(name) LIKE '%prueba%')
    AND lower(name) NOT LIKE '%pruebas de lab%'
  ORDER BY board_id, item_id`);
const porSlug = Object.fromEntries(ORDEN.map(s => [s, candidatos.filter(c => c.board_id === BOARDS[s])]));
for (const s of ORDEN) {
  console.log(`\n${s}: ${porSlug[s].length} items, ${porSlug[s].reduce((a, c) => a + c.lineas, 0)} líneas`);
  for (const c of porSlug[s]) console.log(`  ${c.item_id}  ${c.name}${c.lineas ? `  (${c.lineas} líneas)` : ''}`);
}
console.log(`\ntotal: ${candidatos.length} items`);

if (MODO === '--dry') { console.log('(dry run — --encolar para mandarlos a la cola del cron, --estado para ver el avance)'); process.exit(0); }

if (MODO === '--encolar') {
  d1(`CREATE TABLE IF NOT EXISTS limpieza_cola (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, item_id INTEGER NOT NULL, nombre TEXT NOT NULL,
    encolado_por TEXT NOT NULL, encolado_at TEXT NOT NULL, procesado_at TEXT, resultado TEXT, UNIQUE (slug, item_id))`);
  const ahora = new Date().toISOString();
  let n = 0;
  for (const slug of ORDEN) {
    for (const c of porSlug[slug]) {
      d1(`INSERT OR IGNORE INTO limpieza_cola (slug, item_id, nombre, encolado_por, encolado_at) VALUES (${q(slug)}, ${c.item_id}, ${q(c.name)}, ${q(EMAIL)}, ${q(ahora)})`);
      n++;
    }
  }
  console.log(`\nencolados: ${n} (como ${EMAIL}). El cron de 15 min procesa 10 por corrida; --estado para ver el avance.`);
  process.exit(0);
}

// --borrar: directo contra producción con la sesión de Access guardada.
const { abrirContexto, sesionValida, PROD } = await import('./prod-login.mjs');
const ctx = await abrirContexto({ headless: true });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const me = await sesionValida(page);
if (!me) { console.error('sin sesión de Access: corre node scripts/prod-login.mjs (o usa --encolar)'); await ctx.close(); process.exit(2); }
console.log(`\nsesión: ${me.email} (${me.role})`);
await page.goto(PROD, { waitUntil: 'domcontentloaded' });
let ok = 0, fallo = 0, tope = false;
for (const slug of ORDEN) {
  if (tope) break;
  for (const c of porSlug[slug]) {
    const r = await page.evaluate(async body => {
      const res = await fetch('/api/admin/limpieza/borrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
      return { status: res.status, json };
    }, { slug, itemId: c.item_id, nombre: c.name });
    if (r.status === 200) { ok++; console.log(`  ✓ ${slug} ${c.item_id} "${c.name}" (${r.json?.lineas ?? 0} líneas)`); }
    else if (r.status === 429) { tope = true; console.log(`  ⏸ tope por hora: ${r.json?.error}`); break; }
    else { fallo++; console.log(`  ✗ ${slug} ${c.item_id} "${c.name}" → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`); }
  }
}
await ctx.close();
console.log(`\nborrados: ${ok} · fallidos: ${fallo} · quedan: ${candidatos.length - ok}${tope ? ' (tope alcanzado, repite en una hora)' : ''}`);
