// worker/lib/importeEnLetras.ts — monto en letras para el PDF de cotización
// (campo "TotalPalabras" de la plantilla Eledo). Puerto EXACTO de
// cmp-tallas' api/generate_cotizacion.py's `importe_en_letras` — incluye sus
// mismas rarezas gramaticales a propósito ("UN PESOS", no "UN PESO"): el
// documento legal tiene que decir lo mismo que decía antes, letra por letra.
const ONES = [
  '', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
];
const VEINTI = [
  'VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO',
  'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];
const TENS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const HUNDREDS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

function tresCifras(nIn: number): string {
  let n = nIn;
  if (n === 0) return '';
  const parts: string[] = [];
  if (n >= 100) {
    const c = Math.floor(n / 100);
    n = n % 100;
    if (c === 1 && n === 0) return 'CIEN';
    parts.push(HUNDREDS[c]);
  }
  if (n === 0) {
    // nada más que agregar
  } else if (n < 20) {
    parts.push(ONES[n]);
  } else if (n < 30) {
    parts.push(VEINTI[n - 20]);
  } else {
    const d = Math.floor(n / 10);
    const u = n % 10;
    parts.push(TENS[d] + (u ? ' Y ' + ONES[u] : ''));
  }
  return parts.filter(Boolean).join(' ');
}

function numAPalabras(nIn: number): string {
  let n = nIn;
  if (n === 0) return 'CERO';
  const parts: string[] = [];
  if (n >= 1_000_000) {
    const m = Math.floor(n / 1_000_000);
    n = n % 1_000_000;
    parts.push(m === 1 ? 'UN MILLON' : numAPalabras(m) + ' MILLONES');
  }
  if (n >= 1_000) {
    const k = Math.floor(n / 1_000);
    n = n % 1_000;
    parts.push(k === 1 ? 'MIL' : tresCifras(k) + ' MIL');
  }
  if (n > 0) parts.push(tresCifras(n));
  return parts.filter(Boolean).join(' ');
}

/** "MONTO PESOS XX/100 M.N." (o DOLARES/USD si moneda no es MXN/MN). */
export function importeEnLetras(monto: number, moneda = 'MXN'): string {
  const pesos = Math.trunc(monto);
  const centavos = Math.round((monto - pesos) * 100);
  const esMxn = moneda.toUpperCase() === 'MXN' || moneda.toUpperCase() === 'MN';
  const centavosStr = String(centavos).padStart(2, '0');
  return `${numAPalabras(pesos)} ${esMxn ? 'PESOS' : 'DOLARES'} ${centavosStr}/100 ${esMxn ? 'M.N.' : 'USD'}`;
}
