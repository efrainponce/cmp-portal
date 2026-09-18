// shared/ocMontoPdf.ts — saca Subtotal / IVA / Total del TEXTO de un PDF de
// orden de compra (Lista de OC, 2026-09-18).
//
// Por qué del PDF y no de las líneas del Proyecto: las líneas no dicen a qué OC
// pertenecen, y el día que se escribió 179 de 279 órdenes compartían
// proyecto+proveedor con otra (OC-312, 313 y 317 son las tres del mismo
// proveedor en el mismo proyecto). Sumar las líneas actuales le pondría el
// MISMO número a las tres, y ninguno tendría por qué coincidir con lo que dice
// el papel que se le mandó al proveedor. El PDF es lo único que sabe cuánto fue
// cada orden.
//
// El bloque es igual desde OC-11: "SUBTOTAL | IVA (16%) | TOTAL [| UNIDADES]"
// y enseguida los tres importes (en OC-60/63 el rótulo TOTAL cae entre el
// segundo y el tercero: por eso se ancla en "SUBTOTAL | IVA" y se toman los
// tres primeros importes que sigan, sin exigir el orden de los rótulos). Se autoverifica: si subtotal + IVA no da el
// total, no se devuelve nada — mejor una celda vacía que un monto mal leído en
// un tablero que se usa para pagar.

export interface OcMontoPdf { subtotal: number; iva: number; total: number; moneda: string | null }

const IMPORTE = /\$\s*(-?[\d,]+(?:\.\d+)?)/g;

/** `texto` = los fragmentos de texto del PDF unidos en orden de lectura. Pura. */
export function montoDeTextoOc(texto: string): OcMontoPdf | null {
  const i = texto.search(/SUBTOTAL[\s|]*IVA/i);
  if (i < 0) return null;
  const nums: number[] = [];
  const re = new RegExp(IMPORTE.source, 'g');
  let m: RegExpExecArray | null;
  const cola = texto.slice(i);
  while (nums.length < 3 && (m = re.exec(cola)) !== null) nums.push(Number(m[1].replace(/,/g, '')));
  if (nums.length < 3 || nums.some(n => !Number.isFinite(n))) return null;
  const [subtotal, iva, total] = nums;
  if (!montoCuadra(subtotal, iva, total)) return null;
  // La moneda no viene en los totales: sale de la columna MONEDA de las líneas.
  const moneda = /\b(MXN|USD|EUR)\b/.exec(texto.slice(0, i))?.[1] ?? null;
  return { subtotal, iva, total, moneda };
}

/** Tolerancia de 2 centavos por el redondeo de cada renglón. Los negativos se
 * aceptan: OC-147 salió con un descuento de 125% y su PDF dice $-825.00 — el
 * tablero muestra lo que dice el papel, no lo corrige. */
export function montoCuadra(subtotal: number, iva: number, total: number): boolean {
  return Math.abs(subtotal + iva - total) <= 0.02;
}

/** La FECHA impresa en la orden ("FECHA | 18-09-2026", dd-mm-aaaa) como
 * aaaa-mm-dd. La traen los 269 PDFs del 2026-09-18 —también OC-200 a 205, que
 * no traen totales— y ordena igual que el folio (cero inversiones ese día).
 * null si no aparece o no es una fecha de verdad. Pura. */
export function fechaDeTextoOc(texto: string): string | null {
  const m = /\bFECHA\b[\s|:]*(\d{2})-(\d{2})-(\d{4})/i.exec(texto);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return fechaValida(iso) ? iso : null;
}

/** aaaa-mm-dd que existe en el calendario (no 31-02) y no es un disparate. */
export function fechaValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso >= '2020-01-01';
}
