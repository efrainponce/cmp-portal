// Descuento de las líneas del Proyecto: la columna `numeric_mm1dmsaz` guarda
// una FRACCIÓN 0-1 (0.18 = 18%) — así la escribe la importación de tallas
// (worker/lib/proyectoTallas.ts, mismo contrato que el import_tallas.py real) y
// así la lee el PDF de la OC (worker/lib/pdf/ordenCompraProveedor.ts:
// `1 - descuento`). Pero nadie teclea "0.18": la UI del portal pide y muestra
// PORCENTAJE entero.
//
// Sin esa conversión, un "10" tecleado en "Desc. %" llegaba crudo a la columna
// y el PDF calculaba `1 - 10` → importes NEGATIVOS en la OC; y al revés, una
// línea importada con 18% se veía en el grid como "0.18%" y el total de la
// tarjeta salía mal. Es el mismo bug que ya se había pagado en la prueba
// end-to-end del 2026-08-13, colado por el alta manual y la edición inline.
//
// Convención: la conversión vive en la CAPA UI (aquí), no en los endpoints —
// la edición inline pasa por el PATCH genérico de /api/boards, que escribe el
// valor de columna tal cual y no sabe de porcentajes.

/** Redondeo a 4 decimales: 0.18 * 100 da 18.000000000000004 en coma flotante. */
function limpio(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Lo que se teclea ("18") → lo que se guarda ("0.18"). Vacío = borrar la celda. */
export function pctToFraccion(text: string | undefined): string {
  const t = text?.trim();
  if (!t) return '';
  const n = Number(t.replace(/[%\s,]/g, ''));
  return Number.isFinite(n) ? String(limpio(n / 100)) : '';
}

/** Lo guardado ("0.18") → lo que se muestra ("18"). Un valor > 1 NO se corrige
 * en silencio: sale como "1000%" a propósito, porque eso es lo que el PDF va a
 * calcular y hay que verlo. */
export function fraccionToPct(text: string | undefined): string {
  const t = text?.trim();
  if (!t) return '';
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? String(limpio(n * 100)) : '';
}

/** La fracción como número, para calcular importes: `cantidad * costo * (1 - d)`. */
export function fraccionNum(text: string | undefined): number {
  const n = Number(text?.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
