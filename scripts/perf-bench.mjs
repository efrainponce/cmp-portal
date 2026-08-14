// scripts/perf-bench.mjs — banco de medición de performance del portal.
//
// Mide la MISMA página antes/después de un cambio, con CPU y red estranguladas
// para emular la máquina y la conexión reales de la gente en campo (no la
// laptop del que programa). Corre contra `wrangler dev` (:8787), que sirve el
// build de producción de ./dist MÁS la API real — o sea, bytes y tiempos de
// verdad, no de `vite dev`.
//
//   node scripts/perf-bench.mjs --label baseline
//   npm run build && node scripts/perf-bench.mjs --label despues
//   node scripts/perf-bench.mjs --compare baseline despues
//
// Guarda cada corrida en scripts/perf-results/<label>.json para poder comparar
// después sin volver a medir.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'perf-results');
const BASE = process.env.PERF_BASE ?? 'http://localhost:8787';

// Perfiles de red. "lenta" es el caso que nos importa: banda ancha mala /
// 4G saturado en México — ~1.5 Mbps de bajada y 300 ms de ida y vuelta.
// La latencia pesa más que el ancho de banda cuando hay muchos requests.
const NETWORK = {
  lenta: { downloadThroughput: (1.5 * 1024 * 1024) / 8, uploadThroughput: (0.75 * 1024 * 1024) / 8, latency: 300 },
  media: { downloadThroughput: (6 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8, latency: 100 },
  rapida: { downloadThroughput: (30 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8, latency: 20 },
};

// 4x = laptop/desktop de oficina de hace ~6 años contra la máquina de dev.
const CPU_THROTTLE = Number(process.env.PERF_CPU ?? 4);
// Cuánto tiempo dejamos la página quieta para medir el costo del polling.
const IDLE_MS = Number(process.env.PERF_IDLE ?? 30_000);

// `abrirDrawer` mide lo que más se queja la gente: no la carga del board, sino
// ABRIR una oportunidad. El deep link /oportunidades/<id> monta el drawer solo.
const RUTAS = [
  { nombre: 'oportunidades', path: '/oportunidades', espera: 'lista', abrirDrawer: true },
  { nombre: 'home', path: '/home', espera: null },
];

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

// Oportunidad "de verdad" que se abre para medir el drawer: con líneas,
// costeo y versiones. OPP-0264 (31 líneas) es de las más pesadas del board —
// si esa abre rápido, todas abren rápido.
const FOLIO = arg('--folio') ?? process.env.PERF_FOLIO ?? 'OPP-0264';

const fmtKB = (b) => (b / 1024).toFixed(1) + ' KB';
const fmtMs = (m) => (m == null ? '—' : Math.round(m) + ' ms');

/** Instrumenta una página vía CDP y devuelve los contadores de red crudos. */
async function instrumentar(page, perfil) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORK[perfil] });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  const requests = new Map(); // requestId -> {url, type, fromCache}
  const recursos = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    requests.set(e.requestId, { url: e.request.url, type: e.type, fromCache: false });
  });
  cdp.on('Network.requestServedFromCache', (e) => {
    const r = requests.get(e.requestId);
    if (r) r.fromCache = true;
  });
  // El recurso se registra en responseReceived, NO en loadingFinished: para un
  // 304 (que es justo lo que devuelve el poll con ETag) loadingFinished no
  // llega, y contando solo ahí las revalidaciones salían como "0 requests".
  // Son baratas en bytes pero cuestan un round-trip completo cada una —
  // con 300 ms de latencia eso sí se siente.
  cdp.on('Network.responseReceived', (e) => {
    const r = requests.get(e.requestId);
    if (!r) return;
    r.status = e.response.status;
    r.mime = e.response.mimeType;
    r.bytes = 0;
    recursos.push(r);
  });
  // encodedDataLength = bytes REALES sobre el cable (ya comprimidos).
  // `finAt` es lo que permite atribuir bytes a una ventana de tiempo: sin él,
  // una respuesta grande pedida ANTES de abrir la ventana pero recibida DENTRO
  // se contaba completa como tráfico de la ventana (con la red lenta eso
  // inventaba "3.6 MB/min" de polling que no existía).
  cdp.on('Network.loadingFinished', (e) => {
    const r = requests.get(e.requestId);
    if (r) { r.bytes = e.encodedDataLength; r.finAt = Date.now(); }
  });

  return { cdp, recursos };
}

/** Métricas del lado del navegador: paint, long tasks, memoria, DOM. */
const OBSERVADOR = `
  window.__perf = { longTasks: [], lcp: null };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      const es = l.getEntries();
      window.__perf.lcp = es[es.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
`;

async function leerMetricas(page) {
  return page.evaluate(() => {
    const paint = performance.getEntriesByType('paint');
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? null;
    const lt = window.__perf?.longTasks ?? [];
    return {
      fcp,
      lcp: window.__perf?.lcp ?? null,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null,
      // Tiempo total que el hilo principal estuvo bloqueado >50ms: esto es lo
      // que se siente como "no responde" en una máquina lenta.
      bloqueoTotal: lt.reduce((s, t) => s + Math.max(0, t.dur - 50), 0),
      longTasks: lt.length,
      peorLongTask: lt.reduce((m, t) => Math.max(m, t.dur), 0),
      nodosDOM: document.getElementsByTagName('*').length,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  });
}

function resumirRecursos(recursos) {
  const total = recursos.reduce((s, r) => s + r.bytes, 0);
  const api = recursos.filter((r) => r.url.includes('/api/'));
  const cacheados = recursos.filter((r) => r.fromCache);
  const porTipo = {};
  for (const r of recursos) {
    const k = r.url.includes('/api/') ? 'api' : (r.type || 'other').toLowerCase();
    porTipo[k] = (porTipo[k] || 0) + r.bytes;
  }
  return {
    requests: recursos.length,
    bytes: total,
    bytesApi: api.reduce((s, r) => s + r.bytes, 0),
    requestsApi: api.length,
    servidosDeCache: cacheados.length,
    porTipo,
    // El request más pesado, casi siempre el que hay que arreglar.
    masPesado: recursos.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 5)
      .map((r) => ({ url: r.url.replace(BASE, ''), bytes: r.bytes })),
  };
}

async function medirRuta(browser, ruta, perfil, { warm }) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // Sin caché entre corridas frías; con caché para medir la segunda visita.
    ...(warm ? {} : { storageState: undefined }),
  });
  await context.addInitScript(OBSERVADOR);
  const page = await context.newPage();
  const { cdp, recursos } = await instrumentar(page, perfil);

  const t0 = Date.now();
  await page.goto(BASE + ruta.path, { waitUntil: 'load', timeout: 120_000 });

  // Espera a que la lista realmente tenga renglones — "load" no significa
  // que el usuario ya pueda trabajar; los datos llegan después por /api.
  let tListaMs = null;
  if (ruta.espera === 'lista') {
    try {
      await page.waitForFunction(
        () => /\d+\s+activas/.test(document.body.innerText) && !/Cargando/.test(document.body.innerText),
        { timeout: 90_000 },
      );
      tListaMs = Date.now() - t0;
    } catch { tListaMs = null; }
  }

  const cargaInicial = resumirRecursos(recursos);
  const metricas = await leerMetricas(page);

  /** Bytes/requests en una ventana de N ms sin tocar nada. Se toma la marca
   * DESPUÉS de dejar que se asiente lo que venía en vuelo: con la red
   * estrangulada, una respuesta grande pedida antes puede aterrizar dentro de
   * la ventana y contarse como si fuera tráfico de polling (así me salió un
   * "4.5 MB/min" que no existía). */
  async function medirQuieto(ms) {
    await page.waitForTimeout(2000); // que aterrice lo que ya iba en camino
    const desde = Date.now();
    const nReq = recursos.length;
    await page.waitForTimeout(ms);
    const hasta = Date.now();
    // Solo lo que EMPEZÓ y TERMINÓ dentro de la ventana cuenta como polling.
    const dentro = recursos.filter((r) => r.finAt != null && r.finAt >= desde && r.finAt <= hasta);
    const bytes = dentro.reduce((s, r) => s + r.bytes, 0);
    return {
      segundos: ms / 1000,
      requests: recursos.length - nReq,
      bytes,
      bytesPorMinuto: Math.round((bytes / (ms / 1000)) * 60),
      urls: Object.entries(
        dentro.reduce((m, r) => {
          const k = r.url.replace(BASE, '').split('?')[0];
          m[k] = (m[k] || 0) + r.bytes;
          return m;
        }, {}),
      ).sort((a, b) => b[1] - a[1]).slice(0, 4),
    };
  }

  // Quieto con la LISTA a la vista — aquí es donde pega el poll de 5 s.
  const idleLista = await medirQuieto(IDLE_MS);

  // ---- Abrir una oportunidad (el caso que más duele) ----
  // Se mide con el board YA cargado y polleando, que es la situación real:
  // el drawer pelea por el mismo ancho de banda que el poll de la lista.
  let drawer = null;
  if (ruta.abrirDrawer) {
    const marcaRed = recursos.length;
    const bytesMarca = resumirRecursos(recursos).bytes;
    const tDrawer = Date.now();
    // Un renglón REPRESENTATIVO, no el primero: la primera oportunidad de la
    // lista suele ser una de prueba sin líneas, y abrir algo vacío no mide
    // nada. `--folio` fija cuál para que antes/después comparen lo mismo.
    const fila = FOLIO
      ? page.locator('.row-hover').filter({ hasText: FOLIO }).first()
      : page.locator('.row-hover').first();
    if (await fila.count()) {
      await fila.click();
      // "Listo" = el drawer ya trae contenido Y terminó de reconciliar con
      // Monday (el indicador de sincronización desapareció). Antes de eso el
      // usuario ve datos que todavía pueden brincar.
      let tContenido = null, tReconciliado = null;
      try {
        await page.waitForFunction(() => {
          const t = document.body.innerText;
          return /Cotizaci[óo]n|Actualizaciones|Documentaci[óo]n/.test(t);
        }, { timeout: 60_000 });
        tContenido = Date.now() - tDrawer;
      } catch {}
      // Señal POSITIVA, no ausencia: mientras corre la relectura contra Monday
      // el drawer pinta "⟳ verificando con Monday…" y solo cambia a
      // "sincronizado hace …" (SyncIndicator) cuando ya terminó. Esperar la
      // ausencia del "verificando" daba ~0 ms, porque justo tras el click el
      // drawer todavía no montaba y el texto tampoco estaba.
      try {
        await page.waitForFunction(
          () => /sincronizado hace|sin datos de sincronizaci/i.test(document.body.innerText),
          { timeout: 60_000 },
        );
        tReconciliado = Date.now() - tDrawer;
      } catch {}
      // Deja que se asienten los fetches que dispara el drawer
      // (versiones, checkCosteo, checkValidacion).
      await page.waitForTimeout(3000);
      const post = resumirRecursos(recursos);
      const m = await leerMetricas(page);
      drawer = {
        tiempoContenido: tContenido,
        tiempoReconciliado: tReconciliado,
        requests: recursos.length - marcaRed,
        bytes: post.bytes - bytesMarca,
        bloqueoHilo: m.bloqueoTotal - metricas.bloqueoTotal,
        nodosDOM: m.nodosDOM,
      };
    }
  }

  // Quieto con el DRAWER abierto — la lista se desmonta y deja de pollear,
  // así que aquí solo deberían quedar los checks del drawer.
  const idle = drawer ? await medirQuieto(IDLE_MS) : idleLista;

  const metricasFinales = await leerMetricas(page);

  // ---- Segunda visita, con la caché del navegador ya tibia ----
  // Es el caso REAL del día a día: la gente abre el portal muchas veces al
  // día, no una. Es lo único que mide si las cabeceras de caché sirven — en
  // la carga fría no cambian nada.
  const marcaTibia = recursos.length;
  const tTibia = Date.now();
  await page.goto(BASE + ruta.path, { waitUntil: 'load', timeout: 120_000 });
  let tibiaDatos = null;
  if (ruta.espera === 'lista') {
    try {
      await page.waitForFunction(
        () => /\d+\s+activas/.test(document.body.innerText) && !/Cargando/.test(document.body.innerText),
        { timeout: 90_000 },
      );
      tibiaDatos = Date.now() - tTibia;
    } catch {}
  }
  const recTibia = recursos.slice(marcaTibia);
  const tibia = {
    tiempoHastaDatos: tibiaDatos,
    requests: recTibia.length,
    bytes: recTibia.reduce((s, r) => s + (r.bytes || 0), 0),
    deCache: recTibia.filter((r) => r.fromCache).length,
  };

  await cdp.detach().catch(() => {});
  await context.close();

  return {
    ruta: ruta.nombre,
    tiempoHastaDatos: tListaMs,
    ...metricas,
    bloqueoTrasIdle: metricasFinales.bloqueoTotal,
    heapTrasIdleMB: metricasFinales.heapMB,
    nodosDOM: metricasFinales.nodosDOM,
    red: cargaInicial,
    drawer,
    idleLista,
    idle,
    tibia,
  };
}

async function correr(label, perfil) {
  const browser = await chromium.launch();
  const corrida = { label, perfil, cpuThrottle: CPU_THROTTLE, fecha: new Date().toISOString(), rutas: [] };
  for (const ruta of RUTAS) {
    process.stdout.write(`  midiendo ${ruta.nombre} (${perfil}, CPU ${CPU_THROTTLE}x)…\n`);
    corrida.rutas.push(await medirRuta(browser, ruta, perfil, { warm: false }));
  }
  await browser.close();

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${label}.json`), JSON.stringify(corrida, null, 2));
  imprimir(corrida);
  return corrida;
}

function imprimir(c) {
  console.log(`\n═══ ${c.label} — red ${c.perfil}, CPU ${c.cpuThrottle}x ═══`);
  for (const r of c.rutas) {
    console.log(`\n▸ /${r.ruta}`);
    console.log(`   FCP                    ${fmtMs(r.fcp)}`);
    console.log(`   LCP                    ${fmtMs(r.lcp)}`);
    console.log(`   Datos en pantalla      ${fmtMs(r.tiempoHastaDatos)}`);
    console.log(`   Hilo principal trabado ${fmtMs(r.bloqueoTotal)}  (peor tarea ${fmtMs(r.peorLongTask)})`);
    console.log(`   Bytes carga inicial    ${fmtKB(r.red.bytes)} en ${r.red.requests} requests`);
    console.log(`     └ API                ${fmtKB(r.red.bytesApi)} en ${r.red.requestsApi} requests`);
    console.log(`   Nodos DOM              ${r.nodosDOM}`);
    console.log(`   Heap JS                ${r.heapTrasIdleMB ?? '—'} MB`);
    const il = r.idleLista;
    console.log(`   Quieto en lista ${il.segundos}s   ${fmtKB(il.bytes)} en ${il.requests} req → ${fmtKB(il.bytesPorMinuto)}/min`);
    if (r.drawer) {
      console.log(`   ── Abrir oportunidad ──`);
      console.log(`   Contenido visible      ${fmtMs(r.drawer.tiempoContenido)}`);
      console.log(`   Ya reconciliado        ${fmtMs(r.drawer.tiempoReconciliado)}`);
      console.log(`   Costo                  ${fmtKB(r.drawer.bytes)} en ${r.drawer.requests} requests`);
      console.log(`   Hilo trabado al abrir  ${fmtMs(r.drawer.bloqueoHilo)}`);
      console.log(`   Quieto en drawer ${r.idle.segundos}s  ${fmtKB(r.idle.bytes)} en ${r.idle.requests} req → ${fmtKB(r.idle.bytesPorMinuto)}/min`);
      for (const [u, b] of r.idle.urls ?? []) console.log(`       ${fmtKB(b).padStart(10)}  ${u}`);
    }
    if (r.tibia) {
      console.log(`   ── 2a visita (caché tibia) ──`);
      console.log(`   Datos en pantalla      ${fmtMs(r.tibia.tiempoHastaDatos)}`);
      console.log(`   Bytes                  ${fmtKB(r.tibia.bytes)} en ${r.tibia.requests} requests (${r.tibia.deCache} de caché)`);
    }
    if (r.red.masPesado.length) {
      console.log(`   Más pesados:`);
      for (const m of r.red.masPesado) console.log(`     ${fmtKB(m.bytes).padStart(10)}  ${m.url.slice(0, 70)}`);
    }
  }
}

function comparar(a, b) {
  const ra = JSON.parse(readFileSync(join(OUT_DIR, `${a}.json`), 'utf8'));
  const rb = JSON.parse(readFileSync(join(OUT_DIR, `${b}.json`), 'utf8'));
  console.log(`\n═══ ${a} → ${b} ═══\n`);
  for (const ruta of ra.rutas) {
    const otra = rb.rutas.find((x) => x.ruta === ruta.ruta);
    if (!otra) continue;
    console.log(`▸ /${ruta.ruta}`);
    const fila = (etiqueta, x, y, fmt = fmtMs) => {
      if (x == null || y == null) return;
      const delta = y - x;
      const pct = x === 0 ? 0 : (delta / x) * 100;
      const signo = delta <= 0 ? '✓' : '✗';
      console.log(`   ${etiqueta.padEnd(24)} ${fmt(x).padStart(11)} → ${fmt(y).padStart(11)}  ${signo} ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`);
    };
    fila('FCP', ruta.fcp, otra.fcp);
    fila('LCP', ruta.lcp, otra.lcp);
    fila('Datos en pantalla', ruta.tiempoHastaDatos, otra.tiempoHastaDatos);
    fila('Hilo trabado', ruta.bloqueoTotal, otra.bloqueoTotal);
    fila('Bytes carga', ruta.red.bytes, otra.red.bytes, fmtKB);
    fila('Bytes API', ruta.red.bytesApi, otra.red.bytesApi, fmtKB);
    fila('Bytes/min en lista', ruta.idleLista?.bytesPorMinuto, otra.idleLista?.bytesPorMinuto, fmtKB);
    fila('Bytes/min en drawer', ruta.idle.bytesPorMinuto, otra.idle.bytesPorMinuto, fmtKB);
    fila('2a visita: datos', ruta.tibia?.tiempoHastaDatos, otra.tibia?.tiempoHastaDatos);
    fila('2a visita: bytes', ruta.tibia?.bytes, otra.tibia?.bytes, fmtKB);
    fila('Nodos DOM', ruta.nodosDOM, otra.nodosDOM, String);
    fila('Heap MB', ruta.heapTrasIdleMB, otra.heapTrasIdleMB, String);
    if (ruta.drawer && otra.drawer) {
      fila('Drawer: contenido', ruta.drawer.tiempoContenido, otra.drawer.tiempoContenido);
      fila('Drawer: reconciliado', ruta.drawer.tiempoReconciliado, otra.drawer.tiempoReconciliado);
      fila('Drawer: bytes', ruta.drawer.bytes, otra.drawer.bytes, fmtKB);
    }
    console.log('');
  }
}

const cmp = arg('--compare');
if (cmp) {
  comparar(cmp, process.argv[process.argv.indexOf('--compare') + 2]);
} else {
  const label = arg('--label') ?? 'run';
  const perfil = arg('--perfil') ?? 'lenta';
  if (!NETWORK[perfil]) { console.error(`perfil inválido: ${perfil}`); process.exit(1); }
  if (!existsSync(join(HERE, '..', 'dist', 'index.html'))) {
    console.error('No hay ./dist — corre `npm run build` primero (el banco mide el build de producción).');
    process.exit(1);
  }
  await correr(label, perfil);
}
