#!/usr/bin/env node
// scripts/limpiar-pruebas.mjs — Borra de Monday y de D1 los items de PRUEBA
// (nombre con test / prueba / borrar) de Oportunidades, Proyectos, Contactos e
// Instituciones, con sus líneas (Efraín, 2026-09-16).
//
//   node scripts/limpiar-pruebas.mjs            # solo lista (dry run)
//   node scripts/limpiar-pruebas.mjs --borrar   # borra, de a uno, hasta el tope
//
// La selección sale de la D1 de producción (wrangler, igual que salud.mjs) y
// cada borrado va por POST /api/admin/limpieza/borrar (worker/routes/limpieza.ts)
// con la sesión de Access de scripts/.prod-profile (node scripts/prod-login.mjs
// una vez). El endpoint re-verifica id+nombre, que no haya firma manual, y
// aplica el tope de 40 por hora: al primer 429 el script se detiene — se
// vuelve a correr en una hora. Se excluyen "PRUEBAS DE LAB…" (proyectos y
// productos reales de laboratorio) y no se tocan productos ni proveedores.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirContexto, sesionValida, PROD } from './prod-login.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BORRAR = process.argv.includes('--borrar');
const BOARDS = {
  oportunidades: 18395657596, proyectos: 18395657594, contactos: 18395657595, instituciones: 18395657597,
};
const ORDEN = ['oportunidades', 'proyectos', 'contactos', 'instituciones'];

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--remote', '--env-file=.dev.vars', '--json', '--command', sql], {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? '40a5f9802bef8075fb322a54615bbcf6' },
  });
  return JSON.parse(out)[0]?.results ?? [];
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
if (!BORRAR) { console.log('(dry run — agrega --borrar para borrar)'); process.exit(0); }

const ctx = await abrirContexto({ headless: true });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const me = await sesionValida(page);
if (!me) { console.error('sin sesión de Access: corre node scripts/prod-login.mjs'); await ctx.close(); process.exit(2); }
console.log(`\nsesión: ${me.email} (${me.role})`);
await page.goto(PROD, { waitUntil: 'domcontentloaded' });

let ok = 0, fallo = 0, tope = false;
for (const slug of ORDEN) {
  if (tope) break;
  for (const c of porSlug[slug]) {
    const r = await page.evaluate(async ([slug, itemId, nombre]) => {
      const res = await fetch('/api/admin/limpieza/borrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, itemId, nombre }),
      });
      let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
      return { status: res.status, json };
    }, [slug, c.item_id, c.name]);
    if (r.status === 200) { ok++; console.log(`  ✓ ${slug} ${c.item_id} "${c.name}" (${r.json?.lineas ?? 0} líneas)`); }
    else if (r.status === 429) { tope = true; console.log(`  ⏸ tope por hora: ${r.json?.error}`); break; }
    else { fallo++; console.log(`  ✗ ${slug} ${c.item_id} "${c.name}" → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`); }
  }
}
await ctx.close();
console.log(`\nborrados: ${ok} · fallidos: ${fallo} · quedan: ${candidatos.length - ok}${tope ? ' (tope alcanzado, repite en una hora)' : ''}`);
