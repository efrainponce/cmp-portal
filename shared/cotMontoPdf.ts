// shared/cotMontoPdf.ts — saca Fecha / Subtotal / IVA / Total del TEXTO del PDF
// de una cotización al cliente (Lista de cotizaciones, 2026-09-24).
//
// Es el PDF de Eledo que genera cmp-tallas. Como en la Lista de OC, el monto
// sale del PAPEL y no de las líneas: la oportunidad solo guarda la cotización
// vigente, y cada versión anterior (1109 - 1, 1109 - 2…) dice su propio monto.
//
// El bloque de totales va al final: "Subtotal: | IVA: | Total: | $a | $b | $c".
// Se autoverifica igual que la OC: si subtotal + IVA no da el total, nada.
// Sin dependencias a propósito: scripts/cot-lista-backfill.mjs lo importa
// directo con Node (type stripping), sin bundler.

export interface CotMontoPdf { subtotal: number; iva: number; total: number; moneda: string | null }

const IMPORTE = /\$\s*(-?[\d,]+(?:\.\d+)?)/g;

/** Tolerancia de 2 centavos por redondeo (misma regla que shared/ocMontoPdf.ts). */
export function cotMontoCuadra(subtotal: number, iva: number, total: number): boolean {
  return Math.abs(subtotal + iva - total) <= 0.02;
}

/** `texto` = los fragmentos del PDF unidos con " | " en orden de lectura. Pura. */
export function montoDeTextoCot(texto: string): CotMontoPdf | null {
  const i = texto.search(/SUBTOTAL:?[\s|]*IVA/i);
  if (i < 0) return null;
  const nums: number[] = [];
  const re = new RegExp(IMPORTE.source, 'g');
  const cola = texto.slice(i);
  let m: RegExpExecArray | null;
  while (nums.length < 3 && (m = re.exec(cola)) !== null) nums.push(Number(m[1].replace(/,/g, '')));
  if (nums.length < 3 || nums.some(n => !Number.isFinite(n))) return null;
  const [subtotal, iva, total] = nums;
  if (!cotMontoCuadra(subtotal, iva, total)) return null;
  return { subtotal, iva, total, moneda: monedaDeTextoCot(texto) };
}

/** La moneda sale del importe en letras ("… PESOS 00/100 M.N." / "… DÓLARES
 * 00/100 USD"). null si el PDF no lo trae. Pura. */
export function monedaDeTextoCot(texto: string): string | null {
  // Con los dos puntos: "Son" a secas empata con "Sonora" en el nombre del cliente.
  const letras = /\bSon:[\s|]*([^|]+)/i.exec(texto)?.[1] ?? '';
  const t = letras.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/\bDOLAR(ES)?\b|\bUSD\b/.test(t)) return 'USD';
  if (/\bEUROS?\b/.test(t)) return 'EUR';
  if (/\bPESOS?\b|\bM\.?\s?N\.?\b/.test(t)) return 'MXN';
  return null;
}

/** "Fecha: | 24-09-2026" (dd-mm-aaaa) como aaaa-mm-dd. null si no aparece o no
 * es una fecha de verdad. Pura. */
export function fechaDeTextoCot(texto: string): string | null {
  const m = /\bFECHA:?[\s|]*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i.exec(texto);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return cotFechaValida(iso) ? iso : null;
}

/** aaaa-mm-dd que existe en el calendario y no es un disparate. */
export function cotFechaValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso >= '2020-01-01';
}
