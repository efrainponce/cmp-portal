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
//
// syncTallasPortal (2026-08-13): write-back Portal→Airtable de Tallas. Compras
// edita Tallas (text_mm5v6jhj) desde el catálogo en el portal, pero los campos
// "Tallas"/"Tallas de ficha comercial (ai)" en Airtable son AI fields —
// confirmado contra la API real (PATCH devuelve INVALID_VALUE_FOR_COLUMN, no es
// cuestión de payload) — así que no se puede escribir ahí. Efraín creó un campo
// nuevo de texto plano "Tallas Portal" (fldaxxCo1hD26cb7d) para esto. El
// checkbox "Género M/F" que decide si se expande con prefijo M-/F- vive solo en
// D1 (worker/lib/productoGenero.ts) — no hay columna de Monday para eso.
import type { Env } from '../env';
import type { MirrorItem } from '../../shared/types';
import type { RawCol } from './serialize';
import { getGeneroMF } from './productoGenero';

const AIRTABLE_BASE_ID = 'apprQnMOKPEBYt4AU';
const AIRTABLE_TABLE_ID = 'tblxZZLHRUAeJbGa2';
const AIRTABLE_URL = 'https://api.airtable.com/v0';
const AIRTABLE_TALLAS_PORTAL_FIELD = 'fldaxxCo1hD26cb7d'; // "Tallas Portal"

// Productos (18395657591) — mismos ids que worker/lib/costeo.ts.
const PRODUCTO_TALLAS_COL = 'text_mm5v6jhj';
const PRODUCTO_AIRTABLE_ID_COL = 'text_mkzmgvc7';

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

/** Expande "XCH,CH,M,G,XG,2XG" con prefijo M-/F- por talla cuando el producto es
 * Género M/F ("mismas tallas" para ambos géneros, Efraín 2026-08-13); sin
 * género, la lista sale igual a como Compras la escribió. Pura, exportada para
 * test unitario. */
export function buildTallasPortalValue(tallas: string, generoMF: boolean): string {
  const sizes = tallas.split(',').map(s => s.trim()).filter(Boolean);
  if (!generoMF) return sizes.join(',');
  return [...sizes.map(s => `M-${s}`), ...sizes.map(s => `F-${s}`)].join(',');
}

/** PATCH a "Tallas Portal" en Airtable — best-effort/silencioso, mismo criterio
 * que fetchAirtableImageUrl: nunca bloquea el flujo del portal si falla. */
export async function updateTallasPortal(env: Env, recordId: string, value: string): Promise<void> {
  const apiKey = env.AIRTABLE_API_KEY?.trim();
  if (!apiKey || !recordId) return;
  try {
    await fetch(`${AIRTABLE_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [AIRTABLE_TALLAS_PORTAL_FIELD]: value }, typecast: false }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* best-effort */ }
}

function colText(row: MirrorItem, colId: string): string {
  try {
    const cols: RawCol[] = JSON.parse(row.columns || '[]');
    return cols.find(c => c.id === colId)?.text ?? '';
  } catch {
    return '';
  }
}

/** Recalcula y empuja "Tallas Portal" para un producto del catálogo — junta
 * Tallas + Género M/F (D1) + airtable_id (mirror). Se dispara desde dos
 * lugares: al editar Tallas (worker/lib/outbox.ts submitWrite, con el valor
 * nuevo que se está escribiendo) y al cambiar el género (worker/routes/
 * oportunidades.ts, con el valor actual del mirror). Best-effort: nunca lanza. */
export async function syncTallasPortal(env: Env, row: MirrorItem, tallasOverride?: string): Promise<void> {
  const airtableId = colText(row, PRODUCTO_AIRTABLE_ID_COL);
  if (!airtableId) return;
  const tallas = tallasOverride ?? colText(row, PRODUCTO_TALLAS_COL);
  const generoMF = await getGeneroMF(env, row.item_id);
  await updateTallasPortal(env, airtableId, buildTallasPortalValue(tallas, generoMF));
}
