// scripts/fetch-fonts.mjs — baja Inter + JetBrains Mono de Google Fonts a
// public/fonts/ y genera src/tokens/fonts.css con los @font-face locales.
//
// Por qué self-host: el @import a fonts.googleapis.com dentro de un CSS es el
// peor caso de carga — bloquea el render y es SERIAL (bajar index.css →
// parsear → descubrir el @import → DNS+TLS a fonts.googleapis.com → parsear →
// DNS+TLS a fonts.gstatic.com → recién ahí los woff2). Son dos handshakes a
// orígenes ajenos antes de poder pintar texto, y en una conexión mala eso se
// siente. Sirviéndolas del mismo origen que el resto del portal, viajan por la
// conexión que YA está abierta.
//
// Solo se baja el subset `latin` (U+0000-00FF...): cubre español completo
// (á é í ó ú ü ñ ¿ ¡) y evita bajar cirílico/griego/vietnamita que nadie usa.
// Solo los pesos que el código realmente usa — ver la constante FAMILIES.
//
//   node scripts/fetch-fonts.mjs
//
// Correr solo si cambian los pesos usados; los .woff2 se commitean.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(HERE, '..');
const DIR_FUENTES = join(RAIZ, 'public', 'fonts');
const CSS_SALIDA = join(RAIZ, 'src', 'tokens', 'fonts.css');

// Pesos en uso, contados sobre src/ (font:/fontWeight/tokens de typography.css).
// Si agregas un peso nuevo en el código, agrégalo aquí y vuelve a correr esto,
// si no el navegador lo sintetiza (falso bold) y se ve distinto.
// Ambas son fuentes VARIABLES en Google Fonts: para todos los pesos sirve el
// MISMO archivo (comprobado, mismo md5 para 400/600/700/800). Por eso se baja
// una sola vez por familia y el @font-face declara el rango completo con
// `font-weight: min max` — el navegador interpola el peso que le pidas. Bajar
// un archivo por peso serían 189 KB de Inter en vez de 47 KB, cuatro veces el
// mismo byte por byte.
const FAMILIES = [
  { nombre: 'Inter', archivo: 'inter', pesos: [400, 600, 700, 800] },
  { nombre: 'JetBrains Mono', archivo: 'jetbrains-mono', pesos: [500] },
];

// UA de Chrome: sin esto Google devuelve ttf en vez de woff2 (mucho más pesado).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// El subset latin es el bloque cuyo unicode-range arranca en U+0000-00FF.
const ES_LATIN = /U\+0000-00FF/;

async function main() {
  mkdirSync(DIR_FUENTES, { recursive: true });
  const bloques = [];

  for (const fam of FAMILIES) {
    const query = `${fam.nombre.replace(/ /g, '+')}:wght@${fam.pesos.join(';')}`;
    const url = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
    const css = await fetch(url, { headers: { 'User-Agent': UA } }).then(r => {
      if (!r.ok) throw new Error(`Google Fonts respondió ${r.status} para ${fam.nombre}`);
      return r.text();
    });

    // Cada @font-face trae su propio unicode-range; nos quedamos con el latin.
    const faces = css.split('@font-face').slice(1);
    const latinFaces = faces.filter(f => ES_LATIN.test(f));
    if (!latinFaces.length) throw new Error(`No encontré el subset latin de ${fam.nombre}`);

    // Todos los pesos apuntan al mismo woff2 cuando la familia es variable;
    // Set deduplica para no bajar (ni commitear) el mismo archivo N veces.
    const urls = [...new Set(latinFaces.map(f => f.match(/src:\s*url\(([^)]+)\)/)?.[1]).filter(Boolean))];
    if (urls.length !== 1) {
      throw new Error(
        `${fam.nombre}: esperaba un solo archivo latin (fuente variable) y hay ${urls.length}. ` +
        `Google cambió el formato — revisa el script antes de confiar en el resultado.`,
      );
    }
    const rango = latinFaces[0].match(/unicode-range:\s*([^;]+);/)?.[1].trim();

    const nombreArchivo = `${fam.archivo}.woff2`;
    const bytes = Buffer.from(await fetch(urls[0]).then(r => r.arrayBuffer()));
    writeFileSync(join(DIR_FUENTES, nombreArchivo), bytes);
    const min = Math.min(...fam.pesos);
    const max = Math.max(...fam.pesos);
    console.log(`  ${nombreArchivo.padEnd(24)} ${(bytes.length / 1024).toFixed(1)} KB  (pesos ${min}–${max})`);

    bloques.push(
      `@font-face {\n` +
      `  font-family: '${fam.nombre}';\n` +
      `  font-style: normal;\n` +
      // Rango, no un peso fijo: es una fuente variable, un solo archivo cubre
      // todos los pesos que usamos.
      `  font-weight: ${min} ${max};\n` +
      // swap: el texto se pinta YA con la fuente de sistema y cambia cuando
      // llega el woff2. Nunca se queda en blanco esperando la fuente.
      `  font-display: swap;\n` +
      `  src: url('/fonts/${nombreArchivo}') format('woff2');\n` +
      (rango ? `  unicode-range: ${rango};\n` : '') +
      `}`,
    );
  }

  const encabezado =
    `/* GENERADO por scripts/fetch-fonts.mjs — no editar a mano.\n` +
    ` *\n` +
    ` * Fuentes servidas desde nuestro propio origen (public/fonts/) en vez de\n` +
    ` * fonts.googleapis.com: quita dos handshakes a orígenes ajenos del camino\n` +
    ` * crítico del primer render. Solo subset latin y solo los pesos en uso.\n` +
    ` * Para cambiar pesos, edita FAMILIES en el script y vuelve a correrlo. */\n\n`;
  writeFileSync(CSS_SALIDA, encabezado + bloques.join('\n\n') + '\n');
  console.log(`\n→ ${bloques.length} @font-face en src/tokens/fonts.css`);
}

await main();
