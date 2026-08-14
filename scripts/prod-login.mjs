// scripts/prod-login.mjs — abre Chrome para iniciar sesión UNA vez contra el
// portal de producción y deja la sesión guardada en un perfil local, para poder
// correr después smoke tests contra prod (scripts/prod-smoke.mjs).
//
//   node scripts/prod-login.mjs
//
// Por qué así y no con un service token de Cloudflare Access: el worker exige
// el claim `email` del JWT (worker/mw/access.ts) y un service token no lo trae
// — pasaría Access pero el portal contestaría 401. Y darle soporte implicaría
// abrir una vía de entrada a producción que no pasa por SSO. Con esto se usa la
// identidad REAL de quien hace login, así que el portal se comporta igual que
// para esa persona (rol, zonas, permisos).
//
// OJO: scripts/.prod-profile/ queda como credencial mientras la sesión de
// Access no expire. Está en .gitignore y no debe salir de la máquina. Para
// cerrarla, borra el directorio.
//
// Usa Chrome de verdad (channel: 'chrome'), no el Chromium de Playwright:
// Google bloquea el login en navegadores que detecta como automatizados.

import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PERFIL = join(HERE, '.prod-profile');
export const PROD = process.env.PROD_BASE ?? 'https://portal.mexicanadeproteccion.com';

/** Abre el perfil persistente. `headless` solo funciona si la sesión ya existe. */
export async function abrirContexto({ headless = false } = {}) {
  return chromium.launchPersistentContext(PERFIL, {
    headless,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
  });
}

/** ¿La sesión sirve? Se pregunta al propio portal, no a Access: /api/me
 * responde 200 solo si el JWT trae email Y la identidad existe en D1. */
export async function sesionValida(page) {
  try {
    const res = await page.request.get(`${PROD}/api/me`);
    if (!res.ok()) return null;
    return await res.json();
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const yaHabia = existsSync(PERFIL);
  const ctx = await abrirContexto({ headless: false });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  console.log(yaHabia ? 'Perfil existente — revisando si la sesión sigue viva…' : 'Perfil nuevo.');
  await page.goto(PROD, { waitUntil: 'domcontentloaded' });

  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Se abrió Chrome. Inicia sesión con tu cuenta de CMP.   │');
  console.log('│  Cuando el portal cargue, esto sigue solo.              │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  // Progreso en vivo: sin esto, si el login se atora (Google bloqueando el
  // navegador automatizado, por ejemplo) solo se ve el timeout al final y no
  // queda rastro de DÓNDE se quedó.
  const limite = Date.now() + Number(process.env.LOGIN_MINUTOS ?? 20) * 60_000;
  let me = null;
  let ultimaUrl = '';
  while (Date.now() < limite) {
    me = await sesionValida(page);
    if (me) break;
    let url = '';
    try { url = page.url(); } catch { /* la página puede estar navegando */ }
    if (url && url !== ultimaUrl) {
      ultimaUrl = url;
      const donde = url.includes('cloudflareaccess') ? 'pantalla de Cloudflare Access'
        : /accounts\.google|google\.com\/signin/.test(url) ? 'login de Google'
        : url.startsWith(PROD) ? 'portal' : 'otra';
      console.log(`   [${new Date().toLocaleTimeString('es-MX')}] ${donde}: ${url.slice(0, 90)}`);
    }
    await page.waitForTimeout(3000);
  }

  if (!me) {
    console.log('✗ No se completó el login en 10 minutos. Nada quedó guardado como válido.');
    await ctx.close();
    process.exit(1);
  }

  console.log(`✓ Sesión lista: ${me.email} (${me.role})`);
  console.log(`  Guardada en ${PERFIL}`);
  console.log('  Para cerrarla: rm -rf scripts/.prod-profile');
  await ctx.close();
}
