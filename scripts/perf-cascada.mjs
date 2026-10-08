#!/usr/bin/env node
// scripts/perf-cascada.mjs — la CASCADA real de cada carga de página
// (2026-10-08): qué bajó, en qué orden, cuánto esperó y cuánto tardó en bajar,
// recurso por recurso, en la red de cada quien (Mérida). La graba
// src/lib/perfReal.ts en TODAS las cargas (tabla `perf_cascada`, contrato en
// shared/perfCascada.ts). perf-real.mjs da los promedios; esto da el caso.
//
//   node scripts/perf-cascada.mjs                      # últimas 20 cargas (7 días)
//   node scripts/perf-cascada.mjs --lentas             # solo redes lentas (no 4g o < 2 Mbps o rtt ≥ 300)
//   node scripts/perf-cascada.mjs --email cotizaciones3@mexicanadeproteccion.com --dias 3
//   node scripts/perf-cascada.mjs --id 123             # dibuja la cascada de esa carga
//   node scripts/perf-cascada.mjs --tipica --lentas    # la carga "típica": p50 por recurso
//   node scripts/perf-cascada.mjs --local              # contra la D1 local
//
// Columnas del dibujo: inicio (ms desde la navegación) · espera ░ (DNS +
// conexión + servidor, hasta el primer byte) · bajada █ · KB por la red
// (`caché` = no tocó la red; `304` = revalidó sin cuerpo). Las líneas │ marcan
// los hitos: ttfb, fcp, lcp, dcl, load y la primera lista (L).
// Solo lectura. Necesita `.dev.vars` en la raíz del repo, igual que perf-real.mjs.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const local = argv.includes('--local');
const lentas = argv.includes('--lentas');
const tipica = argv.includes('--tipica');
const id = arg('--id');
const email = arg('--email')?.toLowerCase();
const rol = arg('--rol');
const n = Number(arg('--n') ?? 20);
const horas = arg('--dias') ? Number(arg('--dias')) * 24 : Number(arg('--horas') ?? 24 * 7);
const desde = new Date(Date.now() - Math.max(1, horas || 168) * 3_600_000).toISOString();

const CUENTA_CF = process.env.CLOUDFLARE_ACCOUNT_ID ?? '40a5f9802bef8075fb322a54615bbcf6';
function d1(sql) {
  // .env trae un token de Cloudflare que secuestra a wrangler: fuera del entorno.
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: CUENTA_CF };
  delete env.CLOUDFLARE_API_TOKEN;
  try {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', local ? '--local' : '--remote', '--env-file=.dev.vars', '--json', '--command', sql],
      { cwd: REPO, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(out)[0]?.results ?? [];
  } catch (err) {
    const msg = String(err?.stdout || err?.stderr || err?.message || err);
    if (/no such table/i.test(msg)) return [];
    throw err;
  }
}
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const ms = x => (x === null || x === undefined ? '—' : x >= 10_000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x)}`);
const kb = b => (b / 1024).toFixed(1);
const pct = (xs, p) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))] : null;
};
const esLenta = r => (r.ect && r.ect !== '4g') || (r.down_mbps !== null && r.down_mbps < 2) || (r.rtt_ms ?? 0) >= 300;
const red = r => [r.ect, r.down_mbps !== null ? `${r.down_mbps}Mbps` : null, r.rtt_ms !== null ? `rtt${r.rtt_ms}` : null].filter(Boolean).join(' ') || '—';
// De otro origen (Clarity, Google) el navegador no da tamaños sin
// Timing-Allow-Origin: b=0 ahí NO es caché.
const estado = x => (x.n.startsWith('//') ? 'otro origen' : x.b === 0 ? 'caché' : x.e === 0 && x.i === 'fetch' ? '304' : `${kb(x.b)} KB`);
const dur = x => (x >= 10_000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);

function filtros() {
  const f = [`created_at >= ${q(desde)}`];
  if (email) f.push(`email = ${q(email)}`);
  if (rol) f.push(`role = ${q(rol)}`);
  return f.join(' AND ');
}

function dibujar(r) {
  const hitos = JSON.parse(r.hitos);
  const recursos = JSON.parse(r.recursos);
  const fin = Math.max(...recursos.map(x => x.s + x.d), ...Object.values(hitos).filter(Number.isFinite));
  const ANCHO = 70;
  const col = t => Math.min(ANCHO - 1, Math.round((t / fin) * (ANCHO - 1)));
  const marcas = Object.entries(hitos).filter(([k, v]) => k !== 'nav' && Number.isFinite(v));
  console.log(`\n\x1b[1mCarga #${r.id}\x1b[0m ${r.created_at.slice(0, 16)} · ${r.email} (${r.role}) · /${r.pantalla} · red ${red(r)}${r.oculta ? ' · \x1b[33mPESTAÑA OCULTA (tiempos no confiables)\x1b[0m' : ''}`);
  console.log(`hitos: ${marcas.map(([k, v]) => `${k} ${ms(v)}`).join(' · ')} · ${recursos.length} recursos · ${kb(recursos.reduce((a, x) => a + x.b, 0))} KB por la red · escala ${ms(fin)}`);
  const regla = Array(ANCHO).fill(' ');
  for (const [k, v] of marcas) regla[col(v)] = k === 'lista' ? 'L' : k[0];
  console.log(`${' '.repeat(7)}${'recurso'.padEnd(46)}${regla.join('')}`);
  for (const x of recursos) {
    const fila = Array(ANCHO).fill(' ');
    for (const [, v] of marcas) fila[col(v)] = '\x1b[2m│\x1b[0m';
    const a = col(x.s), b = col(x.s + x.w), c = Math.max(col(x.s + x.d), a);
    for (let i = a; i <= c; i++) fila[i] = i <= b && x.w > 0 ? '░' : '█';
    const nombre = `${x.m ? `${x.m} ` : ''}${x.n}`.slice(-45).padEnd(46);
    console.log(`${ms(x.s).padStart(6)} ${nombre}${fila.join('')} ${dur(x.d)} ${estado(x)}`);
  }
}

if (id) {
  const [r] = d1(`SELECT * FROM perf_cascada WHERE id = ${Number(id)}`);
  if (!r) { console.error(`No hay cascada #${id}.`); process.exit(1); }
  dibujar(r);
  process.exit(0);
}

const filas = d1(`SELECT id, created_at, email, role, pantalla, oculta, ect, down_mbps, rtt_ms, hitos${tipica ? ', recursos' : ', json_array_length(recursos) AS nrec'}
  FROM perf_cascada WHERE ${filtros()} ORDER BY id DESC LIMIT ${tipica ? 500 : Math.max(n * 5, 100)}`)
  .filter(r => !lentas || esLenta(r));

if (!filas.length) {
  console.log(`Sin cascadas desde ${desde}${lentas ? ' en redes lentas' : ''}. (La tabla nace con el deploy del 2026-10-08.)`);
  process.exit(0);
}

if (tipica) {
  // p50 por recurso sobre las cargas visibles: el orden y el peso "normal".
  const visibles = filas.filter(r => !r.oculta);
  const por = new Map();
  for (const r of visibles) {
    const vistos = new Set();
    for (const x of JSON.parse(r.recursos)) {
      const k = `${x.m ? `${x.m} ` : ''}${x.n}`;
      if (vistos.has(k)) continue;      // la 1ª vez en la carga (el polling repite)
      vistos.add(k);
      const g = por.get(k) ?? { s: [], w: [], d: [], b: [] };
      g.s.push(x.s); g.w.push(x.w); g.d.push(x.d); g.b.push(x.b);
      por.set(k, g);
    }
  }
  const hitos = visibles.map(r => JSON.parse(r.hitos));
  console.log(`\n\x1b[1mCarga típica\x1b[0m — ${visibles.length} cargas${lentas ? ' en redes lentas' : ''} desde ${desde.slice(0, 16)}`);
  console.log(`hitos p50: ${['ttfb', 'fcp', 'lcp', 'dcl', 'load', 'lista'].map(k => `${k} ${ms(pct(hitos.map(h => h[k]), 0.5))}`).join(' · ')}`);
  const tabla = [...por.entries()]
    .filter(([, g]) => g.s.length >= Math.max(1, Math.ceil(visibles.length * 0.2)))
    .map(([k, g]) => ({
      recurso: k.slice(-60), en_cargas: `${Math.round((g.s.length / visibles.length) * 100)}%`,
      inicio_p50: ms(pct(g.s, 0.5)), espera_p50: ms(pct(g.w, 0.5)), dur_p50: ms(pct(g.d, 0.5)), dur_p75: ms(pct(g.d, 0.75)),
      kb_p50: kb(pct(g.b, 0.5)), _s: pct(g.s, 0.5),
    }))
    .sort((a, b) => a._s - b._s)
    .map(({ _s, ...r }) => r);
  console.table(tabla);
  process.exit(0);
}

console.log(`\n\x1b[1mCargas recientes\x1b[0m${lentas ? ' (redes lentas)' : ''} — dibuja una con --id N`);
console.table(filas.slice(0, n).map(r => {
  const h = JSON.parse(r.hitos);
  return {
    id: r.id, cuando: r.created_at.slice(5, 16).replace('T', ' '), persona: r.email.split('@')[0], rol: r.role,
    pantalla: r.pantalla, red: red(r), oculta: r.oculta ? 'sí' : '',
    ttfb: ms(h.ttfb), fcp: ms(h.fcp), lcp: ms(h.lcp), load: ms(h.load), lista: ms(h.lista), recursos: r.nrec,
  };
}));
