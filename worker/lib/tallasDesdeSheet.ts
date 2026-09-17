// worker/lib/tallasDesdeSheet.ts — "Traer tallas del archivo al portal" SIN
// borrar nada (Efraín, 2026-09-17: "mejor algo que no destruya nada; deja el
// botón así pero es solo jalar la info").
//
// El botón de antes era import_tallas de cmp-tallas: borra TODOS los subitems
// del Proyecto y los recrea desde el Sheet — se llevaba proveedor/costo/estado
// que Compras ya había editado a mano. Aquí se lee el mismo Sheet (pestaña
// Data, mismas columnas que import_tallas.py) y se pasa por `capturarTallas`
// (worker/lib/proyectoTallas.ts), que reconcilia por identidad
// producto+sku+color+talla(+género): crea lo que falta, actualiza lo que
// cambió, y NUNCA borra. Una línea que ya no está en el archivo se queda en el
// Proyecto — quitarla es decisión de una persona (🗑 de la fila, con respaldo).
//
// Lo que NO hace, a diferencia de import_tallas: no crea las líneas "✨ zona"
// de embellecimiento (las del bordador). Los textos por zona (cols J–Q) sí se
// escriben en cada línea de talla, que es lo que imprime la OC.
//
// Lectura del Sheet: misma service account que Drive (worker/lib/googleAuth.ts),
// con scope de solo lectura de Sheets. Si esa cuenta no puede abrir el archivo
// (lo creó cmp-tallas con otra cuenta y no está compartido), el error lo dice.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { TallaBoxInput, CapturarTallasResponse } from '../../shared/dto';
import { MAX_TALLAS_POR_REQUEST } from '../../shared/dto';
import { getItem } from './dal';
import { getGoogleAccessToken } from './googleAuth';
import { capturarTallas, identityKey } from './proyectoTallas';
import { PROYECTO_SHEET_LINK } from './tallasSheet';
import { isNativeId } from '../../shared/nativeId';

export class TraerTallasError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Data!A:Q — mismo orden que escribe generate_sheet.py y lee import_tallas.py. */
const SHEET_DATA_RANGE = 'Data!A2:Q1000';
/** Cols J–Q → long_text del subitem (import_tallas.py COL_SUB_J..Q). */
const EMBELL_COLS: readonly string[] = [
  'long_text_mm1cqh8e', // J — Espalda
  'long_text_mm1cyqts', // K — Frente derecho
  'long_text_mm1c59cg', // L — Frente izquierdo
  'long_text_mm1c2eyf', // M — Manga derecha/costado derecho
  'long_text_mm1cyq91', // N — Manga izquierda/costado izquierdo
  'long_text_mm1c6ya0', // O — Etiqueta de propiedad
  'long_text_mm1cnbbr', // P — Etiqueta nombre
  'long_text_mm2077h1', // Q — Otros
];

export function spreadsheetIdDe(url: string): string | null {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}

/** Una fila cruda del Sheet → fila capturable; null si no tiene cantidad,
 * talla o producto. Exportada para test puro. */
export function filaASheetTalla(row: (string | undefined)[]): TallaBoxInput | null {
  const cell = (i: number) => String(row[i] ?? '').trim();
  const cantidad = Number(cell(5).replace(/,/g, ''));
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
  const producto = cell(0);
  const talla = cell(4);
  if (!producto || !talla) return null;
  const extras: Record<string, string> = {};
  EMBELL_COLS.forEach((colId, i) => {
    const texto = cell(9 + i);
    if (texto) extras[colId] = texto;
  });
  const subitemId = Number(cell(8));
  return {
    subitemId: Number.isFinite(subitemId) ? subitemId : 0,
    producto,
    sku: cell(1) || undefined,
    color: cell(2) || undefined,
    genero: cell(3) || undefined,
    talla,
    cantidad,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  };
}

/** Dos bloques del Sheet con el MISMO producto+sku+color+talla(+género) —
 * p.ej. una línea dividida en hombre/mujer sin cambiar de producto (PRO-0205:
 * Playera Polo AZUL MARINO 48 + 27, y la pestaña Data no trae género) — son
 * UNA línea del Proyecto: se suman las cantidades en vez de que la segunda
 * pise a la primera. Conserva el primer subitemId (costeo) y junta los textos
 * de embellecimiento. Exportada para test puro. */
export function fusionarFilas(filas: TallaBoxInput[]): TallaBoxInput[] {
  const porLlave = new Map<string, TallaBoxInput>();
  for (const f of filas) {
    const key = identityKey(f.producto, f.sku, f.color, f.talla, f.genero);
    const prev = porLlave.get(key);
    if (!prev) { porLlave.set(key, { ...f, extras: f.extras ? { ...f.extras } : undefined }); continue; }
    prev.cantidad += f.cantidad;
    if (f.extras) {
      prev.extras = prev.extras ?? {};
      for (const [colId, texto] of Object.entries(f.extras)) {
        if (!prev.extras[colId]) prev.extras[colId] = texto;
        else if (!prev.extras[colId].includes(texto)) prev.extras[colId] = `${prev.extras[colId]}\n${texto}`;
      }
    }
  }
  return [...porLlave.values()];
}

async function leerFilas(env: Env, spreadsheetId: string): Promise<TallaBoxInput[]> {
  const token = await getGoogleAccessToken(env, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_DATA_RANGE)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 403 || res.status === 404) {
    throw new TraerTallasError(502, 'El portal no puede abrir el archivo de tallas (no está compartido con la cuenta del portal). Regenera el archivo o compártelo con la cuenta de servicio.');
  }
  if (!res.ok) throw new TraerTallasError(502, `Google Sheets respondió ${res.status} al leer el archivo de tallas.`);
  const json = await res.json<{ values?: unknown[][] }>();
  const out: TallaBoxInput[] = [];
  for (const raw of json.values ?? []) {
    const row = raw.map(v => (v == null ? '' : String(v)));
    const fila = filaASheetTalla(row);
    if (fila) out.push(fila);
  }
  return fusionarFilas(out);
}

export interface TraerTallasResult extends CapturarTallasResponse {
  /** Filas con cantidad en el archivo (todas, no solo las escritas). */
  filas: number;
}

/** Lee el Sheet del Proyecto y reconcilia sus líneas (crea/actualiza, nunca
 * borra). Escribe a lo más MAX_TALLAS_POR_REQUEST líneas por llamada; con
 * `restantes > 0` el cliente vuelve a llamar. */
export async function traerTallasDesdeSheet(env: Env, viewer: Identity, proyectoId: number): Promise<TraerTallasResult> {
  if (isNativeId(proyectoId)) throw new TraerTallasError(400, 'Este proyecto no tiene archivo de tallas: captura las tallas por cajitas.');
  const row = await getItem(env, 'proyectos', proyectoId, viewer, 'own');
  if (!row) throw new TraerTallasError(404, 'not found');
  let sheetUrl = '';
  try {
    const cols: { id: string; value?: string | null; text?: string | null }[] = JSON.parse(row.columns || '[]');
    const link = cols.find(c => c.id === PROYECTO_SHEET_LINK);
    if (link?.value) sheetUrl = (JSON.parse(link.value) as { url?: string }).url ?? '';
    if (!sheetUrl) sheetUrl = /https?:\/\/\S+/.exec(link?.text ?? '')?.[0] ?? '';
  } catch { /* sin link */ }
  const spreadsheetId = sheetUrl ? spreadsheetIdDe(sheetUrl) : null;
  if (!spreadsheetId) throw new TraerTallasError(400, 'El proyecto no tiene archivo de tallas. Primero créalo con "Crear archivo de tallas".');

  const filas = await leerFilas(env, spreadsheetId);
  if (filas.length === 0) {
    throw new TraerTallasError(400, 'El archivo de tallas no tiene ninguna cantidad capturada todavía.');
  }
  const result = await capturarTallas(env, viewer, proyectoId, filas, { maxEscrituras: MAX_TALLAS_POR_REQUEST });
  return { ...result, filas: filas.length };
}
