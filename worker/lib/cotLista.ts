// worker/lib/cotLista.ts — el tablero "Lista de cotizaciones" de Ventas (Efraín,
// 2026-09-24): TODAS las cotizaciones al cliente en una sola lista, con su
// oportunidad, cliente, vendedor y zona, para no entrar a cada Oportunidad a
// buscarlas. Mismo molde que la Lista de OC (worker/lib/ocLista.ts).
//
// De dónde sale la lista: de las columnas de archivo de cada Oportunidad del
// espejo — "Cotizaciones generadas" (sin firmar) y "Cotizaciones Firmadas" (por
// el vendedor). cmp-tallas sube ahí `cotizacion_<folio>_-_<n>.pdf` (los viejos,
// `cotización_<folio> - <n>.pdf`) y DocuSeal la firmada como `….pdf.pdf`.
//
// Las reglas (qué archivo es qué cotización, copias de oportunidades
// duplicadas, versiones) son puras y viven en shared/cotLista.ts.
//
// Lo que sí es propio: lo leído del PDF (fecha y totales), en `cot_pdf_datos`.
// Lo lee el navegador —pdfjs no corre en el Worker— y lo asienta una vez por
// asset; el histórico se asentó con scripts/cot-lista-backfill.mjs.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { CotListaRow } from '../../shared/dto';
import { etagFor, listItems } from './dal';
import { cotFechaValida, cotMontoCuadra } from '../../shared/cotMontoPdf';
import { cotizacionesDeOportunidad, marcarReemplazadas, porFecha, unaFilaPorFolio } from '../../shared/cotLista';

export class CotListaError extends Error {
  status: 400 | 404;
  constructor(message: string, status: 400 | 404 = 400) { super(message); this.status = status; }
}

let tablaLista = false;
export async function ensureCotListaTables(env: Env): Promise<void> {
  if (tablaLista) return;
  // Llave = el ARCHIVO leído (asset de Monday, o el nombre en una oportunidad
  // nativa que vive en R2), no el folio: una cotización regenerada con el mismo
  // nombre trae otro asset y se vuelve a leer. La fila existe = ya se leyó;
  // los totales pueden ir vacíos.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS cot_pdf_datos (
      llave      TEXT PRIMARY KEY,
      clave      TEXT NOT NULL,
      fecha      TEXT,
      subtotal   REAL,
      iva        REAL,
      total      REAL,
      moneda     TEXT,
      por_email  TEXT,
      updated_at TEXT NOT NULL
    )`).run();
  tablaLista = true;
}

/** ETag: las oportunidades que ve ESTE viewer (etagFor ya trae su scope) + lo
 * leído de los PDFs. El refresco de cada minuto contesta 304 sin armar nada. */
export async function etagCotLista(env: Env, viewer: Identity): Promise<string> {
  await ensureCotListaTables(env);
  const [opps, leidos] = await Promise.all([
    etagFor(env, 'oportunidades', viewer),
    env.DB.prepare(`SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') AS s FROM cot_pdf_datos`).first<{ s: string }>(),
  ]);
  return `"cot-lista:${opps.replace(/"/g, '')}:${leidos?.s ?? ''}"`;
}

/** Todas las cotizaciones de las oportunidades que el viewer puede LEER
 * (scoping de dal.ts: un vendedor ve las suyas y las de su zona). */
export async function listarCotizaciones(env: Env, viewer: Identity): Promise<CotListaRow[]> {
  await ensureCotListaTables(env);
  const [opps, leidos] = await Promise.all([
    listItems(env, 'oportunidades', viewer),
    env.DB.prepare(`SELECT llave, fecha, subtotal, iva, total, moneda FROM cot_pdf_datos`)
      .all<{ llave: string; fecha: string | null; subtotal: number | null; iva: number | null; total: number | null; moneda: string | null }>(),
  ]);
  const cotizaciones = marcarReemplazadas(unaFilaPorFolio(opps.flatMap(cotizacionesDeOportunidad)));
  const delPdf = new Map((leidos.results ?? []).map(r => [r.llave, r]));
  for (const c of cotizaciones) {
    const m = c.llave ? delPdf.get(c.llave) : undefined;
    if (!m) continue;
    c.pdfLeido = true;
    c.fecha = m.fecha;
    if (m.subtotal != null) { c.subtotal = m.subtotal; c.iva = m.iva; c.total = m.total; c.moneda = m.moneda; }
  }
  return cotizaciones.sort(porFecha);
}

export interface CotPdfDatosInput { fecha?: string | null; subtotal?: number | null; iva?: number | null; total?: number | null; moneda?: string | null }

/** Asienta lo que el navegador leyó del PDF. Solo de una cotización que el
 * viewer SÍ ve, y validado como en la Lista de OC: fecha real, cifras que
 * cuadran, moneda con forma de moneda. Ligado al archivo vigente (`llave`). */
export async function guardarCotPdfDatos(env: Env, viewer: Identity, clave: string, input: CotPdfDatosInput): Promise<void> {
  const k = clave.trim();
  if (!/^[01]-\d+-\d+$/.test(k)) throw new CotListaError('cotización inválida');
  const cot = (await listarCotizaciones(env, viewer)).find(c => c.clave === k);
  if (!cot) throw new CotListaError('cotización no encontrada', 404);
  if (!cot.llave) throw new CotListaError('la cotización no tiene PDF');
  const fecha = input.fecha ?? null;
  if (fecha != null && !cotFechaValida(fecha)) throw new CotListaError('fecha inválida');
  const { subtotal = null, iva = null, total = null } = input;
  const hayTotales = subtotal != null || iva != null || total != null;
  if (hayTotales && (![subtotal, iva, total].every(n => typeof n === 'number' && Number.isFinite(n)) || !cotMontoCuadra(subtotal!, iva!, total!))) {
    throw new CotListaError('subtotal + IVA no da el total');
  }
  const moneda = hayTotales && input.moneda && /^[A-Z]{3}$/.test(input.moneda) ? input.moneda : null;
  await env.DB.prepare(
    `INSERT INTO cot_pdf_datos (llave, clave, fecha, subtotal, iva, total, moneda, por_email, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(llave) DO UPDATE SET clave = excluded.clave, fecha = excluded.fecha, subtotal = excluded.subtotal, iva = excluded.iva,
       total = excluded.total, moneda = excluded.moneda, por_email = excluded.por_email, updated_at = excluded.updated_at`,
  ).bind(cot.llave, cot.clave, fecha, subtotal, iva, total, moneda, viewer.email, new Date().toISOString()).run();
}
