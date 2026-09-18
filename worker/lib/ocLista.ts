// worker/lib/ocLista.ts — el tablero "Lista de OC" (Elisa, 2026-09-18): TODAS
// las órdenes de compra en una sola lista, con su proyecto, zona y proveedor,
// para no tener que entrar a cada Proyecto a buscarlas.
//
// De dónde sale la lista: de la columna de archivos de cada Proyecto del
// espejo, NO de `oc_emitida`. Medido el día que se escribió: el espejo llegaba
// a OC-317 y el ledger seguía en OC-235 — producción emite por cmp-tallas
// (OC_NATIVE apagado), que sube el PDF directo a Monday y nunca escribe en el
// ledger. Montado sobre esa tabla, el tablero habría nacido sin las ~75 órdenes
// más recientes y sin ningún error que lo delatara. El ledger solo ENRIQUECE
// (monto, fecha, quién) cuando la fila existe y no es del backfill.
//
// Lo que sí es propio: "pagada". No existe en Monday, vive en `oc_pago`.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { OcListaRow } from '../../shared/dto';
import { listItems } from './dal';
import { ensureOcLedger, numeroDeFolio, type OcEmitidaRow } from './ocLedger';
import { montoCuadra } from '../../shared/ocMontoPdf';

const PROYECTO_OC_PDF = 'file_mm0hj9pn';
const PROYECTO_ZONA = 'dropdown_mm0hnyv';
const PROYECTO_FOLIO = 'pulse_id_mm1a12gy';

export class OcListaError extends Error {
  status: 400 | 404;
  constructor(message: string, status: 400 | 404 = 400) { super(message); this.status = status; }
}

let tablaLista = false;
async function ensureOcListaTables(env: Env): Promise<void> {
  if (tablaLista) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_pago (
      folio      TEXT PRIMARY KEY,
      pagada     INTEGER NOT NULL DEFAULT 0,
      por_email  TEXT,
      updated_at TEXT NOT NULL
    )`),
    // Lo que dice el PDF de la orden (shared/ocMontoPdf.ts). Lo lee el
    // navegador —pdfjs no corre en el Worker— y lo asienta una sola vez.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_monto (
      folio      TEXT PRIMARY KEY,
      subtotal   REAL NOT NULL,
      iva        REAL NOT NULL,
      total      REAL NOT NULL,
      moneda     TEXT,
      asset_id   TEXT,
      por_email  TEXT,
      updated_at TEXT NOT NULL
    )`),
  ]);
  tablaLista = true;
}

/** `OC_<folio>_<razón social>[_SIN-COSTOS].pdf`, sobre el NOMBRE del archivo ya
 * decodificado. `(\.pdf)+`: los proyectos clonados en Monday guardan la copia
 * como "….pdf.pdf", y con un regex que corta en el primer ".pdf" el nombre
 * quedaba trunco y el link daba 404 (OC-107, 2026-09-18). */
const OC_NOMBRE_RE = /^OC_(OC-\d+)_(.+?)(_SIN-COSTOS)?(?:\.pdf)+$/i;

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

type Col = { id: string; text?: string | null };

/** Las OC de UN proyecto, a partir de su renglón del espejo. Pura. Las dos
 * copias de una orden (con y sin costos) comparten folio y salen en UNA fila. */
export function ordenesDeProyecto(row: MirrorItem): OcListaRow[] {
  let cols: Col[] = [];
  try { cols = JSON.parse(row.columns || '[]'); } catch { return []; }
  const texto = (id: string) => cols.find(c => c.id === id)?.text?.trim() ?? '';
  // El key cuelga SIEMPRE del Proyecto, aunque tenga Oportunidad ligada. El key
  // por oportunidad obliga a /api/files a adivinar el proyecto
  // (proyectoForOportunidad), y cuando la oportunidad está ligada a dos —los
  // clones— cae en el otro y responde 404: medido, 15 de 279 links muertos.
  // Aquí el proyecto dueño del archivo ya se sabe. El costo: no pega al R2 de
  // `oportunidades/…` y siempre se sirve desde Monday, que es de donde sale
  // esta lista de todos modos.
  const url = (archivo: string) => `/api/files/proyectos/${row.item_id}/oc/${encodeURIComponent(archivo)}`;

  const porFolio = new Map<string, OcListaRow>();
  for (const entrada of texto(PROYECTO_OC_PDF).split(',').map(s => s.trim()).filter(Boolean)) {
    const archivo = decode(entrada.split('/').pop() ?? '');
    const assetId = /\/resources\/(\d+)\//.exec(entrada)?.[1] ?? null;
    const m = OC_NOMBRE_RE.exec(archivo);
    if (!m) continue;
    const folio = m[1].toUpperCase();
    let fila = porFolio.get(folio);
    if (!fila) {
      fila = {
        folio, proveedor: m[2].replace(/_/g, ' ').trim(),
        proyectoId: String(row.item_id), proyecto: row.name, proyectoFolio: texto(PROYECTO_FOLIO) || null,
        zona: texto(PROYECTO_ZONA) || null, tambienEn: [],
        url: null, urlSinCostos: null, assetId: null,
        subtotal: null, iva: null, total: null, moneda: null, emitidaAt: null, pagada: false,
      };
      porFolio.set(folio, fila);
    }
    if (m[3]) fila.urlSinCostos = url(archivo);
    else { fila.url = url(archivo); fila.assetId = assetId; fila.proveedor = m[2].replace(/_/g, ' ').trim(); }
  }
  return [...porFolio.values()];
}

/** Una fila por FOLIO. Un proyecto clonado en Monday se lleva la columna de
 * archivos, así que el mismo PDF aparece en el original y en el clon (10 folios
 * el 2026-09-18). Es UNA orden y se paga una vez: dos filas duplicarían el
 * dinero en los totales. Gana el proyecto más viejo (item_id menor = el
 * original) y los demás quedan como referencia en `tambienEn`. Pura. */
export function unaFilaPorFolio(filas: OcListaRow[]): OcListaRow[] {
  const porFolio = new Map<string, OcListaRow[]>();
  for (const f of filas) (porFolio.get(f.folio) ?? porFolio.set(f.folio, []).get(f.folio)!).push(f);
  const out: OcListaRow[] = [];
  for (const grupo of porFolio.values()) {
    grupo.sort((a, b) => Number(a.proyectoId) - Number(b.proyectoId));
    const [original, ...clones] = grupo;
    out.push({
      ...original,
      // El clon a veces es el único que conserva el PDF con costos.
      url: original.url ?? clones.find(c => c.url)?.url ?? null,
      assetId: original.url ? original.assetId : clones.find(c => c.url)?.assetId ?? null,
      tambienEn: clones.map(c => ({ proyectoId: c.proyectoId, proyectoFolio: c.proyectoFolio, proyecto: c.proyecto })),
    });
  }
  return out;
}

/** Todas las OC de los proyectos que el viewer puede LEER (scoping de dal.ts),
 * de la más reciente a la más vieja — el folio es global y nunca decrece, así
 * que ordena mejor que cualquier fecha (las del backfill comparten una sola). */
export async function listarOrdenesCompra(env: Env, viewer: Identity): Promise<OcListaRow[]> {
  const proyectos = await listItems(env, 'proyectos', viewer);
  const ordenes = unaFilaPorFolio(proyectos.flatMap(ordenesDeProyecto));

  await Promise.all([ensureOcLedger(env), ensureOcListaTables(env)]);
  const [ledger, pagos, montos] = await Promise.all([
    env.DB.prepare(`SELECT folio, monto, moneda, emitida_at FROM oc_emitida WHERE motor != 'backfill'`)
      .all<Pick<OcEmitidaRow, 'folio' | 'monto' | 'moneda' | 'emitida_at'>>(),
    env.DB.prepare(`SELECT folio FROM oc_pago WHERE pagada = 1`).all<{ folio: string }>(),
    env.DB.prepare(`SELECT folio, subtotal, iva, total, moneda, asset_id FROM oc_monto`)
      .all<{ folio: string; subtotal: number; iva: number; total: number; moneda: string | null; asset_id: string | null }>(),
  ]);
  const delLedger = new Map((ledger.results ?? []).map(r => [r.folio, r]));
  const pagadas = new Set((pagos.results ?? []).map(r => r.folio));
  const delPdf = new Map((montos.results ?? []).map(r => [r.folio, r]));
  for (const o of ordenes) {
    const l = delLedger.get(o.folio);
    if (l) { o.emitidaAt = l.emitida_at; o.subtotal = l.monto; o.moneda = l.moneda; }
    // Lo leído del PDF gana, y solo vale si es del asset que HOY está en la
    // columna. Por asset y no por nombre: una orden regenerada conserva el
    // nombre del archivo, pero Monday le da un asset nuevo — y se vuelve a leer.
    const m = delPdf.get(o.folio);
    if (m && m.asset_id === o.assetId) { o.subtotal = m.subtotal; o.iva = m.iva; o.total = m.total; o.moneda = m.moneda ?? o.moneda; }
    o.pagada = pagadas.has(o.folio);
  }
  return ordenes.sort((a, b) => numeroDeFolio(b.folio) - numeroDeFolio(a.folio));
}

async function ordenVisible(env: Env, viewer: Identity, folio: string): Promise<OcListaRow> {
  const f = folio.trim().toUpperCase();
  if (!numeroDeFolio(f)) throw new OcListaError('folio inválido');
  const orden = (await listarOrdenesCompra(env, viewer)).find(o => o.folio === f);
  if (!orden) throw new OcListaError('orden no encontrada', 404);
  return orden;
}

/** Marca/desmarca una OC como pagada. El folio tiene que ser de una orden que
 * el viewer SÍ ve: sin eso, cualquiera con la ruta marcaría folios ajenos. */
export async function marcarPagada(env: Env, viewer: Identity, folio: string, pagada: boolean): Promise<void> {
  const orden = await ordenVisible(env, viewer, folio);
  await env.DB.prepare(
    `INSERT INTO oc_pago (folio, pagada, por_email, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(folio) DO UPDATE SET pagada = excluded.pagada, por_email = excluded.por_email, updated_at = excluded.updated_at`,
  ).bind(orden.folio, pagada ? 1 : 0, viewer.email, new Date().toISOString()).run();
}

export interface MontoInput { subtotal: number; iva: number; total: number; moneda?: string | null }

/** Asienta lo que el navegador leyó del PDF de la orden. El server no puede
 * releer el PDF, así que valida lo que sí puede: que la orden sea visible, que
 * las tres cifras cuadren entre sí y que la moneda tenga forma de moneda.
 * Queda ligado al asset vigente y a quien lo leyó. */
export async function guardarMonto(env: Env, viewer: Identity, folio: string, input: MontoInput): Promise<void> {
  const orden = await ordenVisible(env, viewer, folio);
  if (!orden.url || !orden.assetId) throw new OcListaError('la orden no tiene PDF con costos');
  const { subtotal, iva, total } = input;
  if (![subtotal, iva, total].every(n => typeof n === 'number' && Number.isFinite(n)) || !montoCuadra(subtotal, iva, total)) {
    throw new OcListaError('subtotal + IVA no da el total');
  }
  const moneda = input.moneda && /^[A-Z]{3}$/.test(input.moneda) ? input.moneda : null;
  await env.DB.prepare(
    `INSERT INTO oc_monto (folio, subtotal, iva, total, moneda, asset_id, por_email, updated_at) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(folio) DO UPDATE SET subtotal = excluded.subtotal, iva = excluded.iva, total = excluded.total,
       moneda = excluded.moneda, asset_id = excluded.asset_id, por_email = excluded.por_email, updated_at = excluded.updated_at`,
  ).bind(orden.folio, subtotal, iva, total, moneda, orden.assetId, viewer.email, new Date().toISOString()).run();
}
