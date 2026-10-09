// worker/lib/cotizacionLedger.ts — el folio de la cotización ("1189 - 10")
// sale del MISMO ledger de Google Sheets que usa cmp-tallas (tab "historial",
// 2026-10-09). Mientras convivan el botón del portal y el de Monday (Make 102 →
// cmp-tallas → Eledo), los dos tienen que contar sobre la misma lista: un
// contador propio en D1 (cotizacion_folios, el de la rama COTIZACION_NATIVE)
// arrancaría en 1 y repetiría folios que el cliente ya recibió.
//
// Mismo protocolo que create_sheets_cot/update_sheets_cot/mark_sheets_cot_error
// (cmp-tallas api/generate_cotizacion.py): n = renglones de esa oportunidad + 1,
// la fila se escribe ANTES de generar el PDF ("Generando") y se cierra con
// "Enviado a firma" o "Error" — un folio que truena queda con su fila, no se
// reusa. Misma cuenta de servicio que Drive (cmp-tallas@…), que ya edita el
// Sheet; el scope `drive` también vale para la API de Sheets.
import type { Env } from '../env';
import { getGoogleAccessToken } from './googleAuth';

const SHEET_ID = '1DtSipCWTdhD1qEXagQJoSa00K9wrgz_fJw5UNO1K6RA';
const TAB = 'historial';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

export interface FolioReservado {
  fila: number;
  folio: string;
}

/** "OPP-1189" + renglones existentes (columna C, con encabezado) → "1189 - n".
 * Pura: es la regla de numeración, anclada en test. */
export function siguienteFolio(columnaC: string[][], folioOpp: string): string {
  const n = columnaC.slice(1).filter(r => r?.[0] === folioOpp).length + 1;
  const sufijo = (folioOpp.split('-').pop() ?? folioOpp).trim();
  return `${sufijo} - ${n}`;
}

async function sheets<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  const token = await getGoogleAccessToken(env);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json<T>();
}

export async function reservarFolioCotizacion(env: Env, a: {
  itemId: number; folioOpp: string; cliente: string; institucion: string;
  vendedor: string; subtotal: number; iva: number; total: number;
}): Promise<FolioReservado> {
  const col = await sheets<{ values?: string[][] }>(env, `/values/${encodeURIComponent(`${TAB}!C:C`)}`);
  const folio = siguienteFolio(col.values ?? [], a.folioOpp);
  const fila = [
    folio, String(a.itemId), a.folioOpp, a.cliente, a.institucion, a.vendedor,
    a.subtotal, a.iva, a.total, new Date().toISOString().slice(0, 10),
    'Generando', '', '', '', '',
  ];
  const r = await sheets<{ updates?: { updatedRange?: string } }>(
    env,
    `/values/${encodeURIComponent(`${TAB}!A:O`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [fila] }) },
  );
  // "historial!A749:O749" → 749
  const m = /![A-Z]+(\d+)/.exec(r.updates?.updatedRange ?? '');
  if (!m) throw new Error(`Sheets: append sin rango (${r.updates?.updatedRange ?? '—'})`);
  return { fila: Number(m[1]), folio };
}

/** Cierra la fila: K..O = estado, PDF con precio, PDF sin precio, DocuSeal, error. */
export async function cerrarFolioCotizacion(env: Env, fila: number, c: {
  estado: 'Enviado a firma' | 'Error'; pdfConPrecio?: string; pdfSinPrecio?: string; docuseal?: string; error?: string;
}): Promise<void> {
  await sheets(env, `/values/${encodeURIComponent(`${TAB}!K${fila}:O${fila}`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[c.estado, c.pdfConPrecio ?? '', c.pdfSinPrecio ?? '', c.docuseal ?? '', (c.error ?? '').slice(0, 512)]] }),
  });
}
