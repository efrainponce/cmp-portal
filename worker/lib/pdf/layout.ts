// Motor de layout sobre PdfWriter: el documento se describe como una lista de
// bloques y aquí se pagina, se dibuja el encabezado/pie de cada página y se
// parten las tablas largas repitiendo su header. Las plantillas
// (worker/lib/pdf/templates.ts) solo producen bloques — no tocan coordenadas.
import { PdfWriter, LETTER, widthOf, type FontName } from './writer';
import type { PdfImageData } from './png';

const MARGIN = 48;
const HEADER_BOTTOM = 96;   // primera línea base disponible del contenido
const FOOTER_MARGIN = 44;   // espacio reservado al pie, medido desde abajo

const INK = '#111111';
const INK_SOFT = '#5b6472';
const INK_FAINT = '#98a1ae';
const RULE = '#dde2e8';
const ZEBRA = '#f6f8fa';
const ACCENT = '#1f4e79';

export interface TableColumn {
  header: string;
  /** Fracción del ancho de contenido (todas deben sumar ~1). */
  width: number;
  align?: 'left' | 'right' | 'center';
}

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; size?: number; bold?: boolean; color?: string }
  | { kind: 'kv'; rows: [string, string][]; columns?: 1 | 2 }
  | { kind: 'table'; columns: TableColumn[]; rows: string[][]; footer?: string[] }
  /** Como 'table', pero las columnas en `wrapCols` envuelven a varias líneas
   * en vez de recortar con elipsis, y el renglón crece para que quepan — las
   * demás columnas se dibujan ancladas al TOPE del renglón, nunca desaparecen.
   * Se agregó para la OC a proveedor: descripciones de embellecimiento largas
   * rompían tablas de ancho fijo (visto primero en la plantilla de Eledo,
   * 2026-08-12). */
  | {
      kind: 'wrapTable'; columns: TableColumn[]; rows: string[][]; wrapCols: number[]; footer?: string[];
      /** Override de color del renglón de encabezado — default gris. La OC a
       * proveedor usa el naranja de marca de CMP (sacado del logo). */
      headerFill?: string; headerTextColor?: string;
      /** Tamaño de fuente de celdas/encabezado — default 9/7.5. La hoja de
       * costeo de Validación (2026-08-14) trae ~20 columnas en horizontal y
       * necesita texto más chico para que quepan sin desbordar. */
      cellSize?: number; headerSize?: number;
    }
  | { kind: 'divider' }
  | { kind: 'spacer'; height: number }
  | { kind: 'note'; text: string }
  | { kind: 'signature'; label: string; name: string; detail: string[]; image?: Uint8Array }
  /** Ficha de producto de MEDIA HOJA carta: foto grande a la izquierda y datos
   * + tallas a la derecha (Efraín, 2026-08-24). Existe porque el mismo SKU
   * puede llegar con variantes que el texto no distingue —un chaleco de broches
   * y uno de velcro comparten modelo— y el proveedor necesita VER cuál es. Dos
   * fichas por página, siempre completas: la ficha nunca se parte a la mitad. */
  | {
      kind: 'productCard';
      titulo: string;
      /** Etiqueta/valor cortos (SKU, color, unidad…) arriba de las tallas. */
      datos: [string, string][];
      tallas: { talla: string; cantidad: string }[];
      /** Renglones de cierre (totales, precio unitario) al pie de la ficha. */
      pie: string[];
      /** Null/ausente ⇒ placeholder gris "Sin imagen" (Efraín, 2026-08-24): la
       * OC sale igual aunque el producto no tenga foto todavía. */
      imagen?: PdfImageData | null;
    };

export interface DocumentMeta {
  /** Título que va en el encabezado de todas las páginas. */
  title: string;
  subtitle?: string;
  folio?: string;
  /** Id del documento en D1 — el pie lo imprime como referencia verificable. */
  docId: string;
  generatedAt: string;
  /** Línea legal opcional del pie (documentos firmados la usan para el hash). */
  footerNote?: string;
  /** JPEG del membrete (worker/lib/pdf/logo.ts) — si no se manda, el
   * encabezado cae de vuelta al texto "MEXICANA DE PROTECCIÓN". */
  logo?: Uint8Array;
  /** Oculta la línea "Generado por el portal CMP · fecha · Doc id" del pie.
   * Los documentos con firma electrónica la necesitan como referencia
   * verificable (docs/documentos-firma.md); un documento sin ceremonia de
   * firma (como la OC a proveedor v1) no la necesita. */
  hideGeneratedByLine?: boolean;
  /** Página apaisada (792×612) en vez de carta vertical — para tablas anchas
   * que no caben en 516pt de contenido (hoja de costeo de Validación,
   * 2026-08-14: ~20 columnas). */
  landscape?: boolean;
}

/** Medidas de página resueltas UNA vez por documento — todo lo que dibuja
 * bloques recibe esto en vez de leer constantes de módulo, así el mismo motor
 * sirve para carta vertical y apaisada. */
interface Metrics {
  pageWidth: number;
  pageHeight: number;
  contentLeft: number;
  contentRight: number;
  contentWidth: number;
  headerBottom: number;
  footerTop: number;
}

function metricsFor(landscape: boolean): Metrics {
  const size = landscape ? { width: LETTER.height, height: LETTER.width } : LETTER;
  const contentLeft = MARGIN;
  const contentRight = size.width - MARGIN;
  return {
    pageWidth: size.width,
    pageHeight: size.height,
    contentLeft,
    contentRight,
    contentWidth: contentRight - contentLeft,
    headerBottom: HEADER_BOTTOM,
    footerTop: size.height - FOOTER_MARGIN,
  };
}

/** Corta `text` en líneas que caben en `maxWidth`. Palabras más largas que el
 * ancho se parten por carácter para que nunca se desborden de la caja. */
export function wrapText(text: string, maxWidth: number, size: number, font: FontName = 'H'): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate, size, font) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      if (widthOf(word, size, font) <= maxWidth) { line = word; continue; }
      let piece = '';
      for (const ch of word) {
        if (widthOf(piece + ch, size, font) > maxWidth) { out.push(piece); piece = ch; }
        else piece += ch;
      }
      line = piece;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/** Recorta con elipsis — para celdas de tabla, que nunca envuelven. */
function ellipsize(text: string, maxWidth: number, size: number, font: FontName = 'H'): string {
  if (widthOf(text, size, font) <= maxWidth) return text;
  let out = '';
  for (const ch of text) {
    if (widthOf(out + ch + '…', size, font) > maxWidth) break;
    out += ch;
  }
  return out + '…';
}

function columnBoxes(columns: TableColumn[], m: Metrics): { left: number; right: number }[] {
  const total = columns.reduce((s, c) => s + c.width, 0) || 1;
  const boxes: { left: number; right: number }[] = [];
  let x = m.contentLeft;
  for (const col of columns) {
    const w = (col.width / total) * m.contentWidth;
    boxes.push({ left: x + 4, right: x + w - 4 });
    x += w;
  }
  return boxes;
}

/** Cursor de escritura: sabe abrir páginas nuevas cuando el bloque no cabe. */
class Cursor {
  page: number;
  y: number;

  constructor(private readonly pdf: PdfWriter, private readonly m: Metrics) {
    this.page = pdf.addPage();
    this.y = m.headerBottom;
  }

  /** Asegura `height` puntos disponibles; abre página si no. Devuelve true si saltó. */
  ensure(height: number): boolean {
    if (this.y + height <= this.m.footerTop) return false;
    this.page = this.pdf.addPage();
    this.y = this.m.headerBottom;
    return true;
  }
}

function drawHeading(pdf: PdfWriter, cur: Cursor, m: Metrics, text: string): void {
  cur.ensure(30);
  cur.y += 6;
  pdf.text(cur.page, m.contentLeft, cur.y, text.toUpperCase(), { size: 9, font: 'HB', color: ACCENT });
  cur.y += 5;
  pdf.line(cur.page, m.contentLeft, cur.y, m.contentRight, cur.y, { color: ACCENT, width: 0.8 });
  cur.y += 15;
}

function drawText(pdf: PdfWriter, cur: Cursor, m: Metrics, block: Extract<Block, { kind: 'text' }>): void {
  const size = block.size ?? 9.5;
  const font: FontName = block.bold ? 'HB' : 'H';
  const lineHeight = size * 1.45;
  for (const line of wrapText(block.text, m.contentWidth, size, font)) {
    cur.ensure(lineHeight);
    pdf.text(cur.page, m.contentLeft, cur.y, line, { size, font, color: block.color ?? INK });
    cur.y += lineHeight;
  }
}

function drawKv(pdf: PdfWriter, cur: Cursor, m: Metrics, block: Extract<Block, { kind: 'kv' }>): void {
  const cols = block.columns ?? 2;
  const colWidth = m.contentWidth / cols;
  const rowHeight = 26;
  for (let i = 0; i < block.rows.length; i += cols) {
    cur.ensure(rowHeight);
    for (let c = 0; c < cols; c++) {
      const pair = block.rows[i + c];
      if (!pair) continue;
      const x = m.contentLeft + c * colWidth;
      const maxW = colWidth - 12;
      pdf.text(cur.page, x, cur.y, ellipsize(pair[0].toUpperCase(), maxW, 7.5, 'HB'), { size: 7.5, font: 'HB', color: INK_FAINT });
      pdf.text(cur.page, x, cur.y + 12, ellipsize(pair[1] || '—', maxW, 10), { size: 10, color: INK });
    }
    cur.y += rowHeight;
  }
  cur.y += 4;
}

function drawTableHeader(
  pdf: PdfWriter, cur: Cursor, m: Metrics, columns: TableColumn[],
  fill = '#eef2f6', textColor = INK_SOFT, headerSize = 7.5,
): void {
  const boxes = columnBoxes(columns, m);
  pdf.rect(cur.page, m.contentLeft, cur.y - 10, m.contentWidth, 18, { fill });
  columns.forEach((col, i) => {
    pdf.textAligned(cur.page, ellipsize(col.header.toUpperCase(), boxes[i].right - boxes[i].left, headerSize, 'HB'), cur.y + 2, boxes[i], col.align ?? 'left', { size: headerSize, font: 'HB', color: textColor });
  });
  cur.y += 18;
}

function drawTable(pdf: PdfWriter, cur: Cursor, m: Metrics, block: Extract<Block, { kind: 'table' }>): void {
  const boxes = columnBoxes(block.columns, m);
  const rowHeight = 17;
  cur.ensure(18 + rowHeight * 2);
  drawTableHeader(pdf, cur, m, block.columns);

  block.rows.forEach((row, r) => {
    if (cur.ensure(rowHeight)) drawTableHeader(pdf, cur, m, block.columns);
    if (r % 2 === 1) pdf.rect(cur.page, m.contentLeft, cur.y - 9, m.contentWidth, rowHeight, { fill: ZEBRA });
    block.columns.forEach((col, i) => {
      const cell = row[i] ?? '';
      pdf.textAligned(cur.page, ellipsize(cell, boxes[i].right - boxes[i].left, 9), cur.y + 2, boxes[i], col.align ?? 'left', { size: 9, color: INK });
    });
    cur.y += rowHeight;
    pdf.line(cur.page, m.contentLeft, cur.y - 8, m.contentRight, cur.y - 8, { color: RULE, width: 0.4 });
  });

  if (block.footer) {
    if (cur.ensure(rowHeight + 4)) drawTableHeader(pdf, cur, m, block.columns);
    pdf.rect(cur.page, m.contentLeft, cur.y - 9, m.contentWidth, rowHeight, { fill: '#eef2f6' });
    block.columns.forEach((col, i) => {
      const cell = block.footer?.[i] ?? '';
      pdf.textAligned(cur.page, ellipsize(cell, boxes[i].right - boxes[i].left, 9.5, 'HB'), cur.y + 2, boxes[i], col.align ?? 'left', { size: 9.5, font: 'HB', color: INK });
    });
    cur.y += rowHeight;
  }
  cur.y += 10;
}

function drawWrapTable(pdf: PdfWriter, cur: Cursor, m: Metrics, block: Extract<Block, { kind: 'wrapTable' }>): void {
  const boxes = columnBoxes(block.columns, m);
  const wrapSet = new Set(block.wrapCols);
  const cellSize = block.cellSize ?? 9;
  const headerSize = block.headerSize ?? 7.5;
  const lineHeight = cellSize + 2;
  const baseRowHeight = Math.max(17, cellSize + 8);
  cur.ensure(18 + baseRowHeight * 2);
  drawTableHeader(pdf, cur, m, block.columns, block.headerFill, block.headerTextColor, headerSize);

  block.rows.forEach((row, r) => {
    const wrappedByCol = new Map<number, string[]>();
    let maxLines = 1;
    for (const i of wrapSet) {
      const w = boxes[i].right - boxes[i].left;
      const lines = wrapText(row[i] ?? '', w, cellSize);
      wrappedByCol.set(i, lines);
      maxLines = Math.max(maxLines, lines.length);
    }
    const rowHeight = Math.max(baseRowHeight, maxLines * lineHeight + 6);
    if (cur.ensure(rowHeight)) drawTableHeader(pdf, cur, m, block.columns, block.headerFill, block.headerTextColor, headerSize);
    if (r % 2 === 1) pdf.rect(cur.page, m.contentLeft, cur.y - 9, m.contentWidth, rowHeight, { fill: ZEBRA });
    block.columns.forEach((col, i) => {
      const lines = wrappedByCol.get(i);
      if (lines) {
        let ly = cur.y + 2;
        for (const line of lines) {
          pdf.textAligned(cur.page, line, ly, boxes[i], col.align ?? 'left', { size: cellSize, color: INK });
          ly += lineHeight;
        }
        return;
      }
      // Todo lo que no envuelve va anclado al TOPE del renglón — así nunca se
      // desaloja aunque las columnas de wrapCols crezcan a varias líneas.
      const cell = row[i] ?? '';
      pdf.textAligned(cur.page, ellipsize(cell, boxes[i].right - boxes[i].left, cellSize), cur.y + 2, boxes[i], col.align ?? 'left', { size: cellSize, color: INK });
    });
    cur.y += rowHeight;
    pdf.line(cur.page, m.contentLeft, cur.y - 8, m.contentRight, cur.y - 8, { color: RULE, width: 0.4 });
  });

  if (block.footer) {
    if (cur.ensure(baseRowHeight + 4)) drawTableHeader(pdf, cur, m, block.columns, block.headerFill, block.headerTextColor, headerSize);
    pdf.rect(cur.page, m.contentLeft, cur.y - 9, m.contentWidth, baseRowHeight, { fill: '#eef2f6' });
    block.columns.forEach((col, i) => {
      const cell = block.footer?.[i] ?? '';
      pdf.textAligned(cur.page, ellipsize(cell, boxes[i].right - boxes[i].left, cellSize + 0.5, 'HB'), cur.y + 2, boxes[i], col.align ?? 'left', { size: cellSize + 0.5, font: 'HB', color: INK });
    });
    cur.y += baseRowHeight;
  }
  cur.y += 10;
}

function drawNote(pdf: PdfWriter, cur: Cursor, m: Metrics, text: string): void {
  const lines = wrapText(text, m.contentWidth - 20, 8);
  const height = lines.length * 11 + 14;
  // Aire antes de la caja: si el bloque anterior fue texto, su última línea
  // queda pegada al borde superior (visto en la remisión de muestra).
  if (!cur.ensure(height + 6)) cur.y += 6;
  pdf.rect(cur.page, m.contentLeft, cur.y - 10, m.contentWidth, height, { fill: '#f6f8fa', stroke: RULE });
  let y = cur.y + 2;
  for (const line of lines) {
    pdf.text(cur.page, m.contentLeft + 10, y, line, { size: 8, color: INK_SOFT });
    y += 11;
  }
  cur.y += height + 6;
}

/** Caja de firma: trazo (JPEG) o, si no hay imagen, la línea de firma vacía. */
function drawSignature(pdf: PdfWriter, cur: Cursor, m: Metrics, block: Extract<Block, { kind: 'signature' }>): void {
  const height = 108;
  cur.ensure(height);
  const top = cur.y - 8;
  pdf.rect(cur.page, m.contentLeft, top, m.contentWidth, height, { stroke: RULE });
  pdf.text(cur.page, m.contentLeft + 12, top + 16, block.label.toUpperCase(), { size: 7.5, font: 'HB', color: INK_FAINT });

  const strokeTop = top + 24;
  const drawn = block.image ? pdf.image(cur.page, block.image, m.contentLeft + 12, strokeTop, 190, 46) : false;
  if (!drawn) {
    pdf.line(cur.page, m.contentLeft + 12, strokeTop + 44, m.contentLeft + 210, strokeTop + 44, { color: INK_FAINT, width: 0.8 });
  }
  pdf.text(cur.page, m.contentLeft + 12, top + 86, block.name, { size: 10, font: 'HB', color: INK });

  let y = top + 20;
  for (const line of block.detail.slice(0, 6)) {
    pdf.text(cur.page, m.contentLeft + 236, y, ellipsize(line, m.contentWidth - 248, 8), { size: 8, color: INK_SOFT });
    y += 11;
  }
  cur.y += height + 8;
}

// ── Ficha de producto (media hoja) ────────────────────────────────────────────
/** Alto de la ficha: la mitad EXACTA del área de contenido, para que entren dos
 * por página sin dejar una huérfana. 792 - 96 (encabezado) - 44 (pie) = 652. */
const CARD_HEIGHT = 318;
const CARD_GAP = 8;
/** Ancho de la caja de foto: ~3.7" de los 7.2" de contenido. El resto es la
 * columna de datos. */
const CARD_IMAGE_WIDTH = 268;
const CARD_PAD = 8;

/** Cuántas tallas caben en UNA ficha. Sale de la geometría de arriba en el peor
 * caso (título de dos renglones): la columna de tallas mide ~131pt útiles a 13pt
 * por renglón = 10 por sub-columna, y son dos sub-columnas.
 *
 * La plantilla PARTE el producto en fichas de este tamaño en vez de recortar:
 * una OC a la que le faltan tallas es una OC mal surtida, y el "+N más" que
 * salía antes era justo la clase de recorte silencioso que nadie revisa. */
export const PRODUCT_CARD_TALLAS_MAX = 20;

/** Encaja la imagen dentro de la caja SIN deformarla y la centra. El proveedor
 * compara la foto contra lo que va a fabricar: estirarla sería peor que no
 * ponerla. */
function fitBox(
  img: PdfImageData, box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function drawProductCard(
  pdf: PdfWriter, cur: Cursor, m: Metrics, block: Extract<Block, { kind: 'productCard' }>,
): void {
  cur.ensure(CARD_HEIGHT);
  const top = cur.y - 8;
  pdf.rect(cur.page, m.contentLeft, top, m.contentWidth, CARD_HEIGHT, { stroke: RULE });

  // ── Foto (o placeholder) ──
  const imgBox = {
    x: m.contentLeft + CARD_PAD,
    y: top + CARD_PAD,
    w: CARD_IMAGE_WIDTH,
    h: CARD_HEIGHT - CARD_PAD * 2,
  };
  pdf.rect(cur.page, imgBox.x, imgBox.y, imgBox.w, imgBox.h, { fill: '#f1f3f6', stroke: RULE });
  const drawn = block.imagen
    ? (() => { const f = fitBox(block.imagen, imgBox); return pdf.image(cur.page, block.imagen, f.x, f.y, f.w, f.h); })()
    : false;
  if (!drawn) {
    pdf.textAligned(
      cur.page, 'SIN IMAGEN', imgBox.y + imgBox.h / 2,
      { left: imgBox.x, right: imgBox.x + imgBox.w }, 'center',
      { size: 9, font: 'HB', color: INK_FAINT },
    );
  }

  // ── Columna de datos ──
  const colLeft = imgBox.x + imgBox.w + 14;
  const colRight = m.contentRight - CARD_PAD;
  const colWidth = colRight - colLeft;
  let y = top + 22;

  for (const line of wrapText(block.titulo, colWidth, 13, 'HB').slice(0, 2)) {
    pdf.text(cur.page, colLeft, y, line, { size: 13, font: 'HB', color: INK });
    y += 16;
  }
  y += 4;

  for (const [label, value] of block.datos) {
    pdf.text(cur.page, colLeft, y, ellipsize(label.toUpperCase(), colWidth, 7, 'HB'), { size: 7, font: 'HB', color: INK_FAINT });
    pdf.text(cur.page, colLeft, y + 11, ellipsize(value || '—', colWidth, 9.5), { size: 9.5, color: INK });
    y += 24;
  }

  // ── Tallas ──
  const pieHeight = block.pie.length * 12 + 6;
  const tallasTop = y + 6;
  const tallasBottom = top + CARD_HEIGHT - CARD_PAD - pieHeight;
  pdf.line(cur.page, colLeft, tallasTop - 8, colRight, tallasTop - 8, { color: RULE, width: 0.6 });

  const rowH = 13;
  const available = Math.max(0, tallasBottom - tallasTop - rowH);
  const perColumn = Math.max(1, Math.floor(available / rowH));
  // Dos sub-columnas antes que recortar: una OC de 20 tallas es normal y la
  // lista completa es justo lo que el proveedor tiene que surtir.
  const columns = block.tallas.length > perColumn ? 2 : 1;
  const capacity = perColumn * columns;
  const shown = block.tallas.slice(0, block.tallas.length > capacity ? capacity - 1 : capacity);
  const subWidth = colWidth / columns;

  for (let c = 0; c < columns; c++) {
    const x = colLeft + c * subWidth;
    const box = { left: x, right: x + subWidth - 8 };
    pdf.text(cur.page, x, tallasTop, 'TALLA', { size: 7, font: 'HB', color: INK_FAINT });
    pdf.textAligned(cur.page, 'CANT.', tallasTop, box, 'right', { size: 7, font: 'HB', color: INK_FAINT });
    let ty = tallasTop + rowH;
    for (const t of shown.slice(c * perColumn, (c + 1) * perColumn)) {
      pdf.text(cur.page, x, ty, ellipsize(t.talla, subWidth - 40, 9), { size: 9, color: INK });
      pdf.textAligned(cur.page, t.cantidad, ty, box, 'right', { size: 9, font: 'HB', color: INK });
      ty += rowH;
    }
  }
  if (shown.length < block.tallas.length) {
    pdf.text(
      cur.page, colLeft + (columns - 1) * subWidth, tallasTop + rowH * (perColumn + 1),
      `+${block.tallas.length - shown.length} tallas más`, { size: 8, color: INK_SOFT },
    );
  }

  // ── Pie de la ficha ──
  let py = top + CARD_HEIGHT - CARD_PAD - pieHeight + 10;
  for (const line of block.pie) {
    pdf.text(cur.page, colLeft, py, ellipsize(line, colWidth, 9, 'HB'), { size: 9, font: 'HB', color: INK });
    py += 12;
  }

  cur.y += CARD_HEIGHT + CARD_GAP;
}

function drawChrome(pdf: PdfWriter, m: Metrics, meta: DocumentMeta): void {
  const total = pdf.pageCount;
  for (let page = 0; page < total; page++) {
    // Encabezado
    if (meta.logo) pdf.image(page, meta.logo, m.contentLeft, 14, 101, 40);
    else pdf.text(page, m.contentLeft, 44, 'MEXICANA DE PROTECCIÓN', { size: 11, font: 'HB', color: ACCENT });
    pdf.textAligned(page, meta.title, 40, { left: m.contentLeft + 200, right: m.contentRight }, 'right', { size: 10, font: 'HB', color: INK });
    const sub = [meta.subtitle, meta.folio ? `Folio ${meta.folio}` : ''].filter(Boolean).join(' · ');
    if (sub) pdf.textAligned(page, sub, 53, { left: m.contentLeft + 200, right: m.contentRight }, 'right', { size: 8.5, color: INK_SOFT });
    pdf.line(page, m.contentLeft, 62, m.contentRight, 62, { color: RULE, width: 0.8 });

    // Pie
    pdf.line(page, m.contentLeft, m.footerTop + 8, m.contentRight, m.footerTop + 8, { color: RULE, width: 0.6 });
    if (!meta.hideGeneratedByLine) {
      pdf.text(page, m.contentLeft, m.footerTop + 22, `Generado por el portal CMP · ${meta.generatedAt} · Doc ${meta.docId}`, { size: 7, color: INK_FAINT });
    }
    if (meta.footerNote) {
      pdf.text(page, m.contentLeft, m.footerTop + 32, ellipsize(meta.footerNote, m.contentWidth - 60, 7), { size: 7, color: INK_FAINT });
    }
    pdf.textAligned(page, `Página ${page + 1} de ${total}`, m.footerTop + 22, { left: m.contentRight - 120, right: m.contentRight }, 'right', { size: 7, color: INK_FAINT });
  }
}

/** Renderiza los bloques a un PDF completo (encabezado/pie incluidos). */
export function renderDocument(meta: DocumentMeta, blocks: Block[]): Uint8Array {
  const m = metricsFor(!!meta.landscape);
  const pdf = new PdfWriter({ width: m.pageWidth, height: m.pageHeight });
  const cur = new Cursor(pdf, m);

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': drawHeading(pdf, cur, m, block.text); break;
      case 'text': drawText(pdf, cur, m, block); break;
      case 'kv': drawKv(pdf, cur, m, block); break;
      case 'table': drawTable(pdf, cur, m, block); break;
      case 'wrapTable': drawWrapTable(pdf, cur, m, block); break;
      case 'divider':
        cur.ensure(12);
        pdf.line(cur.page, m.contentLeft, cur.y, m.contentRight, cur.y, { color: RULE });
        cur.y += 12;
        break;
      case 'spacer':
        if (!cur.ensure(block.height)) cur.y += block.height;
        break;
      case 'note': drawNote(pdf, cur, m, block.text); break;
      case 'signature': drawSignature(pdf, cur, m, block); break;
      case 'productCard': drawProductCard(pdf, cur, m, block); break;
    }
  }

  drawChrome(pdf, m, meta);
  return pdf.build();
}
