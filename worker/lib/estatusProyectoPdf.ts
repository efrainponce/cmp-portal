// worker/lib/estatusProyectoPdf.ts — arma los datos del PDF "Estatus de proyecto"
// (worker/lib/pdf/estatusProyecto.ts) desde el mirror: el Proyecto, sus líneas
// (proyectos_sub) y el resumen por producto+color del tab Ejecución. Solo
// lectura y sin captura nueva (Efraín, 2026-09-21: "se hace con los datos que ya
// tenemos"). Igual criterio que cotizacionPreviewPdf.ts: no pasa por
// documents.ts, no se guarda, no toca Monday.
//
// Todo se serializa con `toItemDTO(..., viewer.role, ..., viewer.email)`, así
// que el PDF respeta la whitelist sin reglas propias: a un vendedor no le llega
// el Proveedor (ventas: cero proveedores) y la columna simplemente no sale.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { ItemDTO } from '../../shared/dto';
import { getItem, listItems, childrenOf, childrenOfMany } from './dal';
import { toItemDTO } from './serialize';
import { listProductoResumen, listProductoResumenMany, type ProductoResumenRow } from './productoResumen';
import { buildEstatusProyectoPdf, type EstatusLinea, type EstatusProyecto } from './pdf/estatusProyecto';
import { cargarImagenesParaPdf, skuKey, isSkuUsable } from './ocImagenes';
import type { PdfImageData } from './pdf/png';

export class EstatusProyectoPdfError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Tope de proyectos por PDF: hoy hay ~90 activos; más que esto es un filtro
 * mal puesto, no un reporte que alguien vaya a imprimir. */
export const ESTATUS_MAX_PROYECTOS = 150;

/** Tope de SKUs a los que se les busca foto por PDF. Cada foto es una lectura
 * de R2 (y la primera vez, un viaje a Airtable) dentro del presupuesto de
 * subrequests de UNA invocación del Worker; con más, el PDF por zona se cae
 * a medias. Los que sobran salen con "Sin foto" y la nota lo dice. */
export const ESTATUS_MAX_FOTOS = 24;

/** Fotos del catálogo por SKU (las mismas de la OC con imágenes, `oc_imagen`),
 * llave = SKU tal cual viene en la línea. Nunca tira: sin fotos es un PDF
 * válido, sin PDF no hay nada. */
async function fotosDe(env: Env, proyectos: EstatusProyecto[]): Promise<{ imagenes: Map<string, PdfImageData>; omitidas: number }> {
  const skus = [...new Set(proyectos.flatMap(p => p.lineas.map(l => l.sku.trim())).filter(isSkuUsable))];
  const buscar = skus.slice(0, ESTATUS_MAX_FOTOS);
  const imagenes = new Map<string, PdfImageData>();
  try {
    const porKey = await cargarImagenesParaPdf(env, buscar);
    for (const sku of buscar) {
      const img = porKey.get(skuKey(sku));
      if (img) imagenes.set(sku, img);
    }
  } catch (err) {
    console.error('estatus pdf: fotos', err);
  }
  return { imagenes, omitidas: skus.length - buscar.length };
}

const P_FOLIO = 'pulse_id_mm1a12gy';
const P_INSTITUCION = 'lookup_mm1dwn6';
const P_VENDEDOR = 'multiple_person_mm0hrnqq';
const P_ZONA = 'dropdown_mm0hnyv';
const P_ESTADO = 'project_status';
const P_FECHA_ENTREGA = 'date_mm0m1vfv';
const P_DOCUMENTACION = 'color_mm52csps';

const S_PRODUCTO = 'text_mm0hs17x';
const S_SKU = 'text_mm0hyrfs';
const S_COLOR = 'text_mm0h4a1c';
const S_CANTIDAD = 'numeric_mm0hj2q4';
const S_UNIDAD = 'text_mm56dbkm';
const S_PROVEEDOR = 'board_relation_mm1cfgv5';
const S_PROVEEDOR_RAZON = 'lookup_mm1d2y9b';
const S_ESTADO = 'color_mm0hqf79';
const S_COMENTARIO = 'text_mm20gzsb';
const S_ENTREGA_PROV = 'date_mm20xdtm';

function txt(cols: ItemDTO['cols'], id: string): string {
  return (cols[id]?.text ?? '').trim();
}

function fechaHoy(): string {
  return new Date().toLocaleDateString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Mexico_City',
  });
}

function aProyecto(
  row: MirrorItem, hijos: MirrorItem[], resumen: ProductoResumenRow[], viewer: Identity,
): EstatusProyecto {
  const p = toItemDTO(row, 'proyectos', viewer.role, false, undefined, viewer.email);
  const lineas: EstatusLinea[] = hijos
    .map(h => toItemDTO(h, 'proyectos_sub', viewer.role, false, undefined, viewer.email))
    .map(l => ({
      producto: txt(l.cols, S_PRODUCTO) || l.name || '—',
      sku: txt(l.cols, S_SKU),
      color: txt(l.cols, S_COLOR),
      cantidad: Number(txt(l.cols, S_CANTIDAD).replace(/,/g, '')) || 0,
      unidad: txt(l.cols, S_UNIDAD),
      proveedor: txt(l.cols, S_PROVEEDOR) || txt(l.cols, S_PROVEEDOR_RAZON),
      estado: txt(l.cols, S_ESTADO),
      comentario: txt(l.cols, S_COMENTARIO),
      entrega: txt(l.cols, S_ENTREGA_PROV),
    }));
  const resumenes: Record<string, string> = {};
  for (const r of resumen) resumenes[`${r.producto}|${r.color}`] = r.resumen;
  return {
    folio: txt(p.cols, P_FOLIO),
    nombre: p.name || '',
    institucion: txt(p.cols, P_INSTITUCION),
    vendedor: txt(p.cols, P_VENDEDOR),
    zona: txt(p.cols, P_ZONA),
    estadoProyecto: txt(p.cols, P_ESTADO),
    fechaEntrega: txt(p.cols, P_FECHA_ENTREGA),
    documentacion: txt(p.cols, P_DOCUMENTACION),
    lineas,
    resumenes,
  };
}

/** PDF de UN proyecto. 404 si no existe o no es del viewer (nunca 403). */
export async function generarEstatusProyectoPdf(
  env: Env, proyectoId: number, viewer: Identity,
): Promise<{ bytes: Uint8Array; nombre: string }> {
  const row = await getItem(env, 'proyectos', proyectoId, viewer);
  if (!row) throw new EstatusProyectoPdfError(404, 'proyecto no encontrado');
  const [hijos, resumen] = await Promise.all([
    childrenOf(env, 'proyectos', proyectoId, viewer),
    listProductoResumen(env, proyectoId),
  ]);
  const proyectos = [aProyecto(row, hijos, resumen, viewer)];
  const { imagenes, omitidas } = await fotosDe(env, proyectos);
  const bytes = buildEstatusProyectoPdf({ proyectos, fecha: fechaHoy(), imagenes, fotosOmitidas: omitidas });
  return { bytes, nombre: row.name };
}

/** PDF de VARIOS proyectos: los que la lista tiene en pantalla (ya filtrados por
 * zona, vendedor o búsqueda). Los ids se cruzan contra `listItems` con el scope
 * del viewer — un id ajeno simplemente no aparece. Salen ordenados por zona y
 * vendedor, que es como se reparte la hoja impresa. */
export async function generarEstatusProyectosPdf(
  env: Env, ids: number[], viewer: Identity, alcance?: string,
): Promise<Uint8Array> {
  if (ids.length === 0) throw new EstatusProyectoPdfError(400, 'faltan los proyectos (ids)');
  if (ids.length > ESTATUS_MAX_PROYECTOS) {
    throw new EstatusProyectoPdfError(400, `máximo ${ESTATUS_MAX_PROYECTOS} proyectos por PDF — filtra por zona o vendedor`);
  }
  const pedidos = new Set(ids);
  const rows = (await listItems(env, 'proyectos', viewer)).filter(r => pedidos.has(r.item_id));
  if (rows.length === 0) throw new EstatusProyectoPdfError(404, 'ningún proyecto encontrado');

  const propios = rows.map(r => r.item_id);
  const [hijos, resumenes] = await Promise.all([
    childrenOfMany(env, 'proyectos', propios, viewer),
    listProductoResumenMany(env, propios),
  ]);
  const proyectos = rows
    .map(r => aProyecto(r, hijos.get(r.item_id) ?? [], resumenes.get(r.item_id) ?? [], viewer))
    .sort((a, b) =>
      a.zona.localeCompare(b.zona) || a.vendedor.localeCompare(b.vendedor) || a.folio.localeCompare(b.folio));
  const { imagenes, omitidas } = await fotosDe(env, proyectos);
  return buildEstatusProyectoPdf({ proyectos, alcance, fecha: fechaHoy(), imagenes, fotosOmitidas: omitidas });
}
