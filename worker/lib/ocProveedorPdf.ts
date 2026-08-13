// worker/lib/ocProveedorPdf.ts — arma los datos de la Orden de Compra a
// Proveedor (folio del Proyecto/Oportunidad + las líneas de ese proveedor,
// agrupadas igual que ProveedorGrid en el drawer) y delega el dibujo a
// worker/lib/pdf/ordenCompraProveedor.ts. Solo lectura — no liga ni sube nada
// a Monday, a diferencia de generateOC (worker/lib/automations.ts), que sigue
// siendo el flujo "oficial" (folio + firmas) mientras este se prueba en
// paralelo (Efraín, 2026-08-13).
import type { Env } from './env';
import type { Identity } from '../shared/types';
import { getItem, childrenOf } from './dal';
import { toItemDTO } from './serialize';
import type { ItemDTO } from '../shared/dto';
import { buildOrdenCompraProveedorPdf, type OcProveedorLinea } from './pdf/ordenCompraProveedor';

export class OcProveedorPdfError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const S_PRODUCTO = 'text_mm0hs17x';
const S_SKU = 'text_mm0hyrfs';
const S_COLOR = 'text_mm0h4a1c';
const S_TALLA = 'text_mm1antcb';
const S_UNIDAD = 'text_mm56dbkm';
const S_MONEDA = 'text_mm1gdsvg';
const S_PRECIO = 'numeric_mm1dj4fp';
const S_CANTIDAD = 'numeric_mm0hj2q4';
const S_DESCUENTO = 'numeric_mm1dmsaz';
const S_PROVEEDOR = 'board_relation_mm1cfgv5';
const S_PROVEEDOR_RAZON = 'lookup_mm1d2y9b';

const P_FOLIO = 'pulse_id_mm1a12gy';
const P_FOLIO_OPP = 'lookup_mm1d56mp';
const P_COMPRADOR = 'project_owner';
const P_METODO_PAGO = 'text_mm4cct6a';
const P_COND_PAGO = 'text_mm4cdyjb';

// Revisado/Autorizado son constantes fijas — mismo criterio que
// api/generate_oc.py (PAM_NAME/ELISA_NAME): esas dos firmas siempre las pone
// la misma persona, sin importar quién genera el documento.
const REVISADO_NOMBRE = 'Pamela Ricalde Fernández';
const AUTORIZADO_NOMBRE = 'Elisa Vallado';

function num(cols: ItemDTO['cols'], colId: string): number {
  const raw = (cols[colId]?.text || '0').replace(/,/g, '').trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function fechaHoy(): string {
  return new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function generarOcProveedorPdf(
  env: Env, proyectoId: number, proveedorId: string, viewer: Identity,
): Promise<Uint8Array> {
  const row = await getItem(env, 'proyectos', proyectoId, viewer);
  if (!row) throw new OcProveedorPdfError(404, 'proyecto no encontrado');

  const childRows = await childrenOf(env, 'proyectos', proyectoId, viewer);
  const proyecto = toItemDTO(row, 'proyectos', viewer.role, false);
  const children = childRows.map(r => toItemDTO(r, 'proyectos_sub', viewer.role, false));

  const lineasProveedor = children.filter(l => {
    const rel = l.cols[S_PROVEEDOR]?.value as { linked_item_ids?: string[] } | undefined;
    return rel?.linked_item_ids?.[0] === proveedorId;
  });
  if (lineasProveedor.length === 0) throw new OcProveedorPdfError(404, 'proveedor sin líneas en este proyecto');

  const first = lineasProveedor[0];
  const relText = first.cols[S_PROVEEDOR]?.text || '';
  const razonSocial = first.cols[S_PROVEEDOR_RAZON]?.text || relText;

  const lineas: OcProveedorLinea[] = lineasProveedor.map(l => ({
    producto: l.cols[S_PRODUCTO]?.text || l.name || '—',
    sku: l.cols[S_SKU]?.text || '',
    color: l.cols[S_COLOR]?.text || '',
    talla: l.cols[S_TALLA]?.text || '',
    unidad: l.cols[S_UNIDAD]?.text || '',
    moneda: l.cols[S_MONEDA]?.text || 'MXN',
    precio: num(l.cols, S_PRECIO),
    cantidad: num(l.cols, S_CANTIDAD),
    descuento: num(l.cols, S_DESCUENTO),
  }));

  return buildOrdenCompraProveedorPdf({
    folioProyecto: proyecto.cols[P_FOLIO]?.text || '',
    folioOpp: proyecto.cols[P_FOLIO_OPP]?.text || '',
    nombreProyecto: proyecto.name || '',
    proveedor: relText,
    proveedorRazonSocial: razonSocial,
    comprador: proyecto.cols[P_COMPRADOR]?.text || '',
    fecha: fechaHoy(),
    metodoPago: proyecto.cols[P_METODO_PAGO]?.text || '',
    condicionesPago: proyecto.cols[P_COND_PAGO]?.text || '',
    lineas,
    elaboradoNombre: proyecto.cols[P_COMPRADOR]?.text || '',
    revisadoNombre: REVISADO_NOMBRE,
    autorizadoNombre: AUTORIZADO_NOMBRE,
  });
}
