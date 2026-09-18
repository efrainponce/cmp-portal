// scripts/perf-cls.mjs — mide CLS (Cumulative Layout Shift) y dice QUÉ se movió.
//
// Hermano de perf-bench.mjs (que mide tiempos y bytes): este solo mira los
// brincos de pantalla. Corre contra `wrangler dev` (:8787) con el build de
// producción de ./dist, con CPU y red estranguladas — los brincos solo se ven
// cuando los datos tardan en llegar.
//
//   npm run build && node scripts/perf-cls.mjs --label baseline
//   node scripts/perf-cls.mjs --label despues --perfil media --movil
//
// CLS NO es la suma de todos los brincos: es la peor "ventana de sesión"
// (brincos a <1 s uno del otro, ventana de máx. 5 s), y los brincos dentro de
// los 500 ms de un input del usuario no cuentan (`hadRecentInput`). Sumar todo
// infla el número en una página que pollea.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'perf-results');
const BASE = process.env.PERF_BASE ?? 'http://localhost:8787';

const NETWORK = {
  lenta: { downloadThroughput: (1.5 * 1024 * 1024) / 8, uploadThroughput: (0.75 * 1024 * 1024) / 8, latency: 300 },
  media: { downloadThroughput: (6 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8, latency: 100 },
  rapida: { downloadThroughput: (30 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8, latency: 20 },
};
const CPU_THROTTLE = Number(process.env.PERF_CPU ?? 4);
// Cuánto se deja quieta la página: tiene que alcanzar a ver el poll de la
// lista (5 s) y el de Inicio.
const QUIETO_MS = Number(process.env.PERF_IDLE ?? 20_000);

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}
const flag = (f) => process.argv.includes(f);

const RUTAS = (arg('--rutas') ?? '/,/home,/oportunidades,/costeo,/doctallas,/inventario').split(',');

// Corre ANTES que la app: registra cada layout-shift con los nodos que se
// movieron (selector corto + de dónde a dónde).
const OBSERVADOR = `
  window.__cls = [];
  const corto = (n) => {
    if (!n || n.nodeType !== 1) return '(texto)';
    const cls = typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    const txt = (n.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + cls + (txt ? ' "' + txt + '"' : '');
  };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__cls.push({
          t: Math.round(e.startTime),
          valor: e.value,
          input: e.hadRecentInput,
          nodos: (e.sources || []).slice(0, 4).map((s) => ({
            nodo: corto(s.node),
            de: [Math.round(s.previousRect.x), Math.round(s.previousRect.y), Math.round(s.previousRect.width), Math.round(s.previousRect.height)],
            a: [Math.round(s.currentRect.x), Math.round(s.currentRect.y), Math.round(s.currentRect.width), Math.round(s.currentRect.height)],
          })),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
`;

/** CLS con las reglas de verdad: peor ventana de sesión (gap <1 s, máx 5 s). */
function cls(entradas) {
  let peor = 0, actual = 0, inicio = 0, ultimo = 0;
  for (const e of entradas) {
    if (e.input) continue;
    if (actual > 0 && e.t - ultimo < 1000 && e.t - inicio < 5000) actual += e.valor;
    else { actual = e.valor; inicio = e.t; }
    ultimo = e.t;
    if (actual > peor) peor = actual;
  }
  return peor;
}

async function medir(browser, path, perfil, movil) {
  const context = await browser.newContext({
    viewport: movil ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(movil ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await context.addInitScript(OBSERVADOR);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORK[perfil] });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  await page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(QUIETO_MS);
  const entradas = await page.evaluate(() => window.__cls);
  const aterrizo = await page.evaluate(() => location.pathname);
  await context.close();

  const sinInput = entradas.filter((e) => !e.input);
  return {
    path, aterrizo,
    cls: +cls(entradas).toFixed(4),
    brincos: sinInput.length,
    peores: sinInput.slice().sort((a, b) => b.valor - a.valor).slice(0, 5),
  };
}

// Una sesión de verdad: abrir una oportunidad, pasar por sus pestañas, cerrar,
// cambiar de board, abrir un proyecto. El CLS de una SPA se acumula durante
// TODA la visita: un brinco 600 ms después del click ya cuenta (la ventana de
// gracia de hadRecentInput es de 500 ms y con red lenta los datos llegan
// después). Cada paso marca su tiempo para poder atribuir los brincos.
const FOLIO = arg('--folio') ?? process.env.PERF_FOLIO ?? 'OPP-0264';
const ESPERA_PASO = Number(process.env.PERF_PASO ?? 6000);

async function medirFlujo(browser, perfil, movil) {
  const context = await browser.newContext({
    viewport: movil ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(movil ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await context.addInitScript(OBSERVADOR);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORK[perfil] });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  const pasos = [];
  const marca = async (nombre) => pasos.push({ nombre, t: await page.evaluate(() => Math.round(performance.now())) });
  const click = async (nombre, locator) => {
    if (!(await locator.count())) { pasos.push({ nombre: nombre + ' (NO ENCONTRADO)', t: null }); return false; }
    await marca(nombre);
    await locator.first().click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(ESPERA_PASO);
    return true;
  };
  const tab = (texto) => page.getByRole('button', { name: texto, exact: true }).or(page.getByText(texto, { exact: true }));

  await page.goto(BASE + '/oportunidades', { waitUntil: 'load', timeout: 120_000 });
  await marca('carga /oportunidades');
  await page.waitForFunction(() => /\d+\s+activas/.test(document.body.innerText), { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  if (await click('abrir ' + FOLIO, page.locator('.row-hover').filter({ hasText: FOLIO }))) {
    for (const t of ['Cotizaciones', 'Embellecimientos', 'Actividad', 'Documentación', 'Tallas', 'Órdenes de compra', 'Actualizaciones']) {
      await click('pestaña ' + t, tab(t));
    }
    await marca('cerrar drawer');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(3000);
    // Reabrir la misma: es lo que más se hace (ir y venir entre unas pocas) y
    // es donde sirven los caches de sesión del drawer.
    if (await click('reabrir ' + FOLIO, page.locator('.row-hover').filter({ hasText: FOLIO }))) {
      await marca('cerrar drawer (2)');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(3000);
    }
  }
  // Navegación por URL interna (pushState) — igual que el sidebar, pero sirve
  // también en móvil donde el menú está escondido.
  for (const destino of ['/costeo', '/doctallas', '/home']) {
    await marca('ir a ' + destino);
    await page.evaluate((d) => { history.pushState(null, '', d); dispatchEvent(new PopStateEvent('popstate')); }, destino);
    await page.waitForTimeout(ESPERA_PASO);
    if (destino === '/doctallas') {
      if (await click('abrir primer proyecto', page.locator('.row-hover'))) {
        for (const t of ['Tallas', 'Documentación', 'Actualizaciones']) await click('pestaña proyecto ' + t, tab(t));
        await marca('cerrar drawer proyecto');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(3000);
      }
    }
  }

  const entradas = await page.evaluate(() => window.__cls);
  await context.close();
  const sinInput = entradas.filter((e) => !e.input);
  const conT = pasos.filter((p) => p.t != null);
  const pasoDe = (t) => { let n = '(antes)'; for (const p of conT) if (p.t <= t) n = p.nombre; return n; };
  const porPaso = {};
  for (const e of sinInput) {
    const k = pasoDe(e.t);
    (porPaso[k] ??= { total: 0, brincos: [] }).total += e.valor;
    porPaso[k].brincos.push(e);
  }
  return { cls: +cls(entradas).toFixed(4), suma: +sinInput.reduce((s, e) => s + e.valor, 0).toFixed(4), pasos, porPaso };
}

const label = arg('--label') ?? 'cls';
const perfil = arg('--perfil') ?? 'lenta';
const movil = flag('--movil');
if (!NETWORK[perfil]) { console.error(`perfil inválido: ${perfil}`); process.exit(1); }

const browser = await chromium.launch();
const corrida = { label, perfil, movil, cpuThrottle: CPU_THROTTLE, fecha: new Date().toISOString(), rutas: [] };
console.log(`\n═══ CLS ${label} — red ${perfil}, CPU ${CPU_THROTTLE}x, ${movil ? 'móvil 390px' : 'escritorio 1440px'} ═══`);
if (flag('--flujo')) {
  const f = await medirFlujo(browser, perfil, movil);
  corrida.flujo = f;
  console.log(`\n▸ FLUJO   CLS ${f.cls.toFixed(3)} ${f.cls <= 0.1 ? '✓' : f.cls <= 0.25 ? '~' : '✗'}   (suma de todos los brincos: ${f.suma.toFixed(3)})`);
  for (const p of f.pasos) {
    const d = f.porPaso[p.nombre];
    console.log(`\n   ── ${p.nombre}: ${d ? d.total.toFixed(3) : '0.000'}`);
    for (const e of (d?.brincos ?? []).slice().sort((a, b) => b.valor - a.valor).slice(0, 3)) {
      if (e.valor < 0.002) continue;
      console.log(`      ${e.valor.toFixed(3)} @ +${e.t - p.t} ms`);
      for (const n of e.nodos.slice(0, 3)) console.log(`          ${n.nodo}   [${n.de}] → [${n.a}]`);
    }
  }
}
for (const path of flag('--flujo') ? [] : RUTAS) {
  const r = await medir(browser, path, perfil, movil);
  corrida.rutas.push(r);
  const marca = r.cls <= 0.1 ? '✓' : r.cls <= 0.25 ? '~' : '✗';
  console.log(`\n▸ ${path}${r.aterrizo !== path ? ` → ${r.aterrizo}` : ''}   CLS ${r.cls.toFixed(3)} ${marca}  (${r.brincos} brincos)`);
  for (const e of r.peores) {
    if (e.valor < 0.001) continue;
    console.log(`   ${e.valor.toFixed(3)} @ ${e.t} ms`);
    for (const n of e.nodos) console.log(`       ${n.nodo}   [${n.de}] → [${n.a}]`);
  }
}
await browser.close();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, `${label}${flag('--flujo') ? '-flujo' : ''}${movil ? '-movil' : ''}.json`), JSON.stringify(corrida, null, 2));
