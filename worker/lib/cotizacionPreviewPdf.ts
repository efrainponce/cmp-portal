// worker/lib/cotizacionPreviewPdf.ts — arma los datos de la Cotización (vista
// previa portal) desde las líneas VIGENTES de la Oportunidad (el mirror de
// Monday siempre es la vigente — worker/lib/quoteVersions.ts) y delega el
// dibujo a worker/lib/pdf/cotizacionPreview.ts. Solo lectura, igual criterio
// que worker/lib/ocProveedorPdf.ts: no liga ni sube nada a Monday, no pasa por
// documents.ts (D1) — la oficial sigue siendo la de Eledo (docs/documentos-
// firma.md), esto es un preview desechable.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { getItem, childrenOf } from './dal';
import { toItemDTO } from './serialize';
import type { ItemDTO } from '../../shared/dto';
import { buildCotizacionPreviewPdf, type CotizacionPreviewLinea } from './pdf/cotizacionPreview';
import { QUOTE_TERMS } from '../../shared/quoteTerms';

export class CotizacionPreviewPdfError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const OPP_FOLIO = 'pulse_id_mm0qcq0m';
const OPP_VENDEDOR = 'deal_owner';
const OPP_CONTACTO = 'deal_contact';
const OPP_INSTITUCION = 'lookup_mm1bs976';

const SUB_PRODUCTO_NOMBRE = 'lookup_mm0x4kda';
const SUB_PRODUCTO_TXT = 'text_mm0bkm1j';
const SUB_SKU = 'lookup_mkzn7x9a';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_EMB_STATUS = 'color_mm1b34bg';
const SUB_PRECIO = 'numeric_mkzneg3d';
const EMB_LABEL_CON = 'Con Embellecimiento';

function num(cols: ItemDTO['cols'], colId: string): number {
  const raw = (cols[colId]?.text || '0').replace(/,/g, '').trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function termOf(cols: ItemDTO['cols'], id: string): string {
  const raw = (cols[id]?.text ?? '').trim();
  if (raw) return raw;
  return QUOTE_TERMS.find(t => t.id === id)?.fallback ?? '';
}

function fechaHoy(): string {
  return new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function generarCotizacionPreviewPdf(
  env: Env, oppId: number, viewer: Identity,
): Promise<Uint8Array> {
  const row = await getItem(env, 'oportunidades', oppId, viewer);
  if (!row) throw new CotizacionPreviewPdfError(404, 'oportunidad no encontrada');

  const childRows = await childrenOf(env, 'oportunidades', oppId, viewer);
  if (childRows.length === 0) throw new CotizacionPreviewPdfError(422, 'la oportunidad no tiene líneas de producto');

  const opp = toItemDTO(row, 'oportunidades', viewer.role, false, undefined, viewer.email);
  const children = childRows.map(r => toItemDTO(r, 'oportunidades_sub', viewer.role, false, undefined, viewer.email));

  const lineas: CotizacionPreviewLinea[] = children.map(l => ({
    producto: l.cols[SUB_PRODUCTO_NOMBRE]?.text || l.cols[SUB_PRODUCTO_TXT]?.text || l.name || '—',
    sku: l.cols[SUB_SKU]?.text || '',
    color: l.cols[SUB_COLOR]?.text || '',
    cantidad: num(l.cols, SUB_CANTIDAD),
    embellecimiento: (l.cols[SUB_EMB_STATUS]?.text ?? '').trim() === EMB_LABEL_CON,
    precio: num(l.cols, SUB_PRECIO),
  }));

  const [condicionesId, entregaId, vigenciaId] = QUOTE_TERMS.map(t => t.id);

  return buildCotizacionPreviewPdf({
    folio: opp.cols[OPP_FOLIO]?.text || String(oppId),
    nombreOportunidad: opp.name || '',
    institucion: opp.cols[OPP_INSTITUCION]?.text || '',
    cliente: opp.cols[OPP_CONTACTO]?.text || '',
    vendedor: opp.cols[OPP_VENDEDOR]?.text || '',
    fecha: fechaHoy(),
    tiempoEntrega: termOf(opp.cols, entregaId),
    vigencia: termOf(opp.cols, vigenciaId),
    condicionesComerciales: termOf(opp.cols, condicionesId),
    lineas,
  });
}
