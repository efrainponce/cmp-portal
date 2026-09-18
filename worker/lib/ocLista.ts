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
import { listItems, linkedItemId, PROYECTO_OPP_REL } from './dal';
import { ensureOcLedger, numeroDeFolio, ocDeColumna, type OcEmitidaRow } from './ocLedger';

const PROYECTO_OC_PDF = 'file_mm0hj9pn';
const PROYECTO_ZONA = 'dropdown_mm0hnyv';
const PROYECTO_FOLIO = 'pulse_id_mm1a12gy';

export class OcListaError extends Error {
  status: 400 | 404;
  constructor(message: string, status: 400 | 404 = 400) { super(message); this.status = status; }
}

let tablaLista = false;
async function ensureOcPagoTable(env: Env): Promise<void> {
  if (tablaLista) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_pago (
    folio      TEXT PRIMARY KEY,
    pagada     INTEGER NOT NULL DEFAULT 0,
    por_email  TEXT,
    updated_at TEXT NOT NULL
  )`).run();
  tablaLista = true;
}

type Col = { id: string; text?: string | null };

/** Las OC de UN proyecto, a partir de su renglón del espejo. Pura. Las dos
 * copias de una orden (con y sin costos) comparten folio y salen en UNA fila. */
export function ordenesDeProyecto(row: MirrorItem): OcListaRow[] {
  let cols: Col[] = [];
  try { cols = JSON.parse(row.columns || '[]'); } catch { return []; }
  const texto = (id: string) => cols.find(c => c.id === id)?.text?.trim() ?? '';
  const oppId = linkedItemId(row, PROYECTO_OPP_REL);
  // Mismo key que arma el front (toR2Files): cuelga de la Oportunidad, o del
  // Proyecto cuando nació sin una. /api/files cae a Monday si no está en R2.
  const base = oppId != null ? `oportunidades/${oppId}` : `proyectos/${row.item_id}`;
  const url = (archivo: string) => `/api/files/${base}/oc/${encodeURIComponent(archivo)}`;

  const porFolio = new Map<string, OcListaRow>();
  for (const oc of ocDeColumna(texto(PROYECTO_OC_PDF))) {
    let fila = porFolio.get(oc.folio);
    if (!fila) {
      fila = {
        folio: oc.folio, proveedor: oc.proveedor,
        proyectoId: String(row.item_id), proyecto: row.name, proyectoFolio: texto(PROYECTO_FOLIO) || null,
        zona: texto(PROYECTO_ZONA) || null,
        url: null, urlSinCostos: null, monto: null, moneda: null, emitidaAt: null, pagada: false,
      };
      porFolio.set(oc.folio, fila);
    }
    if (oc.sinCostos) fila.urlSinCostos = url(oc.archivo);
    else { fila.url = url(oc.archivo); fila.proveedor = oc.proveedor; }
  }
  return [...porFolio.values()];
}

/** Todas las OC de los proyectos que el viewer puede LEER (scoping de dal.ts),
 * de la más reciente a la más vieja — el folio es global y nunca decrece, así
 * que ordena mejor que cualquier fecha (las del backfill comparten una sola). */
export async function listarOrdenesCompra(env: Env, viewer: Identity): Promise<OcListaRow[]> {
  const proyectos = await listItems(env, 'proyectos', viewer);
  const ordenes = proyectos.flatMap(ordenesDeProyecto);

  await Promise.all([ensureOcLedger(env), ensureOcPagoTable(env)]);
  const [ledger, pagos] = await Promise.all([
    env.DB.prepare(`SELECT folio, monto, moneda, emitida_at FROM oc_emitida WHERE motor != 'backfill'`)
      .all<Pick<OcEmitidaRow, 'folio' | 'monto' | 'moneda' | 'emitida_at'>>(),
    env.DB.prepare(`SELECT folio FROM oc_pago WHERE pagada = 1`).all<{ folio: string }>(),
  ]);
  const delLedger = new Map((ledger.results ?? []).map(r => [r.folio, r]));
  const pagadas = new Set((pagos.results ?? []).map(r => r.folio));
  for (const o of ordenes) {
    const l = delLedger.get(o.folio);
    if (l) { o.monto = l.monto; o.moneda = l.moneda; o.emitidaAt = l.emitida_at; }
    o.pagada = pagadas.has(o.folio);
  }
  return ordenes.sort((a, b) => numeroDeFolio(b.folio) - numeroDeFolio(a.folio));
}

/** Marca/desmarca una OC como pagada. El folio tiene que ser de una orden que
 * el viewer SÍ ve: sin eso, cualquiera con la ruta marcaría folios ajenos. */
export async function marcarPagada(env: Env, viewer: Identity, folio: string, pagada: boolean): Promise<void> {
  const f = folio.trim().toUpperCase();
  if (!numeroDeFolio(f)) throw new OcListaError('folio inválido');
  const visibles = await listarOrdenesCompra(env, viewer);
  if (!visibles.some(o => o.folio === f)) throw new OcListaError('orden no encontrada', 404);
  await env.DB.prepare(
    `INSERT INTO oc_pago (folio, pagada, por_email, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(folio) DO UPDATE SET pagada = excluded.pagada, por_email = excluded.por_email, updated_at = excluded.updated_at`,
  ).bind(f, pagada ? 1 : 0, viewer.email, new Date().toISOString()).run();
}
