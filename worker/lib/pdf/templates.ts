// Plantillas de documento: datos planos → bloques de layout. Nada aquí toca D1,
// Monday ni R2 (eso es worker/lib/documents.ts), así que son funciones puras y
// testeables. Agregar una plantilla = un tipo de datos + un case en buildBlocks
// + su entrada en shared/documents.ts.
import type { Block, DocumentMeta } from './layout';
import { renderDocument } from './layout';
import { DOC_TEMPLATES, SIGN_INTENT, type DocTemplateId } from '../../../shared/documents';

export interface DocLine {
  producto: string;
  sku?: string;
  color?: string;
  cantidad: number;
  precioUnitario?: number;
  embellecimiento?: boolean;
}

export interface ResumenOportunidadData {
  kind: 'resumen-oportunidad';
  nombre: string;
  folio?: string;
  etapa?: string;
  vendedor?: string;
  cliente?: string;
  institucion?: string;
  zona?: string;
  fechaLimite?: string;
  fechaCotizacion?: string;
  vigencia?: string;
  tiempoEntrega?: string;
  comentarios?: string;
  lineas: DocLine[];
}

export interface RemisionInventarioData {
  kind: 'remision-inventario';
  movimientoId: number;
  tipo: string;
  producto: string;
  cantidad: number;
  origen?: string;
  destino?: string;
  capturadoPor: string;
  folio?: string;
  notas?: string;
  fecha: string;
}

export interface ConstanciaFirmaData {
  kind: 'constancia-firma';
  /** Nombre legible del PDF sellado. */
  archivo: string;
  /** Key de /api/files (o ruta equivalente) que identifica al original. */
  referencia: string;
  /** Contexto opcional: oportunidad a la que pertenece el archivo. */
  contexto?: string;
}

export type DocData = ResumenOportunidadData | RemisionInventarioData | ConstanciaFirmaData;

/** Firma ya asentada, tal como la pinta el PDF regenerado. */
export interface RenderedSignature {
  label: string;
  name: string;
  role: string;
  email: string;
  signedAt: string;
  sha256: string;
  ip?: string | null;
  image?: Uint8Array;
}

export interface RenderInput {
  docId: string;
  data: DocData;
  generatedAt: string;
  signatures: RenderedSignature[];
  /** Hash del PDF base; el pie de las páginas firmadas lo imprime. */
  baseSha256?: string;
}

// ── Formato ───────────────────────────────────────────────────────────────────
const MXN = (n: number): string => {
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};

const NUM = (n: number): string => {
  try { return new Intl.NumberFormat('es-MX').format(n); } catch { return String(n); }
};

/** Fecha legible en hora de la Ciudad de México; ante cualquier problema
 * devuelve el ISO tal cual (nunca revienta el render de un documento). */
export function fechaLarga(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City',
    }).format(new Date(iso)).replace(',', '');
  } catch {
    return iso;
  }
}

// ── Bloques por plantilla ─────────────────────────────────────────────────────
function resumenBlocks(d: ResumenOportunidadData): Block[] {
  const total = d.lineas.reduce((s, l) => s + (l.precioUnitario ?? 0) * l.cantidad, 0);
  const piezas = d.lineas.reduce((s, l) => s + l.cantidad, 0);

  const blocks: Block[] = [
    { kind: 'heading', text: 'Datos de la oportunidad' },
    {
      kind: 'kv',
      rows: [
        ['Oportunidad', d.nombre],
        ['Etapa', d.etapa ?? ''],
        ['Institución', d.institucion ?? ''],
        ['Contacto', d.cliente ?? ''],
        ['Vendedor', d.vendedor ?? ''],
        ['Zona', d.zona ?? ''],
        ['Fecha límite', d.fechaLimite ?? ''],
        ['Fecha de cotización', d.fechaCotizacion ?? ''],
        ['Vigencia', d.vigencia ?? ''],
        ['Tiempo de entrega', d.tiempoEntrega ?? ''],
      ],
    },
    { kind: 'heading', text: 'Líneas de producto' },
  ];

  if (d.lineas.length === 0) {
    blocks.push({ kind: 'text', text: 'La oportunidad no tiene líneas de producto capturadas.', color: '#5b6472' });
  } else {
    blocks.push({
      kind: 'table',
      columns: [
        { header: 'Producto', width: 0.34 },
        { header: 'SKU', width: 0.13 },
        { header: 'Color', width: 0.13 },
        { header: 'Emb.', width: 0.07, align: 'center' },
        { header: 'Cant.', width: 0.09, align: 'right' },
        { header: 'P. unitario', width: 0.12, align: 'right' },
        { header: 'Importe', width: 0.12, align: 'right' },
      ],
      rows: d.lineas.map(l => [
        l.producto,
        l.sku ?? '',
        l.color ?? '',
        l.embellecimiento ? 'Sí' : '—',
        NUM(l.cantidad),
        l.precioUnitario ? MXN(l.precioUnitario) : 'Pend.',
        l.precioUnitario ? MXN(l.precioUnitario * l.cantidad) : '—',
      ]),
      footer: ['Total', '', '', '', NUM(piezas), '', MXN(total)],
    });
  }

  if (d.comentarios) {
    blocks.push({ kind: 'heading', text: 'Comentarios' }, { kind: 'text', text: d.comentarios });
  }
  return blocks;
}

function remisionBlocks(d: RemisionInventarioData): Block[] {
  const blocks: Block[] = [
    { kind: 'heading', text: 'Movimiento' },
    {
      kind: 'kv',
      rows: [
        ['Tipo de movimiento', d.tipo],
        ['Fecha', fechaLarga(d.fecha)],
        ['Origen', d.origen ?? 'No aplica'],
        ['Destino', d.destino ?? 'No aplica'],
        ['Capturó', d.capturadoPor],
        ['Folio de referencia', d.folio ?? ''],
      ],
    },
    { kind: 'heading', text: 'Detalle' },
    {
      kind: 'table',
      columns: [
        { header: 'Producto', width: 0.7 },
        { header: 'Cantidad', width: 0.3, align: 'right' },
      ],
      rows: [[d.producto, NUM(d.cantidad)]],
    },
  ];
  if (d.notas) blocks.push({ kind: 'heading', text: 'Notas' }, { kind: 'text', text: d.notas });
  blocks.push({
    kind: 'note',
    text: 'Quien recibe confirma haber revisado la cantidad y el estado físico del material descrito. ' +
      'Cualquier faltante o daño debe reportarse antes de firmar.',
  });
  return blocks;
}

function constanciaBlocks(d: ConstanciaFirmaData, baseSha256?: string): Block[] {
  return [
    { kind: 'heading', text: 'Documento sellado' },
    {
      kind: 'kv',
      columns: 1,
      rows: [
        ['Archivo', d.archivo],
        ['Referencia interna', d.referencia],
        ...(d.contexto ? [['Contexto', d.contexto] as [string, string]] : []),
        ['Huella SHA-256', baseSha256 ?? '—'],
      ],
    },
    {
      kind: 'note',
      text: 'Esta constancia no reemplaza al archivo original: lo identifica. La huella SHA-256 de arriba ' +
        'se calculó sobre los bytes exactos del PDF al momento de firmarlo, de modo que cualquier ' +
        'modificación posterior del archivo produce una huella distinta y deja la constancia sin correspondencia.',
    },
  ];
}

// ── Firmas ────────────────────────────────────────────────────────────────────
function signatureBlocks(input: RenderInput): Block[] {
  const template = DOC_TEMPLATES[templateIdOf(input.data)];
  const blocks: Block[] = [{ kind: 'heading', text: 'Firmas' }];

  if (input.signatures.length === 0) {
    blocks.push({ kind: 'text', text: 'Documento sin firmar.', color: '#5b6472' });
    return blocks;
  }

  for (const sig of input.signatures) {
    blocks.push({
      kind: 'signature',
      label: sig.label,
      name: sig.name,
      detail: [
        sig.role ? `Rol: ${sig.role}` : '',
        `Cuenta: ${sig.email}`,
        `Firmado: ${fechaLarga(sig.signedAt)}`,
        sig.ip ? `Origen: ${sig.ip}` : '',
        `Huella del documento: ${sig.sha256.slice(0, 32)}…`,
      ].filter(Boolean),
      image: sig.image,
    });
  }

  const pendientes = template.maxSignatures - input.signatures.length;
  if (pendientes > 0) {
    blocks.push({
      kind: 'text',
      text: pendientes === 1
        ? 'Este documento admite una firma más.'
        : `Este documento admite ${pendientes} firmas más.`,
      size: 8.5,
      color: '#5b6472',
    });
  }
  blocks.push({ kind: 'note', text: `Consentimiento aceptado por cada firmante: «${SIGN_INTENT}»` });
  return blocks;
}

export function templateIdOf(data: DocData): DocTemplateId {
  return data.kind;
}

/** Título del documento (encabezado del PDF y columna `title` en D1). */
export function titleOf(data: DocData): string {
  switch (data.kind) {
    case 'resumen-oportunidad': return `Resumen de oportunidad`;
    case 'remision-inventario': return `Remisión de inventario`;
    case 'constancia-firma': return `Constancia de firma electrónica`;
  }
}

function subtitleOf(data: DocData): string | undefined {
  switch (data.kind) {
    case 'resumen-oportunidad': return data.nombre;
    case 'remision-inventario': return `${data.tipo} · ${data.producto}`;
    case 'constancia-firma': return data.archivo;
  }
}

function folioOf(data: DocData): string | undefined {
  switch (data.kind) {
    case 'resumen-oportunidad': return data.folio;
    case 'remision-inventario': return data.folio ?? `MOV-${data.movimientoId}`;
    case 'constancia-firma': return undefined;
  }
}

export function buildBlocks(input: RenderInput): Block[] {
  const body = input.data.kind === 'resumen-oportunidad' ? resumenBlocks(input.data)
    : input.data.kind === 'remision-inventario' ? remisionBlocks(input.data)
    : constanciaBlocks(input.data, input.baseSha256);
  return [...body, { kind: 'spacer', height: 10 }, ...signatureBlocks(input)];
}

export function metaOf(input: RenderInput): DocumentMeta {
  const signed = input.signatures.length > 0;
  return {
    title: titleOf(input.data),
    subtitle: subtitleOf(input.data),
    folio: folioOf(input.data),
    docId: input.docId,
    generatedAt: fechaLarga(input.generatedAt),
    // Solo el hash: el pie es de 7pt y una leyenda más larga se recortaría con
    // elipsis justo encima de los últimos dígitos, que son los que sirven.
    footerNote: signed && input.baseSha256 ? `SHA-256 ${input.baseSha256}` : undefined,
  };
}

/** Render completo: plantilla + firmas → bytes del PDF. */
export function renderTemplate(input: RenderInput): Uint8Array {
  return renderDocument(metaOf(input), buildBlocks(input));
}
