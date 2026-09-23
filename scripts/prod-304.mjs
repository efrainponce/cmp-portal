#!/usr/bin/env node
// scripts/prod-304.mjs — ¿cada endpoint que el portal poletea contesta 304 de
// verdad cuando se le devuelve su ETag? (2026-09-23). Un endpoint que siempre
// contesta 200 hace que cada tick de 5 s vuelva a bajar el cuerpo entero —
// invisible en local, carísimo en la red de Mérida. Pide cada ruta dos veces:
// la segunda con If-None-Match = el ETag de la primera, y debe salir 304.
//
//   node scripts/prod-304.mjs                          # rutas polleadas por defecto
//   node scripts/prod-304.mjs /api/home /api/oc-lista  # solo éstas
//
// Por defecto también prueba el detalle de un proyecto y de una oportunidad
// (toma el primer id de cada lista). Misma sesión que prod-waterfall.mjs:
// perfil de Chrome con Access iniciado (`node scripts/prod-login.mjs`;
// PROD_PROFILE para apuntar a otro, p. ej. desde un worktree). Solo GET.
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PERFIL = process.env.PROD_PROFILE ?? join(HERE, '.prod-profile');
const PROD = process.env.PROD_BASE ?? 'https://portal.mexicanadeproteccion.com';

const POR_DEFECTO = [
  // `cols=name`: la lista completa de Oportunidades sin `cols` pesa >3 MB y
  // aquí solo interesa si contesta 304.
  '/api/boards/proyectos/items?cols=name',
  '/api/boards/oportunidades/items?cols=name',
  '/api/notifications',
  '/api/anuncios',
  '/api/home',
  '/api/oc-lista',
  '/api/proyectos-filtros',
];

if (!existsSync(PERFIL)) {
  console.error(`No existe el perfil ${PERFIL}. Corre \`node scripts/prod-login.mjs\` (o define PROD_PROFILE).`);
  process.exit(1);
}

const ctx = await chromium.launchPersistentContext(PERFIL, { headless: true, channel: 'chrome' });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(`${PROD}/api/me`);
if (page.url().includes('cloudflareaccess.com')) {
  console.error('La sesión de Access expiró: corre `node scripts/prod-login.mjs` otra vez.');
  await ctx.close();
  process.exit(1);
}

const rutas = process.argv.slice(2).filter(a => a.startsWith('/'));
const lista = rutas.length ? rutas : POR_DEFECTO;
const filas = await page.evaluate(async ({ lista, conDetalle }) => {
  const out = [];
  // `cache: 'no-store'`: que la caché HTTP del navegador no conteste por el
  // servidor — se quiere ver lo que dice el WORKER.
  const probar = async (u) => {
    const a = await fetch(u, { cache: 'no-store' });
    const etag = a.headers.get('etag');
    const cuerpo = await a.text();
    const b = await fetch(u, { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
    out.push({ ruta: u.replace(/\/\d{6,}/g, '/:id'), primera: a.status, etag: etag ? etag.slice(0, 18) : '(sin ETag)', segunda: b.status, kb: +(cuerpo.length / 1024).toFixed(1), ok: b.status === 304 ? '✓' : '✗' });
    return cuerpo;
  };
  for (const u of lista) {
    const cuerpo = await probar(u);
    const m = conDetalle && u.match(/^\/api\/boards\/(proyectos|oportunidades)\/items(\?|$)/);
    if (m) {
      try {
        const id = JSON.parse(cuerpo).items?.[0]?.id;
        if (id) await probar(`/api/boards/${m[1]}/items/${id}`);
      } catch { /* lista ilegible: ya quedó su renglón */ }
    }
  }
  return out;
}, { lista, conDetalle: rutas.length === 0 });

console.table(filas);
const malos = filas.filter(f => f.segunda !== 304);
console.log(malos.length ? `✗ ${malos.length} ruta(s) sin 304: cada tick vuelve a bajar el cuerpo entero.` : '✓ todas contestan 304 con su ETag.');
await ctx.close();
