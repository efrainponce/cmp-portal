// worker/lib/ocSheetLedger.ts — el ledger de OC de cmp-tallas (Google Sheet
// `historial`) como ÚNICO contador de folios, compartido por los dos motores.
//
// Por qué (Efraín, 2026-09-22: "cuando el portal hace una OC, ¿lo mandamos al
// Google Sheets? … para no tener duplicados"): cmp-tallas asigna el folio
// contando las filas de la columna A de ese Sheet (`numero = len(rows)`,
// api/generate_oc.py) y NUNCA mira Monday. El portal contaba en D1 con un piso
// leído del espejo — seguro de SU lado, pero el Sheet no se enteraba: la
// primera OC del portal (OC-320) dejaba al Sheet en 319 y la siguiente de
// Monday salía también OC-320. Dos ledgers que no se hablan = folio repetido.
//
// Aquí el portal reserva el folio EXACTAMENTE como cmp-tallas: cuenta filas,
// anexa la suya y toma el número de fila que Sheets le devolvió. El append
// de Sheets es atómico (INSERT_ROWS siempre va después de la última fila),
// así que dos reservas simultáneas —de cualquier motor— reciben filas
// distintas; si otra fila se coló entre el conteo y el append, el folio se
// corrige al número de fila real y se reescribe la celda A. Invariante que
// cmp-tallas asume y que aquí se conserva: `folio = fila - 1`.
//
// La cuenta de servicio es la MISMA de cmp-tallas (cmp-tallas@…iam), ya
// dueña del Sheet — verificado en vivo el 2026-09-22 (320 filas, OC-1…OC-319,
// sin huecos ni duplicados, folio = fila - 1 en las 319).
import type { Env } from '../env';
import { getGoogleAccessToken } from './googleAuth';

/** Mismo id hardcodeado que cmp-tallas (OC_SPREADSHEET_ID). `OC_SHEET_ID`
 * en env lo reemplaza SOLO para pruebas — nunca en wrangler.jsonc. */
export const OC_SHEET_ID_PROD = '1X9Uay20i2fe4AMu0UZnZQswWbUR9OBspw111wxqCY_Y';
export const OC_SHEET_TAB = 'historial';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Columnas A…O, en el orden de cmp-tallas (SHEETS_HEADER_ROW). */
export const OC_SHEET_HEADER = [
  'FolioOrden', 'Key', 'FolioProyecto', 'FolioOpp', 'ProyectoItemId',
  'ProveedorId', 'ProveedorNombre', 'ProveedorRZ', 'Monto', 'Moneda',
  'Fecha', 'Status', 'PdfUrl', 'DocusealSubmissionId', 'ErrorMsg',
] as const;

export class OcSheetLedgerError extends Error {}

export interface ReservaSheet {
  proyectoId: number;
  proveedorId: string;
  proveedorNombre: string;
  proveedorRZ: string;
  folioProyecto: string;
  folioOpp: string;
  monto: number;
  moneda: string;
}

export interface FolioReservado {
  folio: string;
  numero: number;
  /** Fila del Sheet (1-indexed) — para cerrar o marcar error después. */
  fila: number;
}

/** ¿Hay credenciales para hablar con Sheets? Sin ellas (dev local) el
 * llamador cae al contador de D1 de siempre. En producción SIEMPRE las hay. */
export function sheetLedgerDisponible(env: Env): boolean {
  return Boolean(env.GOOGLE_PRIVATE_KEY && env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
}

function sheetId(env: Env): string {
  return env.OC_SHEET_ID || OC_SHEET_ID_PROD;
}

/** `historial!A321:O321` → 321. Pura — anclada en ocSheetLedger.test.ts. */
export function filaDeUpdatedRange(range: string): number {
  const m = /!\$?[A-Z]+\$?(\d+)(?::|$)/.exec(range);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(n) || n < 2) throw new OcSheetLedgerError(`updatedRange inesperado: ${range}`);
  return n;
}

/** La fila A…O tal como la escribe cmp-tallas, con el folio y la fecha dados.
 * Status "Generando" igual que allá: la fila existe ANTES del PDF, para que un
 * fallo posterior no deje un hueco en la numeración. Pura. */
export function filaLedger(r: ReservaSheet, folio: string, fechaISO: string): (string | number)[] {
  return [
    folio,                                 // A FolioOrden
    `${r.proyectoId}__${r.proveedorId}`,   // B Key
    r.folioProyecto,                       // C FolioProyecto
    r.folioOpp,                            // D FolioOpp
    String(r.proyectoId),                  // E ProyectoItemId
    String(r.proveedorId),                 // F ProveedorId
    r.proveedorNombre,                     // G ProveedorNombre
    r.proveedorRZ || '',                   // H ProveedorRZ
    r.monto,                               // I Monto
    r.moneda,                              // J Moneda
    fechaISO.slice(0, 10),                 // K Fecha
    'Generando',                           // L Status
    '',                                    // M PdfUrl
    '',                                    // N DocusealSubmissionId
    '',                                    // O ErrorMsg
  ];
}

async function sheetsFetch(env: Env, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const token = await getGoogleAccessToken(env, SCOPE);
  const res = await fetch(`${API}/${sheetId(env)}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const json: Record<string, unknown> = await res.json<Record<string, unknown>>().catch(() => ({}));
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new OcSheetLedgerError(`Sheets ${res.status}: ${err?.message ?? 'sin detalle'}`);
  }
  return json;
}

/** Cuántas filas tiene la columna A (encabezado incluido) = el número que
 * cmp-tallas le daría a la SIGUIENTE OC. */
export async function contarFilasLedger(env: Env): Promise<number> {
  const tab = encodeURIComponent(OC_SHEET_TAB);
  const json = await sheetsFetch(env, `values/${tab}!A:A`);
  const values = (json.values as unknown[] | undefined) ?? [];
  return values.length;
}

/** Reserva el siguiente folio anexando la fila al Sheet. Lanza
 * OcSheetLedgerError si Sheets no responde: SIN fila en el ledger no se
 * emite (fail-closed) — un folio que el Sheet no conoce es justo el
 * duplicado que esto evita. */
export async function reservarFolioEnSheet(env: Env, r: ReservaSheet): Promise<FolioReservado> {
  const tab = encodeURIComponent(OC_SHEET_TAB);
  const conteo = await contarFilasLedger(env);
  if (conteo === 0) {
    // Sheet vacío = no es el ledger (el real trae encabezado + 319 filas).
    // Antes que numerar desde OC-1 encima de lo que ya existe, se aborta.
    throw new OcSheetLedgerError('el ledger de Sheets está vacío — no se reserva folio');
  }
  const provisional = conteo;
  const json = await sheetsFetch(env,
    `values/${tab}!A:O:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [filaLedger(r, `OC-${provisional}`, new Date().toISOString())] }) });
  const updates = json.updates as { updatedRange?: string } | undefined;
  if (!updates?.updatedRange) throw new OcSheetLedgerError('append sin updatedRange');
  const fila = filaDeUpdatedRange(updates.updatedRange);
  const numero = fila - 1;
  if (numero !== provisional) {
    // Alguien (cmp-tallas o el otro isolate) anexó entre el conteo y el
    // append: el folio bueno es el de la fila real. Se reescribe la celda A.
    await sheetsFetch(env, `values/${tab}!A${fila}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [[`OC-${numero}`]] }) });
  }
  return { folio: `OC-${numero}`, numero, fila };
}

/** L:M de la fila — mismo rango que `update_sheets_oc` de cmp-tallas. */
export async function cerrarFolioEnSheet(
  env: Env, fila: number, c: { status: string; pdfUrl?: string; docusealId?: string },
): Promise<void> {
  const tab = encodeURIComponent(OC_SHEET_TAB);
  await sheetsFetch(env, `values/${tab}!L${fila}:N${fila}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [[c.status, c.pdfUrl ?? '', c.docusealId ?? '']] }) });
}

/** L + O de la fila — como `mark_sheets_oc_error`. El folio NO se recicla. */
export async function marcarErrorEnSheet(env: Env, fila: number, error: string): Promise<void> {
  await sheetsFetch(env, `values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: `${OC_SHEET_TAB}!L${fila}`, values: [['Error']] },
        { range: `${OC_SHEET_TAB}!O${fila}`, values: [[error.slice(0, 500)]] },
      ],
    }),
  });
}
