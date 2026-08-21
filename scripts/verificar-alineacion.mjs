// scripts/verificar-alineacion.mjs — ¿los números de la lista caen justo debajo
// de su título de columna? Se mide, no se ve a ojo: el encabezado de métricas
// (TotalesCells.tsx) vive FUERA de las GroupCards y tiene que copiar a mano su
// geometría (margen 24 + borde 1 + padding 18) y los gaps del renglón. Cada vez
// que eso se desincronizó, las columnas salieron corridas y el bug se reportó
// desde producción con una captura (2026-08-20, dos veces).
//
//   npm run dev  (y el worker en :8787)
//   node scripts/verificar-alineacion.mjs [ruta]      # default /validacion
//
// Sale con código 1 si alguna columna no cuadra.
import { chromium } from 'playwright';

const RUTA = process.argv[2] ?? '/validacion';
const COMO = process.env.VER_COMO ?? 'efrain.ponce@mexicanadeproteccion.com';

const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { 'X-Impersonate-Email': COMO },
});
const p = await ctx.newPage();
await p.goto(`http://localhost:5173${RUTA}`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);

const ETIQUETAS = ['Costo', 'Subtotal', 'Total', 'Util. %', 'M. Gob', 'Utilidad'];
const r = await p.evaluate((ETIQUETAS) => {
  const cabeceras = [...document.querySelectorAll('[title]')].filter(e => ETIQUETAS.includes(e.textContent));
  return cabeceras.map(e => {
    const t = e.getAttribute('title');
    const celda = [...document.querySelectorAll(`[title="${t}"]`)][1];
    return {
      label: e.textContent,
      header: Math.round(e.getBoundingClientRect().right),
      celda: celda ? Math.round(celda.getBoundingClientRect().right) : null,
      texto: celda?.textContent ?? null,
    };
  });
}, ETIQUETAS);

if (r.length === 0) {
  console.log('✗ no se encontró el encabezado de métricas — ¿la lista cargó?');
  await b.close();
  process.exit(1);
}

let peor = 0;
for (const c of r) {
  const d = c.celda == null ? NaN : c.header - c.celda;
  peor = Math.max(peor, Math.abs(d) || 0);
  console.log(`  ${c.label.padEnd(9)} título=${c.header}  número=${c.celda} (${c.texto})  desfase=${d}px`);
}
console.log(peor === 0 ? '\n✓ columnas alineadas' : `\n✗ desfase máximo de ${peor}px`);
await b.close();
process.exit(peor === 0 ? 0 : 1);
