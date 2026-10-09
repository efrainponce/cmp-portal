// worker/lib/pdf/cotizacionCliente.ts — Cotización al cliente generada por el
// portal, sin Eledo (Efraín, 2026-10-09). Nace el día que Eledo dejó de
// contestar (toda plantilla se colgaba >90 s, OPP-1189 quemó 9 folios
// reintentando): "formato simple de la OC … si incluye la foto como en OC".
//
// Mismo esqueleto que la OC con imágenes (worker/lib/pdf/
// ordenCompraProveedorImagenes.ts): PRIMERO el documento que rige —datos del
// cliente, tabla de partidas, totales, importe en letras, condiciones y la
// firma del vendedor— y DESPUÉS un anexo con una ficha por partida: foto,
// marca/modelo/color y la descripción del catálogo. La versión sin precio
// (`conPrecio: false`) es la misma cotización sin dinero, igual que hacía la
// plantilla de Eledo: sin Precio ni Subtotal por línea y sin totales.
import type { Block, DocumentMeta } from './layout';
import { renderDocument } from './layout';
import { LOGO_JPG_BASE64, CMP_ORANGE } from './logo';
import type { PdfImageData } from './png';
import { importeEnLetras, fmtNumMx } from '../importeEnLetras';

export interface CotizacionClienteLinea {
  partida: number;
  producto: string;
  marca: string;
  modelo: string;
  color: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precio: number;
  /** Ya resuelta por el llamador (cargarImagenesParaPdf). Null ⇒ "SIN IMAGEN". */
  imagen: PdfImageData | null;
}

export interface CotizacionClienteInput {
  folio: string;
  folioOpp: string;
  cliente: string;
  cargo: string;
  institucion: string;
  vendedor: string;
  fecha: string;
  vigencia: string;
  tiempoEntrega: string;
  comentarios: string;
  lineas: CotizacionClienteLinea[];
  conPrecio: boolean;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Mismo redondeo que computeTotals (worker/lib/cotizacion.ts): el total que
 * sale en el PDF tiene que ser el mismo que queda en el ledger y en la versión. */
export function totalesCotizacion(lineas: { cantidad: number; precio: number }[]): { subtotal: number; iva: number; total: number } {
  const subtotal = round2(lineas.reduce((s, l) => s + l.cantidad * l.precio, 0));
  const iva = round2(subtotal * 0.16);
  return { subtotal, iva, total: round2(subtotal + iva) };
}

export function buildCotizacionClienteBlocks(input: CotizacionClienteInput): Block[] {
  const { subtotal, iva, total } = totalesCotizacion(input.lineas);
  const totalUnidades = input.lineas.reduce((s, l) => s + l.cantidad, 0);
  const conPrecio = input.conPrecio;
  // Se captura en Monday con ** de markdown y casi siempre arranca con su
  // propio "**CONDICIONES COMERCIALES**": sin ** y sin ese renglón, que ya es
  // el título del bloque.
  const condiciones = input.comentarios
    .replace(/\*\*/g, '')
    .trim()
    .replace(/^condiciones comerciales:?\s*\n/i, '')
    .trim();

  const tabla: Block = {
    kind: 'wrapTable',
    wrapCols: [1, 2, 3, 4],
    columns: conPrecio
      ? [
          { header: '#', width: 0.05 },
          { header: 'Producto', width: 0.25 },
          { header: 'Marca / Modelo', width: 0.18 },
          { header: 'Color', width: 0.11 },
          { header: 'Unidad', width: 0.08 },
          { header: 'Cant.', width: 0.07, align: 'right' },
          { header: 'P. unitario', width: 0.12, align: 'right' },
          { header: 'Subtotal', width: 0.14, align: 'right' },
        ]
      : [
          { header: '#', width: 0.05 },
          { header: 'Producto', width: 0.38 },
          { header: 'Marca / Modelo', width: 0.25 },
          { header: 'Color', width: 0.14 },
          { header: 'Unidad', width: 0.09 },
          { header: 'Cant.', width: 0.09, align: 'right' },
        ],
    rows: input.lineas.map(l => {
      const base = [
        String(l.partida),
        l.producto || '—',
        [l.marca, l.modelo].filter(Boolean).join(' · ') || '—',
        l.color || '—',
        l.unidad || '—',
        fmtNumMx(l.cantidad),
      ];
      return conPrecio ? [...base, fmtMoney(l.precio), fmtMoney(round2(l.cantidad * l.precio))] : base;
    }),
    footer: conPrecio
      ? ['', 'TOTAL', '', '', '', fmtNumMx(totalUnidades), '', fmtMoney(subtotal)]
      : ['', 'TOTAL', '', '', '', fmtNumMx(totalUnidades)],
    headerFill: CMP_ORANGE,
    headerTextColor: '#ffffff',
  };

  const blocks: Block[] = [
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Cliente', input.cliente || '—'],
        ['Folio cotización', input.folio],
        ['Cargo', input.cargo || '—'],
        ['Fecha', input.fecha],
        ['Institución', input.institucion || '—'],
        ['Vendedor', input.vendedor || '—'],
      ],
    },
    { kind: 'divider' },
    tabla,
    { kind: 'spacer', height: 8 },
    {
      kind: 'kv',
      columns: 2,
      rows: conPrecio
        ? [
            ['Tiempo de entrega', input.tiempoEntrega || '—'],
            ['Subtotal', fmtMoney(subtotal)],
            ['Vigencia de la cotización', input.vigencia || '—'],
            ['IVA (16%)', fmtMoney(iva)],
            ['Partidas', fmtNumMx(input.lineas.length)],
            ['Total', fmtMoney(total)],
          ]
        : [
            ['Tiempo de entrega', input.tiempoEntrega || '—'],
            ['Vigencia de la cotización', input.vigencia || '—'],
          ],
    },
    ...(conPrecio
      ? [{ kind: 'text', text: `Son: ${importeEnLetras(total)}`, size: 9, bold: true } as Block]
      : []),
    ...(condiciones
      ? ([
          { kind: 'spacer', height: 8 },
          { kind: 'text', text: 'Condiciones comerciales', size: 9.5, bold: true },
          { kind: 'text', text: condiciones, size: 9 },
        ] as Block[])
      : []),
    { kind: 'spacer', height: 10 },
    { kind: 'signature', label: 'Atentamente', name: input.vendedor || '—', detail: ['Compañía Mexicana de Protección S. de R.L. de C.V.'] },
  ];

  const fichas: Block[] = input.lineas.map(l => ({
    kind: 'productCard',
    titulo: `${l.partida}. ${l.producto || l.modelo || '—'}`,
    datos: [
      ['Marca', l.marca || '—'],
      ['Modelo', l.modelo || '—'],
      ['Color', l.color || '—'],
    ],
    tallas: [],
    descripcion: l.descripcion,
    pie: conPrecio
      ? [`${fmtNumMx(l.cantidad)} ${l.unidad || 'pzas'} · ${fmtMoney(l.precio)} c/u`, `Importe ${fmtMoney(round2(l.cantidad * l.precio))}`]
      : [`${fmtNumMx(l.cantidad)} ${l.unidad || 'pzas'}`, ''],
    imagen: l.imagen,
  }));

  return fichas.length
    ? [
        ...blocks,
        { kind: 'pageBreak' },
        { kind: 'heading', text: 'Anexo — fichas de producto' },
        ...fichas,
      ]
    : blocks;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function buildCotizacionClientePdf(input: CotizacionClienteInput): Uint8Array {
  const meta: DocumentMeta = {
    title: 'Cotización',
    subtitle: input.institucion || input.cliente,
    folio: input.folio,
    docId: `COT ${input.folio}${input.conPrecio ? '' : ' (sin precio)'}`,
    generatedAt: input.fecha,
    logo: base64ToBytes(LOGO_JPG_BASE64),
    hideGeneratedByLine: true,
  };
  return renderDocument(meta, buildCotizacionClienteBlocks(input));
}
