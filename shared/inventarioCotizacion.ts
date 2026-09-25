// Captura de inventario 5.11 por producto dentro de una cotización. Es nativa
// de D1: las fotos y comentarios son evidencia operativa, no columnas de Monday.
//
// Una tarjeta = producto + COLOR: el mismo SKU en dos colores son dos
// inventarios distintos (Lili, OPP 1075, 2026-09-22 — 72175 en BLACK y STORM
// compartían una sola foto). `color` vacío = renglón capturado antes de que
// existiera el color (o producto agregado a mano sin color).
export interface InventarioCotizacionProductoDTO {
  productoId: string;
  productoNombre: string;
  color: string;
  imagenMexicoUrl?: string;
  imagenUsaUrl?: string;
  comentarios: string;
  agregadoManualmente: boolean;
  /** ISO de cuándo se subió cada foto: el inventario cambia a diario y hay que
   * saber de qué día es la captura (Pam, 2026-09-25). */
  imagenMexicoFecha?: string;
  imagenUsaFecha?: string;
}

/** Un guardado de la tarjeta tal como quedó (fotos + comentarios). Cada
 * guardado agrega uno y nunca se reescribe: subir la captura de hoy no borra la
 * de ayer (Pam, 2026-09-25 — "actualizarlo sin perder la versión anterior"). */
export interface InventarioVersionDTO extends InventarioCotizacionProductoDTO {
  guardadoAt: string;
  guardadoPor?: string;
}

export interface InventarioCotizacionResponse {
  productos: InventarioCotizacionProductoDTO[];
  historial: InventarioVersionDTO[];
}

/** Día calendario (YYYY-MM-DD) de un ISO en hora de México. */
export function diaInventario(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

/** "2026-09-25" o un ISO → "25/09/2026". */
export function fechaInventario(diaOIso: string): string {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(diaOIso) ? diaOIso : diaInventario(diaOIso);
  const [y, m, d] = dia.split('-');
  return `${d}/${m}/${y}`;
}

/** Las versiones del tab son DÍAS: cada día en que se guardó algo, del más
 * reciente al más viejo. El primero es la vigente. */
export function diasInventario(historial: InventarioVersionDTO[]): string[] {
  return [...new Set(historial.map((h) => diaInventario(h.guardadoAt)))].sort().reverse();
}

/** El inventario como estaba al cierre de `dia`: por producto+color, el último
 * guardado de ese día o antes. */
export function inventarioAlDia(historial: InventarioVersionDTO[], dia: string): InventarioVersionDTO[] {
  const ultimo = new Map<string, InventarioVersionDTO>();
  for (const h of historial) {
    if (diaInventario(h.guardadoAt) > dia) continue;
    const k = `${h.productoId}|${h.color}`;
    const prev = ultimo.get(k);
    if (!prev || h.guardadoAt >= prev.guardadoAt) ultimo.set(k, h);
  }
  return [...ultimo.values()];
}

/** Color canónico para comparar/guardar: la línea de Monday es texto libre
 * ("Black", "BLACK ", "black"), así que se normaliza a mayúsculas sin espacios
 * de sobra. */
export function colorInventario(color: string | null | undefined): string {
  return (color ?? '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 60);
}
