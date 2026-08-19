// scripts/qa-prod.mjs — QA agresivo contra PRODUCCIÓN.
//
//   node scripts/prod-login.mjs        (una vez: deja la sesión de Access)
//   node scripts/qa-prod.mjs           todo
//   node scripts/qa-prod.mjs --lectura solo lo que no escribe nada
//   node scripts/qa-prod.mjs --catalogo | --ciclo | --blindaje
//   node scripts/qa-prod.mjs --limpiar borra lo que dejaron las corridas
//
// El proceso que esto verifica, escrito paso por paso y por rol, está en
// docs/qa-prod.md — ese documento manda; este script es su ejecución.
//
// ESCRIBE EN PRODUCCIÓN (salvo con --lectura): crea una oportunidad y un
// proyecto NATIVOS en la Zona Efrain (existen solo en D1, Monday no se toca) y
// consume folios globales de OC, que no se pueden regresar. Todo lo que crea
// arranca con "QA PROD" y `--limpiar` lo borra.
import { abrirQA, crearReporte } from './qa/lib.mjs';
import { suiteCatalogo } from './qa/catalogo.mjs';
import { suiteCiclo, QA_PREFIJO } from './qa/ciclo.mjs';
import { suiteBlindaje } from './qa/blindaje.mjs';

const args = process.argv.slice(2);
const tiene = (f) => args.includes(f);
const soloLectura = tiene('--lectura');
const pedido = ['--catalogo', '--ciclo', '--blindaje'].filter(tiene);
const corre = (n) => (pedido.length ? pedido.includes('--' + n) : true);

const NATIVO = 900000000000;
const esQA = (n) => String(n ?? '').startsWith(QA_PREFIJO);

// ── Limpieza ──────────────────────────────────────────────────────────────────
async function limpiar(q) {
  console.log(`\nBuscando lo que dejaron corridas anteriores ("${QA_PREFIJO}…")`);
  const lista = async (slug) => ((await q.api('GET', `/boards/${slug}/items`)).json?.items ?? []);

  const opps = (await lista('oportunidades')).filter(i => Number(i.id) >= NATIVO && esQA(i.name));
  const proys = (await lista('proyectos')).filter(i => Number(i.id) >= NATIVO && esQA(i.name));
  const oppIds = new Set(opps.map(o => String(o.id)));
  const proyIds = new Set(proys.map(p => String(p.id)));
  // Filtrado LOCAL siempre: la ruta no acepta `?parent=` y un filtro ignorado
  // haría que esto barriera el board entero (2026-08-18).
  const lineas = (await lista('oportunidades_sub')).filter(i => oppIds.has(String(i.parentId)));
  const tallas = (await lista('proyectos_sub')).filter(i => proyIds.has(String(i.parentId)));

  console.log(`  ${opps.length} oportunidades · ${lineas.length} líneas · ${proys.length} proyectos · ${tallas.length} renglones de talla`);
  const ajeno = [...opps, ...proys].find(i => Number(i.id) < NATIVO);
  if (ajeno) { console.log(`  ✗ ABORTO: ${ajeno.id} no es nativo`); return 1; }
  if (!opps.length && !proys.length) { console.log('  nada que borrar'); return 0; }

  let ok = 0, mal = 0;
  for (const [slug, items] of [['oportunidades_sub', lineas], ['proyectos_sub', tallas],
                               ['oportunidades', opps], ['proyectos', proys]]) {
    for (const it of items) {
      const r = await q.api('DELETE', `/boards/${slug}/items/${it.id}`);
      if (r.status === 200) ok++;
      else { mal++; console.log(`  ✗ ${slug}/${it.id} → ${r.status} ${JSON.stringify(r.json).slice(0, 90)}`); }
    }
  }
  console.log(`  borrados ${ok} · fallidos ${mal}`);
  return mal ? 1 : 0;
}

// ── Corrida ───────────────────────────────────────────────────────────────────
const q = await abrirQA({ headless: true });
console.log(`Sesión: ${q.me.email} (${q.me.role}) · zonaEfrain=${q.me.zonaEfrainAccess}`);

if (tiene('--limpiar')) {
  const code = await limpiar(q);
  await q.ctx.close();
  process.exit(code);
}

if (q.me.role !== 'admin') {
  console.log('✗ este QA necesita una sesión admin (suplanta a los demás roles desde ahí)');
  await q.ctx.close();
  process.exit(1);
}

const R = crearReporte(`QA de producción · ${new Date().toLocaleString('es-MX')}`);
let estado = {};

try {
  if (corre('catalogo')) await suiteCatalogo(R, q);

  if (corre('ciclo')) {
    if (soloLectura) R.omitido('ciclo de vida completo', '--lectura: el ciclo escribe en producción');
    else estado = await suiteCiclo(R, q) ?? {};
  }

  if (corre('blindaje')) await suiteBlindaje(R, q, estado);
} catch (err) {
  console.log(`\n✗ la corrida se cayó: ${err?.stack ?? err}`);
  R.check('la corrida termina sin excepciones', () => { throw err; });
}

const fallas = R.resumen();

if (estado.oppId) {
  console.log(`Dejó en producción: oportunidad ${estado.oppId}` +
    (estado.proyId ? ` · proyecto ${estado.proyId}` : '') +
    `\nPara borrarlo: node scripts/qa-prod.mjs --limpiar\n`);
}

await q.ctx.close();
process.exit(fallas ? 1 : 0);
