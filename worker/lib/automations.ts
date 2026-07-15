// worker/lib/automations.ts — cmp-tallas Vercel automations client (trigger, don't reimplement).
import type { Env } from '../env';

export class AutomationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Contract: cmp-tallas always answers 200 with {ok, skipped?, reason?} — never throws
// on business-logic "skip"; only network/config failures raise here.
export interface CotizacionResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  [key: string]: unknown;
}

export async function generateCotizacion(env: Env, itemId: number): Promise<CotizacionResult> {
  if (!env.CMP_TALLAS_BASE) throw new AutomationError(501, 'CMP_TALLAS_BASE not configured');

  const res = await fetch(`${env.CMP_TALLAS_BASE}/api/generate_cotizacion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CMP-Secret': env.CMP_SECRET ?? '',
    },
    body: JSON.stringify({ item_id: itemId }),
  });
  if (!res.ok) throw new AutomationError(502, `cotizacion upstream failed (${res.status})`);
  return (await res.json()) as CotizacionResult;
}
