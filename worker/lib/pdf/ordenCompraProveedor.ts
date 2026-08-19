// worker/lib/pdf/ordenCompraProveedor.ts — Orden de Compra a Proveedor, generada
// nativa por el portal (2026-08-13). Reemplaza (para esta plantilla) el PDF que
// generaba Eledo vía cmp-tallas: su tabla de productos perdía Cantidad/Precio/
// Descuento/Subtotal (y el pie de firmas) cuando la descripción de un embelle-
// cimiento era larga — confirmado bisectando el payload real contra la API de
// Eledo. `wrapTable` (worker/lib/pdf/layout.ts) existe por esa razón: el
// renglón crece con el texto en vez de desalojar a sus columnas vecinas.
//
// v1 a propósito simple (Efraín, 2026-08-13): solo arma y devuelve el PDF —
// sin folio propio (cmp-tallas sigue siendo el ledger, pendiente conectarlo) y
// sin ceremonia de firma electrónica. Deja el espacio de firma FÍSICA (línea +
// nombre precargado, como el PDF de Eledo) para Elaborado/Revisado/Autorizado.
import type { Block, DocumentMeta } from './layout';
import { renderDocument } from './layout';
import { LOGO_JPG_BASE64, CMP_ORANGE } from './logo';
import { importeEnLetras, fmtNumMx } from '../importeEnLetras';

export interface OcProveedorLinea {
  producto: string;
  /** Zona/tipo de embellecimiento (Frente derecho, Etiqueta de propiedad,
   * Código de barras, Otros…) — el nombre del subitem de Embellecimientos en
   * Monday, sin el prefijo "✨". Vacío para líneas de producto normal (no
   * embellecimiento). Efraín, 2026-08-13: "no sale que es etiqueta y eso". */
  zona: string;
  sku: string;
  color: string;
  talla: string;
  unidad: string;
  moneda: string;
  precio: number;
  cantidad: number;
  /** Fracción 0..1 (0.2 = 20%), no porcentaje entero — así lo guarda Monday. */
  descuento: number;
}

export interface OcProveedorPdfInput {
  /** Folio de la orden ("OC-225") — lo asigna el ledger al GENERARLA. Vacío en
   * la vista previa ("Ver OC (portal)"), que no consume folio. */
  folioOrden: string;
  folioProyecto: string;
  folioOpp: string;
  nombreProyecto: string;
  proveedor: string;
  proveedorRazonSocial: string;
  comprador: string;
  fecha: string;
  metodoPago: string;
  condicionesPago: string;
  /** Notas al proveedor (worker/lib/ocNotas.ts) — texto libre de Compras que
   * se imprime tal cual en la OC. Vacío = el bloque no se dibuja. */
  notas: string;
  lineas: OcProveedorLinea[];
  elaboradoNombre: string;
  revisadoNombre: string;
  autorizadoNombre: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function fmtMoney(n: number, moneda: string): string {
  const s = n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `US$${s}` : `$${s}`;
}

function firmaBlock(label: string, nombre: string): Extract<Block, { kind: 'signature' }> {
  return { kind: 'signature', label, name: nombre || '—', detail: [] };
}

export function buildOrdenCompraProveedorPdf(input: OcProveedorPdfInput): Uint8Array {
  const moneda = input.lineas[0]?.moneda || 'MXN';
  const monto = input.lineas.reduce((s, l) => s + l.cantidad * l.precio * (1 - l.descuento), 0);
  const totalUnidades = input.lineas.reduce((s, l) => s + l.cantidad, 0);

  const blocks: Block[] = [
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Proveedor', input.proveedor],
        ['Razón social', input.proveedorRazonSocial],
        ...(input.folioOrden ? [['Folio OC', input.folioOrden] as [string, string]] : []),
        ['Folio oportunidad', input.folioOpp],
        ['Folio proyecto', input.folioProyecto],
        ['Comprador', input.comprador],
        ['Fecha', input.fecha],
      ],
    },
    { kind: 'divider' },
    {
      kind: 'wrapTable',
      wrapCols: [0, 1],
      columns: [
        { header: 'Producto', width: 0.20 },
        { header: 'Zona/Tipo', width: 0.11 },
        { header: 'Modelo', width: 0.08 },
        { header: 'Talla', width: 0.06 },
        { header: 'Unidad', width: 0.07 },
        { header: 'Moneda', width: 0.06 },
        { header: 'Cant.', width: 0.08, align: 'right' },
        { header: 'Precio', width: 0.10, align: 'right' },
        { header: 'Desc.', width: 0.06, align: 'right' },
        { header: 'Subtotal', width: 0.18, align: 'right' },
      ],
      rows: input.lineas.map(l => [
        l.producto,
        l.zona,
        [l.sku, l.color].filter(Boolean).join(', '),
        l.talla,
        l.unidad,
        l.moneda,
        String(l.cantidad),
        fmtMoney(l.precio, l.moneda),
        l.descuento > 0 ? `${Math.round(l.descuento * 100)}%` : '0%',
        fmtMoney(l.cantidad * l.precio * (1 - l.descuento), l.moneda),
      ]),
      headerFill: CMP_ORANGE,
      headerTextColor: '#ffffff',
    },
    { kind: 'spacer', height: 8 },
    // Dos columnas alineadas por renglón: términos de pago a la izquierda,
    // desglose de dinero a la derecha — para que Subtotal/IVA/Total salgan
    // pegados a su renglón correspondiente, no sueltos aparte (Efraín,
    // 2026-08-13: "tiene que quedar todo super claro").
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Método de pago', input.metodoPago || '—'],
        ['Subtotal', fmtMoney(monto, moneda)],
        ['Condiciones de pago', input.condicionesPago || '—'],
        ['IVA (16%)', fmtMoney(monto * 0.16, moneda)],
        ['Unidades', fmtNumMx(totalUnidades)],
        ['Total', fmtMoney(monto * 1.16, moneda)],
      ],
    },
    { kind: 'text', text: `Importe con IVA en letras: ${importeEnLetras(monto * 1.16, moneda)}`, size: 9, bold: true },
    // Notas al proveedor — arriba de las firmas a propósito: es parte de lo que
    // se está firmando, no un pie de página (Efraín, 2026-08-19).
    ...(input.notas.trim()
      ? [
          { kind: 'spacer', height: 8 },
          { kind: 'text', text: 'Notas para el proveedor', size: 9.5, bold: true },
          { kind: 'text', text: input.notas.trim(), size: 9 },
        ] as Block[]
      : []),
    { kind: 'spacer', height: 10 },
    firmaBlock('Elaborado por', input.elaboradoNombre),
    firmaBlock('Revisado por', input.revisadoNombre),
    firmaBlock('Autorizado por', input.autorizadoNombre),
  ];

  const meta: DocumentMeta = {
    title: 'Orden de Compra a Proveedor',
    subtitle: input.nombreProyecto,
    docId: input.folioOrden || `${input.folioProyecto}-${input.proveedor}`,
    generatedAt: input.fecha,
    logo: base64ToBytes(LOGO_JPG_BASE64),
    hideGeneratedByLine: true,
  };

  return renderDocument(meta, blocks);
}
