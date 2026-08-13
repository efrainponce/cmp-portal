// worker/lib/airtable.ts — Airtable cliente delgado (Fase 0, plan "salir de
// Monday", 2026-08-12). Por ahora solo cubre lo que Fase 2 (cotización) necesita:
// la imagen de producto que hoy Airtable sigue guardando (ids reales de
// cmp-tallas api/generate_cotizacion.py — base/tabla del catálogo de productos).
// Degradación silenciosa a propósito (mismo criterio que cmp-tallas): sin
// AIRTABLE_API_KEY, sin record id, o si Airtable falla, la cotización se genera
// igual sin imagen — nunca bloquea el flujo.
//
// El sync de catálogo Airtable↔Monday (Fase 6, sync_producto.py) es una
// integración aparte y más grande — no vive aquí todavía.
import type { Env } from '../env';

const AIRTABLE_BASE_ID = 'apprQnMOKPEBYt4AU';
const AIRTABLE_TABLE_ID = 'tblxZZLHRUAeJbGa2';
const AIRTABLE_URL = 'https://api.airtable.com/v0';

/** URL de la imagen "Imagen producto" (thumbnail completo) de un record de
 * Airtable, o '' si no hay API key, no hay recordId, el record no tiene imagen,
 * o la call falla — nunca lanza. */
export async function fetchAirtableImageUrl(env: Env, recordId: string): Promise<string> {
  const apiKey = env.AIRTABLE_API_KEY?.trim();
  if (!apiKey || !recordId) return '';

  try {
    const res = await fetch(`${AIRTABLE_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return '';
    const data = (await res.json()) as {
      fields?: { 'Imagen producto'?: { thumbnails?: { full?: { url?: string } } }[] };
    };
    return data.fields?.['Imagen producto']?.[0]?.thumbnails?.full?.url ?? '';
  } catch {
    return '';
  }
}
