// scripts/qa/catalogo.mjs — auditoría de PROCEDENCIA de los precios del catálogo.
//
// Airtable es la fuente: ahí Compras captura Costo Distribuidor, Descuento
// Distribuidor, Gastos de envío e importación y Moneda, y un sync externo
// (cmp-tallas `sync_producto.py`, Fase 6 — no vive en este repo) los copia al
// board Productos de Monday. De ahí los hereda cada línea de cotización por
// columna espejo, y de los espejos sale el SNAPSHOT que congela el costeo
// (worker/lib/costeoSnapshot.ts). O sea: un número mal importado aquí no se ve
// hasta que sale en una cotización o en una OC con el precio equivocado.
//
// Nadie estaba comparando las dos puntas. Esto lo hace, es de SOLO LECTURA y
// corre contra los 1300+ productos reales, no contra una muestra.
//
// Dos clases de hallazgo, a propósito separadas:
//   · DERIVA  — Airtable dice A y Monday dice B. El sync no corrió o falló.
//   · TRAMPA  — el dato es incoherente en sí mismo aunque las dos puntas
//               coincidan. La grande: Descuento/Gastos son FRACCIONES (0.18 =
//               18%). Un 18 capturado como 18 pasa el sync tal cual y hace que
//               el snapshot calcule con 1800% — silenciosamente.
import { verdad, mayorQue, leerEnv, Falla } from './lib.mjs';

const AIRTABLE_BASE = 'apprQnMOKPEBYt4AU';
const AIRTABLE_TABLA = 'tblxZZLHRUAeJbGa2';

// Monday (board Productos) ← Airtable. Ids verificados contra
// shared/column-meta.gen.ts y worker/lib/nativeMirrors.ts.
const MAPA = [
  { col: 'numeric_mkzpx7eb', campo: 'Costo Distribuidor',              que: 'Costo distribuidor', tipo: 'num' },
  { col: 'numeric_mm0bgd2f', campo: 'Descuento Distribuidor',          que: 'Descuento',          tipo: 'num' },
  { col: 'numeric_mm0bnkch', campo: 'Gastos de envío e importación',   que: 'Gastos %',           tipo: 'num' },
  { col: 'text_mkzp59zf',    campo: 'Moneda',                          que: 'Moneda',             tipo: 'txt' },
  { col: 'product_and_service_sku', campo: 'SKU (Producto)',           que: 'SKU',                tipo: 'txt' },
];
const COL_AIRTABLE_ID = 'text_mkzmgvc7';
const COLS = [...MAPA.map(m => m.col), COL_AIRTABLE_ID].join(',');

const nu = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const st = (v) => String(v ?? '').trim();

async function traerAirtable(apiKey) {
  const recs = new Map();
  let offset = '';
  for (let i = 0; i < 60; i++) {   // tope duro: 6000 registros
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLA}?pageSize=100${offset ? '&offset=' + offset : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Falla(`Airtable HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    for (const r of j.records ?? []) recs.set(r.id, r.fields ?? {});
    offset = j.offset ?? '';
    if (!offset) break;
  }
  return recs;
}

export async function suiteCatalogo(R, q) {
  R.seccion('Catálogo: ¿los precios de Airtable llegaron bien a Monday?');

  const env = leerEnv();
  if (!env.AIRTABLE_API_KEY) {
    R.omitido('auditoría Airtable ↔ Monday', 'no hay AIRTABLE_API_KEY en .env');
    return;
  }

  let productos = [];
  await R.check('el portal entrega el catálogo completo con costos', async () => {
    const r = await q.api('GET', `/boards/productos/items?cols=${COLS}`);
    verdad(r.status === 200, `HTTP ${r.status}`);
    productos = r.json?.items ?? [];
    mayorQue(productos.length, 500, 'productos en el catálogo');
    verdad(productos.some(p => p.cols?.[COL_AIRTABLE_ID]?.text),
      'ningún producto trae id de Airtable — el rol no ve la columna o el sync nunca corrió');
    return `${productos.length} productos`;
  });
  if (!productos.length) return;

  let air = new Map();
  await R.check('Airtable responde el catálogo completo', async () => {
    air = await traerAirtable(env.AIRTABLE_API_KEY);
    mayorQue(air.size, 500, 'registros en Airtable');
    return `${air.size} registros`;
  });
  if (!air.size) return;

  // ── Ligas rotas en las dos direcciones ──────────────────────────────────────
  const conId = productos.filter(p => st(p.cols?.[COL_AIRTABLE_ID]?.text));
  const sinId = productos.length - conId.length;

  await R.check('todo id de Airtable guardado en Monday existe en Airtable', () => {
    const fantasmas = conId.filter(p => !air.has(st(p.cols[COL_AIRTABLE_ID].text)));
    if (fantasmas.length) {
      throw new Falla(`${fantasmas.length} productos del portal guardan un id de Airtable que ya no existe ` +
        `(record borrado en Airtable, id viejo en Monday) — la imagen de la cotización sale vacía para ellos: ` +
        fantasmas.slice(0, 5).map(p => `${p.name} (${st(p.cols[COL_AIRTABLE_ID].text)})`).join(' · '));
    }
    return `${conId.length} ligados · ${sinId} sin id de Airtable`;
  });

  await R.check('todo record de Airtable con Monday Item ID existe en el portal', () => {
    const idsPortal = new Set(productos.map(p => String(p.id)));
    const huerfanos = [...air.entries()]
      .filter(([, f]) => st(f['Monday Item ID']) && !idsPortal.has(st(f['Monday Item ID'])));
    if (huerfanos.length > air.size * 0.05) {
      throw new Falla(`${huerfanos.length} de ${air.size} records apuntan a un item que el portal no tiene: ` +
        huerfanos.slice(0, 5).map(([id, f]) => `${st(f.Producto)} → ${st(f['Monday Item ID'])} (${id})`).join(' · '));
    }
    return huerfanos.length ? `${huerfanos.length} huérfanos (bajo el 5% tolerado)` : 'sin huérfanos';
  });

  // ── Deriva campo por campo ──────────────────────────────────────────────────
  const derivas = new Map(MAPA.map(m => [m.col, []]));
  for (const p of conId) {
    const f = air.get(st(p.cols[COL_AIRTABLE_ID].text));
    if (!f) continue;
    for (const m of MAPA) {
      const mon = p.cols?.[m.col]?.text;
      const at = f[m.campo];
      if (m.tipo === 'num') {
        const a = nu(at), b = nu(mon);
        if (a == null && b == null) continue;
        if (a == null || b == null || Math.abs(a - b) > 0.005) {
          derivas.get(m.col).push({ nombre: p.name, id: p.id, airtable: a ?? '(vacío)', monday: b ?? '(vacío)' });
        }
      } else {
        const a = st(at).toUpperCase(), b = st(mon).toUpperCase();
        if (a !== b) derivas.get(m.col).push({ nombre: p.name, id: p.id, airtable: a || '(vacío)', monday: b || '(vacío)' });
      }
    }
  }

  for (const m of MAPA) {
    await R.check(`${m.que}: Monday == Airtable`, () => {
      const d = derivas.get(m.col);
      const pct = ((d.length / conId.length) * 100).toFixed(1);
      if (d.length) {
        throw new Falla(`${d.length}/${conId.length} productos (${pct}%) no coinciden:\n` +
          d.slice(0, 8).map(x => `        · ${x.nombre} [${x.id}] — Airtable ${x.airtable} vs portal ${x.monday}`).join('\n') +
          (d.length > 8 ? `\n        … y ${d.length - 8} más` : ''));
      }
      return `${conId.length} productos cuadran`;
    });
  }

  // ── Trampas de captura (coherencia interna, no comparación) ─────────────────
  R.seccion('Catálogo: trampas de captura que el sync copia tal cual');

  await R.check('Descuento y Gastos están capturados como FRACCIÓN (0.18, no 18)', () => {
    const malos = [];
    for (const p of productos) {
      for (const col of ['numeric_mm0bgd2f', 'numeric_mm0bnkch']) {
        const v = nu(p.cols?.[col]?.text);
        if (v != null && v >= 1) malos.push(`${p.name} [${p.id}] ${col}=${v}`);
      }
    }
    if (malos.length) {
      throw new Falla(`${malos.length} valores ≥ 1 — el snapshot los multiplicaría por 100:\n` +
        malos.slice(0, 8).map(s => '        · ' + s).join('\n'));
    }
    return 'todos < 1';
  });

  await R.check('Moneda es MXN o USD (el snapshot solo distingue esas dos)', () => {
    const raras = productos
      .map(p => ({ n: p.name, m: st(p.cols?.text_mkzp59zf?.text).toUpperCase() }))
      .filter(x => x.m && x.m !== 'MXN' && x.m !== 'USD');
    if (raras.length) {
      throw new Falla(`${raras.length} monedas fuera de {MXN,USD} — se costean con TC=1: ` +
        raras.slice(0, 6).map(x => `${x.n}="${x.m}"`).join(' · '));
    }
    const usd = productos.filter(p => st(p.cols?.text_mkzp59zf?.text).toUpperCase() === 'USD').length;
    return `${usd} en USD (TC=18) · ${productos.length - usd} en MXN`;
  });

  await R.check('un producto sin Moneda no se costea como USD por accidente', () => {
    const sinMoneda = productos.filter(p => !st(p.cols?.text_mkzp59zf?.text) && nu(p.cols?.numeric_mkzpx7eb?.text));
    // No es falla: sin moneda el snapshot usa TC=1 (MXN), que es el default correcto.
    // Se reporta para que Compras lo vea, no para tumbar la corrida.
    return sinMoneda.length ? `${sinMoneda.length} productos con costo y sin Moneda → se costean como MXN` : 'todos con Moneda';
  });

  // Sin tope superior a propósito: el catálogo tiene sistemas y drones de
  // varios millones de pesos y son costos reales — un umbral inventado aquí
  // solo generaría ruido que se aprende a ignorar. Lo que sí es imposible es
  // un costo negativo.
  await R.check('ningún costo del catálogo es negativo', () => {
    const malos = productos
      .map(p => ({ n: p.name, id: p.id, v: nu(p.cols?.numeric_mkzpx7eb?.text) }))
      .filter(x => x.v != null && x.v < 0);
    if (malos.length) throw new Falla(malos.slice(0, 6).map(x => `${x.n} [${x.id}] = ${x.v}`).join(' · '));
    const conCosto = productos.filter(p => (nu(p.cols?.numeric_mkzpx7eb?.text) ?? 0) > 0);
    const caro = conCosto.reduce((a, p) => (nu(p.cols.numeric_mkzpx7eb.text) > (nu(a?.cols?.numeric_mkzpx7eb?.text) ?? 0) ? p : a), null);
    return `${conCosto.length}/${productos.length} con costo · el más alto: ${caro?.name?.slice(0, 30)} = ${nu(caro?.cols?.numeric_mkzpx7eb?.text)}`;
  });

  return { productos, air };
}
