// worker/lib/eledo.ts — Eledo (eledo.online) cliente delgado para renderizar PDFs a
// partir de una plantilla ya diseñada ahí (Fase 0, plan "salir de Monday",
// 2026-08-12). El Worker llama a Eledo directo en vez de que cmp-tallas sea el
// intermediario — mismo endpoint/auth para toda plantilla, solo cambia
// `templateId` + el shape de `file` (cada plantilla define sus propios campos,
// por eso `file` es `Record<string, unknown>`: quien arma el payload por flujo
// —worker/lib/cotizacion.ts, worker/lib/oc.ts, todavía no existen— es dueño de
// esa forma, no este cliente).
//
// Costeo (worker/lib/costeo.ts) YA NO usa Eledo desde la Fase 1 nativa: el PDF
// propio del portal (worker/lib/documents.ts) es el oficial ahí.
import type { Env } from '../env';

export class EledoError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const ELEDO_URL = 'https://eledo.online/api/RESTv1/Generate';

// Ids de plantilla reales (cmp-tallas api/generate_cotizacion.py, api/generate_oc.py)
// — nunca inventados. La de costeo (69a23e1d6345ea4ac2109a02) no se migra: Fase 1
// dejó de necesitarla.
export const ELEDO_TEMPLATE_COTIZACION = '69a0eb3d6345ea9ffcaf7e62'; // template_cotizacion_v2
export const ELEDO_TEMPLATE_OC = '69b3b936c38adc73cf462f2f';

/** Renderiza una plantilla de Eledo a PDF. `file` son los campos que esa
 * plantilla espera (varían por templateId — ver los módulos de cada flujo). */
export async function renderEledoPdf(
  env: Env,
  templateId: string,
  file: Record<string, unknown>,
): Promise<Uint8Array> {
  if (!env.ELEDO_API_KEY) throw new EledoError('ELEDO_API_KEY not configured');

  const res = await fetch(ELEDO_URL, {
    method: 'POST',
    headers: { 'Api-Key': env.ELEDO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, file }),
    signal: AbortSignal.timeout(90_000),
  });

  const contentType = res.headers.get('content-type') ?? '';
  if (res.ok && contentType.includes('application/pdf')) {
    return new Uint8Array(await res.arrayBuffer());
  }

  const text = await res.text();
  throw new EledoError(`Eledo HTTP ${res.status}: ${text.slice(0, 500)}`);
}
