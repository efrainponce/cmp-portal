// scripts/qa/blindaje.mjs — permisos por rol y rechazos, probados EN VIVO
// suplantando identidades reales del portal (`X-Impersonate-Email`,
// worker/mw/identity.ts). Todo aquí es de lectura, salvo escrituras que DEBEN
// ser rechazadas: si una pasa, el hallazgo es justamente ese.
//
// Por qué en producción y no solo en `shared/visibility.test.ts`: el unit test
// prueba la whitelist; esto prueba que el server la APLICA sobre los datos
// reales, con las identidades reales, en el código desplegado. Las dos veces
// que se escapó algo (Precio de Venta escribible por vendedor, el `name` del
// item viajando con `cols` vacío) el unit test estaba verde.
import { Falla, verdad, eq, rechaza, ok, txt, mayorQue } from './lib.mjs';

// Columnas que Ventas NUNCA debe ver (regla dura 2026-07-30: cero costos y
// cero proveedores). Ids de docs/monday-column-map.md.
const PROHIBIDAS_VENTAS = {
  'numeric_mm0bph99': 'Costo Distr. C/U',
  'lookup_mm5ck4b3': 'Costo (auto)',
  'formula_mkzngnjm': 'Costo real',
  'formula_mkznpfgg': 'Costo total unitario',
  'formula_mkznrm5a': 'Costo total',
  'numeric_mkzn2q51': 'Descuento %',
  'lookup_mm1ck0mr': 'Proveedor (nombre)',
  'lookup_mm1cs054': 'Proveedor (id)',
};

/** Elige una identidad real por rol; falla claro si el portal ya no la tiene. */
function elegir(ids, role, excluirEmails = []) {
  const c = ids.find(i => i.role === role && i.active !== false && !excluirEmails.includes(i.email));
  if (!c) throw new Falla(`no hay identidad activa con rol "${role}" en el portal`);
  return c;
}

export async function suiteBlindaje(R, q, estado = {}) {
  R.seccion('Roles: quién es quién (suplantación real, no simulada)');

  let ids = [];
  let vendedor = null, compras = null, adminAjeno = null;

  await R.check('el portal lista identidades reales para cada rol', async () => {
    ids = await q.identidades();
    mayorQue(ids.length, 5, 'identidades');
    vendedor = elegir(ids, 'vendedor');
    compras = elegir(ids, 'compras');
    // Un admin que NO es de la whitelist de la Zona Efrain (worker/lib/zonas.ts):
    // "admin ve todo" tiene exactamente esta excepción.
    adminAjeno = ids.find(i => i.role === 'admin' && i.active !== false
      && !/efrain|administracion/i.test(i.email)) ?? null;
    return `vendedor=${vendedor.email} · compras=${compras.email} · admin ajeno=${adminAjeno?.email ?? '(ninguno)'}`;
  });
  if (!vendedor || !compras) return;

  for (const [rol, ident] of [['vendedor', vendedor], ['compras', compras]]) {
    await R.check(`suplantar a ${rol} devuelve SU identidad, no la mía`, async () => {
      const j = ok(await q.como(ident.email).api('GET', '/me'), '/me');
      eq(j.email, ident.email, 'correo');
      eq(j.role, rol, 'rol');
      verdad(j.impersonatedBy?.email, 'el portal no marcó la sesión como suplantada');
      verdad(j.zonaEfrainAccess === false, `${rol} no debería ver la Zona Efrain`);
      return `${j.nombre} · zonaEfrain=${j.zonaEfrainAccess}`;
    });
  }

  // ── Whitelist por columna, tal como el server la publica ────────────────────
  R.seccion('Permisos por columna (lo que el server declara escribible)');

  const metaDe = async (cli, slug) => {
    const j = (await cli.api('GET', '/boards')).json;
    const arr = Array.isArray(j) ? j : (j.boards ?? Object.values(j));
    const b = arr.find(x => x.slug === slug);
    verdad(b, `el board ${slug} no aparece en /api/boards`);
    return new Map(b.cols.map(c => [c.id, c]));
  };

  await R.check('Precio de Venta C/U: solo admin lo escribe (vendedor y compras solo lo ven)', async () => {
    const yo = await metaDe(q, 'oportunidades_sub');
    const v = await metaDe(q.como(vendedor.email), 'oportunidades_sub');
    const c = await metaDe(q.como(compras.email), 'oportunidades_sub');
    verdad(yo.get('numeric_mkzneg3d')?.w === true, 'admin debería poder escribir el Precio de Venta');
    verdad(v.get('numeric_mkzneg3d'), 'el vendedor debe VER el precio (cotiza al cliente)');
    verdad(v.get('numeric_mkzneg3d')?.w !== true, 'el vendedor NO debe poder escribir el Precio de Venta');
    verdad(c.get('numeric_mkzneg3d'), 'compras debe VER el precio');
    verdad(c.get('numeric_mkzneg3d')?.w !== true, 'compras NO debe poder escribir el Precio de Venta');
    return 'admin=escribe · vendedor=lee · compras=lee';
  });

  await R.check('Ventas no recibe ni una columna de costo o proveedor en el meta del board', async () => {
    const v = await metaDe(q.como(vendedor.email), 'oportunidades_sub');
    const filtradas = Object.entries(PROHIBIDAS_VENTAS).filter(([id]) => v.has(id));
    if (filtradas.length) throw new Falla(`el vendedor recibe ${filtradas.map(([id, t]) => `${t} (${id})`).join(', ')}`);
    return `${Object.keys(PROHIBIDAS_VENTAS).length} columnas correctamente ausentes`;
  });

  await R.check('Ventas tampoco las recibe en los DATOS reales del board', async () => {
    const cli = q.como(vendedor.email);
    const j = ok(await cli.api('GET', '/boards/oportunidades_sub/items'), 'líneas como vendedor');
    const items = j.items ?? [];
    mayorQue(items.length, 0, 'líneas visibles para el vendedor');
    const fugas = new Map();
    for (const it of items) {
      for (const id of Object.keys(it.cols ?? {})) {
        if (PROHIBIDAS_VENTAS[id]) fugas.set(id, (fugas.get(id) ?? 0) + 1);
      }
    }
    if (fugas.size) {
      throw new Falla('se filtraron: ' + [...fugas.entries()]
        .map(([id, n]) => `${PROHIBIDAS_VENTAS[id]} en ${n} líneas`).join(' · '));
    }
    return `${items.length} líneas revisadas, sin fugas`;
  });

  await R.check('el board Proveedores no le llega a Ventas', async () => {
    const r = await q.como(vendedor.email).api('GET', '/boards/proveedores/items');
    if (r.status === 200) {
      const n = r.json?.items?.length ?? 0;
      verdad(n === 0, `el vendedor recibió ${n} proveedores con datos`);
      return 'responde 200 pero vacío';
    }
    verdad(r.status === 403 || r.status === 404, `esperaba 403/404 y llegó ${r.status}`);
    return `HTTP ${r.status}`;
  });

  // ── Zona privada ────────────────────────────────────────────────────────────
  if (estado.oppId) {
    R.seccion('Zona Efrain: privada de verdad, no solo escondida del menú');

    const ajenos = [['vendedor', vendedor], ['compras', compras]];
    if (adminAjeno) ajenos.push(['admin fuera de la whitelist', adminAjeno]);

    for (const [rol, ident] of ajenos) {
      await R.check(`${rol} (${ident.email.split('@')[0]}) NO puede leer la oportunidad de la zona`, async () => {
        const r = await q.como(ident.email).api('GET', `/boards/oportunidades/items/${estado.oppId}`);
        verdad(r.status === 404 || r.status === 403,
          `esperaba 404/403 y llegó ${r.status} — ${JSON.stringify(r.json).slice(0, 200)}`);
        return `HTTP ${r.status}`;
      });
    }

    await R.check('la oportunidad de la zona tampoco sale en la LISTA de un ajeno', async () => {
      const j = ok(await q.como(vendedor.email).api('GET', '/boards/oportunidades/items'), 'lista como vendedor');
      const mia = (j.items ?? []).find(i => String(i.id) === String(estado.oppId));
      verdad(!mia, `la oportunidad ${estado.oppId} aparece entre las ${j.items.length} del vendedor`);
      return `${j.items.length} oportunidades, ninguna de la zona`;
    });

    await R.check('un ajeno tampoco puede ESCRIBIR en la zona (y nada cambia)', async () => {
      verdad(estado.lineas?.length, 'no hay línea del QA sobre la cual probar');
      const linea = estado.lineas[0];
      const antes = await q.item('oportunidades_sub', linea.lineaId);
      const precioAntes = txt(antes, 'numeric_mkzneg3d');
      const r = await q.como(vendedor.email).api('PATCH', `/boards/oportunidades_sub/items/${linea.lineaId}`,
        { cols: { numeric_mkzneg3d: '1' } });
      verdad(r.status >= 400, `la escritura ajena devolvió ${r.status} — debía rechazarse`);
      const despues = await q.item('oportunidades_sub', linea.lineaId);
      eq(txt(despues, 'numeric_mkzneg3d'), precioAntes, 'el precio tras el intento ajeno');
      return `HTTP ${r.status} · precio intacto (${precioAntes})`;
    });
  }

  // ── Gates de rol en los endpoints de flujo ──────────────────────────────────
  R.seccion('Gates de rol en los endpoints (no solo botones deshabilitados)');

  const idPrueba = estado.oppId ?? '900000000000';
  const gates = [
    ['vendedor no puede mandar a validación', vendedor, 'POST', `/oportunidades/${idPrueba}/enviar-validacion`, 403],
    ['vendedor no puede validar el costeo', vendedor, 'POST', `/oportunidades/${idPrueba}/validar-costeo`, 403],
    ['compras no puede validar el costeo (es de Dirección)', compras, 'POST', `/oportunidades/${idPrueba}/validar-costeo`, 403],
  ];
  for (const [nombre, ident, metodo, ruta, esperado] of gates) {
    await R.check(nombre, async () => {
      const r = await q.como(ident.email).api(metodo, ruta, {});
      rechaza(r, esperado, nombre);
      return `HTTP ${r.status}`;
    });
  }

  if (estado.proyId) {
    await R.check('vendedor no puede bajar el PDF de la OC a proveedor', async () => {
      const r = await q.como(vendedor.email).bin(`/proyectos/${estado.proyId}/oc-nativa/1/pdf`);
      verdad(r.status === 403 || r.status === 404, `esperaba 403/404 y llegó ${r.status}`);
      return `HTTP ${r.status}`;
    });
  }

  // ── Rechazos del write path ─────────────────────────────────────────────────
  R.seccion('El write path rechaza lo que no entiende');

  await R.check('un filtro que la ruta no conoce se rechaza (no degrada a "sin filtro")', async () => {
    const rutas = ['/boards/oportunidades/items?parent=123', '/boards/oportunidades_sub/items?parentId=1', '/boards/proyectos/items?estado=x'];
    const malas = [];
    for (const ruta of rutas) {
      const r = await q.api('GET', ruta);
      if (r.status !== 400) malas.push(`${ruta} → ${r.status}`);
    }
    if (malas.length) throw new Falla(`estas devolvieron el board completo en vez de 400: ${malas.join(' · ')}`);
    return `${rutas.length} rutas devuelven 400`;
  });

  if (estado.lineas?.length) {
    const linea = estado.lineas[0].lineaId;

    await R.check('una etiqueta de status inventada se rechaza (Monday asignaría una al azar)', async () => {
      const antes = txt(await q.item('oportunidades_sub', linea), 'color_mm084gvf');
      const r = await q.api('PATCH', `/boards/oportunidades_sub/items/${linea}`,
        { cols: { color_mm084gvf: 'Etiqueta Que No Existe QA' } });
      if (r.status === 200) {
        const despues = txt(await q.item('oportunidades_sub', linea), 'color_mm084gvf');
        throw new Falla(`aceptó la etiqueta inventada (200) y dejó el status en "${despues}" (antes "${antes}")`);
      }
      verdad(r.status >= 400, `esperaba rechazo y llegó ${r.status}`);
      const despues = txt(await q.item('oportunidades_sub', linea), 'color_mm084gvf');
      eq(despues, antes, 'el status tras el rechazo');
      return `HTTP ${r.status} · status intacto ("${antes}")`;
    });

    await R.check('una columna de FÓRMULA no se puede escribir', async () => {
      const r = await q.api('PATCH', `/boards/oportunidades_sub/items/${linea}`,
        { cols: { formula_mkznrm5a: '999999' } });
      verdad(r.status >= 400, `esperaba rechazo y llegó ${r.status} — ${JSON.stringify(r.json).slice(0, 160)}`);
      return `HTTP ${r.status}`;
    });

    await R.check('una columna que no existe se rechaza', async () => {
      const r = await q.api('PATCH', `/boards/oportunidades_sub/items/${linea}`,
        { cols: { text_columna_inventada_qa: 'x' } });
      verdad(r.status >= 400, `esperaba rechazo y llegó ${r.status}`);
      return `HTTP ${r.status}`;
    });
  }

  R.omitido('el portal no borra en Monday',
    'probarlo en vivo exigiría un DELETE contra un item REAL; queda anclado en worker/lib/monday.destructivo.test.ts, que corre en CI antes de cada deploy');
}
