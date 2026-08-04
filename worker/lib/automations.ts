// worker/lib/automations.ts — cmp-tallas Vercel automations client (trigger, don't reimplement).
// Endpoint↔trigger map: docs/cmp-tallas-endpoint-map.md. Contract: cmp-tallas always
// answers 200 with {ok, skipped?, reason?, ...} on business outcomes — HTTP errors here
// mean infra/config, not "validation failed".
import type { Env } from '../env';

export class AutomationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AutomationResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  [key: string]: unknown;
}

// Eledo render + Monday upload + DocuSeal can take a while; Vercel caps at 300s.
// Portal used to abort at 120s, well under that cap — cmp-tallas kept working
// server-side after the abort, so the user saw a false failure and had to
// retry (WhatsApp 2026-08-04: "hay que apretarle varias veces"). Match the
// budget cmp-tallas actually has, with a small margin.
const TIMEOUT_MS = 280_000;

async function callCmpTallas(env: Env, path: string, body: Record<string, unknown>): Promise<AutomationResult> {
  if (!env.CMP_TALLAS_BASE) throw new AutomationError(501, 'CMP_TALLAS_BASE not configured');

  const res = await fetch(`${env.CMP_TALLAS_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CMP-Secret': env.CMP_SECRET ?? '',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new AutomationError(502, `${path} upstream failed (${res.status})`);
  return (await res.json()) as AutomationResult;
}

// ── Oportunidades ─────────────────────────────────────────────────────────────

/** Botón "Solicitar costeo": valida subitems, snapshotea costos, genera y sube el
 * PDF de costeo, mueve deal_stage→"En costeo" (o rechaza →"Nueva oportunidad"). */
export function validarCosteo(env: Env, itemId: number, dryRun = false): Promise<AutomationResult> {
  return callCmpTallas(env, '/api/validar_costeo', { item_id: String(itemId), dry_run: dryRun });
}

/** Botón "Generar Cotización": PDFs con/sin precio, DocuSeal al vendedor,
 * ledger en Sheets, deal_stage→"Cotización". */
export function generateCotizacion(env: Env, itemId: number): Promise<AutomationResult> {
  return callCmpTallas(env, '/api/generate_cotizacion', { item_id: String(itemId) });
}

// ── Proyectos ────────────────────────────────────────────────────────────────

/** Crea/regenera el Google Sheet de tallas del Proyecto (preserva cantidades). */
export function generateSheet(env: Env, proyectoId: number): Promise<AutomationResult> {
  return callCmpTallas(env, '/api/generate_sheet', { item_id: String(proyectoId) });
}

/** VENDEDOR valida tallas: gate "TODO CUADRA" en el sheet, PDF de relación de
 * tallas + DocuSeal a firma del vendedor. */
export function confirmTallas(env: Env, proyectoId: number, dryRun = false): Promise<AutomationResult> {
  return callCmpTallas(env, '/api/confirm_tallas', { item_id: String(proyectoId), dry_run: dryRun });
}

/** COMPRAS importa tallas: BORRA los subitems del Proyecto y los recrea desde el
 * sheet (una fila por talla + embellecimientos únicos). Destructivo. */
export function importTallas(env: Env, proyectoId: number, dryRun = false): Promise<AutomationResult> {
  return callCmpTallas(env, '/api/import_tallas', { item_id: String(proyectoId), dry_run: dryRun });
}

/** Genera OC por proveedor (agrupa subitems), folio en Sheets, DocuSeal con 3
 * firmas (Elaborado→Pam→Elisa). ¡El run real manda correos de firma!
 * `metodoPago`/`condPago`: overrides de un solo proveedor — solo tienen efecto
 * junto con `onlyProveedor` (una corrección apunta a uno a la vez); sin ellos,
 * cmp-tallas usa el default a nivel Proyecto (WhatsApp 2026-08-04: antes se
 * aplicaba el mismo valor a todos los proveedores). Sin `onlyProveedor`, el
 * botón masivo ahora salta proveedores con una OC ya vigente (mismo pedido). */
export function generateOC(
  env: Env,
  proyectoId: number,
  opts: { dryRun?: boolean; onlyProveedor?: string; metodoPago?: string; condPago?: string } = {},
): Promise<AutomationResult> {
  const body: Record<string, unknown> = { item_id: String(proyectoId), dry_run: opts.dryRun ?? false };
  if (opts.onlyProveedor) body.only_proveedor = opts.onlyProveedor;
  if (opts.metodoPago) body.metodo_pago = opts.metodoPago;
  if (opts.condPago) body.cond_pago = opts.condPago;
  return callCmpTallas(env, '/api/generate_oc', body);
}
