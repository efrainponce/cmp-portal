// scripts/qa/ciclo.mjs — el ciclo de vida COMPLETO de una oportunidad, contra
// producción, con el criterio de docs/qa-prod.md: cada escritura se relee y
// cada número se compara contra la fórmula.
//
// Corre en la Zona Efrain (items NATIVOS, ids ≥ 900_000_000_000): ahí la misma
// persona cotiza, costea y aprueba, así que el ciclo entero cabe en una corrida
// sin pedirle nada a nadie — y es justo la zona donde los espejos de Monday no
// existen y medio pipeline se atoraba (worker/lib/nativeMirrors.ts).
//
// ESCRIBE EN PRODUCCIÓN: crea filas nativas en D1 (Monday no se toca, esos
// items no existen allá) y consume folios globales de OC. Todo lo que crea
// lleva el prefijo QA_PREFIJO y lo borra `node scripts/qa-prod.mjs --limpiar`.
import {
  verdad, eq, casi, mayorQue, contiene, noContiene, ok,
  txt, num, numReq, hijosDe, textoPdf, plano, hasta,
} from './lib.mjs';

export const QA_PREFIJO = 'QA PROD';

// ── Ids de columnas (docs/monday-column-map.md / shared/column-meta.gen.ts) ────
const OPP = {
  stage: 'deal_stage', owner: 'deal_owner', vendedor: 'multiple_person_mm03qyw9',
  contacto: 'deal_contact', institucion: 'lookup_mm1bs976', puesto: 'lookup_mm0xf2r5',
  zona: 'dropdown_mm03g067', origen: 'color_mm47f0ca', catalogo: 'color_mm0ex0ed',
};
const LIN = {
  producto: 'board_relation_mkzmafgp', color: 'text_mm07s2mg', cantidad: 'numeric_mkzm6399',
  // espejos del catálogo (los estampa nativeMirrors.ts al ligar el producto)
  mCosto: 'lookup_mm5ck4b3', mDesc: 'lookup_mm0bdwb5', mGastos: 'lookup_mm0bbz02',
  mMoneda: 'lookup_mm11t8gj', mSku: 'lookup_mkzn7x9a', mNombre: 'lookup_mm0x4kda',
  mFicha: 'lookup_mm0xw8p7', mColores: 'lookup_mkznm0h3', mAirtable: 'lookup_mm0z4exs',
  // snapshot congelado (worker/lib/costeoSnapshot.ts)
  sNombre: 'text_mm0bkm1j', sSku: 'text_mm0bxy39', sCosto: 'numeric_mm0bph99',
  sDescPct: 'numeric_mkzn2q51', sGastPct: 'numeric_mkzngs9x', sIva: 'numeric_mm0cg0bm',
  sTc: 'numeric_mm0rvhgs', sPrecioForm: 'numeric_mm2qzzbe',
  // captura humana
  precio: 'numeric_mkzneg3d',            // Precio de Venta C/U — SOLO admin
  embCosto: 'numeric_mm0gxvpa', embStatus: 'color_mm1b34bg', embTexto: 'long_text_mm1bj4pt',
  etapaCosteo: 'color_mm084gvf', margenGob: 'numeric_mkznnm5s',
};
const PROD_COL = {
  costo: 'numeric_mkzpx7eb', desc: 'numeric_mm0bgd2f', gastos: 'numeric_mm0bnkch',
  moneda: 'text_mkzp59zf', sku: 'product_and_service_sku', nombre: 'text_mm0wvga2',
  confirmado: 'boolean_mm5cqtjs', colores: 'dropdown_mkztty4b', airtable: 'text_mkzmgvc7',
};
const LOG = { recoleccion: 'text_mm4ph3a9', guiaCliente: 'text_mm4pywyx', comentarios: 'text_mm6aapc8' };

const CEO = '98635534';   // dueño de la Zona Efrain
const YO  = '98389537';
const CONTACTO = '12017028945';   // Elías Guerrero → Constructora Janing

// ── Las mismas fórmulas del server/front, reimplementadas aquí a propósito ────
// Si el QA importara worker/lib/costeoSnapshot.ts probaría que el código es
// igual a sí mismo. Escritas de nuevo desde docs/monday-column-map.md, el
// único modo de que un cambio en la fórmula haga ruido.
const snapEsperado = (costo, descFrac, gastosFrac, moneda) => {
  const tc = String(moneda).toUpperCase() === 'USD' ? 18 : 1;
  return {
    costo, tc,
    descPct: Math.round(descFrac * 100),
    gastPct: Math.round(gastosFrac * 100),
    iva: 16,
    precio: Math.round((1 + gastosFrac) * (costo * (1 - descFrac)) * tc * 1.3 * 100) / 100,
  };
};
const costoTotalUnitEsperado = (costoDistr, descPct, gastosPct, tc, embell) =>
  (1 + gastosPct / 100) * (costoDistr - (descPct / 100) * costoDistr) * tc + embell;

const nu = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const pngMinimo = () => Uint8Array.from([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0x0d,0x49,0x48,0x44,0x52,0,0,0,1,0,0,0,1,8,6,0,0,0,
  0x1f,0x15,0xc4,0x89,0,0,0,0x0a,0x49,0x44,0x41,0x54,0x78,0x9c,0x63,0,1,0,0,5,0,1,0x0d,0x0a,0x2d,0xb4,
  0,0,0,0,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82,
]);
const pdfMinimo = (t) => new TextEncoder().encode(`%PDF-1.4\n% ${t}\n`);

/** Zonas de embellecimiento con texto que muerde: acentos, "/" y comas — el
 * serializador usa ",," y ":" como separadores (shared/embellecimiento.ts). */
const ZONAS_QA = {
  'Espalda': 'Logo bordado 12 cm, hilo blanco',
  'Frente izquierdo': 'Escudo institucional 8x8 cm',
  'Manga derecha/costado derecho': 'Bandera de México, sublimada',
  'Etiqueta de propiedad': 'Texto: "PROPIEDAD DE CMP" — no retirar',
};

export async function suiteCiclo(R, q) {
  const estado = { oppId: null, proyId: null, lineas: [], docs: [] };
  const sello = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const NOMBRE = `${QA_PREFIJO} ${sello} — borrar`;

  // ── 0. Elegir productos REALES del catálogo según lo que hace falta probar ──
  R.seccion('Preparación: productos reales del catálogo');
  let conCosto = [], sinCosto = null, enUsd = null;

  await R.check('hay productos de catálogo para cada caso que se va a probar', async () => {
    const cols = Object.values(PROD_COL).join(',');
    const r = await q.api('GET', `/boards/productos/items?cols=${cols}`);
    const items = ok(r, 'catálogo').items ?? [];
    mayorQue(items.length, 100, 'productos');

    const usable = (p) => txt(p, PROD_COL.confirmado) && txt(p, PROD_COL.colores) && txt(p, PROD_COL.nombre);
    const costo = (p) => nu(txt(p, PROD_COL.costo));

    conCosto = items.filter(p => usable(p) && (costo(p) ?? 0) > 0
      && String(txt(p, PROD_COL.moneda)).toUpperCase() === 'MXN').slice(0, 3);
    sinCosto = items.find(p => usable(p) && !txt(p, PROD_COL.costo));
    enUsd = items.find(p => usable(p) && (costo(p) ?? 0) > 0 && String(txt(p, PROD_COL.moneda)).toUpperCase() === 'USD');

    verdad(conCosto.length >= 2, `solo ${conCosto.length} productos confirmados con costo en MXN`);
    verdad(sinCosto, 'no hay ningún producto confirmado SIN costo — no se puede probar el borrado del snapshot');
    return `${conCosto.length} con costo · sin costo: ${sinCosto?.name?.slice(0, 22)} · USD: ${enUsd ? enUsd.name.slice(0, 18) : 'ninguno'}`;
  });
  if (conCosto.length < 2) return estado;

  R.omitido('el gate de "Descripción y tallas confirmadas" bloquea la validación',
    'exigiría desconfirmar un producto del catálogo REAL (la confirmación vive en el producto, no en la línea) — anclado en worker/lib/costeo.test.ts');

  const primerColor = (p) => String(txt(p, PROD_COL.colores)).split(',')[0].trim();
  const plan = conCosto.map((p, i) => ({
    prod: p, color: primerColor(p), cant: [45, 20, 11][i] ?? 10,
    costoCat: nu(txt(p, PROD_COL.costo)),
    descCat: nu(txt(p, PROD_COL.desc)) ?? 0,
    gastosCat: nu(txt(p, PROD_COL.gastos)) ?? 0,
    moneda: txt(p, PROD_COL.moneda) || 'MXN',
  }));
  if (enUsd) {
    plan.push({
      prod: enUsd, color: primerColor(enUsd), cant: 4, costoCat: nu(txt(enUsd, PROD_COL.costo)),
      descCat: nu(txt(enUsd, PROD_COL.desc)) ?? 0, gastosCat: nu(txt(enUsd, PROD_COL.gastos)) ?? 0,
      moneda: 'USD',
    });
  } else {
    R.omitido('snapshot en USD (TC=18)', 'no hay producto confirmado en USD con costo en el catálogo');
  }

  // ── 1. Alta de la oportunidad ───────────────────────────────────────────────
  R.seccion('1. Alta de la oportunidad (Zona Efrain)');

  await R.check('POST /boards/oportunidades/items crea la oportunidad nativa', async () => {
    const r = await q.api('POST', '/boards/oportunidades/items', {
      name: NOMBRE, native: true,
      cols: {
        [OPP.owner]: CEO, [OPP.vendedor]: YO, [OPP.contacto]: CONTACTO,
        [OPP.zona]: 'Bajio', [OPP.origen]: 'Estudio de mercado',
        [OPP.catalogo]: 'No, productos en catálogo',
      },
    });
    const j = ok(r, 'crear oportunidad');
    verdad(j.id, `sin id: ${r.text}`);
    verdad(Number(j.id) >= 900000000000, `el id ${j.id} no es nativo — se creó en el board REAL`);
    estado.oppId = j.id;
    return `id ${j.id}`;
  });
  if (!estado.oppId) return estado;

  await R.check('lo que se mandó es lo que quedó guardado (relectura, no el 200)', async () => {
    const it = await q.item('oportunidades', estado.oppId);
    eq(it.name, NOMBRE, 'nombre');
    eq(txt(it, OPP.zona), 'Bajio', 'Zona');
    eq(txt(it, OPP.origen), 'Estudio de mercado', 'Origen');
    eq(txt(it, OPP.stage), 'Nueva oportunidad', 'Etapa inicial');
    contiene(txt(it, OPP.owner), 'Efrain', 'Dueño');
    return `etapa "${txt(it, OPP.stage)}"`;
  });

  await R.check('el espejo Institución se resolvió local (sin él "Mandar a costeo" es imposible)', async () => {
    const it = await hasta(async () => {
      const x = await q.item('oportunidades', estado.oppId);
      verdad(txt(x, OPP.institucion), 'el espejo Institución sigue vacío');
      return x;
    }, { intentos: 6, cada: 1200 });
    return `Institución = "${txt(it, OPP.institucion)}"`;
  });

  // ── 2. Líneas: el catálogo aterriza en la línea ─────────────────────────────
  R.seccion('2. Líneas: el precio del catálogo aterriza en la línea');

  for (const p of plan) {
    await R.check(`línea ${p.prod.name.slice(0, 26)} (${p.color}) x${p.cant}`, async () => {
      const c = await q.api('POST', `/oportunidades/${estado.oppId}/productos`, { cantidad: p.cant });
      const j = ok(c, 'crear línea');
      verdad(j.id, `sin id: ${c.text}`);
      const w = await q.api('PATCH', `/boards/oportunidades_sub/items/${j.id}`, {
        cols: { [LIN.producto]: String(p.prod.id), [LIN.color]: p.color, [LIN.cantidad]: String(p.cant) },
      });
      ok(w, 'ligar producto');
      p.lineaId = j.id;
      estado.lineas.push(p);
      return `id ${j.id}`;
    });
  }
  const lineas = plan.filter(p => p.lineaId);
  verdad(lineas.length > 0, 'ninguna línea se creó');

  for (const p of lineas) {
    await R.check(`${p.prod.name.slice(0, 22)}: espejos del catálogo copiados a la línea`, async () => {
      const l = await hasta(async () => {
        const x = await q.item('oportunidades_sub', p.lineaId);
        verdad(txt(x, LIN.mCosto) || txt(x, LIN.mNombre), 'los espejos siguen vacíos');
        return x;
      });
      eq(txt(l, LIN.mNombre), txt(p.prod, PROD_COL.nombre), 'Nombre del producto (espejo)');
      eq(txt(l, LIN.mSku), txt(p.prod, PROD_COL.sku), 'SKU (espejo)');
      casi(nu(txt(l, LIN.mDesc)) ?? 0, p.descCat, 'Descuento (auto) espejo');
      casi(nu(txt(l, LIN.mGastos)) ?? 0, p.gastosCat, 'Gastos % (auto) espejo');
      eq(String(txt(l, LIN.mMoneda)).toUpperCase(), String(p.moneda).toUpperCase(), 'Moneda (espejo)');
      // El espejo "Costo (auto)" (lookup_mm5ck4b3) NO se expone por la API a
      // ningún rol (shared/visibility.ts) aunque el server sí lo use para
      // congelar el snapshot. Que el costo del catálogo llegó bien a la línea
      // se comprueba en el check del snapshot de aquí abajo, que es el número
      // que de verdad se cotiza.
      verdad(txt(l, LIN.mFicha), 'Ficha comercial (espejo) vacía — checkCosteo la exige');
      // "Colores disponibles" (lookup_mkznm0h3) tampoco viaja al cliente; que
      // llegó bien lo prueba que `costeo-check` (paso 5) valide el color
      // capturado contra él sin quejarse.
      // El NOMBRE de la línea: en Monday lo pone una automatización; nativo lo
      // pone nativeMirrors. checkTodoCuadra cruza tallas POR NOMBRE.
      contiene(l.name, txt(p.prod, PROD_COL.nombre).slice(0, 12), 'nombre de la línea');
      return `costo ${nu(txt(l, LIN.mCosto))} · ${txt(l, LIN.mMoneda)}`;
    });

    await R.check(`${p.prod.name.slice(0, 22)}: el snapshot de costeo cuadra con la fórmula`, async () => {
      const l = await hasta(async () => {
        const x = await q.item('oportunidades_sub', p.lineaId);
        verdad(txt(x, LIN.sCosto), 'el snapshot no se estampó al elegir el producto');
        return x;
      });
      const esp = snapEsperado(p.costoCat, p.descCat, p.gastosCat, p.moneda);
      casi(numReq(l, LIN.sCosto, 'Costo distr.'), esp.costo, 'Costo distr. (snapshot)');
      casi(numReq(l, LIN.sDescPct, 'Descuento %'), esp.descPct, 'Descuento % (snapshot)');
      casi(numReq(l, LIN.sGastPct, 'Gastos %'), esp.gastPct, 'Gastos % (snapshot)');
      casi(numReq(l, LIN.sTc, 'TC'), esp.tc, 'Tipo de cambio');
      casi(numReq(l, LIN.sIva, 'IVA'), esp.iva, 'IVA %');
      casi(numReq(l, LIN.sPrecioForm, 'Precio sugerido'), esp.precio, 'Precio sugerido (fórmula)', 0.05);
      eq(txt(l, LIN.sSku), txt(p.prod, PROD_COL.sku), 'SKU congelado');
      return `costo ${esp.costo} · desc ${esp.descPct}% · gastos ${esp.gastPct}% · TC ${esp.tc} → sugerido ${esp.precio}`;
    });
  }

  // ── 3. Qué pasa cuando algo SE MUEVE ────────────────────────────────────────
  R.seccion('3. Qué pasa cuando algo se mueve');
  const movil = lineas[0];

  await R.check('cambiar de producto re-estampa el costeo con el NUEVO catálogo', async () => {
    const otro = conCosto.find(p => String(p.id) !== String(movil.prod.id) && (nu(txt(p, PROD_COL.costo)) ?? 0) > 0);
    verdad(otro, 'no hay un segundo producto con costo para mover la línea');
    const w = await q.api('PATCH', `/boards/oportunidades_sub/items/${movil.lineaId}`, {
      cols: { [LIN.producto]: String(otro.id), [LIN.color]: primerColor(otro) },
    });
    ok(w, 'cambiar producto');
    const costoOtro = nu(txt(otro, PROD_COL.costo));
    const l = await hasta(async () => {
      const x = await q.item('oportunidades_sub', movil.lineaId);
      casi(numReq(x, LIN.sCosto, 'costo'), costoOtro, 'Costo distr. tras cambiar de producto');
      return x;
    });
    eq(txt(l, LIN.sSku), txt(otro, PROD_COL.sku), 'SKU congelado tras el cambio');
    eq(txt(l, LIN.mNombre), txt(otro, PROD_COL.nombre), 'espejo Nombre tras el cambio');
    return `${movil.costoCat} → ${costoOtro}`;
  });

  await R.check('mover a un producto SIN costo limpia el snapshot (no deja el del anterior)', async () => {
    const w = await q.api('PATCH', `/boards/oportunidades_sub/items/${movil.lineaId}`, {
      cols: { [LIN.producto]: String(sinCosto.id), [LIN.color]: primerColor(sinCosto) },
    });
    ok(w, 'cambiar a producto sin costo');
    const l = await hasta(async () => {
      const x = await q.item('oportunidades_sub', movil.lineaId);
      const c = txt(x, LIN.sCosto);
      verdad(c === '' || nu(c) === 0, `Costo distr. quedó en "${c}" — es el costo del producto ANTERIOR`);
      return x;
    });
    for (const [col, que] of [[LIN.sDescPct, 'Descuento %'], [LIN.sGastPct, 'Gastos %'], [LIN.sPrecioForm, 'Precio sugerido']]) {
      const v = txt(l, col);
      verdad(v === '' || nu(v) === 0, `${que} quedó en "${v}" tras mover a un producto sin costo`);
    }
    return `producto "${sinCosto.name.slice(0, 24)}" sin costo → snapshot en blanco`;
  });

  await R.check('regresar al producto original restaura su costeo', async () => {
    const w = await q.api('PATCH', `/boards/oportunidades_sub/items/${movil.lineaId}`, {
      cols: { [LIN.producto]: String(movil.prod.id), [LIN.color]: movil.color },
    });
    ok(w, 'restaurar producto');
    const esp = snapEsperado(movil.costoCat, movil.descCat, movil.gastosCat, movil.moneda);
    await hasta(async () => {
      const x = await q.item('oportunidades_sub', movil.lineaId);
      casi(numReq(x, LIN.sCosto, 'costo'), esp.costo, 'Costo distr. restaurado');
      casi(numReq(x, LIN.sPrecioForm, 'sugerido'), esp.precio, 'Precio sugerido restaurado', 0.05);
    });
    return `costo ${esp.costo} de vuelta`;
  });

  await R.check('cambiar la cantidad mueve el total (y no toca el costo unitario)', async () => {
    const antes = await q.item('oportunidades_sub', movil.lineaId);
    const costoUnit = numReq(antes, LIN.sCosto, 'costo unitario');
    const nueva = movil.cant + 7;
    ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${movil.lineaId}`,
      { cols: { [LIN.cantidad]: String(nueva) } }), 'cambiar cantidad');
    const l = await hasta(async () => {
      const x = await q.item('oportunidades_sub', movil.lineaId);
      casi(numReq(x, LIN.cantidad, 'cantidad'), nueva, 'Cantidad');
      return x;
    });
    casi(numReq(l, LIN.sCosto, 'costo'), costoUnit, 'el costo unitario NO debía moverse');
    ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${movil.lineaId}`,
      { cols: { [LIN.cantidad]: String(movil.cant) } }), 'restaurar cantidad');
    return `${movil.cant} → ${nueva} → ${movil.cant}`;
  });

  // ── 4. Embellecimiento ──────────────────────────────────────────────────────
  R.seccion('4. Embellecimiento');
  const conEmb = lineas[0];

  await R.check('marcar "Con Embellecimiento" queda guardado como etiqueta real', async () => {
    ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${conEmb.lineaId}`,
      { cols: { [LIN.embStatus]: 'Con Embellecimiento' } }), 'marcar embellecimiento');
    const l = await hasta(async () => {
      const x = await q.item('oportunidades_sub', conEmb.lineaId);
      eq(txt(x, LIN.embStatus), 'Con Embellecimiento', 'Estado de embellecimiento');
      return x;
    });
    // Una línea nativa guarda status como {index}: si se guardara como texto,
    // los boards que filtran por índice la dejarían de ver (bug de 2026-08-18).
    const v = l.cols?.[LIN.embStatus]?.value;
    verdad(v != null, 'el status llegó sin `value` — se guardó como texto, no como índice');
    return `etiqueta "${txt(l, LIN.embStatus)}" (index ${JSON.stringify(v)})`;
  });

  await R.check('las 8 zonas van y vuelven sin perder acentos, comas ni "/"', async () => {
    const crudo = Object.entries(ZONAS_QA).map(([k, v]) => `${k}:${v}`).join(',,');
    ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${conEmb.lineaId}`,
      { cols: { [LIN.embTexto]: crudo } }), 'escribir zonas');
    const l = await hasta(async () => {
      const x = await q.item('oportunidades_sub', conEmb.lineaId);
      verdad(txt(x, LIN.embTexto), 'el texto de embellecimiento volvió vacío');
      return x;
    });
    const leido = txt(l, LIN.embTexto);
    // Se parsea con la misma regla de shared/embellecimiento.ts, reescrita aquí.
    const zonas = {};
    for (const par of leido.replace(/\n,,/g, ',,').split(',,')) {
      const i = par.indexOf(':');
      if (i === -1) continue;
      const k = par.slice(0, i).trim();
      if (!(k in zonas)) zonas[k] = par.slice(i + 1).trim();
    }
    for (const [k, v] of Object.entries(ZONAS_QA)) eq(zonas[k], v, `zona "${k}"`);
    return `${Object.keys(zonas).length} zonas íntegras`;
  });

  const COSTO_EMB = 85.5;
  await R.check('el costo de embellecimiento entra al costo total unitario', async () => {
    ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${conEmb.lineaId}`,
      { cols: { [LIN.embCosto]: String(COSTO_EMB) } }), 'escribir costo de embellecimiento');
    const l = await hasta(async () => {
      const x = await q.item('oportunidades_sub', conEmb.lineaId);
      casi(numReq(x, LIN.embCosto, 'costo emb.'), COSTO_EMB, 'Costo de embellecimiento');
      return x;
    });
    const esperado = costoTotalUnitEsperado(
      numReq(l, LIN.sCosto, 'costo'), numReq(l, LIN.sDescPct, 'desc'),
      numReq(l, LIN.sGastPct, 'gastos'), numReq(l, LIN.sTc, 'tc'), COSTO_EMB);
    const sinEmb = costoTotalUnitEsperado(
      numReq(l, LIN.sCosto, 'costo'), numReq(l, LIN.sDescPct, 'desc'),
      numReq(l, LIN.sGastPct, 'gastos'), numReq(l, LIN.sTc, 'tc'), 0);
    casi(esperado - sinEmb, COSTO_EMB, 'el embellecimiento debe sumar exactamente su costo');
    return `costo unit. ${sinEmb.toFixed(2)} → ${esperado.toFixed(2)} (+${COSTO_EMB})`;
  });

  await R.check('subir imagen de referencia por zona y recuperarla idéntica', async () => {
    const png = pngMinimo();
    const zona = 'Espalda';
    const up = await q.subir(`/oportunidades/lineas/${conEmb.lineaId}/embellecimiento-imagen`,
      'referencia-qa.png', png, 'image/png', { zone: zona });
    ok(up, 'subir imagen');
    // La ruta devuelve un mapa { zona: url }, una imagen por zona.
    const lista = ok(await q.api('GET', `/oportunidades/lineas/${conEmb.lineaId}/embellecimiento-imagenes`), 'listar imágenes');
    const zonas = Object.keys(lista ?? {});
    verdad(zonas.length > 0, `la lista volvió vacía: ${JSON.stringify(lista).slice(0, 200)}`);
    const url = lista[zona];
    verdad(url, `la imagen no aparece bajo "${zona}": ${JSON.stringify(lista).slice(0, 250)}`);
    contiene(url, 'referencia-qa', 'la url debe apuntar al archivo subido');
    const back = await q.bin(url);
    verdad(back.status === 200, `descargar la imagen: HTTP ${back.status}`);
    eq(back.bytes.byteLength, png.byteLength, 'bytes recuperados');
    return `zona(s) ${zonas.join(', ')} · ${back.bytes.byteLength} bytes idénticos`;
  });

  await R.check('una zona inventada se RECHAZA (no se guarda con nombre libre)', async () => {
    const up = await q.subir(`/oportunidades/lineas/${conEmb.lineaId}/embellecimiento-imagen`,
      'zona-mala.png', pngMinimo(), 'image/png', { zone: 'Zona Que No Existe' });
    verdad(up.status >= 400, `esperaba rechazo y llegó ${up.status} — se guardó una zona fuera de plantilla`);
    return `HTTP ${up.status}`;
  });

  // ── 5. Mandar a costeo + PDF de solicitud ───────────────────────────────────
  R.seccion('5. Mandar a costeo (y el PDF de solicitud)');

  await R.check('el pre-chequeo pasa con la oportunidad completa', async () => {
    const r = await q.api('GET', `/oportunidades/${estado.oppId}/costeo-check`);
    const j = ok(r, 'costeo-check');
    verdad(j.ok === true, `bloqueado: ${JSON.stringify(j.errors ?? j).slice(0, 400)}`);
    return 'sin errores';
  });

  await R.check('POST enviar-costeo mueve la etapa a "En costeo" DE VERDAD', async () => {
    const r = await q.api('POST', `/oportunidades/${estado.oppId}/enviar-costeo`);
    const j = ok(r, 'enviar-costeo');
    verdad(j.ok === true, JSON.stringify(j).slice(0, 400));
    const it = await hasta(async () => {
      const x = await q.item('oportunidades', estado.oppId);
      eq(txt(x, OPP.stage), 'En costeo', 'Etapa tras mandar a costeo');
      return x;
    });
    return `etapa "${txt(it, OPP.stage)}" · folio ${j.folio ?? '(sin folio)'}`;
  });

  await R.check('la solicitud queda asentada como documento con su sha256', async () => {
    const sol = await hasta(async () => {
      const j = ok(await q.api('GET', `/documents?sourceKind=oportunidad&sourceId=${estado.oppId}`), 'listar documentos');
      const d = (j.documents ?? []).find(x => x.templateId === 'solicitud-costeo');
      verdad(d, `todavía no aparece: ${(j.documents ?? []).map(x => x.templateId).join(', ') || '(ninguno)'}`);
      return d;
    }, { intentos: 10, cada: 3000 });
    verdad(sol.sha256 && String(sol.sha256).length >= 32, `sha256 ausente o corto: ${sol.sha256}`);
    estado.solicitud = sol;
    return `sha ${String(sol.sha256).slice(0, 12)}…`;
  });

  await R.check('el PDF de solicitud de costeo se abre y lista los productos', async () => {
    verdad(estado.solicitud, 'no hay documento de solicitud que abrir');
    const r = await q.bin(`/documents/${estado.solicitud.id}/pdf`);
    verdad(r.status === 200, `HTTP ${r.status}`);
    contiene(r.tipo, 'pdf', 'content-type');
    const { texto, paginas, bytes } = await textoPdf(r.bytes);
    const t = plano(texto);
    for (const p of lineas) {
      const nombre = txt(p.prod, PROD_COL.nombre) || p.prod.name;
      contiene(t, plano(nombre.slice(0, 14)), `el PDF debe listar "${nombre.slice(0, 24)}"`);
      contiene(t, String(p.cant), `la cantidad ${p.cant} de "${nombre.slice(0, 18)}"`);
    }
    estado.textoSolicitud = t;
    return `${paginas} pág · ${(bytes / 1024).toFixed(1)} KB · ${lineas.length} productos listados`;
  });

  await R.check('la solicitud de costeo NO lleva precios de venta (es su razón de ser)', () => {
    const t = String(estado.textoSolicitud ?? '');
    verdad(t, 'no se pudo leer el texto de la solicitud');
    noContiene(t.toLowerCase(), 'precio de venta', 'encabezado de precio de venta');
    for (const p of lineas) {
      if (!p.precioVenta) continue;
      noContiene(t, p.precioVenta.toLocaleString('es-MX', { minimumFractionDigits: 2 }), 'un precio de venta');
    }
    return 'sin columna ni importes de precio de venta';
  });

  // El botón del drawer no lee el documento de D1 sino el archivo en R2, que se
  // sube en segundo plano DESPUÉS de responder el "Mandar a costeo". O sea que
  // hay una ventana en la que el usuario da click y no hay PDF. Medirla es el
  // punto de este check: falla solo si nunca aparece.
  await R.check('la solicitud también se sirve por la ruta del drawer (y en cuánto tiempo)', async () => {
    const t0 = Date.now();
    const r = await hasta(async () => {
      const x = await q.bin(`/oportunidades/${estado.oppId}/cotizacion-pdf/solicitud_costeo`);
      verdad(x.status === 200, `sigue en HTTP ${x.status} tras ${Math.round((Date.now() - t0) / 1000)}s`);
      return x;
    }, { intentos: 45, cada: 4000 });
    const segundos = Math.round((Date.now() - t0) / 1000);
    const { paginas } = await textoPdf(r.bytes);
    return `${paginas} pág · disponible tras ~${segundos}s` +
      (segundos > 30 ? ' ⚠ el botón del drawer da 404 todo ese rato' : '');
  });

  // ── 6. Costear de verdad: cambiar costos y precios ──────────────────────────
  R.seccion('6. Costear de verdad (Compras captura costo, Dirección precio)');

  for (const p of lineas) {
    p.costoReal = Math.round((p.costoCat * 1.07 + 13) * 100) / 100;
    p.precioVenta = Math.round(p.costoReal * 2.15 * 100) / 100;
    await R.check(`${p.prod.name.slice(0, 22)}: costo ${p.costoReal} y precio ${p.precioVenta} quedan guardados`, async () => {
      ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${p.lineaId}`, {
        cols: {
          [LIN.sCosto]: String(p.costoReal),
          [LIN.precio]: String(p.precioVenta),
          [LIN.etapaCosteo]: 'Listo',
        },
      }), 'costear línea');
      const l = await hasta(async () => {
        const x = await q.item('oportunidades_sub', p.lineaId);
        casi(numReq(x, LIN.precio, 'precio'), p.precioVenta, 'Precio de Venta C/U');
        return x;
      });
      casi(numReq(l, LIN.sCosto, 'costo'), p.costoReal, 'Costo distr. capturado');
      eq(txt(l, LIN.etapaCosteo), 'Listo', 'Etapa Costeo');
      return `precio ${numReq(l, LIN.precio, 'p')} · costo ${numReq(l, LIN.sCosto, 'c')}`;
    });
  }

  await R.check('cambiar el precio OTRA VEZ se vuelve a guardar (no se atora en el eco)', async () => {
    const p = lineas[0];
    const nuevo = Math.round((p.precioVenta + 137.25) * 100) / 100;
    ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${p.lineaId}`,
      { cols: { [LIN.precio]: String(nuevo) } }), 'segundo cambio de precio');
    await hasta(async () => {
      const x = await q.item('oportunidades_sub', p.lineaId);
      casi(numReq(x, LIN.precio, 'precio'), nuevo, 'Precio tras el segundo cambio');
      verdad(!x.pendingWrite, 'la escritura quedó pendiente de confirmación');
    }, { intentos: 10, cada: 1500 });
    p.precioVenta = nuevo;
    return `→ ${nuevo}`;
  });

  await R.check('borrar el precio lo deja vacío (no lo deja con el valor viejo)', async () => {
    const p = lineas[lineas.length - 1];
    ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${p.lineaId}`,
      { cols: { [LIN.precio]: '' } }), 'limpiar precio');
    await hasta(async () => {
      const x = await q.item('oportunidades_sub', p.lineaId);
      const v = txt(x, LIN.precio);
      verdad(v === '' || nu(v) === 0, `el precio quedó en "${v}" tras limpiarlo`);
    });
    ok(await q.api('PATCH', `/boards/oportunidades_sub/items/${p.lineaId}`,
      { cols: { [LIN.precio]: String(p.precioVenta) } }), 'restaurar precio');
    await hasta(async () => {
      const x = await q.item('oportunidades_sub', p.lineaId);
      casi(numReq(x, LIN.precio, 'precio'), p.precioVenta, 'Precio restaurado');
    });
    return 'vacío y restaurado';
  });

  await R.check('el total de la cotización cuadra con precio × cantidad + IVA', async () => {
    const det = await q.item('oportunidades', estado.oppId);
    const hijos = hijosDe(det.children ?? [], estado.oppId, 'líneas de la oportunidad');
    let subtotal = 0;
    for (const l of hijos) {
      const precio = num(l, LIN.precio), cant = num(l, LIN.cantidad);
      if (!Number.isFinite(precio) || !Number.isFinite(cant)) continue;
      subtotal += precio * cant;
    }
    mayorQue(subtotal, 0, 'subtotal');
    estado.subtotal = Math.round(subtotal * 100) / 100;
    estado.iva = Math.round(subtotal * 0.16 * 100) / 100;
    estado.total = Math.round((subtotal * 1.16) * 100) / 100;
    return `${hijos.length} líneas · subtotal ${estado.subtotal} · IVA ${estado.iva} · total ${estado.total}`;
  });

  // ── 7. Validación y confirmación ────────────────────────────────────────────
  R.seccion('7. Validación de costeo y confirmación');

  await R.check('POST enviar-validacion mueve 15 → 7', async () => {
    const r = await q.api('POST', `/oportunidades/${estado.oppId}/enviar-validacion`);
    const j = ok(r, 'enviar-validacion');
    verdad(j.ok === true, JSON.stringify(j).slice(0, 400));
    await hasta(async () => {
      const x = await q.item('oportunidades', estado.oppId);
      eq(txt(x, OPP.stage), 'Costeo en validación', 'Etapa');
    });
    return 'etapa "Costeo en validación"';
  });

  await R.check('POST validar-costeo mueve 7 → 9 (Costeo Confirmado)', async () => {
    const r = await q.api('POST', `/oportunidades/${estado.oppId}/validar-costeo`);
    const j = ok(r, 'validar-costeo');
    verdad(j.ok === true, JSON.stringify(j).slice(0, 400));
    await hasta(async () => {
      const x = await q.item('oportunidades', estado.oppId);
      eq(txt(x, OPP.stage), 'Costeo Confirmado', 'Etapa');
    });
    return 'etapa "Costeo Confirmado"';
  });

  await R.check('la hoja de validación SÍ trae los precios y cuadra con el total', async () => {
    const j = ok(await q.api('GET', `/documents?sourceKind=oportunidad&sourceId=${estado.oppId}`), 'documentos');
    const doc = (j.documents ?? []).find(d => d.templateId === 'validacion-costeo');
    verdad(doc, `no se generó la hoja de validación: ${(j.documents ?? []).map(d => d.templateId).join(', ')}`);
    const r = await q.bin(`/documents/${doc.id}/pdf`);
    verdad(r.status === 200, `descargar PDF: HTTP ${r.status}`);
    const { texto, paginas } = await textoPdf(r.bytes);
    const t = plano(texto);
    const miles = (n) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const enteros = String(Math.round(estado.subtotal)).slice(0, 4);
    verdad(t.includes(miles(estado.subtotal)) || t.includes(enteros),
      `el subtotal ${miles(estado.subtotal)} no aparece en la hoja de validación`);
    return `${paginas} pág · subtotal ${miles(estado.subtotal)} presente`;
  });

  // ── 8. Cotización y PDF al cliente ──────────────────────────────────────────
  R.seccion('8. Cotización');

  await R.check('POST cotizacion genera la cotización nativa', async () => {
    const r = await q.api('POST', `/oportunidades/${estado.oppId}/cotizacion`);
    const j = ok(r, 'cotizacion');
    verdad(j.ok === true, JSON.stringify(j).slice(0, 400));
    return JSON.stringify(j).slice(0, 120);
  });

  await R.check('el PDF de cotización trae productos, cantidades y el total correcto', async () => {
    const r = await hasta(async () => {
      const x = await q.bin(`/oportunidades/${estado.oppId}/cotizacion-pdf/sin_firmar`);
      verdad(x.status === 200, `HTTP ${x.status}`);
      return x;
    }, { intentos: 6, cada: 2000 });
    const { texto, paginas } = await textoPdf(r.bytes);
    const t = plano(texto);
    for (const p of lineas) {
      const nombre = txt(p.prod, PROD_COL.nombre) || p.prod.name;
      contiene(t, plano(nombre.slice(0, 12)), `producto "${nombre.slice(0, 22)}" en la cotización`);
    }
    const miles = (n) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    verdad(t.includes(miles(estado.total)) || t.includes(miles(estado.subtotal)),
      `ni el subtotal ${miles(estado.subtotal)} ni el total ${miles(estado.total)} aparecen en el PDF`);
    return `${paginas} pág · total ${miles(estado.total)} verificado`;
  });

  await R.check('la vista previa nativa de cotización también corre', async () => {
    const r = await q.bin(`/oportunidades/${estado.oppId}/cotizacion-preview/pdf`);
    verdad(r.status === 200, `HTTP ${r.status} — ${new TextDecoder().decode(r.bytes.slice(0, 160))}`);
    const { texto, paginas } = await textoPdf(r.bytes);
    const t = plano(texto);
    mayorQue(t.length, 80, 'texto extraído del PDF');
    contiene(t, plano(txt(lineas[0].prod, PROD_COL.nombre).slice(0, 12)), 'primer producto');
    return `${paginas} pág`;
  });

  // ── 9. Ganar → Proyecto ─────────────────────────────────────────────────────
  R.seccion('9. Ganar → Proyecto');

  await R.check('POST ganar crea el Proyecto y deja la oportunidad en "Ganada"', async () => {
    const r = await q.api('POST', `/oportunidades/${estado.oppId}/ganar`);
    const j = ok(r, 'ganar');
    verdad(j.proyectoId, `sin proyectoId: ${JSON.stringify(j).slice(0, 300)}`);
    estado.proyId = j.proyectoId;
    await hasta(async () => {
      const x = await q.item('oportunidades', estado.oppId);
      eq(txt(x, OPP.stage), 'Ganada', 'Etapa');
    });
    return `proyecto ${j.proyectoId}`;
  });

  if (estado.proyId) {
    // Ojo: al "ganar" el Proyecto nace SIN líneas — los renglones se crean al
    // capturar tallas (paso 10). Aquí se verifica lo que sí debe existir ya.
    await R.check('el Proyecto nace con el nombre y ligado a su oportunidad', async () => {
      const det = await q.item('proyectos', estado.proyId);
      contiene(det.name, QA_PREFIJO, 'nombre del proyecto');
      const liga = ok(await q.api('GET', `/proyectos/${estado.proyId}/oportunidad`), 'proyecto → oportunidad');
      const oppLigada = String(liga.id ?? liga.oportunidadId ?? liga.item?.id ?? '');
      eq(oppLigada, String(estado.oppId), 'oportunidad ligada al Proyecto');
      return `"${det.name.slice(0, 30)}" ← opp ${oppLigada}`;
    });

    await R.check('el Proyecto se ve en la lista del board (no desaparece por status mal guardado)', async () => {
      const j = ok(await q.api('GET', '/boards/proyectos/items'), 'listar proyectos');
      const mio = (j.items ?? []).find(i => String(i.id) === String(estado.proyId));
      verdad(mio, `el proyecto ${estado.proyId} no sale entre los ${j.items?.length ?? 0} del board`);
      return `visible entre ${j.items.length} proyectos`;
    });
  }

  // ── 10. Tallas ──────────────────────────────────────────────────────────────
  if (estado.proyId) {
    R.seccion('10. Tallas');

    await R.check('confirmar tallas SIN la OC del cliente se rechaza', async () => {
      const r = await q.api('POST', `/proyectos/${estado.proyId}/tallas-confirmar`, {});
      verdad(r.status >= 400 || r.json?.ok === false,
        `esperaba rechazo y llegó ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      return `HTTP ${r.status}`;
    });

    const filas = [];
    for (const p of lineas) {
      const cant = p.cant;
      const tallas = { M: Math.ceil(cant / 2), G: Math.floor(cant / 2) };
      p.tallas = tallas;
      for (const [talla, cantidad] of Object.entries(tallas)) {
        if (cantidad > 0) filas.push({
          subitemId: Number(p.lineaId), producto: txt(p.prod, PROD_COL.nombre) || p.prod.name,
          color: p.color, talla, cantidad,
        });
      }
    }

    await R.check(`capturar ${filas.length} renglones de tallas y releerlos uno por uno`, async () => {
      const r = await q.api('POST', `/proyectos/${estado.proyId}/tallas-capturar`, { rows: filas });
      const j = ok(r, 'tallas-capturar');
      verdad(j.ok === true, JSON.stringify(j).slice(0, 300));
      const det = await hasta(async () => {
        const x = await q.item('proyectos', estado.proyId);
        verdad((x.children ?? []).length >= filas.length, `solo ${(x.children ?? []).length} de ${filas.length} renglones`);
        return x;
      }, { intentos: 8, cada: 2000 });
      const hijos = hijosDe(det.children ?? [], estado.proyId, 'renglones de talla');
      return `${hijos.length} renglones en el Proyecto`;
    });

    await R.check('la suma de tallas cuadra con la cantidad de cada línea', async () => {
      for (const p of lineas) {
        const suma = Object.values(p.tallas).reduce((a, b) => a + b, 0);
        casi(suma, p.cant, `suma de tallas de "${p.prod.name.slice(0, 20)}"`, 0);
      }
      return lineas.map(p => `${p.cant}`).join(' + ');
    });

    await R.check('subir la OC del cliente y recuperarla', async () => {
      const pdf = pdfMinimo('OC cliente QA');
      const up = await q.subir(`/proyectos/${estado.proyId}/documento`, 'OC-cliente-qa.pdf', pdf);
      const j = ok(up, 'subir OC del cliente');
      verdad(j.ok === true, JSON.stringify(j).slice(0, 200));
      if (j.url) {
        const back = await q.bin(j.url);
        verdad(back.status === 200, `descargar la OC: HTTP ${back.status}`);
        eq(back.bytes.byteLength, pdf.byteLength, 'bytes de la OC del cliente');
      }
      return j.url ? 'subida y descargada idéntica' : 'subida';
    });

    await R.check('POST tallas-confirmar corre y genera la relación de tallas', async () => {
      const r = await q.api('POST', `/proyectos/${estado.proyId}/tallas-confirmar`, {});
      const j = ok(r, 'tallas-confirmar');
      verdad(j.ok === true, JSON.stringify(j).slice(0, 400));
      return JSON.stringify(j).slice(0, 140);
    });
  }

  // ── 11. OC a proveedor ──────────────────────────────────────────────────────
  if (estado.proyId) {
    R.seccion('11. Orden de compra a proveedor');

    await R.check('POST generar-oc corre y devuelve una OC por proveedor con monto', async () => {
      const r = await q.api('POST', `/proyectos/${estado.proyId}/generar-oc`,
        { metodoPago: 'Transferencia', condPago: '30 días' });
      const j = ok(r, 'generar-oc');
      verdad(j.ok === true, JSON.stringify(j).slice(0, 500));
      const ordenes = j.ordenes ?? [];
      verdad(ordenes.length > 0, `no devolvió ninguna orden: ${JSON.stringify(j).slice(0, 300)}`);
      for (const o of ordenes) {
        verdad(o.proveedorNombre, `una orden salió sin nombre de proveedor: ${JSON.stringify(o)}`);
        verdad(!/^\d+$/.test(String(o.proveedorNombre)), `el proveedor salió como id: "${o.proveedorNombre}"`);
        mayorQue(Number(o.monto), 0, `monto de la OC de ${o.proveedorNombre}`);
        verdad(o.folioOrden, `la OC de ${o.proveedorNombre} salió sin folio`);
      }
      estado.ordenes = ordenes;
      return ordenes.map(o => `${o.proveedorNombre} ${o.folioOrden} $${o.monto}`).join(' · ').slice(0, 170);
    });

    await R.check('el PDF de la OC trae el NOMBRE del proveedor (no su id) y no sale en $0', async () => {
      const orden = (estado.ordenes ?? [])[0];
      verdad(orden, 'generar-oc no dejó ninguna orden de la cual sacar el proveedor');
      const provId = String(orden.proveedorId);
      const provNombre = String(orden.proveedorNombre);
      const r = await q.bin(`/proyectos/${estado.proyId}/oc-nativa/${provId}/pdf`);
      verdad(r.status === 200, `HTTP ${r.status} — ${new TextDecoder().decode(r.bytes.slice(0, 200))}`);
      const { texto, paginas } = await textoPdf(r.bytes);
      const t = plano(texto);
      noContiene(t, provId, 'el id numérico del proveedor NO debe salir impreso');
      contiene(t.toUpperCase(), plano(provNombre).slice(0, 8).toUpperCase(), 'nombre del proveedor');
      verdad(!/\$\s*0\.00\s*$/.test(t.trim()), 'la OC parece salir en $0.00');
      mayorQue(t.length, 120, 'texto de la OC');
      return `${paginas} pág · proveedor "${provNombre.slice(0, 24)}"`;
    });
  }

  // ── 12. Logística ───────────────────────────────────────────────────────────
  if (estado.proyId) {
    R.seccion('12. Logística');

    await R.check('capturar recolección / guía / comentarios y releerlos', async () => {
      const det = await q.item('proyectos', estado.proyId);
      const hijos = hijosDe(det.children ?? [], estado.proyId, 'líneas del Proyecto');
      const s = hijos[0].id;
      const vals = { [LOG.recoleccion]: 'REC-QA-1', [LOG.guiaCliente]: 'GUIA-QA-CLIENTE', [LOG.comentarios]: 'Captura del QA de producción' };
      ok(await q.api('PATCH', `/boards/proyectos_sub/items/${s}`, { cols: vals }), 'capturar logística');
      const l = await hasta(async () => {
        const x = await q.item('proyectos_sub', s);
        eq(txt(x, LOG.recoleccion), vals[LOG.recoleccion], '# Recolección');
        return x;
      });
      eq(txt(l, LOG.guiaCliente), vals[LOG.guiaCliente], '# Guía cliente');
      eq(txt(l, LOG.comentarios), vals[LOG.comentarios], 'Comentarios');
      estado.lineaProyecto = s;
      return `línea ${s}`;
    });

    await R.check('subir la guía de la empresa y descargarla byte por byte', async () => {
      verdad(estado.lineaProyecto, 'no hay línea de proyecto donde subirla');
      const pdf = pdfMinimo('guia empresa QA');
      const g = await q.subir(`/proyectos_sub/${estado.lineaProyecto}/logistica/guia-empresa`, 'guia-qa.pdf', pdf);
      const j = ok(g, 'subir guía');
      verdad(j.ok === true, JSON.stringify(j).slice(0, 200));
      verdad(j.url, 'la guía se subió sin devolver url');
      const back = await q.bin(j.url);
      verdad(back.status === 200, `descargar la guía: HTTP ${back.status}`);
      eq(back.bytes.byteLength, pdf.byteLength, 'bytes de la guía');
      return `${back.bytes.byteLength} bytes idénticos`;
    });
  }

  return estado;
}
