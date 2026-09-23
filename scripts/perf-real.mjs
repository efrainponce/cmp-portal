#!/usr/bin/env node
// scripts/perf-real.mjs — ¿qué tan rápido le carga el portal a cada quien, EN
// SU RED? (2026-09-23). Lee de D1 de producción los resúmenes `perf` que manda
// cada navegador (src/lib/perfReal.ts) y los junta por persona y por endpoint.
// Sirve para comprobar una optimización (antes/después) y escoger la
// siguiente: si Compras en Mérida tarda 9 s en ver la lista y 8 de ellos son
// bajar 400 KB, la siguiente es adelgazar esa respuesta, no el servidor.
//
//   node scripts/perf-real.mjs                    # últimas 24 h, todos
//   node scripts/perf-real.mjs --dias 7
//   node scripts/perf-real.mjs --rol compras --horas 72
//   node scripts/perf-real.mjs --email cotizaciones3@mexicanadeproteccion.com
//   node scripts/perf-real.mjs --local            # contra la D1 local de wrangler dev
//
// Qué significa cada número:
//  - red: lo que Chrome estima de la conexión (navigator.connection):
//    `down` Mbps, `rtt` ms. Safari/Firefox no lo dan.
//  - carga: TTFB del HTML y fin del evento load de la página.
//  - lista: ms desde que arrancó la navegación hasta la primera lista con
//    datos en pantalla (lo que la persona espera al entrar).
//  - drawer: abrir → detalle en pantalla, solo aperturas SIN caché (las que
//    esperan a la red).
//  - LCP / INP / CLS: Web Vitals (bien: LCP < 2.5 s, INP < 200 ms, CLS < 0.1).
//  - endpoints: `bajada` = duración COMPLETA de las respuestas 200 (hasta el
//    último byte); `espera` = hasta el primer byte. La diferencia es el ancho
//    de banda. `304` = % de revalidaciones que no bajaron cuerpo.
//    Los percentiles por endpoint son ponderados sobre los p50/p75 de cada
//    ventana de 10 min (el navegador ya manda resumido) — aproximados, de
//    sobra para comparar.
//
// OJO con la atribución por persona: `ux_event.user_id` es el monday_user_id
// y "Actuar en Monday como" lo PRESTA — un mismo id puede tener varios
// correos en identity (se listan todos). --email filtra por el id de ese
// correo, así que trae también a quien lo comparta.
// Solo lectura. Necesita `.dev.vars` en la raíz del repo, igual que salud.mjs.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const local = argv.includes('--local');
const horas = arg('--dias') ? Number(arg('--dias')) * 24 : Number(arg('--horas') ?? 24);
const email = arg('--email')?.toLowerCase();
const rol = arg('--rol');
const desde = new Date(Date.now() - Math.max(1, horas || 24) * 3_600_000).toISOString();

function d1(sql) {
  // .env trae un token de Cloudflare que secuestra a wrangler: fuera del entorno.
  const env = { ...process.env };
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
const titulo = t => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ── estadística ─────────────────────────────────────────────────────────────
function pct(xs, p) {
  const v = xs.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
}
/** Percentil ponderado: cada valor cuenta `peso` veces (p50 de una ventana con n peticiones). */
function pctPond(pares, p) {
  const v = pares.filter(([x, w]) => Number.isFinite(x) && w > 0).sort((a, b) => a[0] - b[0]);
  const total = v.reduce((a, [, w]) => a + w, 0);
  if (!total) return null;
  let acc = 0;
  for (const [x, w] of v) { acc += w; if (acc >= p * total) return x; }
  return v[v.length - 1][0];
}
const moda = xs => {
  const m = {};
  for (const x of xs) if (x) m[x] = (m[x] ?? 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const ms = x => (x === null || x === undefined ? '—' : x >= 10_000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x)}`);
const kb = b => (b === null || b === undefined ? '—' : (b / 1024).toFixed(1));

// ── datos ───────────────────────────────────────────────────────────────────
let filtroUsuario = '';
if (email) {
  const ids = d1(`SELECT DISTINCT monday_user_id AS id FROM identity WHERE lower(email) = ${q(email)}`).map(r => r.id);
  if (!ids.length) { console.error(`No hay identity con correo ${email}.`); process.exit(1); }
  filtroUsuario = ` AND e.user_id IN (${ids.join(',')})`;
}
const filtroRol = rol ? ` AND e.role = ${q(rol)}` : '';

const filas = d1(`SELECT e.user_id, e.role, e.session_id, e.target, e.board_slug, e.latency_ms, e.meta
  FROM ux_event e WHERE e.kind = 'perf' AND e.created_at >= ${q(desde)}${filtroUsuario}${filtroRol}`)
  .map(r => ({ ...r, m: (() => { try { return JSON.parse(r.meta ?? '{}') ?? {}; } catch { return {}; } })() }));

const nombres = new Map();
for (const r of d1('SELECT monday_user_id AS id, group_concat(email, \', \') AS correos FROM identity GROUP BY monday_user_id')) nombres.set(r.id, r.correos);

console.log(`Rendimiento real del portal — ${local ? 'D1 LOCAL' : 'producción'}, ventana de ${horas} h (desde ${desde.slice(0, 16)} UTC)`
  + `${email ? `, correo ${email}` : ''}${rol ? `, rol ${rol}` : ''}: ${filas.length} resúmenes`);
if (!filas.length) {
  console.log('\nSin datos `perf` en la ventana (¿ya se desplegó src/lib/perfReal.ts? ¿alguien abrió el portal?).');
  process.exit(0);
}

// ── 1. por persona ──────────────────────────────────────────────────────────
titulo('1. Por persona');
const porUsuario = new Map();
for (const f of filas) {
  const k = `${f.user_id}|${f.role}`;
  if (!porUsuario.has(k)) porUsuario.set(k, []);
  porUsuario.get(k).push(f);
}
const tabla = [];
for (const [k, fs] of porUsuario) {
  const [uid, role] = k.split('|');
  const cargas = fs.filter(f => f.target === 'perf:carga');
  const vis = new Map();   // máximo por sesión: LCP/INP/CLS solo crecen
  for (const f of fs.filter(f => f.target === 'perf:vitals')) {
    const v = vis.get(f.session_id) ?? {};
    for (const c of ['lcp', 'inp', 'cls']) if (typeof f.m[c] === 'number') v[c] = Math.max(v[c] ?? 0, f.m[c]);
    vis.set(f.session_id, v);
  }
  const vitals = [...vis.values()];
  const api = fs.filter(f => f.target.startsWith('api:'));
  const n304 = api.filter(f => f.m.nm).reduce((a, f) => a + (f.m.n ?? 0), 0);
  const nApi = api.reduce((a, f) => a + (f.m.n ?? 0), 0);
  const lista200 = api.filter(f => f.target === 'api:get:boards:slug:items' && !f.m.nm);
  const assets = fs.filter(f => f.target === 'perf:assets');
  const nAssets = assets.reduce((a, f) => a + (f.m.n ?? 0), 0);
  const cacheAssets = assets.reduce((a, f) => a + (f.m.cache ?? 0), 0);
  tabla.push({
    persona: (nombres.get(Number(uid)) ?? `user ${uid}`).slice(0, 60),
    rol: role,
    ses: new Set(fs.map(f => f.session_id)).size,
    cargas: cargas.length,
    red: moda(cargas.map(f => f.m.ect)) ?? '—',
    down_mbps: pct(cargas.map(f => f.m.down), 0.5) ?? '—',
    rtt: ms(pct(cargas.map(f => f.m.rtt), 0.5)),
    ttfb: ms(pct(cargas.map(f => f.m.ttfb), 0.5)),
    load: ms(pct(cargas.map(f => f.m.load), 0.5)),
    lista_p50: ms(pct(fs.filter(f => f.target === 'perf:datos:lista').map(f => f.latency_ms), 0.5)),
    lista_p75: ms(pct(fs.filter(f => f.target === 'perf:datos:lista').map(f => f.latency_ms), 0.75)),
    drawer_p50: ms(pct(fs.filter(f => f.target === 'perf:datos:drawer' && !f.m.cache).map(f => f.latency_ms), 0.5)),
    lista_200: ms(pctPond(lista200.map(f => [f.m.p50, f.m.n]), 0.5)),
    lcp_p75: ms(pct(vitals.map(v => v.lcp), 0.75)),
    inp_p75: ms(pct(vitals.map(v => v.inp), 0.75)),
    cls_p75: pct(vitals.map(v => v.cls), 0.75) ?? '—',
    '304%': nApi ? Math.round((100 * n304) / nApi) : '—',
    'cache_js%': nAssets ? Math.round((100 * cacheAssets) / nAssets) : '—',
  });
}
tabla.sort((a, b) => b.ses - a.ses);
console.table(tabla);
console.log('  lista = navegación → primera lista pintada · drawer = abrir → detalle (sin caché) · lista_200 = bajada completa de la lista cuando SÍ cambió');

// ── 2. por endpoint ─────────────────────────────────────────────────────────
titulo('2. Por endpoint (todas las personas del filtro)');
const porEp = new Map();
for (const f of filas.filter(f => f.target.startsWith('api:'))) {
  const k = `${f.target}${f.board_slug ? ` [${f.board_slug}]` : ''}`;
  if (!porEp.has(k)) porEp.set(k, []);
  porEp.get(k).push(f);
}
const eps = [];
for (const [k, fs] of porEp) {
  const completas = fs.filter(f => !f.m.nm);
  const nm = fs.filter(f => f.m.nm);
  const nC = completas.reduce((a, f) => a + (f.m.n ?? 0), 0);
  const nN = nm.reduce((a, f) => a + (f.m.n ?? 0), 0);
  const bytesC = completas.reduce((a, f) => a + (f.m.bytes ?? 0), 0);
  eps.push({
    endpoint: k.slice(0, 70),
    peticiones: nC + nN,
    '304%': nC + nN ? Math.round((100 * nN) / (nC + nN)) : '—',
    bajada_p50: ms(pctPond(completas.map(f => [f.m.p50, f.m.n]), 0.5)),
    bajada_p75: ms(pctPond(completas.map(f => [f.m.p75, f.m.n]), 0.75)),
    espera_p50: ms(pctPond(completas.map(f => [f.m.ttfb, f.m.n]), 0.5)),
    kb_por_200: nC ? kb(bytesC / nC) : '—',
    r304_p50: ms(pctPond(nm.map(f => [f.m.p50, f.m.n]), 0.5)),
    fria_p50: ms(pctPond(completas.filter(f => f.m.fria).map(f => [f.m.p50, f.m.n]), 0.5)),
    _peso: bytesC,
  });
}
eps.sort((a, b) => b._peso - a._peso);
console.table(eps.slice(0, 30).map(({ _peso, ...r }) => r));
console.log('  ordenado por KB totales bajados (lo que más le cuesta a una red lenta) · fria = la ventana de la carga en frío');

// ── 3. estáticos ────────────────────────────────────────────────────────────
titulo('3. Estáticos (JS/CSS/fuentes)');
const assets = filas.filter(f => f.target === 'perf:assets');
const suma = (fs, c) => fs.reduce((a, f) => a + (f.m[c] ?? 0), 0);
for (const [etq, fs] of [['carga fría (1ª ventana)', assets.filter(f => f.m.fria)], ['después (chunks diferidos)', assets.filter(f => !f.m.fria)]]) {
  if (!fs.length) continue;
  const n = suma(fs, 'n');
  console.log(`  ${etq}: ${fs.length} ventanas, ${n} archivos, ${n ? Math.round((100 * suma(fs, 'cache')) / n) : 0}% de caché,`
    + ` ${kb(suma(fs, 'bytes') / fs.length)} KB por ventana (js ${kb(suma(fs, 'js') / fs.length)}, css ${kb(suma(fs, 'css') / fs.length)}, fuentes ${kb(suma(fs, 'font') / fs.length)}),`
    + ` el más lento p50 ${ms(pct(fs.map(f => f.m.max), 0.5))} ms`);
}
if (!assets.length) console.log('  sin datos');

console.log('\nDetalle crudo: SELECT created_at, target, board_slug, latency_ms, meta FROM ux_event WHERE kind = \'perf\' AND user_id = … ORDER BY id DESC LIMIT 50');
