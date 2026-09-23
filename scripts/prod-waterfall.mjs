#!/usr/bin/env node
// scripts/prod-waterfall.mjs — cascada de red de una carga REAL de producción
// con la red estrangulada (2026-09-23). Sirve para ver, antes y después de una
// optimización, qué baja la página, en qué orden, cuánto pesa y cuánto tarda
// cada cosa con una conexión lenta como la de Compras en Mérida. Complementa
// a scripts/perf-real.mjs: aquél dice lo que VIVEN los usuarios; éste deja
// reproducir una carga concreta y ver por qué.
//
//   node scripts/prod-waterfall.mjs /oportunidades
//   node scripts/prod-waterfall.mjs /proyectos /proyectos/12898219669   # luego abre un drawer
//   node scripts/prod-waterfall.mjs /oportunidades --sin-cache          # carga fría (primera visita)
//   node scripts/prod-waterfall.mjs /costeo --latencia 150 --bajada 5   # otra red
//   node scripts/prod-waterfall.mjs /oportunidades --reposo 60          # y cuánto trafica en reposo
//
// Sin --sin-cache la caché del navegador se conserva (el perfil es
// persistente): es la carga de quien ya había entrado, el caso de todos los
// días. Red por defecto: 300 ms de latencia, 1.5 Mbps de bajada, 0.5 de
// subida.
//
// Necesita la sesión de Access ya iniciada en el perfil de Chrome
// (`node scripts/prod-login.mjs`, deja scripts/.prod-profile en la raíz del
// repo — es una credencial, está en .gitignore). Desde un worktree ese perfil
// no existe: apúntalo con PROD_PROFILE=/ruta/al/repo/scripts/.prod-profile.
// Usa Chrome de verdad (channel 'chrome'), igual que prod-login.
// Solo LEE: navega y mide, no toca nada.
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PERFIL = process.env.PROD_PROFILE ?? join(HERE, '.prod-profile');
const PROD = process.env.PROD_BASE ?? 'https://portal.mexicanadeproteccion.com';

const args = process.argv.slice(2);
function opcion(nombre, def) {
  const i = args.indexOf(nombre);
  if (i < 0) return def;
  const v = Number(args[i + 1]);
  args.splice(i, 2);
  return Number.isFinite(v) ? v : def;
}
const sinCache = args.includes('--sin-cache');
if (sinCache) args.splice(args.indexOf('--sin-cache'), 1);
const latencia = opcion('--latencia', 300);
const bajadaMbps = opcion('--bajada', 1.5);
const subidaMbps = opcion('--subida', 0.5);
const reposoS = opcion('--reposo', 0);
const esperaS = opcion('--espera', 20);
const [ruta = '/', ruta2] = args;

if (!existsSync(PERFIL)) {
  console.error(`No existe el perfil ${PERFIL}. Corre \`node scripts/prod-login.mjs\` (o define PROD_PROFILE).`);
  process.exit(1);
}

const ctx = await chromium.launchPersistentContext(PERFIL, { headless: true, channel: 'chrome' });
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
if (sinCache) await cdp.send('Network.clearBrowserCache');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: latencia,
  downloadThroughput: (bajadaMbps * 1e6) / 8, uploadThroughput: (subidaMbps * 1e6) / 8,
});

// Por requestId, desde CDP y no desde Resource Timing: CDP ve también lo que
// la página no reporta (redirecciones de Access, beacons) y el tamaño real en
// el cable (encodedDataLength, con encabezados).
const reqs = new Map();
cdp.on('Network.requestWillBeSent', e => reqs.set(e.requestId, { url: e.request.url, metodo: e.request.method, inicio: e.timestamp }));
cdp.on('Network.responseReceived', e => {
  const r = reqs.get(e.requestId);
  if (!r) return;
  const h = e.response.headers;
  r.status = e.response.status;
  r.enc = h['content-encoding'] ?? h['Content-Encoding'];
  r.proto = e.response.protocol;
  r.cache = e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache;
});
cdp.on('Network.loadingFinished', e => {
  const r = reqs.get(e.requestId);
  if (r) { r.bytes = e.encodedDataLength; r.fin = e.timestamp; }
});

const corta = u => u.replace(PROD, '').replace(/^https?:\/\//, '').slice(0, 110);
const kb = b => +((b ?? 0) / 1024).toFixed(1);

function resumen(titulo) {
  const todas = [...reqs.values()];
  if (todas.length === 0) { console.log(`\n=== ${titulo}: sin peticiones`); return; }
  const t0 = Math.min(...todas.map(r => r.inicio));
  const total = todas.reduce((a, r) => a + (r.bytes ?? 0), 0);
  const fin = Math.max(...todas.map(r => r.fin ?? r.inicio));
  console.log(`\n=== ${titulo}: ${todas.length} peticiones, ${kb(total)} KB, última termina a ${Math.round((fin - t0) * 1000)} ms`);
  console.log('Las más pesadas:');
  console.table(todas
    .map(r => ({ desde_ms: Math.round((r.inicio - t0) * 1000), dura_ms: r.fin ? Math.round((r.fin - r.inicio) * 1000) : null, kb: kb(r.bytes), st: r.status, cache: r.cache ? 'sí' : '', url: corta(r.url) }))
    .sort((a, b) => b.kb - a.kb).slice(0, 25));
  const api = todas.filter(r => new URL(r.url).pathname.startsWith('/api/')).sort((a, b) => a.inicio - b.inicio);
  if (api.length) {
    console.log('Cascada de /api (en orden de salida):');
    for (const r of api) {
      console.log(`  ${String(Math.round((r.inicio - t0) * 1000)).padStart(6)} ms  +${r.fin ? Math.round((r.fin - r.inicio) * 1000) : '?'} ms  ${r.status ?? '…'} ${r.enc ?? '-'} ${r.proto ?? ''} ${kb(r.bytes)} KB  ${r.metodo} ${corta(r.url)}`);
    }
  }
}

async function cargar(path, titulo) {
  reqs.clear();
  const t = Date.now();
  await page.goto(PROD + path, { waitUntil: 'load', timeout: 180_000 });
  const load = Date.now() - t;
  // El evento load no espera a la lista (llega por fetch después): se deja
  // correr un rato para que entre lo que la página pide al arrancar.
  await page.waitForTimeout(esperaS * 1000);
  const nav = await page.evaluate(() => new Promise((ok) => {
    const n = performance.getEntriesByType('navigation')[0];
    // LCP no está en getEntriesByType: solo se lee con un observer `buffered`.
    let lcp = null;
    try {
      new PerformanceObserver(l => { const e = l.getEntries().at(-1); if (e) lcp = Math.round(e.startTime); })
        .observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* sin soporte */ }
    setTimeout(() => ok(n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), lcp } : null), 50);
  })).catch(() => null);
  console.log(`\n${titulo}: ${page.url()} — load en ${load} ms${nav ? ` (ttfb ${nav.ttfb}, DOMContentLoaded ${nav.dcl}, load ${nav.load}, LCP ${nav.lcp ?? '?'} ms)` : ''}`);
  if (page.url().includes('cloudflareaccess.com')) {
    console.error('La sesión de Access expiró: corre `node scripts/prod-login.mjs` otra vez.');
    await ctx.close();
    process.exit(1);
  }
  resumen(titulo);
}

console.log(`Red: ${latencia} ms, ${bajadaMbps} Mbps ↓ / ${subidaMbps} Mbps ↑ — ${sinCache ? 'SIN caché (carga fría)' : 'con la caché del perfil (visita repetida)'}`);
await cargar(ruta, `Carga ${ruta}`);
if (ruta2) await cargar(ruta2, `Abrir ${ruta2}`);

if (reposoS > 0) {
  reqs.clear();
  await page.waitForTimeout(reposoS * 1000);
  const todas = [...reqs.values()];
  console.log(`\n=== Reposo ${reposoS} s: ${todas.length} peticiones, ${kb(todas.reduce((a, r) => a + (r.bytes ?? 0), 0))} KB`);
  const porRuta = {};
  for (const r of todas) {
    const k = `${r.metodo} ${new URL(r.url).pathname.replace(/\d{6,}/g, ':id')} ${r.status ?? ''}`;
    porRuta[k] = (porRuta[k] ?? 0) + 1;
  }
  console.table(porRuta);
}

await ctx.close();
