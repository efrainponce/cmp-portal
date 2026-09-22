// Pegado desde Excel en la captura de tallas por boxes (TallaCapture.tsx).
// Salida de Monday / del Google Sheet (2026-09-21): lo que el Sheet daba gratis
// y los boxes no era pegar un bloque copiado de Excel. Lógica pura, sin DOM.
//
// Tres formas de bloque, las que salen de copiar un desglose real:
//  1. Una fila de cantidades        → se reparten hacia la derecha desde la
//                                      cajita donde se pegó.
//  2. Encabezado de tallas + fila   → cada cantidad va a la talla de su columna.
//  3. Dos columnas talla | cantidad → una talla por renglón.
// Una sola celda NO es un bloque: devuelve null y el navegador pega normal.

const esNumero = (s: string) => /^\d+([.,]\d+)?$/.test(s.trim());
const entero = (s: string) => String(Math.max(0, Math.round(Number(s.trim().replace(',', '.')) || 0)));

/** La talla tal como ya existe en la tarjeta si coincide sin distinguir
 * mayúsculas ("xl" → "XL"); si no, el texto pegado en mayúsculas. */
function tallaCanonica(raw: string, existentes: string[]): string {
  const t = raw.trim().toUpperCase();
  return existentes.find(e => e.toUpperCase() === t) ?? t;
}

export function parsePegadoTallas(
  texto: string, tallas: string[], desde: number,
): Record<string, string> | null {
  const filas = texto.replace(/\r/g, '').split('\n')
    .map(l => l.split('\t').map(c => c.trim()))
    .filter(f => f.some(c => c !== ''));
  if (filas.length === 0) return null;
  if (filas.length === 1 && filas[0].length === 1) return null;

  const out: Record<string, string> = {};

  // 3. talla | cantidad por renglón
  if (filas.every(f => f.length >= 2 && f[0] !== '' && !esNumero(f[0]) && (f[1] === '' || esNumero(f[1])))) {
    for (const [talla, cantidad] of filas) if (cantidad !== '') out[tallaCanonica(talla, tallas)] = entero(cantidad);
    return Object.keys(out).length ? out : null;
  }

  // 2. encabezado + cantidades
  if (filas.length === 2 && filas[0].every(c => c === '' || !esNumero(c)) && filas[1].every(c => c === '' || esNumero(c))) {
    filas[0].forEach((talla, i) => {
      const cantidad = filas[1][i] ?? '';
      if (talla !== '' && cantidad !== '') out[tallaCanonica(talla, tallas)] = entero(cantidad);
    });
    return Object.keys(out).length ? out : null;
  }

  // 1. fila de cantidades, posicional
  if (filas.length === 1 && filas[0].every(c => c === '' || esNumero(c))) {
    filas[0].forEach((cantidad, i) => {
      const talla = tallas[desde + i];
      if (talla !== undefined && cantidad !== '') out[talla] = entero(cantidad);
    });
    return Object.keys(out).length ? out : null;
  }

  return null;
}
