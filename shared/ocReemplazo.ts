// shared/ocReemplazo.ts — ¿esta re-emisión se PARECE a la orden que la reemplazó?
//
// La Lista de OC no suma las re-emisiones: de cada proveedor en un proyecto solo
// cuenta la última OC. Casi siempre es una corrección y los montos se parecen
// (88 de 102 pares el 2026-09-18). Cuando NO se parecen (OC-100 $92k → OC-109
// $6k) puede ser una orden complementaria que sí se paga aparte. Efraín, mismo
// día: se queda SIN confirmar ni override — solo un color que lo delate.

/** Arriba de esta diferencia relativa contra la vigente, la fila se pinta. */
export const REEMPLAZO_DUDOSO_UMBRAL = 0.25;

/** null en cualquiera = todavía no se lee el PDF: sin dato no se acusa a nadie. */
export function esReemplazoDudoso(anterior: number | null, vigente: number | null): boolean {
  if (anterior == null || vigente == null) return false;
  return Math.abs(anterior - vigente) / Math.max(Math.abs(vigente), 1) > REEMPLAZO_DUDOSO_UMBRAL;
}
