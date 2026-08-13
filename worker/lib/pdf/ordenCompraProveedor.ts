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
import { LOGO_JPG_BASE64 } from './logo';

export interface OcProveedorLinea {
  producto: string;
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
  folioProyecto: string;
  folioOpp: string;
  nombreProyecto: string;
  proveedor: string;
  proveedorRazonSocial: string;
  comprador: string;
  fecha: string;
  metodoPago: string;
  condicionesPago: string;
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

// ── Importe en letras (mismo algoritmo que api/generate_oc.py:_num_a_palabras,
//    portado 1:1 para que el texto salga idéntico al que ya conocen en compras) ──
const ONES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const VEINTI = ['VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO',
  'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const TENS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const HUNDREDS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function tresCifras(n: number): string {
  if (n === 0) return '';
  const parts: string[] = [];
  let rest = n;
  if (rest >= 100) {
    const c = Math.floor(rest / 100);
    rest = rest % 100;
    if (c === 1 && rest === 0) return 'CIEN';
    parts.push(HUNDREDS[c]);
  }
  if (rest === 0) {
    // nada
  } else if (rest < 20) {
    parts.push(ONES[rest]);
  } else if (rest < 30) {
    parts.push(VEINTI[rest - 20]);
  } else {
    const d = Math.floor(rest / 10);
    const u = rest % 10;
    parts.push(TENS[d] + (u ? ' Y ' + ONES[u] : ''));
  }
  return parts.filter(Boolean).join(' ');
}

function numeroAPalabras(n: number): string {
  if (n === 0) return 'CERO';
  const parts: string[] = [];
  let rest = n;
  if (rest >= 1_000_000) {
    const m = Math.floor(rest / 1_000_000);
    rest = rest % 1_000_000;
    parts.push(m === 1 ? 'UN MILLON' : numeroAPalabras(m) + ' MILLONES');
  }
  if (rest >= 1000) {
    const k = Math.floor(rest / 1000);
    rest = rest % 1000;
    parts.push(k === 1 ? 'MIL' : tresCifras(k) + ' MIL');
  }
  if (rest > 0) parts.push(tresCifras(rest));
  return parts.filter(Boolean).join(' ');
}

export function importeEnLetras(monto: number, moneda: string = 'MXN'): string {
  const pesos = Math.trunc(monto);
  const centavos = Math.round((monto - pesos) * 100);
  const esMxn = moneda.toUpperCase() === 'MXN' || moneda.toUpperCase() === 'MN';
  const centavosStr = String(centavos).padStart(2, '0');
  return `${numeroAPalabras(pesos)} ${esMxn ? 'PESOS' : 'DOLARES'} ${centavosStr}/100 ${esMxn ? 'M.N.' : 'USD'}`;
}

function firmaBlock(label: string, nombre: string): Extract<Block, { kind: 'signature' }> {
  return { kind: 'signature', label, name: nombre || '—', detail: [] };
}

export function buildOrdenCompraProveedorPdf(input: OcProveedorPdfInput): Uint8Array {
  const moneda = input.lineas[0]?.moneda || 'MXN';
  const monto = input.lineas.reduce((s, l) => s + l.cantidad * l.precio * (1 - l.descuento), 0);

  const blocks: Block[] = [
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Proveedor', input.proveedor],
        ['Razón social', input.proveedorRazonSocial],
        ['Folio oportunidad', input.folioOpp],
        ['Folio proyecto', input.folioProyecto],
        ['Comprador', input.comprador],
        ['Fecha', input.fecha],
      ],
    },
    { kind: 'divider' },
    {
      kind: 'wrapTable',
      wrapCol: 0,
      columns: [
        { header: 'Producto', width: 0.25 },
        { header: 'Modelo', width: 0.10 },
        { header: 'Talla', width: 0.07 },
        { header: 'Unidad', width: 0.08 },
        { header: 'Moneda', width: 0.07 },
        { header: 'Cant.', width: 0.09, align: 'right' },
        { header: 'Precio', width: 0.11, align: 'right' },
        { header: 'Desc.', width: 0.07, align: 'right' },
        { header: 'Subtotal', width: 0.16, align: 'right' },
      ],
      rows: input.lineas.map(l => [
        l.producto,
        [l.sku, l.color].filter(Boolean).join(', '),
        l.talla,
        l.unidad,
        l.moneda,
        String(l.cantidad),
        fmtMoney(l.precio, l.moneda),
        l.descuento > 0 ? `${Math.round(l.descuento * 100)}%` : '0%',
        fmtMoney(l.cantidad * l.precio * (1 - l.descuento), l.moneda),
      ]),
      footer: ['', '', '', '', '', '', '', 'Subtotal', fmtMoney(monto, moneda)],
    },
    { kind: 'spacer', height: 6 },
    { kind: 'text', text: `Método de pago: ${input.metodoPago || '—'}`, size: 9 },
    { kind: 'text', text: `Condiciones de pago: ${input.condicionesPago || '—'}`, size: 9 },
    { kind: 'text', text: `Importe con IVA en letras: ${importeEnLetras(monto * 1.16, moneda)}`, size: 9, bold: true },
    { kind: 'spacer', height: 10 },
    firmaBlock('Elaborado por', input.elaboradoNombre),
    firmaBlock('Revisado por', input.revisadoNombre),
    firmaBlock('Autorizado por', input.autorizadoNombre),
  ];

  const meta: DocumentMeta = {
    title: 'Orden de Compra a Proveedor',
    subtitle: input.nombreProyecto,
    docId: `${input.folioProyecto}-${input.proveedor}`,
    generatedAt: input.fecha,
    logo: base64ToBytes(LOGO_JPG_BASE64),
  };

  return renderDocument(meta, blocks);
}
