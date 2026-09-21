// Captura de inventario 5.11 por producto dentro de una cotización. Es nativa
// de D1: las fotos y comentarios son evidencia operativa, no columnas de Monday.
export interface InventarioCotizacionProductoDTO {
  productoId: string;
  productoNombre: string;
  imagenMexicoUrl?: string;
  imagenUsaUrl?: string;
  comentarios: string;
  agregadoManualmente: boolean;
}

export interface InventarioCotizacionResponse {
  productos: InventarioCotizacionProductoDTO[];
}
