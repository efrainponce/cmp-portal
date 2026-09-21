/** Llave de la foto de un producto en la OC con imágenes: su SKU, o el NOMBRE
 * del producto cuando la línea no trae SKU (línea manual, 2026-09-21 — sin esto
 * un producto sin SKU ni aparecía en la tira de fotos). El tab y el PDF usan
 * esta misma función: si divergen, la foto se sube con una llave y el PDF la
 * busca con otra. Pura. */
export function llaveFotoOc(sku: string | null | undefined, producto: string | null | undefined): string {
  return (sku ?? '').trim() || (producto ?? '').trim();
}
