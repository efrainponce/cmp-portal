// worker/lib/nativeSeq.ts — asigna el item_id sintético de un item nativo
// (shared/nativeId.ts NATIVE_ID_FLOOR). Aleatorio de verdad (Web Crypto, no
// Math.random ni un contador secuencial): igual que los ids de Monday, que se
// ven como números grandes sin patrón — un contador delataría cuántos
// registros nativos existen y en qué orden nacieron. UNA sola función para
// TODA entidad nativa (oportunidad, línea, proyecto...) — mismo piso, mismo
// rango, así que el largo en dígitos siempre sale igual (12), nunca varía por
// tipo de registro.
import type { Env } from '../env';
import { NATIVE_ID_FLOOR } from '../../shared/nativeId';

// 2^32 valores posibles (0..4294967295) sumados al piso: el máximo posible
// (904,294,967,295) sigue teniendo los mismos 12 dígitos que el piso — nunca
// se "desborda" a 13 — y de sobra por debajo de Number.MAX_SAFE_INTEGER
// (2^53). Espacio grande de sobra para nunca chocar por casualidad aun con
// miles de registros nativos; el chequeo contra `items` de abajo es la
// garantía real, esto solo la hace improbable.
function randomOffset(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

const MAX_ATTEMPTS = 10;

/** Reserva un item_id nativo único. Los ids de Monday son globales a toda la
 * plataforma (no por board) — se replica ese mismo criterio acá: la unicidad
 * se checa contra TODA la tabla `items`, sin importar board_id ni entidad. */
export async function reserveNativeId(env: Env): Promise<number> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = NATIVE_ID_FLOOR + randomOffset();
    const taken = await env.DB.prepare(`SELECT 1 FROM items WHERE item_id = ? LIMIT 1`).bind(candidate).first();
    if (!taken) return candidate;
  }
  throw new Error('no se pudo reservar un item_id nativo único tras varios intentos');
}
