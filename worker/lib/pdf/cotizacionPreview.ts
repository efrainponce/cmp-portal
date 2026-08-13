// worker/lib/pdf/cotizacionPreview.ts — Cotización, vista previa generada
// nativa por el portal (2026-08-13). Mismo template visual que la OC a
// Proveedor (worker/lib/pdf/ordenCompraProveedor.ts, Efraín: "está genial, usa
// ese mismo template"): naranja de marca en el header de la tabla, kv de datos,
// desglose Subtotal/IVA/Total, importe en letras.
//
// OJO (Efraín, 2026-08-13): esto es SOLO vista previa dentro del portal — la
// cotización oficial para el cliente sigue saliendo de Eledo (docs/documentos-
// firma.md). No se guarda en D1, no se firma, no se sube a Monday: se arma al
// vuelo desde el mirror, igual que la OC nativa, y se descarta al cerrar el
// preview.
import type { Block, DocumentMeta } from './layout';
import { renderDocument } from './layout';
import { LOGO_JPG_BASE64, CMP_ORANGE } from './logo';
import { importeEnLetras } from '../importeEnLetras';

export interface CotizacionPreviewLinea {
  producto: string;
  sku: string;
  color: string;
  cantidad: number;
  embellecimiento: boolean;
  precio: number;
}

export interface CotizacionPreviewInput {
  folio: string;
  nombreOportunidad: string;
  institucion: string;
  cliente: string;
  vendedor: string;
  fecha: string;
  tiempoEntrega: string;
  vigencia: string;
  condicionesComerciales: string;
  lineas: CotizacionPreviewLinea[];
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildCotizacionPreviewPdf(input: CotizacionPreviewInput): Uint8Array {
  const subtotal = input.lineas.reduce((s, l) => s + l.cantidad * l.precio, 0);
  const iva = subtotal * 0.16;
  const total = subtotal + iva;

  const blocks: Block[] = [
    {
      kind: 'note',
      text: 'VISTA PREVIA generada por el portal — no es la cotización oficial. La cotización que se entrega al cliente se sigue elaborando en Eledo.',
    },
    { kind: 'spacer', height: 6 },
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Institución', input.institucion || '—'],
        ['Contacto', input.cliente || '—'],
        ['Folio', input.folio],
        ['Vendedor', input.vendedor || '—'],
        ['Fecha', input.fecha],
        ['Tiempo de entrega', input.tiempoEntrega || '—'],
      ],
    },
    { kind: 'divider' },
    {
      kind: 'wrapTable',
      wrapCols: [0],
      columns: [
        { header: 'Producto', width: 0.30 },
        { header: 'SKU', width: 0.13 },
        { header: 'Color', width: 0.15 },
        { header: 'Cant.', width: 0.10, align: 'right' },
        { header: 'P. venta C/U', width: 0.15, align: 'right' },
        { header: 'Subtotal', width: 0.17, align: 'right' },
      ],
      rows: input.lineas.map(l => [
        l.producto + (l.embellecimiento ? ' · Con Embellecimiento' : ''),
        l.sku,
        l.color,
        String(l.cantidad),
        fmtMoney(l.precio),
        fmtMoney(l.cantidad * l.precio),
      ]),
      headerFill: CMP_ORANGE,
      headerTextColor: '#ffffff',
    },
    { kind: 'spacer', height: 8 },
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Vigencia de la cotización', input.vigencia || '—'],
        ['Subtotal', fmtMoney(subtotal)],
        [' ', ' '],
        ['IVA (16%)', fmtMoney(iva)],
        [' ', ' '],
        ['Total', fmtMoney(total)],
      ],
    },
    { kind: 'text', text: `Importe con IVA en letras: ${importeEnLetras(total, 'MXN')}`, size: 9, bold: true },
    { kind: 'spacer', height: 10 },
    { kind: 'heading', text: 'Condiciones comerciales' },
    { kind: 'text', text: input.condicionesComerciales || '—', size: 9 },
  ];

  const meta: DocumentMeta = {
    title: 'Cotización — Vista previa',
    subtitle: input.nombreOportunidad,
    folio: input.folio,
    docId: `${input.folio}-preview`,
    generatedAt: input.fecha,
    logo: base64ToBytes(LOGO_JPG_BASE64),
    hideGeneratedByLine: true,
  };

  return renderDocument(meta, blocks);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
