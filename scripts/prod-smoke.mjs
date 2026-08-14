// scripts/prod-smoke.mjs — verifica contra PRODUCCIÓN que los cambios de
// performance están vivos y que nada se rompió. Requiere haber corrido antes
// `node scripts/prod-login.mjs` (deja la sesión en scripts/.prod-profile).
//
//   node scripts/prod-smoke.mjs
//
// NO es un banco de performance: los tiempos aquí dependen de la red de esta
// máquina, no de la de la gente en campo. Para el "¿mejoró?" está
// scripts/perf-bench.mjs, que compara el mismo build en condiciones fijas. Esto
// responde otra pregunta: "¿lo que se desplegó hace lo que debía?".

import { abrirContexto, sesionValida, PROD } from './prod-login.mjs';

const kb = (b) => (b / 1024).toFixed(1) + ' KB';
const resultados = [];
const check = (ok, nombre, detalle) => {
  resultados.push({ ok, nombre, detalle });
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${detalle ? ' — ' + detalle : ''}`);
};

const ctx = await abrirContexto({ headless: true });
const page = ctx.pages()[0] ?? (await ctx.newPage());

const me = await sesionValida(page);
if (!me) {
  console.log('✗ Sin sesión válida. Corre primero: node scripts/prod-login.mjs');
  await ctx.close();
  process.exit(1);
}
console.log(`Sesión: ${me.email} (${me.role})\n`);

// Contabilidad de bytes por endpoint.
const bytes = {};
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
const urls = new Map();
cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
cdp.on('Network.loadingFinished', (e) => {
  const u = urls.get(e.requestId);
  if (!u) return;
  const k = u.replace(PROD, '').split('?')[0];
  bytes[k] = (bytes[k] || 0) + e.encodedDataLength;
});
const bytesDe = (frag) => Object.entries(bytes).filter(([k]) => k.includes(frag)).reduce((s, [, v]) => s + v, 0);

console.log('▸ Cabeceras de caché y fuentes propias');
{
  const r = await page.request.get(`${PROD}/fonts/inter.woff2`);
  check(r.ok(), 'la fuente propia se sirve', `http=${r.status()}`);
  check(/max-age=31536000/.test(r.headers()['cache-control'] || ''), 'fuente cacheada a un año',
    r.headers()['cache-control']);
}

console.log('\n▸ Lista de Oportunidades');
await page.goto(`${PROD}/oportunidades`, { waitUntil: 'load' });
await page.waitForFunction(() => /[1-9]\d* activas/.test(document.body.innerText), { timeout: 90_000 });
{
  const renglones = await page.locator('.row-hover').count();
  check(renglones > 0, 'la lista pinta renglones', `${renglones}`);
  const pidioProyeccion = Object.keys(bytes).some((k) => k.includes('/boards/oportunidades/items'));
  check(pidioProyeccion, 'la lista pidió /items');
  const asset = Object.entries(bytes).find(([k]) => k.startsWith('/assets/index-'));
  if (asset) {
    const r = await page.request.get(PROD + asset[0]);
    check(/immutable/.test(r.headers()['cache-control'] || ''), 'assets con hash son immutable',
      r.headers()['cache-control']);
  }
  check(bytesDe('/boards/oportunidades/items') < 120 * 1024, 'la lista viaja proyectada (<120 KB)',
    kb(bytesDe('/boards/oportunidades/items')));
}

console.log('\n▸ Abrir una oportunidad (que NO baje los PDFs)');
{
  const antes = bytesDe('cotizacion-pdf');
  const fila = page.locator('.row-hover').filter({ hasText: 'OPP-' }).first();
  await fila.click();
  await page.waitForFunction(() => /sincronizado hace|sin datos de/i.test(document.body.innerText), { timeout: 90_000 });
  await page.waitForTimeout(6000);
  const pdfs = bytesDe('cotizacion-pdf') - antes;
  check(pdfs === 0, 'no se precargan PDFs al abrir', pdfs ? kb(pdfs) + ' bajados' : '0 bytes');
  const texto = await page.evaluate(() => document.body.innerText);
  check(/sincronizado hace/.test(texto), 'el indicador de sincronización se pinta bien',
    (texto.match(/sincronizado hace [^\n·]*/) || [''])[0].trim());
}

console.log('\n▸ Selector de catálogo (Inventario → productos)');
{
  await page.goto(`${PROD}/inventario`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const antes = bytesDe('/boards/productos/items');
  const nuevo = page.getByText(/Nuevo movimiento/i).first();
  if (await nuevo.count()) {
    await nuevo.click();
    await page.waitForTimeout(6000);
    const prod = bytesDe('/boards/productos/items') - antes;
    check(prod > 0 && prod < 120 * 1024, 'el picker de productos viaja proyectado', kb(prod));
    check(await page.locator('.row-hover').count() > 0, 'el picker muestra opciones',
      `${await page.locator('.row-hover').count()}`);
  } else {
    check(false, 'no encontré "Nuevo movimiento" (¿rol sin acceso?)');
  }
}

await page.screenshot({ path: '/tmp/prod-smoke.png', fullPage: false });
await ctx.close();

const fallaron = resultados.filter((r) => !r.ok);
console.log(`\n${fallaron.length ? '✗' : '✓'} ${resultados.length - fallaron.length}/${resultados.length} checks OK`);
if (fallaron.length) {
  for (const f of fallaron) console.log(`   ✗ ${f.nombre}`);
  process.exit(1);
}
