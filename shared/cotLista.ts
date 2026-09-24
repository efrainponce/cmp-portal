// shared/cotLista.ts — reglas PURAS de la "Lista de cotizaciones" de Ventas
// (worker/lib/cotLista.ts): qué archivo es qué cotización, las copias que se
// lleva una oportunidad duplicada y qué versión es la vigente. Aquí y no en el
// worker para que scripts/cot-lista-backfill.mjs las importe directo con Node
// (type stripping): por eso solo `import type`, que Node borra.
import type { MirrorItem } from './types';
import type { CotListaRow } from './dto';

const OPP_SIN_FIRMAR = 'file_mm0fgrzq';
const OPP_FIRMADA = 'file_mm0zjras';
const OPP_FOLIO = 'pulse_id_mm0qcq0m';
const OPP_INSTITUCION = 'lookup_mm1bs976';
const OPP_CONTACTO = 'deal_contact';
const OPP_ZONA = 'dropdown_mm03g067';
const OPP_VENDEDOR = 'deal_owner';
const OPP_ETAPA = 'deal_stage';

/** `cotizacion_1109_-_1.pdf`, `cotización_0167 - 1.pdf`, `….pdf.pdf` (la
 * firmada) → folio "1109-1". Sobre el nombre ya decodificado y sin acentos.
 * Deja fuera `…_sin_precio.pdf` (la solicitud de costeo) y los PDFs que alguien
 * subió a mano con otro nombre (1 de 2,384 el día que se escribió).
 *
 * El folio SOLO no identifica la cotización: el contador se reinició al pasar
 * de las hojas de cálculo ("cotización_0282 - 1", abril) a cmp-tallas
 * ("cotizacion_0282_-_1", agosto), y 19 oportunidades traen las dos — PDFs
 * distintos con el mismo folio. `era` las separa (1 = el formato con guiones
 * bajos, siempre el más nuevo) y va en la `clave` de la fila. */
const COT_NOMBRE_RE = /^cotizacion[ _]+(\d+)[ _]*-[ _]*(\d+)(?:\.pdf)+$/i;

export interface FolioCot { folio: string; numero: string; version: number; era: 0 | 1; clave: string }

export function folioDeArchivo(nombre: string): FolioCot | null {
  const limpio = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const m = COT_NOMBRE_RE.exec(limpio);
  if (!m) return null;
  const version = Number(m[2]);
  const era = /_-_/.test(limpio) ? 1 : 0;
  return { folio: `${m[1]}-${version}`, numero: m[1], version, era, clave: `${era}-${m[1]}-${version}` };
}

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

type Col = { id: string; text?: string | null };

/** Las cotizaciones de UNA oportunidad, a partir de su renglón del espejo.
 * Pura. La copia sin firmar y la firmada comparten folio y salen en UNA fila. */
export function cotizacionesDeOportunidad(row: MirrorItem): CotListaRow[] {
  let cols: Col[] = [];
  try { cols = JSON.parse(row.columns || '[]'); } catch { return []; }
  const texto = (id: string) => cols.find(c => c.id === id)?.text?.trim() ?? '';
  // Mismos keys de /api/files que el tab Documentación (toR2Files): R2 primero
  // y Monday de respaldo, con el scoping de la oportunidad.
  const url = (categoria: string, archivo: string) => `/api/files/oportunidades/${row.item_id}/${categoria}/${encodeURIComponent(archivo)}`;
  const archivos = (colId: string) => texto(colId).split(',').map(s => s.trim()).filter(Boolean).map(entrada => {
    const archivo = decode(entrada.split('/').pop() ?? '');
    const assetId = /\/resources\/(\d+)\//.exec(entrada)?.[1] ?? null;
    return { archivo, llave: assetId ?? `r2:${row.item_id}/${archivo}`, f: folioDeArchivo(archivo) };
  });

  const oppFolio = texto(OPP_FOLIO) || null;
  const base = (f: FolioCot): CotListaRow => ({
    clave: f.clave, folio: f.folio, numero: f.numero, version: f.version, era: f.era,
    oportunidadId: String(row.item_id), oportunidad: row.name, oportunidadFolio: oppFolio,
    institucion: texto(OPP_INSTITUCION) || null, contacto: texto(OPP_CONTACTO) || null,
    zona: texto(OPP_ZONA) || null, vendedor: texto(OPP_VENDEDOR) || null, etapa: texto(OPP_ETAPA) || null,
    tambienEn: [], reemplazadaPor: null, url: null, urlFirmada: null, llave: null,
    fecha: null, subtotal: null, iva: null, total: null, moneda: null, pdfLeido: false,
  });

  const porClave = new Map<string, CotListaRow>();
  // Monday agrega en orden de subida: si un nombre se repite, gana el último.
  for (const { archivo, llave, f } of archivos(OPP_SIN_FIRMAR)) {
    if (!f) continue;
    const fila = porClave.get(f.clave) ?? porClave.set(f.clave, base(f)).get(f.clave)!;
    fila.url = url('cotizacion-no-firmada', archivo);
    fila.llave = llave;
  }
  for (const { archivo, llave, f } of archivos(OPP_FIRMADA)) {
    if (!f) continue;
    const fila = porClave.get(f.clave) ?? porClave.set(f.clave, base(f)).get(f.clave)!;
    fila.urlFirmada = url('cotizacion-firmada', archivo);
    // Solo firmada: su PDF es el que se lee.
    if (!fila.url) fila.llave = llave;
  }
  return [...porClave.values()];
}

/** "OPP-1109" → "1109". */
function numeroDeOpp(folio: string | null): string | null {
  const m = /(\d+)\s*$/.exec(folio ?? '');
  return m ? m[1] : null;
}

/** Una fila por cotización (`clave`). Duplicar una oportunidad en Monday se lleva sus columnas
 * de archivo: OPP-1107/1108/1109 traen las cotizaciones 0624-1 y 0624-2 de la
 * OPP-0624 de la que salieron. Es UNA cotización. Se queda en la oportunidad
 * cuyo folio es el de la cotización (la 0624 es de OPP-0624); si esa no está a
 * la vista, en la más vieja (item_id menor = el original). Las demás quedan de
 * referencia en `tambienEn`. Pura. */
export function unaFilaPorFolio(filas: CotListaRow[]): CotListaRow[] {
  const porClave = new Map<string, CotListaRow[]>();
  for (const f of filas) (porClave.get(f.clave) ?? porClave.set(f.clave, []).get(f.clave)!).push(f);
  const out: CotListaRow[] = [];
  for (const grupo of porClave.values()) {
    const esDueña = (c: CotListaRow) => Number(numeroDeOpp(c.oportunidadFolio)) === Number(c.numero);
    grupo.sort((a, b) => Number(esDueña(b)) - Number(esDueña(a)) || Number(a.oportunidadId) - Number(b.oportunidadId));
    const [dueña, ...copias] = grupo;
    const conPdf = dueña.url ? dueña : copias.find(c => c.url) ?? dueña;
    const conFirma = dueña.urlFirmada ? dueña : copias.find(c => c.urlFirmada) ?? dueña;
    out.push({
      ...dueña,
      url: conPdf.url,
      urlFirmada: conFirma.urlFirmada,
      llave: conPdf.url ? conPdf.llave : conFirma.llave,
      tambienEn: copias.map(c => ({ oportunidadId: c.oportunidadId, oportunidadFolio: c.oportunidadFolio, oportunidad: c.oportunidad })),
    });
  }
  return out;
}

/** Más nueva primero: la era (el formato de cmp-tallas siempre es posterior
 * al de las hojas) y luego la versión. Pura. */
function masNueva(a: CotListaRow, b: CotListaRow): number {
  return b.era - a.era || b.version - a.version;
}

/** Versiones: "1109 - 2" reemplaza a "1109 - 1" (Nueva versión = se cotiza
 * otra vez la misma oportunidad). La más nueva de cada número queda vigente;
 * las demás apuntan a ella y no suman — igual que las re-emisiones de la Lista
 * de OC. Pura. */
export function marcarReemplazadas(filas: CotListaRow[]): CotListaRow[] {
  const vigente = new Map<string, CotListaRow>();
  for (const c of filas) {
    const k = String(Number(c.numero));
    const actual = vigente.get(k);
    if (!actual || masNueva(c, actual) < 0) vigente.set(k, c);
  }
  return filas.map(c => {
    const v = vigente.get(String(Number(c.numero)))!;
    return { ...c, reemplazadaPor: v.clave === c.clave ? null : v.folio };
  });
}

/** De la más reciente a la más vieja por la fecha impresa; sin fecha (PDF aún
 * sin leer), por número y versión, que crecen con el tiempo. */
export function porFecha(a: CotListaRow, b: CotListaRow): number {
  if (a.fecha && b.fecha && a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
  return Number(b.numero) - Number(a.numero) || masNueva(a, b);
}

