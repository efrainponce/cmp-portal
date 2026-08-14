// La precarga de index.html duplica, en JS plano, la lista de columnas que
// pide la lista de Oportunidades (LIST_COLS en StageBoardList.tsx). No puede
// importarla: es un <script> inline que corre ANTES del bundle, que es
// justamente lo que le da la ventaja. Este test es el que impide que las dos
// copias se separen sin que nadie se entere — si se separan, la precarga pide
// una URL distinta a la que pide la app, nunca coincide, y la optimización se
// apaga en silencio (nada falla, solo vuelve a estar lento).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { queryLista } from './api';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..', '..');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
const stageBoardList = readFileSync(
  join(RAIZ, 'src', 'boards', 'oportunidades', 'StageBoardList.tsx'), 'utf8');

/** Las columnas que declara StageBoardList, resolviendo las constantes. */
function colsDelComponente(): string[] {
  const bloque = stageBoardList.match(/const LIST_COLS = \[([\s\S]*?)\] as const;/);
  if (!bloque) throw new Error('no encontré LIST_COLS en StageBoardList.tsx');
  const nombres = bloque[1].split(',').map(s => s.trim()).filter(Boolean);
  return nombres.map((nombre) => {
    const def = stageBoardList.match(new RegExp(`const ${nombre} = '([^']+)'`));
    if (!def) throw new Error(`no pude resolver la constante ${nombre}`);
    return def[1];
  });
}

/** Las columnas que arma el script inline de index.html. */
function colsDelHtml(): string[] {
  const bloque = html.match(/var COLS = ([\s\S]*?);\n/);
  if (!bloque) throw new Error('no encontré COLS en index.html');
  const partes = [...bloque[1].matchAll(/'([^']*)'/g)].map(m => m[1]);
  return partes.join('').split(',').map(s => s.trim()).filter(Boolean);
}

describe('precarga de index.html', () => {
  it('pide exactamente las columnas que pinta la lista', () => {
    // Mismo conjunto Y mismo orden: la URL entra en el ETag del worker
    // (etagFor recibe el `cols` crudo), así que un orden distinto es otra
    // llave y la precarga no serviría de nada.
    expect(colsDelHtml()).toEqual(colsDelComponente());
  });

  it('arma LA MISMA URL que la app, carácter por carácter', () => {
    // El test de columnas por sí solo no basta: con URLSearchParams la app
    // escapaba las comas a %2C y la URL dejaba de coincidir aunque las
    // columnas fueran idénticas. Resultado real: la lista se bajaba dos veces
    // y la "optimización" salía peor que no hacer nada. Esto compara la URL
    // completa contra la que de verdad construye usePoll.
    const urlApp = '/api/boards/oportunidades/items'
      + queryLista('', colsDelComponente().join(','));
    const urlHtml = '/api/boards/oportunidades/items?cols=' + colsDelHtml().join(',');
    expect(urlApp).toBe(urlHtml);
    expect(urlApp).not.toContain('%2C');
  });

  it('precarga /api/me y /api/boards', () => {
    expect(html).toContain("pedir('/api/me')");
    expect(html).toContain("pedir('/api/boards')");
  });

  it('no precarga nada si hay suplantación activa', () => {
    // La precarga no puede mandar X-Impersonate-Email; si se usara bajo "ver
    // como", el admin vería SU propia data creyendo que es la del suplantado.
    expect(html).toContain("localStorage.getItem('cmp:impersonateEmail')");
  });

  it('en un deep link precarga el detalle, no la lista', () => {
    // Con /oportunidades/123 el wrapper no monta la lista, así que precargarla
    // sería tirar ~65 KB por el caño.
    expect(html).toMatch(/if \(itemId\)[\s\S]*items\/' \+ encodeURIComponent\(itemId\)/);
  });
});
