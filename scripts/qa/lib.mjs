// scripts/qa/lib.mjs — cimientos del QA agresivo contra PRODUCCIÓN.
//
// La diferencia con un smoke test: aquí NINGÚN paso se da por bueno porque el
// servidor haya contestado 200. Cada escritura se vuelve a LEER y se compara
// contra el valor esperado, y cada número se compara contra la fórmula, no
// contra sí mismo. Un endpoint que contesta `{ok:true}` y no guarda nada es
// exactamente el bug que este archivo existe para atrapar.
//
// Reglas que impone el harness (ver docs/qa-prod.md):
//   1. `check()` solo pasa si su función NO lanza. Devolver un texto es el
//      detalle que se imprime; no hay "warning" que sume como éxito.
//   2. Un paso que no se pudo correr cuenta como FALLA, no como "saltado".
//      `omitido()` existe solo para lo que se decidió deliberadamente no cubrir,
//      y sale listado aparte en el reporte final.
//   3. Toda lista que venga del servidor pasa por `hijosDe()` antes de que
//      alguien actúe sobre ella: un filtro que el server no conoce degrada a
//      "sin filtro" y el script terminaría escribiendo sobre datos reales
//      ajenos (2026-08-18: 70 líneas borradas por exactamente eso).
//   4. Los PDFs se descargan y se PARSEAN. "Pesa 40 KB" no prueba nada.
import { abrirContexto, sesionValida, PROD } from '../prod-login.mjs';
import { readFileSync } from 'node:fs';

export { PROD };

/** Falla de aserción — cualquier throw sirve, esta solo se ve más clara. */
export class Falla extends Error {}

// ── Aserciones (lanzan; no devuelven booleanos) ───────────────────────────────

export function verdad(cond, msg) {
  if (!cond) throw new Falla(msg);
  return true;
}

export function eq(actual, esperado, que) {
  const a = String(actual ?? '').trim();
  const e = String(esperado ?? '').trim();
  if (a !== e) throw new Falla(`${que}: esperaba "${e}", llegó "${a}"`);
  return a;
}

/** Igualdad numérica con tolerancia — los redondeos de Monday/D1 no son bit a bit. */
export function casi(actual, esperado, que, tol = 0.02) {
  const a = Number(actual), e = Number(esperado);
  if (!Number.isFinite(a)) throw new Falla(`${que}: "${actual}" no es número`);
  if (Math.abs(a - e) > tol) throw new Falla(`${que}: esperaba ${e}, llegó ${a} (dif ${(a - e).toFixed(4)})`);
  return a;
}

export function mayorQue(actual, min, que) {
  const a = Number(actual);
  if (!Number.isFinite(a) || a <= min) throw new Falla(`${que}: esperaba > ${min}, llegó ${actual}`);
  return a;
}

export function contiene(texto, sub, que) {
  if (!String(texto).includes(sub)) throw new Falla(`${que}: no encontré "${sub}"`);
  return true;
}

export function noContiene(texto, sub, que) {
  if (String(texto).includes(sub)) throw new Falla(`${que}: NO debía aparecer "${sub}" y sí aparece`);
  return true;
}

/** El servidor debe RECHAZAR con este status. Un 200 aquí es la falla. */
export function rechaza(res, status, que) {
  if (res.status !== status) {
    throw new Falla(`${que}: esperaba ${status}, llegó ${res.status} — ${JSON.stringify(res.json ?? res.text).slice(0, 200)}`);
  }
  return true;
}

export function ok(res, que) {
  if (res.status !== 200) throw new Falla(`${que}: HTTP ${res.status} — ${JSON.stringify(res.json ?? res.text).slice(0, 300)}`);
  return res.json;
}

/**
 * Regla 3 — filtrar SIEMPRE del lado nuestro y dejar constancia de cuántos
 * elementos traía la lista completa. Si la lista viene entera (el server ignoró
 * el filtro) esto lo hace visible en vez de dejar que el script actúe sobre
 * el board completo.
 */
export function hijosDe(items, parentId, que) {
  const todos = items ?? [];
  const mios = todos.filter(i => String(i.parentId) === String(parentId));
  if (mios.length === 0) throw new Falla(`${que}: 0 de ${todos.length} elementos son del padre ${parentId}`);
  if (todos.length > mios.length * 20 && todos.length > 100) {
    console.log(`    ⚠ la lista llegó con ${todos.length} elementos y solo ${mios.length} son míos — filtrado local obligatorio`);
  }
  return mios;
}

// ── Lectura de columnas de un ItemDTO ─────────────────────────────────────────

export const txt = (item, colId) => String(item?.cols?.[colId]?.text ?? '').trim();

export function num(item, colId) {
  const c = item?.cols?.[colId];
  if (c == null) return NaN;
  if (typeof c.value === 'number') return c.value;
  const n = parseFloat(String(c.text ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/** Como `num` pero exige que la columna EXISTA y traiga número. Una columna que
 * el server no mandó no es "0": es una columna que el rol no ve o que no se
 * escribió, y confundirlas esconde bugs. */
export function numReq(item, colId, que) {
  verdad(item?.cols?.[colId] != null, `${que}: la columna ${colId} no llegó en el DTO`);
  const n = num(item, colId);
  if (!Number.isFinite(n)) throw new Falla(`${que}: ${colId} no es número ("${txt(item, colId)}")`);
  return n;
}

// ── PDF: se parsea, no se pesa ────────────────────────────────────────────────

let pdfjs = null;
/** Texto plano de un PDF (Uint8Array/ArrayBuffer) — pdfjs-dist ya es dependencia
 * del repo (CotizacionPdfRow lo usa en el front). */
export async function textoPdf(bytes) {
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const tamano = data.byteLength;   // pdfjs se queda con el buffer: medir ANTES
  if (String.fromCharCode(...data.slice(0, 5)) !== '%PDF-') {
    throw new Falla(`no es un PDF (arranca con "${String.fromCharCode(...data.slice(0, 8))}")`);
  }
  // `destroy()` vive en la tarea de carga, no en el documento (pdfjs-dist 6.x) —
  // y `numPages` hay que leerlo ANTES de destruir.
  const tarea = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const doc = await tarea.promise;
  const paginas = doc.numPages;
  const partes = [];
  for (let p = 1; p <= paginas; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    partes.push(tc.items.map(i => i.str).join(' '));
  }
  await tarea.destroy();
  return { texto: partes.join('\n'), paginas, bytes: tamano };
}

/** Normaliza para comparar texto de PDF: los espacios entre glifos son ruido. */
export const plano = (s) => String(s).replace(/\s+/g, ' ').normalize('NFC').trim();

// ── Sesión contra producción (y suplantación de roles) ───────────────────────
//
// El worker deja que un admin actúe como cualquier otra identidad mandando la
// cabecera `X-Impersonate-Email` (worker/mw/identity.ts): TODO lo de abajo —
// dal.ts, visibility.ts, outbox — ve exactamente lo que vería esa persona. Es
// el mismo mecanismo del "Actuar como" de Configuración, así que probar los
// permisos por rol NO requiere las contraseñas de nadie.
//
// OJO: suplantar a alguien y ESCRIBIR deja la actividad a su nombre. Aquí se
// suplanta para leer y para comprobar que los rechazos rechazan; cualquier
// escritura de prueba va contra filas que creó el propio QA.

export async function abrirQA({ headless = true } = {}) {
  const ctx = await abrirContexto({ headless });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const me = await sesionValida(page);
  if (!me) {
    await ctx.close();
    console.log('✗ sin sesión de Access — corre primero: node scripts/prod-login.mjs');
    process.exit(1);
  }
  await page.goto(PROD, { waitUntil: 'domcontentloaded' });

  /** Cliente de API atado a una identidad. `comoEmail = null` = yo mismo. */
  function cliente(comoEmail = null) {
    /** Toda llamada sale DESDE la página para heredar la cookie de Access. */
    const api = (method, path, body) => page.evaluate(async ([method, path, body, como]) => {
      const opt = { method, headers: {} };
      if (como) opt.headers['X-Impersonate-Email'] = como;
      if (body !== null) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
      const res = await fetch('/api' + path, opt);
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* no era json */ }
      return { status: res.status, json, text: text.slice(0, 600) };
    }, [method, path, body ?? null, comoEmail]);

    /** Descarga binaria (PDFs, imágenes) — vuelve como bytes de verdad. */
    const bin = async (path) => {
      const r = await page.evaluate(async ([path, como]) => {
        const res = await fetch(path.startsWith('/api') ? path : '/api' + path,
          como ? { headers: { 'X-Impersonate-Email': como } } : undefined);
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, tipo: res.headers.get('content-type') ?? '', bytes: Array.from(buf) };
      }, [path, comoEmail]);
      return { status: r.status, tipo: r.tipo, bytes: new Uint8Array(r.bytes) };
    };

    const subir = (path, nombre, contenido, mime = 'application/pdf', campos = {}) =>
      page.evaluate(async ([path, nombre, contenido, mime, campos, como]) => {
        const fd = new FormData();
        for (const [k, v] of Object.entries(campos)) fd.append(k, v);
        fd.append('file', new File([Uint8Array.from(contenido)], nombre, { type: mime }));
        const res = await fetch('/api' + path, {
          method: 'POST', body: fd, headers: como ? { 'X-Impersonate-Email': como } : {},
        });
        const text = await res.text();
        let json = null; try { json = JSON.parse(text); } catch { /* no era json */ }
        return { status: res.status, json, text: text.slice(0, 400) };
      }, [path, nombre, Array.from(contenido), mime, campos, comoEmail]);

    /** Relee un item del portal. `fresh` fuerza la relectura contra Monday (el
     * mirror tarda; sin esto una aserción puede leer el valor viejo y "pasar"). */
    const item = async (slug, id, fresh = false) => {
      const r = await api('GET', `/boards/${slug}/items/${id}${fresh ? '?fresh=1' : ''}`);
      return ok(r, `leer ${slug}/${id}`);
    };

    return { api, bin, subir, item, comoEmail };
  }

  const propio = cliente(null);
  return {
    ctx, page, me, ...propio,
    /** Un cliente que actúa como otra identidad (worker/mw/identity.ts). */
    como: (email) => cliente(email),
    /** Identidades reales del portal, agrupadas por rol. */
    async identidades() {
      const r = await propio.api('GET', '/admin/identities');
      const lista = r.json?.identities ?? r.json ?? [];
      return Array.isArray(lista) ? lista : [];
    },
  };
}

// ── Reporte ───────────────────────────────────────────────────────────────────

export function crearReporte(titulo) {
  const pasos = [];
  let seccion = '';
  console.log(`\n${'═'.repeat(72)}\n  ${titulo}\n${'═'.repeat(72)}`);

  const rep = {
    pasos,
    seccion(nombre) { seccion = nombre; console.log(`\n▸ ${nombre}`); },

    /** El único camino a "pasó": que `fn` no lance. */
    async check(nombre, fn) {
      const t0 = Date.now();
      try {
        const detalle = await fn();
        pasos.push({ seccion, nombre, estado: 'ok', detalle: detalle ?? '', ms: Date.now() - t0 });
        console.log(`  ✓ ${nombre}${detalle ? ' — ' + detalle : ''}`);
        return true;
      } catch (err) {
        const msg = err instanceof Falla ? err.message : `${err?.name ?? 'error'}: ${err?.message ?? err}`;
        pasos.push({ seccion, nombre, estado: 'falla', detalle: msg, ms: Date.now() - t0 });
        console.log(`  ✗ ${nombre}\n      ${msg}`);
        return false;
      }
    },

    /** Cobertura que se decidió NO hacer. Se lista aparte y NO cuenta como éxito. */
    omitido(nombre, porque) {
      pasos.push({ seccion, nombre, estado: 'omitido', detalle: porque, ms: 0 });
      console.log(`  ○ ${nombre} — omitido: ${porque}`);
    },

    resumen() {
      const okk = pasos.filter(p => p.estado === 'ok');
      const mal = pasos.filter(p => p.estado === 'falla');
      const om = pasos.filter(p => p.estado === 'omitido');
      console.log(`\n${'═'.repeat(72)}`);
      console.log(`  ${okk.length}/${okk.length + mal.length} checks OK · ${mal.length} fallas · ${om.length} omitidos`);
      if (mal.length) {
        console.log(`\n  FALLAS:`);
        for (const f of mal) console.log(`   ✗ [${f.seccion}] ${f.nombre}\n       ${f.detalle}`);
      }
      if (om.length) {
        console.log(`\n  NO CUBIERTO:`);
        for (const f of om) console.log(`   ○ [${f.seccion}] ${f.nombre} — ${f.detalle}`);
      }
      console.log(`${'═'.repeat(72)}\n`);
      return mal.length;
    },
  };
  return rep;
}

// ── .env (llaves de Airtable/Monday para las auditorías cruzadas) ─────────────

export function leerEnv(archivo = '.env') {
  try {
    const out = {};
    for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
      if (!linea.includes('=') || linea.trimStart().startsWith('#')) continue;
      const i = linea.indexOf('=');
      out[linea.slice(0, i).trim()] = linea.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}

export const espera = (ms) => new Promise(r => setTimeout(r, ms));

/** Reintenta hasta que `fn` no lance — para el desfase del mirror tras un write.
 * NO enmascara fallas: si nunca cuadra, relanza la última. */
export async function hasta(fn, { intentos = 8, cada = 1500 } = {}) {
  let ultima;
  for (let i = 0; i < intentos; i++) {
    try { return await fn(); } catch (err) { ultima = err; await espera(cada); }
  }
  throw ultima;
}
