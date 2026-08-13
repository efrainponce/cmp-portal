// Plantillas de documento: datos planos → bloques de layout. Nada aquí toca D1,
// Monday ni R2 (eso es worker/lib/documents.ts), así que son funciones puras y
// testeables. Agregar una plantilla = un tipo de datos + un case en buildBlocks
// + su entrada en shared/documents.ts.
import type { Block, DocumentMeta } from './layout';
import { renderDocument } from './layout';
import { CMP_ORANGE, LOGO_JPG_BASE64 } from './logo';
import { DOC_TEMPLATES, SIGN_INTENT, ATTEST_INTENT, type DocTemplateId } from '../../../shared/documents';
import { fmtNumMx as NUM } from '../importeEnLetras';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Línea de producto tal como la lee compras para costear. SIN precios a
 * propósito: eso es justo lo que la solicitud pide que llenen. */
export interface DocLine {
  producto: string;
  sku?: string;
  marca?: string;
  color?: string;
  tallas?: string;
  unidad?: string;
  cantidad: number;
  descripcion?: string;
  embellecimiento?: boolean;
  descripcionEmbellecimiento?: string;
}

export interface SolicitudCosteoData {
  kind: 'solicitud-costeo';
  nombre: string;
  folio?: string;
  etapa?: string;
  vendedor?: string;
  cliente?: string;
  institucion?: string;
  zona?: string;
  fechaLimite?: string;
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

export type DocData = SolicitudCosteoData | RemisionInventarioData | ConstanciaFirmaData;

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

/** Tallas del catálogo — lista simple separada por comas ("S,M,XL"), el literal
 * "unitalla", o "error"/vacío cuando el llenado automático no encontró tallas
 * en el texto libre del producto. Reemplazó el JSON por género (hombre/mujer)
 * el 2026-08-03 — ya no hay nada que parsear, solo limpiar. */
export function formatTallas(raw?: string): string | undefined {
  const cleaned = (raw ?? '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'error') return undefined;
  if (cleaned.toLowerCase() === 'unitalla') return 'Unitalla';
  const items = cleaned.split(',').map(t => t.trim()).filter(Boolean);
  return items.length ? items.join(', ') : undefined;
}

/** Los long_text de Monday llegan con ",," entre renglones y con campos vacíos
 * que terminan en ":" (plantilla de embellecimiento sin llenar). Se parte en
 * líneas de verdad y se tiran los renglones que no dicen nada. */
export function formatMultiline(raw?: string): string | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  const lineas = text
    .split(/,{2,}|\r?\n/)
    .map(l => l.trim().replace(/^,+|,+$/g, '').trim())
    .filter(l => l.length > 0 && !/:$/.test(l));
  return lineas.length ? lineas.join('\n') : undefined;
}

// ── Bloques por plantilla ─────────────────────────────────────────────────────
function solicitudBlocks(d: SolicitudCosteoData): Block[] {
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
        ['Tiempo de entrega', d.tiempoEntrega ?? ''],
      ],
    },
    { kind: 'heading', text: 'Productos por costear' },
  ];

  if (d.lineas.length === 0) {
    blocks.push({ kind: 'text', text: 'La oportunidad no tiene líneas de producto capturadas.', color: '#5b6472' });
    return blocks;
  }

  // Sin columna de precio ni de importe: la solicitud PIDE los precios, no los
  // trae (Efraín, 2026-07-26). Tampoco imágenes: el motor solo embebe JPEG y el
  // catálogo las tiene en PNG; SKU + marca alcanzan para identificar el producto.
  // wrapTable + naranja de marca — mismo template visual que la OC a Proveedor
  // (worker/lib/pdf/ordenCompraProveedor.ts, Efraín 2026-08-13: "está genial,
  // usa ese mismo template"); Producto envuelve a varias líneas en vez de
  // recortarse con elipsis, igual que ahí.
  blocks.push({
    kind: 'wrapTable',
    wrapCols: [1],
    // La unidad va pegada a la cantidad ("30 Pieza") en vez de en su propia
    // columna: casi siempre dice "Pieza" y ese ancho le hace falta a marca y
    // color, que se recortaban con elipsis (visto en la solicitud de OPP-0717).
    columns: [
      { header: '#', width: 0.04, align: 'right' },
      { header: 'Producto', width: 0.33 },
      { header: 'SKU', width: 0.15 },
      { header: 'Marca', width: 0.16 },
      { header: 'Color', width: 0.18 },
      { header: 'Cantidad', width: 0.14, align: 'right' },
    ],
    rows: d.lineas.map((l, i) => [
      String(i + 1),
      l.producto,
      l.sku ?? '',
      l.marca ?? '',
      l.color ?? '',
      `${NUM(l.cantidad)} ${l.unidad || 'Pieza'}`,
    ]),
    footer: ['', `${d.lineas.length} partida(s)`, '', '', '', NUM(piezas)],
    headerFill: CMP_ORANGE,
    headerTextColor: '#ffffff',
  });

  // El detalle largo (descripción del catálogo, tallas, embellecimiento) va como
  // texto por partida: en la tabla se recortaría con elipsis y es justo lo que
  // compras necesita leer completo para cotizarle al proveedor.
  const conDetalle = d.lineas.filter(l => l.descripcion || l.tallas || l.embellecimiento);
  if (conDetalle.length > 0) {
    blocks.push({ kind: 'heading', text: 'Detalle por partida' });
    for (const l of d.lineas) {
      if (!l.descripcion && !l.tallas && !l.embellecimiento) continue;
      const n = d.lineas.indexOf(l) + 1;
      blocks.push({ kind: 'text', text: `${n}. ${l.producto}`, bold: true, size: 9.5 });
      if (l.descripcion) blocks.push({ kind: 'text', text: l.descripcion, size: 9 });
      if (l.tallas) blocks.push({ kind: 'text', text: `Tallas: ${l.tallas}`, size: 9, color: '#5b6472' });
      if (l.embellecimiento) {
        blocks.push({
          kind: 'text',
          text: `Embellecimiento: ${l.descripcionEmbellecimiento || 'sí (ver especificación con el vendedor)'}`,
          size: 9,
          color: '#5b6472',
        });
      }
      blocks.push({ kind: 'spacer', height: 4 });
    }
  }

  if (d.comentarios) {
    blocks.push({ kind: 'heading', text: 'Comentarios del vendedor' }, { kind: 'text', text: d.comentarios });
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
  const acuse = template.autoAcuse === true;
  const blocks: Block[] = [{ kind: 'heading', text: acuse ? 'Acuse' : 'Firmas' }];

  if (input.signatures.length === 0) {
    blocks.push({
      kind: 'text',
      text: acuse ? 'Sin acuse registrado.' : 'Documento sin firmar.',
      color: '#5b6472',
    });
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

  const pendientes = acuse ? 0 : template.maxSignatures - input.signatures.length;
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
  blocks.push({
    kind: 'note',
    text: acuse ? ATTEST_INTENT : `Consentimiento aceptado por cada firmante: «${SIGN_INTENT}»`,
  });
  return blocks;
}

export function templateIdOf(data: DocData): DocTemplateId {
  return data.kind;
}

/** Título del documento (encabezado del PDF y columna `title` en D1). */
export function titleOf(data: DocData): string {
  switch (data.kind) {
    case 'solicitud-costeo': return `Solicitud de costeo`;
    case 'remision-inventario': return `Remisión de inventario`;
    case 'constancia-firma': return `Constancia de firma electrónica`;
  }
}

function subtitleOf(data: DocData): string | undefined {
  switch (data.kind) {
    case 'solicitud-costeo': return data.nombre;
    case 'remision-inventario': return `${data.tipo} · ${data.producto}`;
    case 'constancia-firma': return data.archivo;
  }
}

function folioOf(data: DocData): string | undefined {
  switch (data.kind) {
    case 'solicitud-costeo': return data.folio;
    case 'remision-inventario': return data.folio ?? `MOV-${data.movimientoId}`;
    case 'constancia-firma': return undefined;
  }
}

export function buildBlocks(input: RenderInput): Block[] {
  const body = input.data.kind === 'solicitud-costeo' ? solicitudBlocks(input.data)
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
    // Mismo membrete que la OC a Proveedor (worker/lib/pdf/ordenCompraProveedor.ts)
    // — antes caía al texto "MEXICANA DE PROTECCIÓN" del fallback de layout.ts.
    logo: base64ToBytes(LOGO_JPG_BASE64),
  };
}

/** Render completo: plantilla + firmas → bytes del PDF. */
export function renderTemplate(input: RenderInput): Uint8Array {
  return renderDocument(metaOf(input), buildBlocks(input));
}
