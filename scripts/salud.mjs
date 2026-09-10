#!/usr/bin/env node
// scripts/salud.mjs — ¿Qué está fallando en el portal? Lee D1 de producción y
// resume en la terminal (2026-09-10, Efraín: "haz lo necesario para tener
// telemetría o algo que puedas ver cuando las cosas no funcionan").
//
//   node scripts/salud.mjs            # últimas 24 h
//   node scripts/salud.mjs --horas 72
//
// Fuentes (todas en D1, solo lectura):
//  - salud_hallazgo: revisiones de integridad que el worker corre cada hora
//    (worker/lib/salud.ts): divisiones borradas, SKU desfasado, líneas
//    fantasma, outbox atorado/fallido/en conflicto, tallas que no cuadran,
//    errores de la última hora.
//  - sync_log ok=0: excepciones reales del servidor (kind 'error', con pila) y
//    del front ('front …'), fallos de sync.
//  - accion_log: cada POST/PATCH/DELETE rechazado, con su motivo.
//  - outbox: escrituras del portal a Monday por estado.
// Necesita `.dev.vars` (wrangler) en la raíz del repo, igual que el resto de
// scripts.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--horas');
const horas = i > 0 ? Math.max(1, Number(process.argv[i + 1]) || 24) : 24;
const desde = new Date(Date.now() - horas * 3_600_000).toISOString();

function d1(sql) {
  try {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--remote', '--env-file=.dev.vars', '--json', '--command', sql],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(out)[0]?.results ?? [];
  } catch (err) {
    const msg = String(err?.stdout || err?.message || err);
    if (/no such table/i.test(msg)) return null;
    throw err;
  }
}
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const corto = (s, n = 200) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const ruta = r => String(r).replace(/\/\d{5,}/g, '/:id');
const titulo = t => console.log(`\n\x1b[1m${t}\x1b[0m`);

console.log(`Salud del portal CMP — ventana de ${horas} h (desde ${desde.slice(0, 16)} UTC)`);

titulo('1. Hallazgos abiertos (revisión de integridad cada hora)');
const abiertos = d1(`SELECT tipo, severidad, titulo, board_id, item_id, primera_vez, ultima_vez FROM salud_hallazgo
  WHERE resuelto_at IS NULL ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, ultima_vez DESC LIMIT 80`);
if (abiertos === null) console.log('  (la tabla todavía no existe: la revisión no ha corrido)');
else {
  const ultima = d1('SELECT MAX(ultima_vez) AS t FROM salud_hallazgo')?.[0]?.t;
  console.log(`  última revisión: ${ultima ? ultima.slice(0, 16) + ' UTC' : 'nunca'}`);
  if (abiertos.length === 0) console.log('  ✓ nada abierto');
  const porTipo = {};
  for (const h of abiertos) porTipo[h.tipo] = (porTipo[h.tipo] ?? 0) + 1;
  if (abiertos.length) console.log('  por tipo:', Object.entries(porTipo).map(([t, n]) => `${t}=${n}`).join(', '));
  for (const h of abiertos.slice(0, 40)) {
    console.log(`  [${h.severidad}] ${corto(h.titulo, 240)}${h.item_id ? `  (item ${h.item_id})` : ''}  desde ${String(h.primera_vez).slice(0, 16)}`);
  }
}

titulo('2. Errores registrados (sync_log ok=0)');
const errores = d1(`SELECT CASE WHEN kind = 'error' AND detail LIKE 'front %' THEN 'front' ELSE kind END AS origen, COUNT(*) AS n, MAX(at) AS ultimo
  FROM sync_log WHERE ok = 0 AND at > ${q(desde)} GROUP BY origen ORDER BY n DESC`) ?? [];
if (errores.length === 0) console.log('  ✓ ninguno');
for (const e of errores) console.log(`  ${e.origen}: ${e.n} (último ${String(e.ultimo).slice(0, 16)})`);
const ejemplos = d1(`SELECT at, kind, detail FROM sync_log WHERE ok = 0 AND kind IN ('error', 'http') AND at > ${q(desde)} ORDER BY id DESC LIMIT 15`) ?? [];
for (const e of ejemplos) console.log(`   · ${String(e.at).slice(0, 16)} ${corto(e.detail, 260)}`);

titulo('3. Acciones rechazadas (accion_log, status ≥ 400)');
const rech = d1(`SELECT ruta, status, detalle, COUNT(*) AS n FROM accion_log WHERE status >= 400 AND at > ${q(desde)} GROUP BY ruta, status, detalle`);
if (rech === null) console.log('  (accion_log todavía no existe)');
else {
  const m = new Map();
  for (const r of rech) {
    const k = `${ruta(r.ruta)}|${r.status}|${r.detalle ?? ''}`;
    m.set(k, { ruta: ruta(r.ruta), status: r.status, detalle: r.detalle, n: (m.get(k)?.n ?? 0) + r.n });
  }
  const lista = [...m.values()].sort((a, b) => b.n - a.n).slice(0, 25);
  if (lista.length === 0) console.log('  ✓ ninguna');
  for (const r of lista) console.log(`  ${String(r.n).padStart(4)} × ${r.status} ${r.ruta} — ${corto(r.detalle ?? '', 140)}`);
}

titulo('4. Outbox (escrituras del portal a Monday)');
const ob = d1(`SELECT status, COUNT(*) AS n FROM outbox WHERE updated_at > ${q(desde)} GROUP BY status`) ?? [];
console.log('  ' + (ob.map(o => `${o.status}=${o.n}`).join(', ') || 'sin movimiento'));
const atorados = d1(`SELECT id, board_id, item_id, status, attempts, updated_at FROM outbox WHERE status IN ('pending','sent') AND updated_at < ${q(new Date(Date.now() - 15 * 60_000).toISOString())} LIMIT 10`) ?? [];
for (const o of atorados) console.log(`  ⚠ atorado #${o.id} ${o.status} (${o.attempts} intentos) item ${o.item_id} desde ${String(o.updated_at).slice(0, 16)}`);

console.log('\nDetalle de un hallazgo: SELECT * FROM salud_hallazgo WHERE clave = \'…\' (wrangler d1 execute cmp-portal --remote --env-file=.dev.vars).');
