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
}

export interface InventarioCotizacionResponse {
  productos: InventarioCotizacionProductoDTO[];
}

/** Color canónico para comparar/guardar: la línea de Monday es texto libre
 * ("Black", "BLACK ", "black"), así que se normaliza a mayúsculas sin espacios
 * de sobra. */
export function colorInventario(color: string | null | undefined): string {
  return (color ?? '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 60);
}
