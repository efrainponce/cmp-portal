// Nombre con el que el navegador GUARDA un archivo bajado del portal.
//
// Nace del reporte de Elizabeth (2026-08-21): al dar "Descargar" en la
// cotización sin firmar, el Guardar como proponía `sin_firmar.pdf` — el nombre
// técnico del último segmento de la URL — y había que teclear a mano
// "OPP 0934 …" para archivarlo en la carpeta del cliente.
//
// IMPORTANTE: esto es SOLO presentación de la descarga (encabezado
// Content-Disposition de nuestras rutas de lectura). El nombre con el que el
// archivo se SUBE a Monday no se toca en ningún lado: DocuSeal liga la firma a
// la oportunidad por ese nombre (worker/lib/docuseal.ts + los `filename` que
// arman cotizacion.ts / oc.ts / proyectoTallas.ts). Renombrar la subida
// rompería ese amarre; renombrar la descarga no lo ve nadie más que quien
// guarda el archivo en su compu.
//
// El `name` del item de Monday ya trae el folio adelante
// ("OPP-0947 - CONOS-TRAFITAMBOS TORREON"), así que el prefijo sale de ahí y no
// hace falta leer la columna de folio por separado.

/** Quita lo que Windows/macOS no aceptan en un nombre de archivo. Los acentos
 * SÍ se conservan: el Content-Disposition los manda en `filename*=UTF-8''…`. */
export function limpiarNombreArchivo(texto: string): string {
  return texto
    .replace(/[\\/:*?"<>|]/g, ' ')          // ilegales en Windows
    .replace(/[\u0000-\u001f\u007f]/g, '')      // de control
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');                 // Windows tampoco guarda "algo."
}

/** Extensión de un nombre de archivo, o '' si no tiene una de verdad. Partir en
 * el último punto a secas le inventa extensión "11" a "INVENTARIO 5.11", así
 * que se exige al menos una letra — pdf/jpg/xlsx sí, versiones no. */
export function extensionDe(nombre: string): string {
  const m = nombre.match(/\.([A-Za-z0-9]{1,5})$/);
  return m && /[A-Za-z]/.test(m[1]) ? m[1].toLowerCase() : '';
}

/** Normaliza para COMPARAR (no para mostrar): "OPP-0934" y "OPP 0934" iguales. */
function clave(texto: string): string {
  return texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const MAX_ITEM = 90;
const MAX_ETIQUETA = 60;

/** `"OPP-0947 - CONOS TORREON - Cotización sin firmar.pdf"`.
 *
 * - `item`: el `name` del item de Monday (oportunidad o proyecto; ambos traen
 *   el folio adelante). Vacío = se usa solo la etiqueta.
 * - `etiqueta`: qué documento es. Puede ser el nombre original del archivo
 *   (documentación, tallas, OC de cmp-tallas) o una etiqueta nuestra
 *   ("Cotización sin firmar"). Si YA trae el folio del item se respeta tal
 *   cual: los PDFs que genera cmp-tallas ya vienen identificados y duplicar el
 *   folio solo alarga el nombre.
 */
export function nombreDescarga(opts: { item?: string | null; etiqueta?: string | null; ext?: string }): string {
  const ext = (opts.ext ?? 'pdf').replace(/^\./, '').toLowerCase();
  const item = limpiarNombreArchivo(opts.item ?? '').slice(0, MAX_ITEM).trim();
  // La extensión se quita para volver a ponerla al final (y que el recorte por
  // largo no se la coma). Se quita en bucle porque hay archivos en Monday que
  // ya venían con ella repetida: "cotizacion_0601_-_1.pdf.pdf".
  let base = opts.etiqueta ?? '';
  while (ext && base.toLowerCase().endsWith(`.${ext}`)) base = base.slice(0, -(ext.length + 1));
  const etiqueta = limpiarNombreArchivo(base).slice(0, MAX_ETIQUETA).trim();

  const sufijo = ext ? `.${ext}` : '';
  if (!item) return (etiqueta || 'archivo') + sufijo;
  if (!etiqueta) return item + sufijo;

  const folio = item.match(/OPP[\s-]?\d+/i)?.[0];
  if (folio && clave(etiqueta).includes(clave(folio))) return etiqueta + sufijo;

  return `${item} - ${etiqueta}${sufijo}`;
}
