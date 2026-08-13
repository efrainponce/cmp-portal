// worker/lib/cotizacion.ts — "Generar Cotización" nativo (Fase 2, plan "salir de
// Monday", 2026-08-12). Reimplementa cmp-tallas' api/generate_cotizacion.py 1:1:
// arma las líneas desde el mirror en vivo de Monday, genera los PDF con/sin
// precio vía Eledo (worker/lib/eledo.ts, el Worker llama a Eledo directo — ya no
// cmp-tallas de intermediario), sube ambos a Monday, pide firma DocuSeal SOLO de
// la versión con precio, mueve stage+grupo, folio propio en D1 (reemplaza el
// ledger de Google Sheets que llevaba cmp-tallas — nunca decrece, igual que allá).
// La imagen de producto sigue viniendo de Airtable (worker/lib/airtable.ts),
// degradación silenciosa si falla — igual que hoy.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { ownsItem } from './dal';
import {
  fetchItemWithSubitems, gql, moveItemToGroup, addFileToColumn, createUpdate,
  fetchUserById, createNotification, cvText, cvNum, firstPersonId, type MondayItem,
} from './monday';
import { BOARDS } from '../../shared/boards';
import { DEAL_STAGE_LABELS } from '../../shared/dealStages';
import { renderEledoPdf, ELEDO_TEMPLATE_COTIZACION } from './eledo';
import { createDocuSealSubmission } from './docuseal';
import { fetchAirtableImageUrl } from './airtable';
import { importeEnLetras } from './importeEnLetras';
import { getOrCreateDriveFolder, oportunidadRootFolderName, uploadPdfToDrive } from './drive';

export class CotizacionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Oportunidades (18395657596) — ids verificados contra shared/column-meta.gen.ts,
// mismos que cmp-tallas api/generate_cotizacion.py.
const OPP_FOLIO = 'pulse_id_mm0qcq0m';
const OPP_CONTACTO = 'deal_contact';
const OPP_VENDEDOR = 'deal_owner';
const OPP_CARGO = 'lookup_mm0xf2r5';
const OPP_INSTITUCION = 'lookup_mm1bs976';
const OPP_VIGENCIA = 'text_mm0gje0';
const OPP_ENTREGA = 'text_mm0gjrrd';
const OPP_COMENTARIOS = 'long_text_mm1m416j';
const OPP_FILE_CON_PRECIO = 'file_mm0fgrzq';
const OPP_FILE_SIN_PRECIO = 'file_mm0z6rze';
const OPP_COMPRAS = 'multiple_person_mm03qyw9';
const GROUP_CON_COTIZACION = 'topics'; // "Oportunidades con cotización" (cmp-tallas)

// Oportunidades subitems (18395657607)
const SUB_TIPO = 'lookup_mm07x7e7';         // "Embellecimiento" se salta
const SUB_AIRTABLE_ID = 'lookup_mm0z4exs';
const SUB_NOMBRE = 'text_mm0bkm1j';
const SUB_MARCA = 'lookup_mm0xn98d';
const SUB_SKU = 'lookup_mkzn7x9a';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_DESCRIPCION = 'lookup_mm0xw8p7';
const SUB_UNIDAD = 'lookup_mm0w4f4v';
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_PRECIO = 'numeric_mkzneg3d'; // "Precio de Venta C/U" — solo LECTURA aquí


const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ProductLine {
  NumPartida: number;
  Nombre: string;
  Marca: string;
  Modelo: string;
  Color: string;
  Url: string;
  Descripcion: string;
  Cantidad: number;
  Unidad: string;
  Precio: number;
}

/** Una línea por subitem que no sea "Embellecimiento", NumPartida secuencial —
 * mirror 1:1 de build_product_lines. `Url` se resuelve aparte (fetchAirtableImageUrl
 * es async; separarlo deja esta función pura y testeable). */
export function buildProductLines(subitems: MondayItem[]): { line: Omit<ProductLine, 'Url'>; airtableId: string }[] {
  const out: { line: Omit<ProductLine, 'Url'>; airtableId: string }[] = [];
  let partida = 1;
  for (const sub of subitems) {
    const cols = sub.column_values;
    if (cvText(cols, SUB_TIPO).toLowerCase() === 'embellecimiento') continue;
    out.push({
      line: {
        NumPartida: partida,
        Nombre: cvText(cols, SUB_NOMBRE),
        Marca: cvText(cols, SUB_MARCA),
        Modelo: cvText(cols, SUB_SKU),
        Color: cvText(cols, SUB_COLOR),
        Descripcion: cvText(cols, SUB_DESCRIPCION),
        Cantidad: cvNum(cols, SUB_CANTIDAD),
        Unidad: cvText(cols, SUB_UNIDAD),
        Precio: cvNum(cols, SUB_PRECIO),
      },
      airtableId: cvText(cols, SUB_AIRTABLE_ID),
    });
    partida++;
  }
  return out;
}

/** subtotal = Σ(Cantidad·Precio), IVA 16%, total = subtotal+IVA — mirror 1:1 de
 * _compute_totals. */
export function computeTotals(products: ProductLine[]): { subtotal: number; iva: number; total: number } {
  const subtotal = round2(products.reduce((s, p) => s + p.Cantidad * p.Precio, 0));
  const iva = round2(subtotal * 0.16);
  const total = round2(subtotal + iva);
  return { subtotal, iva, total };
}

interface EledoCotizacionArgs {
  folioCotizacion: string;
  cliente: string;
  cargo: string;
  institucion: string;
  vendedorName: string;
  vigencia: string;
  tiempoEntrega: string;
  comentarios: string;
  products: ProductLine[];
  subtotal: number;
  iva: number;
  total: number;
  conPrecio: boolean;
}

/** Payload de la plantilla Eledo de cotización — mirror 1:1 de generate_pdf_eledo
 * (sin la llamada HTTP, que vive en worker/lib/eledo.ts). La versión "sin precio"
 * quita el campo Precio de cada línea pero conserva Cantidad, y deja vacíos los
 * totales — regla exacta del Python, no una aproximación. */
export function buildEledoFile(args: EledoCotizacionArgs): Record<string, unknown> {
  const products = args.conPrecio
    ? args.products
    : args.products.map(({ Precio: _Precio, ...rest }) => rest);
  return {
    NumCotizacion: args.folioCotizacion,
    Cliente: args.cliente,
    Cargo: args.cargo,
    Institucion: args.institucion,
    DigitalSignature: args.vendedorName,
    Vendedor: args.vendedorName,
    vigencia: args.vigencia,
    Tiempo_de_entrega: args.tiempoEntrega,
    Comentarios: args.comentarios || '',
    products,
    SubtotalTotal: args.conPrecio ? args.subtotal : '',
    IvaTotal: args.conPrecio ? args.iva : '',
    TotalTotal: args.conPrecio ? args.total : '',
    TotalPalabras: args.conPrecio ? importeEnLetras(args.total) : '',
  };
}

/** "0053 - n" a partir de "OPP-0053" (todo lo que sigue al último "-") — mismo
 * formato que create_sheets_cot, folio propio en D1 en vez del ledger de Sheets. */
let cotizacionFolioTableReady = false;
async function nextCotizacionSeq(env: Env, itemId: number): Promise<number> {
  if (!cotizacionFolioTableReady) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS cotizacion_folios (item_id INTEGER PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0)`,
    ).run();
    cotizacionFolioTableReady = true;
  }
  await env.DB.prepare(
    `INSERT INTO cotizacion_folios (item_id, seq) VALUES (?, 1)
     ON CONFLICT(item_id) DO UPDATE SET seq = seq + 1`,
  ).bind(itemId).run();
  const row = await env.DB.prepare(`SELECT seq FROM cotizacion_folios WHERE item_id = ?`).bind(itemId).first<{ seq: number }>();
  return row?.seq ?? 1;
}

async function resolveVendedor(env: Env, personId: number | null, fallbackName: string): Promise<{ name: string; email: string }> {
  if (personId) {
    try {
      const user = await fetchUserById(env, personId);
      if (user) return { name: user.name, email: user.email };
    } catch { /* cae al fallback */ }
  }
  return { name: fallbackName || 'Vendedor', email: '' };
}

async function notifySkip(env: Env, itemId: number, reason: string): Promise<void> {
  try {
    await createUpdate(env, itemId, `⚠️ Proceso omitido: ${reason}`);
  } catch { /* best-effort */ }
}

async function notifyNoPrecio(env: Env, itemId: number, comprasPersonId: number | null, vendedorName: string): Promise<void> {
  const msg = `⚠️ Cotización NO generada: ningún producto tiene precio asignado.\nVendedor: ${vendedorName}. Por favor asignar precios en los subitems.`;
  try {
    await createUpdate(env, itemId, msg);
  } catch { /* best-effort */ }
  if (comprasPersonId) {
    try {
      await createNotification(env, comprasPersonId, itemId, msg);
    } catch { /* best-effort */ }
  }
}

export interface GenerarCotizacionResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  folio?: string;
  total?: number;
  pdfConPrecio?: string;
  pdfSinPrecio?: string;
  docusealId?: string;
}

/** Botón "Generar Cotización" — flujo completo nativo. `ownsItem` (no la zona):
 * genera y muta la oportunidad, mismo criterio que worker/lib/costeo.ts. */
export async function generarCotizacionNative(env: Env, itemId: number, viewer: Identity): Promise<GenerarCotizacionResult> {
  if (!(await ownsItem(env, 'oportunidades', itemId, viewer))) throw new CotizacionError(404, 'not found');

  const fetched = await fetchItemWithSubitems(env, itemId);
  if (!fetched) throw new CotizacionError(404, 'not found');
  const { item, subitems } = fetched;
  const cols = item.column_values;

  const folioOpp = cvText(cols, OPP_FOLIO) || String(itemId);
  const cliente = cvText(cols, OPP_CONTACTO);
  const cargo = cvText(cols, OPP_CARGO);
  const institucion = cvText(cols, OPP_INSTITUCION);
  const vigencia = cvText(cols, OPP_VIGENCIA);
  const tiempoEntrega = cvText(cols, OPP_ENTREGA);
  const comentarios = cvText(cols, OPP_COMENTARIOS);
  const dealOwnerName = cvText(cols, OPP_VENDEDOR);
  const dealOwnerId = firstPersonId(cols, OPP_VENDEDOR);
  const comprasPersonId = firstPersonId(cols, OPP_COMPRAS);

  const vendedor = await resolveVendedor(env, dealOwnerId, dealOwnerName);

  const rawLines = buildProductLines(subitems);
  if (rawLines.length === 0) {
    const reason = 'No hay líneas de producto (¿todos son Embellecimiento?)';
    await notifySkip(env, itemId, reason);
    return { ok: true, skipped: true, reason };
  }
  if (rawLines.every(r => r.line.Precio === 0)) {
    await notifyNoPrecio(env, itemId, comprasPersonId, dealOwnerName);
    return { ok: true, skipped: true, reason: 'Ningún producto tiene precio. Cotización no generada.' };
  }

  const products: ProductLine[] = await Promise.all(
    rawLines.map(async r => ({ ...r.line, Url: await fetchAirtableImageUrl(env, r.airtableId) })),
  );
  const { subtotal, iva, total } = computeTotals(products);

  const seq = await nextCotizacionSeq(env, itemId);
  const folioSuffix = folioOpp.includes('-') ? (folioOpp.split('-').pop() ?? folioOpp).trim() : folioOpp;
  const folioCotizacion = `${folioSuffix} - ${seq}`;
  const safeFolio = folioCotizacion.replace(/ /g, '_').replace(/\//g, '-');
  const filenameCP = `cotizacion_${safeFolio}.pdf`;
  const filenameSP = `cotizacion_${safeFolio}_sin_precio.pdf`;

  const baseArgs = {
    folioCotizacion, cliente, cargo, institucion, vendedorName: vendedor.name,
    vigencia, tiempoEntrega, comentarios, products, subtotal, iva, total,
  };

  // PDF "con precio" — camino crítico: si falla, se propaga (no hay nada que
  // subir a Monday ni que firmar). Mismo criterio que generate_cotizacion.py.
  const pdfCP = await renderEledoPdf(env, ELEDO_TEMPLATE_COTIZACION, buildEledoFile({ ...baseArgs, conPrecio: true }));
  const uploadCP = await addFileToColumn(env, itemId, OPP_FILE_CON_PRECIO, new Blob([pdfCP], { type: 'application/pdf' }), filenameCP);

  // Fase 5 "salir de Monday" (2026-08-13): depositar el PDF con precio en
  // "10. COT FINAL" de la carpeta de Drive de la Oportunidad — best-effort,
  // el PDF ya quedó en Monday aunque esto falle.
  if (env.DRIVE_NATIVE === '1') {
    try {
      const folder = await getOrCreateDriveFolder(env, itemId, oportunidadRootFolderName(folioOpp, item.name));
      await uploadPdfToDrive(env, folder.subfolders['10. COT FINAL'], filenameCP, pdfCP);
    } catch { /* best-effort */ }
  }

  // DocuSeal (firma del vendedor) — no fatal: el PDF ya quedó en Monday.
  let docusealId = '';
  try {
    docusealId = await createDocuSealSubmission(env, {
      name: String(itemId),
      pdfUrl: uploadCP.publicUrl,
      filename: filenameCP,
      signers: [{ role: 'Vendedor', name: vendedor.name, email: vendedor.email }],
    });
  } catch (err) {
    docusealId = `ERROR: ${String(err)}`;
  }

  // PDF "sin precio" — no fatal, igual que Python ("mirrors Make's builtin:Ignore").
  let pdfSinPrecioUrl = '';
  try {
    const pdfSP = await renderEledoPdf(env, ELEDO_TEMPLATE_COTIZACION, buildEledoFile({ ...baseArgs, conPrecio: false }));
    const uploadSP = await addFileToColumn(env, itemId, OPP_FILE_SIN_PRECIO, new Blob([pdfSP], { type: 'application/pdf' }), filenameSP);
    pdfSinPrecioUrl = uploadSP.publicUrl;
  } catch { /* non-fatal */ }

  // Auditoría + stage/grupo — best-effort como un solo bloque (mismo criterio
  // que move_to_cotizacion_stage/write_monday_update en Python: el PDF y la firma
  // ya están hechos, esto es organización visual + bitácora).
  try {
    await createUpdate(
      env, itemId,
      `**Cotización generada — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC**\n- ✅ ${folioCotizacion}`,
    );
  } catch { /* best-effort */ }
  try {
    await gql(
      env,
      `mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
      { b: String(BOARDS.oportunidades.id), i: String(itemId), cv: JSON.stringify({ deal_stage: { label: DEAL_STAGE_LABELS['6'] } }) },
    );
    await moveItemToGroup(env, itemId, GROUP_CON_COTIZACION);
  } catch { /* best-effort */ }

  return { ok: true, folio: folioCotizacion, total, pdfConPrecio: uploadCP.publicUrl, pdfSinPrecio: pdfSinPrecioUrl, docusealId };
}
