// worker/lib/cotizacionPdfs.ts — Resuelve los PDFs de cotización (columnas de
// archivo file_mm0fgrzq/file_mm0zjras en Oportunidades, sin firmar/firmada por el
// vendedor) a la URL firmada y embebible de Monday (mismo mecanismo que
// embellecimientoImagenes.ts: assetId -> fetchAssetPublicUrls). El link crudo que
// Monday guarda en `.text` (protected_static/...) exige sesión de monday.com y
// bloquea framing vía CSP frame-ancestors — por eso el worker transmite los bytes
// desde nuestro propio dominio (ver la ruta en worker/index.ts) en vez de mandar
// esa URL cruda al iframe del portal.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { getItem } from './dal';
import { fetchAssetPublicUrls } from './monday';
import { oportunidadFileKey } from './r2';
import type { RawCol } from './serialize';

export class CotizacionPdfError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SOLICITUD_COSTEO_COL = 'file_mm0z6rze'; // Solicitud de costeo (cotización sin precio)
const NO_FIRMADAS_COL = 'file_mm0fgrzq'; // Cotizaciones generadas (no firmadas por vendedor)
const FIRMADAS_COL = 'file_mm0zjras';    // Cotizaciones Firmadas

export type PdfKind = 'solicitud_costeo' | 'sin_firmar' | 'firmada';
const COL_BY_KIND: Record<PdfKind, string> = {
  solicitud_costeo: SOLICITUD_COSTEO_COL, sin_firmar: NO_FIRMADAS_COL, firmada: FIRMADAS_COL,
};

/** Carpeta en R2 por tipo de PDF, para una oportunidad NATIVA: ahí no hay
 * assets de Monday que resolver (el item no existe en Monday), los bytes los
 * escribe worker/lib/cotizacion.ts y el nombre queda en el marcador de la
 * columna de archivo (stampNativeFileMarker). Mismos nombres de carpeta que
 * usa el backfill de los PDFs de cmp-tallas, para que /api/files/... los sirva
 * igual. La convención vive aquí, en un solo lugar: quien escribe y quien lee
 * llaman a la misma función. */
const R2_CATEGORIA_BY_KIND: Record<PdfKind, string> = {
  solicitud_costeo: 'cotizacion-sin-precio', sin_firmar: 'cotizacion-no-firmada', firmada: 'cotizacion-firmada',
};

export function cotizacionR2Key(oppId: number, kind: PdfKind, filename: string): string {
  return oportunidadFileKey(oppId, R2_CATEGORIA_BY_KIND[kind], filename);
}

/** Bytes del PDF de una oportunidad NATIVA, leídos de R2 por el nombre que
 * quedó en el marcador de la columna. `undefined` si esa columna todavía no
 * tiene archivo; lanza 404 si el marcador existe pero el objeto no está. */
export async function nativeCotizacionPdf(
  env: Env, itemId: number, viewer: Identity, kind: PdfKind,
): Promise<{ bytes: ArrayBuffer; filename: string } | undefined> {
  const row = await getItem(env, 'oportunidades', itemId, viewer);
  if (!row) throw new CotizacionPdfError(404, 'not found');

  const files = parseFiles(row.columns, COL_BY_KIND[kind]);
  if (files.length === 0) return undefined;
  const filename = files[files.length - 1].name;
  const object = await env.FILES.get(cotizacionR2Key(itemId, kind, filename));
  if (!object) throw new CotizacionPdfError(404, 'el PDF no está en R2');
  return { bytes: await object.arrayBuffer(), filename };
}

// `assetId` solo existe cuando el archivo vive en Monday; en una oportunidad
// nativa el marcador solo guarda el nombre y los bytes están en R2.
interface FileEntry { name: string; assetId?: number }

function parseFiles(columnsJson: string, colId: string): FileEntry[] {
  try {
    const cols: RawCol[] = JSON.parse(columnsJson || '[]');
    const col = cols.find(c => c.id === colId);
    if (!col?.value) return [];
    return (JSON.parse(col.value) as { files?: FileEntry[] }).files ?? [];
  } catch {
    return [];
  }
}

/** URL firmada (embebible) del último PDF subido a la columna pedida, o undefined
 * si la Oportunidad no tiene ese archivo todavía. */
export async function resolveCotizacionPdfUrl(
  env: Env, itemId: number, viewer: Identity, kind: PdfKind,
): Promise<string | undefined> {
  const row = await getItem(env, 'oportunidades', itemId, viewer);
  if (!row) throw new CotizacionPdfError(404, 'not found');

  const files = parseFiles(row.columns, COL_BY_KIND[kind]);
  if (files.length === 0) return undefined;
  // Monday agrega los archivos en orden de subida — el último es el vigente.
  const last = files[files.length - 1];
  if (last.assetId == null) return undefined;   // nativo: ver nativeCotizacionPdf
  const urls = await fetchAssetPublicUrls(env, [String(last.assetId)]);
  return urls.get(String(last.assetId));
}
