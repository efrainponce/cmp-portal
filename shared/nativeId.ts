// shared/nativeId.ts — frontera entre items reales de Monday e items nacidos en el
// portal ("salir de Monday", Zona Efrain). Un item nativo reusa la MISMA tabla
// `items` (mismo shape de columnas, mismo scoping por dal.ts/visibility.ts) pero
// con un item_id sintético que nunca colisiona con un id real de Monday (que a la
// fecha va en el orden de 10^9 pero siempre por debajo de este piso).
export const NATIVE_ID_FLOOR = 900_000_000_000;

export function isNativeId(itemId: number): boolean {
  return itemId >= NATIVE_ID_FLOOR;
}
