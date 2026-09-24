#!/usr/bin/env node
// Precarga de la "Lista de cotizaciones" (worker/lib/cotLista.ts, 2026-09-24):
// lee fecha y totales de TODOS los PDFs de cotización que ya existen y los
// asienta en `cot_pdf_datos` de producción.
//
// Por qué: el navegador lee los PDFs que falten (src/lib/cotPdfMonto.ts), de a
// dos. Con ~1,070 cotizaciones de ~0.5 MB, el primer vendedor en abrir la lista
// se bajaría medio GB. Esto lo hace una vez desde aquí.
//
// Solo ESCRIBE en su propia tabla (INSERT OR IGNORE: nunca pisa lo que ya se
// leyó) y solo LEE de Monday (assets). Usa las MISMAS reglas que el worker
// (shared/cotLista.ts) para decidir qué archivo es el de cada cotización.
//
//   node scripts/cot-lista-backfill.mjs            # solo cuenta y prueba 5 PDFs
//   node scripts/cot-lista-backfill.mjs --aplicar  # lee todo y escribe en prod
//
// Necesita MONDAY_API_KEY en el entorno (.env) y wrangler con sesión OAuth.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cotizacionesDeOportunidad, marcarReemplazadas, unaFilaPorFolio } from '../shared/cotLista.ts';
import { cotFechaValida, cotMontoCuadra, fechaDeTextoCot, montoDeTextoCot } from '../shared/cotMontoPdf.ts';

const APLICAR = process.argv.includes('--aplicar');
const OPORTUNIDADES = 18395657596;
const TOKEN = process.env.MONDAY_API_KEY;
if (!TOKEN) throw new Error('Falta MONDAY_API_KEY (source .env)');

function d1(sql) {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN; // el del .env secuestra a wrangler
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--remote', '--env-file=.dev.vars', '--json', '--command', sql],
    { env, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' });
  return JSON.parse(out)[0].results;
}

function d1Archivo(sql) {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  const f = join(mkdtempSync(join(tmpdir(), 'cot-')), 'backfill.sql');
  writeFileSync(f, sql);
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--remote', '--env-file=.dev.vars', '--yes', '--file', f], { env, stdio: 'inherit' });
}

async function publicUrls(ids) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-10' },
    body: JSON.stringify({ query: `{assets(ids:[${ids.join(',')}]){id public_url}}` }),
  });
  const j = await res.json();
  if (!j.data) throw new Error(`Monday: ${JSON.stringify(j.errors ?? j)}`);
  return new Map(j.data.assets.map(a => [String(a.id), a.public_url]));
}

async function leer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF ${res.status}`);
  const tarea = getDocument({ data: new Uint8Array(await res.arrayBuffer()), verbosity: 0 });
  try {
    const doc = await tarea.promise;
    let texto = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      texto += c.items.map(it => it.str ?? '').filter(s => s.trim()).join(' | ') + '\n';
    }
    return { fecha: fechaDeTextoCot(texto), monto: montoDeTextoCot(texto) };
  } finally {
    await tarea.destroy();
  }
}

const q = s => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const n = v => (v == null ? 'NULL' : String(v));

const CREATE = `CREATE TABLE IF NOT EXISTS cot_pdf_datos (
  llave TEXT PRIMARY KEY, clave TEXT NOT NULL, fecha TEXT, subtotal REAL, iva REAL, total REAL,
  moneda TEXT, por_email TEXT, updated_at TEXT NOT NULL);`;

// 1. Las cotizaciones como las ve un admin (sin recorte por vendedor).
const opps = d1(`SELECT * FROM items WHERE board_id = ${OPORTUNIDADES} AND parent_item_id IS NULL`);
const cots = marcarReemplazadas(unaFilaPorFolio(opps.flatMap(cotizacionesDeOportunidad)));
let yaLeidas = new Set();
try { yaLeidas = new Set(d1('SELECT llave FROM cot_pdf_datos').map(r => r.llave)); } catch { /* la tabla aún no existe */ }
const pendientes = cots.filter(c => c.llave && /^\d+$/.test(c.llave) && !yaLeidas.has(c.llave));
console.log(`${opps.length} oportunidades · ${cots.length} cotizaciones · ${yaLeidas.size} ya leídas · ${pendientes.length} por leer`);

const lote = APLICAR ? pendientes : pendientes.slice(0, 5);
const filas = [];
let sinMonto = 0, fallos = 0;
for (let i = 0; i < lote.length; i += 25) {
  const grupo = lote.slice(i, i + 25);
  const urls = await publicUrls(grupo.map(c => c.llave));
  await Promise.all(grupo.map(async c => {
    const url = urls.get(c.llave);
    if (!url) { fallos++; return; }
    try {
      const { fecha, monto } = await leer(url);
      const m = monto && cotMontoCuadra(monto.subtotal, monto.iva, monto.total) ? monto : null;
      if (!m) sinMonto++;
      filas.push({ llave: c.llave, clave: c.clave, fecha: fecha && cotFechaValida(fecha) ? fecha : null, ...(m ?? {}), moneda: m?.moneda ?? null });
      if (!APLICAR) console.log(c.clave, c.oportunidad.slice(0, 40), fecha, m ? `${m.subtotal} ${m.moneda}` : 'SIN MONTO');
    } catch (e) {
      fallos++;
      console.warn(`✗ ${c.clave} (${c.llave}): ${e.message}`);
    }
  }));
  process.stdout.write(`\r${Math.min(i + 25, lote.length)}/${lote.length} leídas`);
}
console.log(`\n${filas.length} leídas · ${sinMonto} sin bloque de totales · ${fallos} fallaron (el navegador las reintenta)`);

if (!APLICAR) {
  console.log('Prueba nada más. Para escribir en producción: --aplicar');
  process.exit(0);
}
const ahora = new Date().toISOString();
for (let i = 0; i < filas.length; i += 200) {
  const valores = filas.slice(i, i + 200).map(f =>
    `(${q(f.llave)}, ${q(f.clave)}, ${q(f.fecha)}, ${n(f.subtotal)}, ${n(f.iva)}, ${n(f.total)}, ${q(f.moneda)}, 'backfill', ${q(ahora)})`);
  d1Archivo(`${i === 0 ? CREATE + '\n' : ''}INSERT OR IGNORE INTO cot_pdf_datos (llave, clave, fecha, subtotal, iva, total, moneda, por_email, updated_at) VALUES\n${valores.join(',\n')};`);
}
console.log(`Listo: ${filas.length} filas en cot_pdf_datos.`);
