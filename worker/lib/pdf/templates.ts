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

/** Línea de producto de una cotización — a diferencia de DocLine, SÍ lleva
 * precio (es justo lo que este documento le manda al cliente). */
export interface CotizacionLine {
  numPartida: number;
  producto: string;
  sku?: string;
  marca?: string;
  color?: string;
  cantidad: number;
  unidad?: string;
  precio: number;
  importe: number;
}

export interface CotizacionData {
  kind: 'cotizacion';
  folio: string;
  cliente?: string;
  cargo?: string;
  institucion?: string;
  vendedor?: string;
  vigencia?: string;
  tiempoEntrega?: string;
  comentarios?: string;
  lineas: CotizacionLine[];
  subtotal: number;
  iva: number;
  total: number;
  totalPalabras: string;
}

/** Línea de la hoja de costeo — mismos campos que GRID_COLS_COSTEO
 * (src/boards/oportunidades/tabs/cotizacion/gridMeta.tsx), en el mismo orden,
 * para que lo impreso coincida exactamente con lo que compras ya ve en
 * pantalla al validar. Los `formula_*` de Monday (costoReal, costoTotalUnit,
 * subtotal, margenGobTotal, utilidad, utilidadPct) llegan YA CALCULADOS por
 * Monday — aquí solo se leen e imprimen, no se recalculan. IVA y Total c/IVA
 * ya no se imprimen (Efraín, 2026-08-18), por eso tampoco se guardan. */
export interface CosteoValidacionLine {
  producto: string;
  sku?: string;
  color?: string;
  cantidad: number;
  etapaCosteo?: string;
  moneda?: string;
  costoDistr: number;
  descuentoPct: number;
  costoReal: number;
  conversion: number;
  gastosPct: number;
  costoEmbellecimiento: number;
  costoTotal: number;
  techo: number;
  precioSugerido: number;
  precioVenta: number;
  subtotal: number;
  margenGobPct: number;
  margenGobTotal: number;
  utilidad: number;
  utilidadPct: number;
}

export interface CosteoValidacionData {
  kind: 'validacion-costeo';
  nombre: string;
  folio?: string;
  institucion?: string;
  vendedor?: string;
  zona?: string;
  lineas: CosteoValidacionLine[];
  subtotal: number;
  /** Suma de la utilidad por línea — sustituye al total con IVA en el pie. */
  utilidad: number;
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

export type DocData = SolicitudCosteoData | CotizacionData | CosteoValidacionData | RemisionInventarioData | ConstanciaFirmaData;

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

function cotizacionBlocks(d: CotizacionData): Block[] {
  const blocks: Block[] = [
    { kind: 'heading', text: 'Datos de la cotización' },
    {
      kind: 'kv',
      rows: [
        ['Folio', d.folio],
        ['Institución', d.institucion ?? ''],
        ['Contacto', d.cliente ?? ''],
        ['Cargo', d.cargo ?? ''],
        ['Vendedor', d.vendedor ?? ''],
        ['Vigencia', d.vigencia ?? ''],
        ['Tiempo de entrega', d.tiempoEntrega ?? ''],
      ],
    },
    { kind: 'heading', text: 'Productos' },
  ];

  if (d.lineas.length === 0) {
    blocks.push({ kind: 'text', text: 'Sin líneas de producto.', color: '#5b6472' });
    return blocks;
  }

  blocks.push({
    kind: 'wrapTable',
    wrapCols: [1],
    columns: [
      { header: '#', width: 0.05, align: 'right' },
      { header: 'Producto', width: 0.30 },
      { header: 'Color', width: 0.13 },
      { header: 'Cantidad', width: 0.12, align: 'right' },
      { header: 'P. Unitario', width: 0.18, align: 'right' },
      { header: 'Importe', width: 0.22, align: 'right' },
    ],
    rows: d.lineas.map(l => [
      String(l.numPartida),
      l.producto,
      l.color ?? '',
      `${NUM(l.cantidad)} ${l.unidad || 'Pieza'}`,
      `$${NUM(l.precio)}`,
      `$${NUM(l.importe)}`,
    ]),
    footer: ['', '', '', '', '', `$${NUM(d.total)}`],
    headerFill: CMP_ORANGE,
    headerTextColor: '#ffffff',
  });

  blocks.push({
    kind: 'kv',
    columns: 1,
    rows: [
      ['Subtotal', `$${NUM(d.subtotal)}`],
      ['IVA (16%)', `$${NUM(d.iva)}`],
      ['Total', `$${NUM(d.total)}`],
      ['Importe con letra', d.totalPalabras],
    ],
  });

  if (d.comentarios) {
    blocks.push({ kind: 'heading', text: 'Comentarios' }, { kind: 'text', text: d.comentarios });
  }
  return blocks;
}

const money = (n: number): string => `$${NUM(n)}`;
const pct = (n: number): string => `${NUM(n)}%`;

/** Hoja de costeo en horizontal (2026-08-14), "solo lo ven compras y admin"
 * (worker/lib/documents.ts assertTemplateViewable). Sale sola al mandar a
 * validación, sin ceremonia de firma.
 *
 * Imprime las columnas de decisión (costo real/total, precio, subtotal/IVA/
 * total, márgenes) — NO las 24 de la grid completa: a ese detalle (etapa
 * costeo, conversión, gastos %, desc. %, costo embell., techo, sugerido, IVA%
 * por línea, margen gob total) se le probó primero con TODAS las columnas y el
 * texto salía cortado con elipsis, empezando por los importes — inservible
 * para validar un costeo. costeoValidacionData sí captura todo ese detalle en
 * el snapshot JSON (documents.data) por si hace falta auditarlo; el PDF solo
 * imprime lo que cabe legible. */
function costeoValidacionBlocks(d: CosteoValidacionData): Block[] {
  const blocks: Block[] = [
    { kind: 'heading', text: 'Datos de la oportunidad' },
    {
      kind: 'kv',
      columns: 1,
      rows: [
        ['Oportunidad', d.nombre],
        ['Institución', d.institucion ?? ''],
        ['Vendedor', d.vendedor ?? ''],
        ['Zona', d.zona ?? ''],
      ],
    },
    { kind: 'heading', text: 'Costeo por partida' },
  ];

  if (d.lineas.length === 0) {
    blocks.push({ kind: 'text', text: 'La oportunidad no tiene líneas de producto capturadas.', color: '#5b6472' });
    return blocks;
  }

  blocks.push({
    kind: 'wrapTable',
    wrapCols: [0],
    cellSize: 8,
    headerSize: 7,
    // Sin IVA ni Total c/IVA (Efraín, 2026-08-18: "el iva no nos interesa") —
    // esta hoja es para validar costo contra precio, y las dos columnas de
    // impuesto se llevaban el 18% del ancho, dejando los demás encabezados
    // cortados ("Costo r…", "Marge…", "Utilid…"). Ese ancho se repartió aquí.
    // Encabezados cortos a propósito: a 7pt, "Costo real C/U" o "Margen Gob %"
    // no caben y el escritor los cortaba con elipsis ("COSTO REAL C…"), que fue
    // justo lo que se vio en el PDF de OPP-0913. Los costos son unitarios y los
    // porcentajes se leen en el propio valor, así que el sufijo no hacía falta.
    columns: [
      { header: 'Producto', width: 0.15 },
      { header: 'SKU', width: 0.07 },
      { header: 'Color', width: 0.065 },
      { header: 'Cant.', width: 0.045, align: 'right' },
      { header: 'Moneda', width: 0.06 },
      { header: 'Costo real', width: 0.095, align: 'right' },
      { header: 'Costo total', width: 0.095, align: 'right' },
      { header: 'P. venta', width: 0.085, align: 'right' },
      { header: 'Subtotal', width: 0.095, align: 'right' },
      { header: 'Margen Gob', width: 0.085, align: 'right' },
      { header: 'Utilidad', width: 0.09, align: 'right' },
      { header: 'Util. %', width: 0.065, align: 'right' },
    ],
    rows: d.lineas.map(l => [
      l.producto,
      l.sku ?? '',
      l.color ?? '',
      NUM(l.cantidad),
      l.moneda ?? '',
      money(l.costoReal),
      money(l.costoTotal),
      money(l.precioVenta),
      money(l.subtotal),
      pct(l.margenGobPct),
      money(l.utilidad),
      pct(l.utilidadPct),
    ]),
    footer: ['', '', '', '', '', '', '', '', money(d.subtotal), '', money(d.utilidad), ''],
    headerFill: CMP_ORANGE,
    headerTextColor: '#ffffff',
  });

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
    case 'cotizacion': return `Cotización`;
    case 'validacion-costeo': return `Costeo — Validación`;
    case 'remision-inventario': return `Remisión de inventario`;
    case 'constancia-firma': return `Constancia de firma electrónica`;
  }
}

function subtitleOf(data: DocData): string | undefined {
  switch (data.kind) {
    case 'solicitud-costeo': return data.nombre;
    case 'cotizacion': return data.institucion ?? data.cliente;
    case 'validacion-costeo': return data.nombre;
    case 'remision-inventario': return `${data.tipo} · ${data.producto}`;
    case 'constancia-firma': return data.archivo;
  }
}

function folioOf(data: DocData): string | undefined {
  switch (data.kind) {
    case 'solicitud-costeo': return data.folio;
    case 'cotizacion': return data.folio;
    case 'validacion-costeo': return data.folio;
    case 'remision-inventario': return data.folio ?? `MOV-${data.movimientoId}`;
    case 'constancia-firma': return undefined;
  }
}

export function buildBlocks(input: RenderInput): Block[] {
  const body = input.data.kind === 'solicitud-costeo' ? solicitudBlocks(input.data)
    : input.data.kind === 'cotizacion' ? cotizacionBlocks(input.data)
    : input.data.kind === 'validacion-costeo' ? costeoValidacionBlocks(input.data)
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
    // Horizontal: la hoja de costeo trae ~24 columnas (todas las de la grid de
    // Costeo) — en carta vertical no caben ni con fuente chica (Efraín,
    // 2026-08-14: "en horizontal para que quepan todas las columnas").
    landscape: input.data.kind === 'validacion-costeo',
  };
}

/** Render completo: plantilla + firmas → bytes del PDF. */
export function renderTemplate(input: RenderInput): Uint8Array {
  return renderDocument(metaOf(input), buildBlocks(input));
}
