// scripts/e2e-zona-efrain.mjs — prueba end-to-end del flujo NATIVO de Zona
// Efrain (Efraín, 2026-08-18), contra PRODUCCIÓN: copia una oportunidad
// compleja real (6 líneas, 3 proveedores) como oportunidad nativa y la lleva
// Nueva oportunidad → costeo → validación → cotización → ganar → tallas → OC →
// logística, por los MISMOS endpoints que usa la UI.
//
//   node scripts/prod-login.mjs      (una vez, deja la sesión de Access)
//   node scripts/e2e-zona-efrain.mjs
//
// OJO — ESCRIBE EN PRODUCCIÓN: crea filas nativas en D1 (no toca Monday, los
// items nativos no existen allá) y CONSUME folios globales de OC. Al terminar,
// borra lo que creó con scripts/e2e-zona-efrain-limpiar.mjs; el contador
// `oc_folios` no se puede regresar desde aquí (pide un token con D1:Edit).
//
// Los productos van fijos a propósito: son de catálogo REAL y tienen que tener
// "Descripción y tallas confirmadas" y colores válidos, o el flujo se detiene
// en la validación (que es justo lo que debe hacer).
import { abrirContexto, sesionValida, PROD } from '/Users/efrain/Documents/dev/cmp-portal/scripts/prod-login.mjs';

const CEO = '98635534';        // Efrain Ponce (dueño → cae en la zona privada)
const YO  = '98389537';        // Efraín (Compras, para que las notificaciones no vayan a PAM)

// 6 líneas del OPP-0870 real: 3 de UNIMX + 3 de SWA (multi-proveedor para la OC).
const LINEAS = [
  { pid: '11013699728', producto: 'Taclite Pro Long Sleeve Shirt', color: 'WHITE', cant: 45, costo: 1170, precio: 2490, prov: '5.11', tallas: { M: 20, G: 15, XG: 10 } },
  { pid: '11657093250', producto: 'Bata de Laboratorio',   color: 'BLANCO',      cant: 20, costo: 290, precio: 890,  prov: 'UNIMX', tallas: { M: 10, G: 10 } },
  { pid: '11655657340', producto: 'Overol Industrial',     color: 'AZUL MARINO', cant: 11, costo: 560, precio: 1490, prov: 'UNIMX', tallas: { G: 6, XG: 5 } },
  { pid: '11584091853', producto: 'Chaleco Capitonado',    color: 'AZUL MARINO', cant: 35, costo: 450, precio: 1290, prov: 'SWA',   tallas: { M: 15, G: 12, XG: 8 } },
  { pid: '11013498708', producto: 'Playera Polo Piqué',    color: 'BLANCO',      cant: 15, costo: 209, precio: 690,  prov: 'SWA',   tallas: { M: 8, G: 7 } },
  { pid: '11013687367', producto: 'ATAC 2.0 8 Side Zip',   color: 'BLACK',       cant: 6,  costo: 2170, precio: 4290, prov: '5.11',  tallas: { G: 3, XG: 3 } },
];

const pasos = [];
const paso = (nombre, ok, detalle) => {
  pasos.push({ nombre, ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ' — ' + detalle : ''}`);
};

const ctx = await abrirContexto({ headless: true });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const me = await sesionValida(page);
if (!me) { console.log('✗ sin sesión válida — corre node scripts/prod-login.mjs'); await ctx.close(); process.exit(1); }
console.log(`Sesión: ${me.email} (${me.role}) · zonaEfrainAccess=${me.zonaEfrainAccess}\n`);

await page.goto(PROD, { waitUntil: 'domcontentloaded' });

// Todas las llamadas salen del contexto de la página (cookie de Access incluida).
const api = (method, path, body) => page.evaluate(async ([method, path, body]) => {
  const opt = { method, headers: {} };
  if (body !== null) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, opt);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no era json */ }
  return { status: res.status, json, text: text.slice(0, 400) };
}, [method, path, body ?? null]);

const subirArchivo = (path, nombre, contenido) => page.evaluate(async ([path, nombre, contenido]) => {
  const fd = new FormData();
  fd.append('file', new File([contenido], nombre, { type: 'application/pdf' }));
  const res = await fetch('/api' + path, { method: 'POST', body: fd });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no era json */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}, [path, nombre, contenido]);

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const NOMBRE = `PRUEBA E2E ZONA EFRAIN ${stamp} — borrar`;

// ── 1. Crear la oportunidad nativa ────────────────────────────────────────────
let r = await api('POST', '/boards/oportunidades/items', {
  name: NOMBRE, native: true,
  cols: {
    deal_owner: CEO,
    multiple_person_mm03qyw9: YO,
    deal_contact: '12017028945',   // Elías Guerrero → Constructora Janing (para la Institución)
    dropdown_mm03g067: 'Bajio',
    color_mm47f0ca: 'Estudio de mercado',
    color_mm0ex0ed: 'No, productos en catálogo',
  },
});
if (!r.json?.id) { paso('crear oportunidad nativa', false, r.text); await ctx.close(); process.exit(1); }
const OPP = r.json.id;
paso('crear oportunidad nativa', true, `id ${OPP}`);

// ── 2. Copiar las 6 líneas ────────────────────────────────────────────────────
const ids = [];
for (const l of LINEAS) {
  const c = await api('POST', `/oportunidades/${OPP}/productos`, { cantidad: l.cant });
  if (!c.json?.id) { paso(`línea ${l.producto}`, false, c.text); continue; }
  const p = await api('PATCH', `/boards/oportunidades_sub/items/${c.json.id}`, {
    cols: {
      board_relation_mkzmafgp: l.pid,
      text_mm07s2mg: l.color,
      numeric_mkzm6399: String(l.cant),
    },
  });
  ids.push({ ...l, id: c.json.id });
  paso(`línea ${l.producto} (${l.color}) x${l.cant}`, p.status === 200, p.status === 200 ? `id ${c.json.id}` : p.text);
}

// ── 3. Mandar a costeo ────────────────────────────────────────────────────────
r = await api('GET', `/oportunidades/${OPP}/costeo-check`);
paso('costeo-check', r.json?.ok === true, r.json?.ok ? 'sin errores' : JSON.stringify(r.json?.errors ?? r.text).slice(0, 500));
r = await api('POST', `/oportunidades/${OPP}/enviar-costeo`);
const costeoOk = r.json?.ok === true;
paso('POST enviar-costeo', costeoOk, JSON.stringify(r.json ?? r.text).slice(0, 400));

// ── 4. Costear las líneas (Etapa Costeo = Listo) ──────────────────────────────
for (const l of ids) {
  const p = await api('PATCH', `/boards/oportunidades_sub/items/${l.id}`, {
    cols: { numeric_mm0bph99: String(l.costo), numeric_mkzneg3d: String(l.precio), color_mm084gvf: 'Listo' },
  });
  if (p.status !== 200) paso(`costear ${l.producto}`, false, p.text);
}
paso('Compras costea las 6 líneas (costo + precio + Listo)', true, '');

// ── 5. Validación → cotización → ganar ────────────────────────────────────────
r = await api('POST', `/oportunidades/${OPP}/enviar-validacion`);
paso('POST enviar-validacion (15→7)', r.json?.ok === true, JSON.stringify(r.json ?? r.text).slice(0, 300));

r = await api('GET', `/oportunidades/${OPP}/validacion-check`);
paso('validacion-check', r.json?.ok === true, JSON.stringify(r.json?.errors ?? 'sin errores').slice(0, 300));

r = await api('POST', `/oportunidades/${OPP}/cotizacion`);
paso('POST cotizacion (nativa, PDF a R2)', r.json?.ok === true, JSON.stringify(r.json ?? r.text).slice(0, 400));

r = await api('POST', `/oportunidades/${OPP}/ganar`);
const PROY = r.json?.proyectoId;
paso('POST ganar → Proyecto nativo', !!PROY, PROY ? `proyecto ${PROY}` : JSON.stringify(r.json ?? r.text).slice(0, 300));
if (!PROY) { console.log('\nSin Proyecto no hay post-venta que probar.'); await resumen(); process.exit(0); }

// ── 6. Tallas ─────────────────────────────────────────────────────────────────
const rows = [];
for (const l of ids) {
  for (const [talla, cantidad] of Object.entries(l.tallas)) {
    rows.push({ subitemId: Number(l.id), producto: l.producto, color: l.color, talla, cantidad });
  }
}
r = await api('POST', `/proyectos/${PROY}/tallas-capturar`, { rows });
paso(`capturar ${rows.length} tallas`, r.json?.ok === true, JSON.stringify(r.json ?? r.text).slice(0, 300));

// OC del cliente: checkOcCliente la exige antes de confirmar tallas
r = await subirArchivo(`/proyectos/${PROY}/documento`, 'OC-cliente-prueba.pdf', '%PDF-1.4 prueba e2e');
paso('subir OC del cliente (R2)', r.json?.ok === true, JSON.stringify(r.json ?? r.text).slice(0, 200));

r = await api('POST', `/proyectos/${PROY}/tallas-confirmar`, {});
paso('POST tallas-confirmar (PDF relación de tallas)', r.json?.ok === true, JSON.stringify(r.json ?? r.text).slice(0, 400));

// ── 7. OC a proveedor ─────────────────────────────────────────────────────────
r = await api('POST', `/proyectos/${PROY}/generar-oc`, { metodoPago: 'Transferencia', condPago: '30 días' });
paso('POST generar-oc (multi-proveedor)', r.json?.ok === true, JSON.stringify(r.json ?? r.text).slice(0, 600));

// ── 8. Logística ──────────────────────────────────────────────────────────────
r = await api('GET', `/boards/proyectos_sub/items?parent=${PROY}`);
const subs = r.json?.items ?? [];
paso('leer líneas del Proyecto', subs.length > 0, `${subs.length} líneas`);
if (subs.length > 0) {
  const s = subs[0].id;
  const p = await api('PATCH', `/boards/proyectos_sub/items/${s}`, {
    cols: { text_mm4ph3a9: 'REC-E2E-1', text_mm4pywyx: 'GUIA-CLIENTE-E2E', text_mm6aapc8: 'Prueba E2E de Zona Efrain' },
  });
  paso('capturar # recolección / guía cliente / comentarios', p.status === 200, p.status === 200 ? '' : p.text);
  const g = await subirArchivo(`/proyectos_sub/${s}/logistica/guia-empresa`, 'guia-e2e.pdf', '%PDF-1.4 guia e2e');
  paso('subir # Guía - empresa (R2)', g.json?.ok === true, JSON.stringify(g.json ?? g.text).slice(0, 200));
  if (g.json?.url) {
    const d = await page.evaluate(async (u) => { const res = await fetch(u); return { status: res.status, len: (await res.text()).length }; }, g.json.url);
    paso('descargar la guía de vuelta', d.status === 200 && d.len > 0, `${d.status}, ${d.len} bytes`);
  }
}

// ── 9. La UI ──────────────────────────────────────────────────────────────────
const OUT = '/private/tmp/claude-501/-Users-efrain-Documents-dev-cmp-portal/f80d1b0f-caff-4d2b-87e8-4d8ba1a78785/scratchpad';
await page.goto(`${PROD}/zona_efrain_proy`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/e2e-prod-lista.png` });
const t1 = await page.locator('body').innerText();
paso('el Proyecto aparece en el tab Zona Efrain (Proyectos)', t1.includes('PRUEBA E2E'), (t1.match(/(\d+) proyectos/) || [''])[0]);
await page.goto(`${PROD}/zona_efrain_proy/${PROY}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/e2e-prod-drawer.png`, fullPage: true });

console.log(`\nIDS: opp=${OPP} proyecto=${PROY} lineas=${ids.map(i => i.id).join(',')}`);
async function resumen() {
  const malos = pasos.filter(p => !p.ok);
  console.log(`\n${pasos.length - malos.length}/${pasos.length} pasos OK`);
  if (malos.length) console.log('Fallaron:\n' + malos.map(p => ' - ' + p.nombre + ': ' + (p.detalle ?? '')).join('\n'));
  await ctx.close();
}
await resumen();
