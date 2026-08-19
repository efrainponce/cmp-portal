// worker/lib/oc.ts — "Generar OC" nativo (Fase 4, plan "salir de Monday",
// 2026-08-12). Reimplementa cmp-tallas' api/generate_oc.py 1:1: agrupa las
// líneas del Proyecto por proveedor, genera un PDF por proveedor vía Eledo
// (worker/lib/eledo.ts, directo — ya no cmp-tallas de intermediario), sube cada
// uno a Monday y pide firma DocuSeal de 3 firmantes en orden (Elaborado→
// Revisado→Autorizado). Revisado/Autorizado siguen hardcodeados (Pam/Elisa,
// mismos valores que cmp-tallas) — evita que una columna de Monday vacía tumbe
// la firma. Folio "OC-n" GLOBAL en D1 (nunca decrece — reemplaza el ledger de
// Google Sheets, mismo criterio que costeo/cotización/tallas).
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { postUpdate } from './nativeUpdates';
import { ownsItem, childrenOf, linkedItemId, getItemTrusted, PROYECTO_OPP_REL } from './dal';
import { fetchItemWithSubitems, addFileToColumn, fetchUserById, cvText, cvNum, firstPersonId, type MondayCol, type MondayItem } from './monday';
import { renderEledoPdf, ELEDO_TEMPLATE_OC } from './eledo';
import { createDocuSealSubmission } from './docuseal';
import { importeEnLetras } from './importeEnLetras';
import { getOrCreateDriveFolderForOportunidad, uploadPdfToDrive } from './drive';
import { isNativeId } from '../../shared/nativeId';
import { BOARDS } from '../../shared/boards';
import { mergeNativeCols } from './nativeMirrors';
import { oportunidadFileKey, putFile } from './r2';
import { generarOcProveedorPdf } from './ocProveedorPdf';
import { getOcNota } from './ocNotas';

// Proyecto (18395657594) — ids verificados contra shared/column-meta.gen.ts,
// mismos que cmp-tallas api/generate_oc.py.
const PROYECTO_FOLIO = 'pulse_id_mm1a12gy';
const PROYECTO_FOLIO_OPP = 'lookup_mm1d56mp';
const PROYECTO_COMPRAS = 'project_owner';
const PROYECTO_ELABORADO = 'multiple_person_mm164em1';
const PROYECTO_OC_PDF = 'file_mm0hj9pn';
const PROYECTO_METODO_PAGO = 'text_mm4cct6a';
const PROYECTO_COND_PAGO = 'text_mm4cdyjb';
const PROYECTO_COMENTARIOS_OC = 'text_mm4c74f8';

// Proyectos subitems (18395657609)
const SUB_PRODUCTO = 'text_mm0hs17x';
const SUB_SKU = 'text_mm0hyrfs';
const SUB_COLOR = 'text_mm0h4a1c';
const SUB_TALLA = 'text_mm1antcb';
const SUB_UNIDAD = 'text_mm56dbkm';
const SUB_MONEDA = 'text_mm1gdsvg';
const SUB_PRECIO = 'numeric_mm1dj4fp';
const SUB_CANTIDAD = 'numeric_mm0hj2q4';
const SUB_DESCUENTO = 'numeric_mm1dmsaz';
const SUB_PROVEEDOR_REL = 'board_relation_mm1cfgv5';
const SUB_PROVEEDOR_RZ = 'lookup_mm1d2y9b';

// Firmantes hardcodeados (idénticos a cmp-tallas — "previene BundleValidationError
// cuando la columna de personas está vacía"). Revisado/Autorizado SIEMPRE son
// estos dos; Elaborado se lee de Monday y cae a Pam si la columna está vacía.
const PAM_NAME = 'Pamela Ricalde Fernández';
const PAM_EMAIL = 'compras@mexicanadeproteccion.com';
const ELISA_NAME = 'Elisa Vallado';
const ELISA_EMAIL = 'administracion@mexicanadeproteccion.com';
const DEFAULT_COND_PAGO = '50/50, a contado, transferencia o efectivo';

function firstLinkedId(cols: MondayCol[], id: string): string | null {
  const raw = cols.find(c => c.id === id)?.value;
  if (!raw) return null;
  try {
    const ids = (JSON.parse(raw) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
    return ids.length > 0 ? String(ids[0]) : null;
  } catch {
    return null;
  }
}

export interface ProveedorLine {
  Producto: string;
  SKU: string;
  Color: string;
  Talla: string;
  Unidad: string;
  Moneda: string;
  Precio: number;
  Cantidad: number;
  descuento: string;
  Subtotal: number;
}

export interface ProveedorGroup {
  proveedorId: string;
  proveedorNombre: string;
  proveedorRZ: string;
  lines: ProveedorLine[];
}

/** Agrupa subitems por proveedor ligado — los sin proveedor se saltan. Mirror
 * 1:1 de group_subitems_by_proveedor. Exportada: pura, testeable. */
export function groupSubitemsByProveedor(subitems: MondayItem[], onlyProveedor?: string): Map<string, ProveedorGroup> {
  const groups = new Map<string, ProveedorGroup>();
  for (const sub of subitems) {
    const cols = sub.column_values;
    const provId = firstLinkedId(cols, SUB_PROVEEDOR_REL);
    if (!provId) continue;
    if (onlyProveedor && provId !== onlyProveedor) continue;

    let group = groups.get(provId);
    if (!group) {
      group = { proveedorId: provId, proveedorNombre: cvText(cols, SUB_PROVEEDOR_REL), proveedorRZ: cvText(cols, SUB_PROVEEDOR_RZ), lines: [] };
      groups.set(provId, group);
    }

    const precio = cvNum(cols, SUB_PRECIO);
    const cantidad = cvNum(cols, SUB_CANTIDAD);
    const descuento = cvNum(cols, SUB_DESCUENTO); // fracción 0..1
    const subtotal = Math.round(cantidad * precio * (1 - descuento) * 100) / 100;

    group.lines.push({
      Producto: cvText(cols, SUB_PRODUCTO),
      SKU: cvText(cols, SUB_SKU),
      Color: cvText(cols, SUB_COLOR),
      Talla: cvText(cols, SUB_TALLA),
      Unidad: cvText(cols, SUB_UNIDAD),
      Moneda: cvText(cols, SUB_MONEDA) || 'MXN',
      Precio: precio,
      Cantidad: cantidad,
      descuento: descuento > 0 ? `${Math.round(descuento * 100)}%` : '0%',
      Subtotal: subtotal,
    });
  }
  return groups;
}

/** monto = Σ Subtotal, moneda = la de la primera línea (todas comparten
 * proveedor, en la práctica comparten moneda). Mirror 1:1 de _group_totals. */
export function groupTotals(group: ProveedorGroup): { monto: number; moneda: string } {
  const monto = Math.round(group.lines.reduce((s, l) => s + l.Subtotal, 0) * 100) / 100;
  return { monto, moneda: group.lines[0]?.Moneda ?? 'MXN' };
}

export interface Signer { name: string; email: string }
export interface Signers { elaborado: Signer; revisado: Signer; autorizado: Signer }

async function resolveSigners(env: Env, elaboradoPersonId: number | null): Promise<Signers> {
  let elaborado: Signer = { name: PAM_NAME, email: PAM_EMAIL };
  if (elaboradoPersonId) {
    try {
      const user = await fetchUserById(env, elaboradoPersonId);
      if (user?.email) elaborado = { name: user.name, email: user.email };
    } catch { /* cae al fallback */ }
  }
  return {
    elaborado,
    revisado: { name: PAM_NAME, email: PAM_EMAIL },
    autorizado: { name: ELISA_NAME, email: ELISA_EMAIL },
  };
}

interface EledoOcArgs {
  folioOrden: string;
  folioProyecto: string;
  folioOpp: string;
  nombreProyecto: string;
  nombreCompras: string;
  proveedorNombre: string;
  proveedorRZ: string;
  signers: Signers;
  metodoPago: string;
  condPago: string;
  comentarios: string;
  products: ProveedorLine[];
  monto: number;
  moneda: string;
}

/** Payload de la plantilla Eledo de OC — mirror 1:1 de generate_oc.py's
 * generate_pdf_eledo (sin la llamada HTTP). "importe_en_letras" se calcula
 * sobre monto+IVA (16%), no sobre el subtotal — regla exacta del Python. */
export function buildEledoOcFile(a: EledoOcArgs): Record<string, unknown> {
  return {
    folio_oc: a.folioOrden,
    folio_proyecto: a.folioProyecto,
    folio_opp: a.folioOpp,
    nombre_proyecto: a.nombreProyecto,
    NombreCompras: a.nombreCompras,
    Proveedor: a.proveedorNombre,
    ProveedorRZ: a.proveedorRZ,
    NumCotizacion: a.folioOrden,
    elaboradopor: a.signers.elaborado.email,
    NombreElaborado: a.signers.elaborado.name,
    revisadopor: a.signers.revisado.email,
    NombreRevisado: a.signers.revisado.name,
    autorizadopor: a.signers.autorizado.email,
    NombreAutorizado: a.signers.autorizado.name,
    metodo_de_pago: a.metodoPago,
    condiciones_de_pago: a.condPago,
    comentarios: a.comentarios || '',
    importe_en_letras: importeEnLetras(Math.round(a.monto * 1.16 * 100) / 100, a.moneda),
    products: a.products,
  };
}

// Folio GLOBAL "OC-n" — nunca decrece, una sola fila en D1 (a diferencia de
// costeo/cotización/tallas, que son POR oportunidad/proyecto). Mirror 1:1 del
// conteo de filas del ledger de Sheets que hacía cmp-tallas.
let ocFolioTableReady = false;
async function nextOcFolio(env: Env): Promise<string> {
  if (!ocFolioTableReady) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_folios (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL DEFAULT 0)`).run();
    ocFolioTableReady = true;
  }
  await env.DB.prepare(`INSERT INTO oc_folios (id, seq) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET seq = seq + 1`).run();
  const row = await env.DB.prepare(`SELECT seq FROM oc_folios WHERE id = 1`).first<{ seq: number }>();
  return `OC-${row?.seq ?? 1}`;
}

export interface OrdenResult {
  proveedorId: string;
  proveedorNombre: string;
  folioOrden?: string;
  monto?: number;
  moneda?: string;
  pdfUrl?: string;
  docusealId?: string;
  error?: string;
}

export interface GenerarOcResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  ordenes: OrdenResult[];
}

/** Fila de D1 (MirrorItem) con el shape mínimo de MondayItem que
 * groupSubitemsByProveedor/groupTotals necesitan (solo leen `column_values`
 * — el resto de campos no se usan, se rellenan vacíos). Reusar esas dos
 * funciones puras evita reimplementar el agrupado por proveedor. */
function asMondayItemShape(row: MirrorItem): MondayItem {
  let column_values: MondayCol[] = [];
  try { column_values = JSON.parse(row.columns || '[]'); } catch { /* fila corrupta — sin columnas */ }
  return { id: String(row.item_id), name: row.name, updated_at: row.synced_at, group: null, parent_item: null, column_values };
}

/** "Generar OC" para un Proyecto nativo (Zona Efrain, "salir de Monday"):
 * mismo agrupado por proveedor y mismo folio global "OC-n" (D1, ya existía)
 * que el flujo real, pero el PDF se arma con el generador que ya corría en
 * paralelo como preview 100% D1 (`generarOcProveedorPdf`,
 * worker/lib/ocProveedorPdf.ts, 2026-08-13) en vez de Eledo, y va a R2 en
 * vez de a una columna de Monday. Sin firmas DocuSeal ni Drive. */
export async function generarOcNativeD1(
  env: Env, viewer: Identity, proyectoId: number,
  opts: { onlyProveedor?: string; metodoPago?: string; condPago?: string } = {},
): Promise<GenerarOcResult> {
  // Método/condiciones de pago llegan por request (ProveedorGrid) pero el PDF
  // los lee de las columnas del Proyecto — en el flujo real es Eledo quien
  // recibe los overrides. Se estampan antes de generar, o salen vacíos en el
  // PDF (prueba end-to-end en producción, 2026-08-18).
  const pago: Record<string, string> = {};
  if (opts.metodoPago) pago[PROYECTO_METODO_PAGO] = opts.metodoPago;
  if (opts.condPago) pago[PROYECTO_COND_PAGO] = opts.condPago;
  if (Object.keys(pago).length > 0) {
    try { await mergeNativeCols(env, 'proyectos', proyectoId, pago); }
    catch { /* best-effort: el PDF sale sin esos dos campos, no vale abortar la OC */ }
  }

  const subitems = (await childrenOf(env, 'proyectos', proyectoId, viewer)).map(asMondayItemShape);
  const groups = groupSubitemsByProveedor(subitems, opts.onlyProveedor);

  if (groups.size === 0) {
    return { ok: true, skipped: true, reason: 'No hay subitems con proveedor asignado.', ordenes: [] };
  }

  // Mismo prefijo/carpeta que documento/tallas (worker/lib/proyectoTallas.ts,
  // /api/proyectos/:id/documento) para reusar el gate de lectura existente de
  // /api/files/:key (solo sirve claves bajo "oportunidades/").
  const proyectoRow = await getItemTrusted(env, 'proyectos', proyectoId);
  const oppId = proyectoRow ? linkedItemId(proyectoRow, PROYECTO_OPP_REL) : null;

  const ordenes: OrdenResult[] = [];
  for (const group of groups.values()) {
    const orden: OrdenResult = { proveedorId: group.proveedorId, proveedorNombre: group.proveedorNombre };
    try {
      const { monto, moneda } = groupTotals(group);
      orden.monto = monto;
      orden.moneda = moneda;

      const folioOrden = await nextOcFolio(env);
      orden.folioOrden = folioOrden;

      const pdfBytes = await generarOcProveedorPdf(env, proyectoId, group.proveedorId, viewer);
      const safeRZ = (group.proveedorRZ || group.proveedorNombre).replace(/[^\w\- ]/g, '_').slice(0, 40).trim();
      const filename = `OC_${folioOrden}_${safeRZ}.pdf`;

      if (oppId != null) {
        const key = oportunidadFileKey(oppId, 'oc', filename);
        await putFile(env, key, new Blob([pdfBytes], { type: 'application/pdf' }));
        orden.pdfUrl = `/api/files/${key}`;
      }
    } catch (err) {
      orden.error = String(err);
    }
    ordenes.push(orden);
  }

  return { ok: !ordenes.some(o => o.error), ordenes };
}

/** Botón "Generar OC" — una orden por proveedor con subitems ligados.
 * `onlyProveedor`/`metodoPago`/`condPago`: overrides de un solo proveedor
 * (ProveedorGrid, botón por tarjeta) — mismo contrato que
 * worker/lib/automations.ts's generateOC. Sin filtro de "saltar proveedores con
 * OC vigente": Efraín lo revirtió el 2026-08-10 a propósito (Compras necesita
 * poder regenerar). `ownsItem`: genera y muta el Proyecto. */
export async function generarOcNative(
  env: Env, viewer: Identity, proyectoId: number,
  opts: { onlyProveedor?: string; metodoPago?: string; condPago?: string } = {},
): Promise<GenerarOcResult> {
  if (!(await ownsItem(env, 'proyectos', proyectoId, viewer))) return { ok: false, reason: 'not found', ordenes: [] };

  const fetched = await fetchItemWithSubitems(env, proyectoId);
  if (!fetched) return { ok: false, reason: 'not found', ordenes: [] };
  const { item, subitems } = fetched;
  const cols = item.column_values;

  const folioProyecto = cvText(cols, PROYECTO_FOLIO) || String(proyectoId);
  const folioOpp = cvText(cols, PROYECTO_FOLIO_OPP);
  const nombreCompras = cvText(cols, PROYECTO_COMPRAS);
  const metodoPago = opts.metodoPago || cvText(cols, PROYECTO_METODO_PAGO);
  const condPago = opts.condPago || cvText(cols, PROYECTO_COND_PAGO) || DEFAULT_COND_PAGO;
  // Comentarios del Proyecto = fallback; la nota que Compras escribió PARA ESTE
  // proveedor (worker/lib/ocNotas.ts) manda, y se resuelve dentro del loop
  // porque cada OC lleva la suya (Efraín, 2026-08-19).
  const comentariosProyecto = cvText(cols, PROYECTO_COMENTARIOS_OC);

  const signers = await resolveSigners(env, firstPersonId(cols, PROYECTO_ELABORADO));
  const groups = groupSubitemsByProveedor(subitems, opts.onlyProveedor);

  if (groups.size === 0) {
    const reason = 'No hay subitems con proveedor asignado.';
    try { await postUpdate(env, BOARDS.proyectos.id, proyectoId, `⚠️ Proceso omitido: ${reason}`); } catch { /* best-effort */ }
    return { ok: true, skipped: true, reason, ordenes: [] };
  }

  // Fase 5 "salir de Monday" (2026-08-13): carpeta de Drive de la Oportunidad
  // ligada — resuelta UNA vez, reusada por cada OC de este proyecto. Best-effort:
  // null cuando falla o no aplica, cada depósito de abajo se salta en silencio.
  let ocDriveFolderId: string | null = null;
  if (env.DRIVE_NATIVE === '1') {
    const oppId = Number(firstLinkedId(cols, PROYECTO_OPP_REL));
    if (Number.isFinite(oppId) && oppId > 0) {
      try {
        const resolved = await getOrCreateDriveFolderForOportunidad(env, oppId);
        ocDriveFolderId = resolved?.folder.subfolders['08. ODC PROVEEDOR'] ?? null;
      } catch { /* best-effort */ }
    }
  }

  const ordenes: OrdenResult[] = [];
  for (const group of groups.values()) {
    const orden: OrdenResult = { proveedorId: group.proveedorId, proveedorNombre: group.proveedorNombre };
    try {
      const { monto, moneda } = groupTotals(group);
      orden.monto = monto;
      orden.moneda = moneda;

      const folioOrden = await nextOcFolio(env);
      orden.folioOrden = folioOrden;

      const comentarios = (await getOcNota(env, proyectoId, group.proveedorId)) || comentariosProyecto;

      const pdfBytes = await renderEledoPdf(env, ELEDO_TEMPLATE_OC, buildEledoOcFile({
        folioOrden, folioProyecto, folioOpp, nombreProyecto: item.name, nombreCompras,
        proveedorNombre: group.proveedorNombre, proveedorRZ: group.proveedorRZ, signers,
        metodoPago, condPago, comentarios, products: group.lines, monto, moneda,
      }));

      const safeRZ = (group.proveedorRZ || group.proveedorNombre).replace(/[^\w\- ]/g, '_').slice(0, 40).trim();
      const filename = `OC_${folioOrden}_${safeRZ}.pdf`;
      const upload = await addFileToColumn(env, proyectoId, PROYECTO_OC_PDF, new Blob([pdfBytes], { type: 'application/pdf' }), filename);
      orden.pdfUrl = upload.publicUrl;

      if (ocDriveFolderId) {
        try { await uploadPdfToDrive(env, ocDriveFolderId, filename, pdfBytes); } catch { /* best-effort */ }
      }

      try {
        orden.docusealId = await createDocuSealSubmission(env, {
          name: String(proyectoId),
          pdfUrl: upload.publicUrl,
          filename,
          signers: [
            { role: 'Elaborado', name: signers.elaborado.name, email: signers.elaborado.email, order: 0 },
            { role: 'Revisado', name: signers.revisado.name, email: signers.revisado.email, order: 1 },
            { role: 'Autorizado', name: signers.autorizado.name, email: signers.autorizado.email, order: 2 },
          ],
        });
      } catch (err) {
        orden.docusealId = `ERROR: ${String(err)}`;
      }
    } catch (err) {
      orden.error = String(err);
    }
    ordenes.push(orden);
  }

  try {
    const lines = [
      '**Órdenes de Compra generadas**',
      ...ordenes.map(o => o.error ? `- ❌ ${o.proveedorNombre} → no se pudo generar` : `- ✅ ${o.folioOrden} | ${o.proveedorNombre}`),
    ];
    await postUpdate(env, BOARDS.proyectos.id, proyectoId, lines.join('\n'));
  } catch { /* best-effort — la(s) OC ya se emitieron */ }

  return { ok: !ordenes.some(o => o.error), ordenes };
}
