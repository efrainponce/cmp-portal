// Escritor de PDF mínimo, sin dependencias (2026-07-25). Suficiente para los
// documentos que genera el portal: texto Helvetica/Helvetica-Bold, líneas,
// rectángulos y JPEG embebido (la firma trazada en el canvas). NO parsea PDFs
// —solo los escribe— y por eso los documentos firmados se re-renderizan desde
// los datos en vez de estamparse sobre un PDF ajeno (ver worker/lib/documents.ts).
//
// Se eligió escribirlo en vez de traer pdf-lib para no tocar package.json
// (había otra sesión con el árbol sucio) y porque el layout que necesitamos son
// tablas + bloques de texto, no PDFs arbitrarios.
//
// Coordenadas de la API: origen ARRIBA-IZQUIERDA en puntos (1/72"), más cómodo
// para layout; internamente se traducen al sistema de PDF (origen abajo).

export type FontName = 'H' | 'HB'; // Helvetica / Helvetica-Bold

export const LETTER = { width: 612, height: 792 };

// ── Métricas AFM (unidades/1000) ──────────────────────────────────────────────
// Solo ASCII imprimible; los acentuados de WinAnsi miden igual que su letra base
// en Helvetica, así que se resuelven por fallback (widthOf) en vez de tabularlos.
const W_HELV: Record<string, number> = buildWidths(
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278',      // 32-47
  '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556',      // 48-63
  '1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778',     // 64-79
  '667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556',      // 80-95
  '333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556',      // 96-111
  '556 556 333 500 278 556 500 722 500 500 500 334 260 334 584',          // 112-126
);
const W_BOLD: Record<string, number> = buildWidths(
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278',
  '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611',
  '975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778',
  '667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556',
  '333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611',
  '611 611 389 556 333 611 556 778 556 556 500 389 280 389 584',
);

function buildWidths(...rows: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  let code = 32;
  for (const row of rows) for (const n of row.split(' ')) out[String.fromCharCode(code++)] = Number(n);
  return out;
}

/** Acentuados/símbolos frecuentes en español → carácter cuyo ancho comparten. */
const WIDTH_ALIAS: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n', ç: 'c',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N', Ç: 'C',
  '°': 'o', '¿': '?', '¡': '!', '“': '"', '”': '"', '‘': "'", '’': "'",
  '–': '-', '—': 'm', '·': '.', '€': '$', '™': 'm', '©': 'O', '®': 'O',
};

/** Ancho de `text` en puntos. Caracteres desconocidos cuentan como 'n'. */
export function widthOf(text: string, size: number, font: FontName = 'H'): number {
  const table = font === 'HB' ? W_BOLD : W_HELV;
  let units = 0;
  for (const ch of text) units += table[ch] ?? table[WIDTH_ALIAS[ch] ?? ''] ?? table['n'];
  return (units * size) / 1000;
}

// ── Codificación WinAnsi ──────────────────────────────────────────────────────
// WinAnsi coincide con Latin-1 en 32-255 salvo el rango 128-159 (comillas
// tipográficas, guiones largos…), que se mapea explícitamente. Todo lo demás
// que no quepa en un byte se degrada a '?' antes de escapar.
const WINANSI_HIGH: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Literal de PDF (`(...)`) ya escapado y 100% ASCII: los bytes >126 salen como
 * escapes octales, así que el stream completo se puede serializar con TextEncoder. */
export function pdfString(text: string): string {
  let out = '(';
  for (const ch of text) {
    let code = WINANSI_HIGH[ch] ?? ch.codePointAt(0) ?? 63;
    if (code > 255) code = 63; // '?' — emoji y demás fuera de WinAnsi
    if (code === 40 || code === 41 || code === 92) out += '\\' + String.fromCharCode(code);
    else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    // Se reconstruye desde `code`, no desde `ch`: un carácter degradado a 63
    // debe salir como '?', no como el original de dos unidades.
    else out += String.fromCharCode(code);
  }
  return out + ')';
}

// ── Color ─────────────────────────────────────────────────────────────────────
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

// ── Imágenes JPEG ─────────────────────────────────────────────────────────────
export interface JpegInfo { width: number; height: number; components: number }

/** Dimensiones/componentes de un JPEG leyendo su marcador SOF. Devuelve null si
 * no es un JPEG usable — el llamador simplemente omite la imagen. */
export function jpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    // SOF0-SOF3 / SOF5-SOF7 / SOF9-SOF11 / SOF13-SOF15 traen el frame header.
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len <= 0) return null;
    i += 2 + len;
  }
  return null;
}

// ── Writer ────────────────────────────────────────────────────────────────────
interface TextOpts { size?: number; font?: FontName; color?: string }
interface RectOpts { fill?: string; stroke?: string; lineWidth?: number }
interface ImageEntry { name: string; bytes: Uint8Array; info: JpegInfo }

export class PdfWriter {
  readonly width: number;
  readonly height: number;
  private pages: string[][] = [];
  private images: ImageEntry[] = [];

  constructor(size: { width: number; height: number } = LETTER) {
    this.width = size.width;
    this.height = size.height;
  }

  get pageCount(): number { return this.pages.length; }

  /** Agrega una página y devuelve su índice (referencia para el resto de la API). */
  addPage(): number {
    this.pages.push([]);
    return this.pages.length - 1;
  }

  /** `y` es la línea base del texto, medida desde el borde SUPERIOR. */
  text(page: number, x: number, y: number, str: string, opts: TextOpts = {}): void {
    const { size = 10, font = 'H', color = '#111111' } = opts;
    if (!str) return;
    const [r, g, b] = rgb(color);
    this.pages[page].push(
      `BT ${fmt(r)} ${fmt(g)} ${fmt(b)} rg /${font} ${fmt(size)} Tf ` +
      `1 0 0 1 ${fmt(x)} ${fmt(this.height - y)} Tm ${pdfString(str)} Tj ET`,
    );
  }

  /** Igual que `text` pero alineando a la derecha de `right` o centrando en `center`. */
  textAligned(
    page: number, str: string, y: number,
    box: { left: number; right: number }, align: 'left' | 'right' | 'center',
    opts: TextOpts = {},
  ): void {
    const w = widthOf(str, opts.size ?? 10, opts.font ?? 'H');
    const x = align === 'right' ? box.right - w
      : align === 'center' ? box.left + (box.right - box.left - w) / 2
      : box.left;
    this.text(page, x, y, str, opts);
  }

  line(page: number, x1: number, y1: number, x2: number, y2: number, opts: { color?: string; width?: number } = {}): void {
    const [r, g, b] = rgb(opts.color ?? '#dddddd');
    this.pages[page].push(
      `${fmt(opts.width ?? 0.6)} w ${fmt(r)} ${fmt(g)} ${fmt(b)} RG ` +
      `${fmt(x1)} ${fmt(this.height - y1)} m ${fmt(x2)} ${fmt(this.height - y2)} l S`,
    );
  }

  rect(page: number, x: number, y: number, w: number, h: number, opts: RectOpts = {}): void {
    const ops: string[] = [];
    if (opts.fill) { const [r, g, b] = rgb(opts.fill); ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`); }
    if (opts.stroke) { const [r, g, b] = rgb(opts.stroke); ops.push(`${fmt(opts.lineWidth ?? 0.6)} w ${fmt(r)} ${fmt(g)} ${fmt(b)} RG`); }
    const paint = opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S';
    ops.push(`${fmt(x)} ${fmt(this.height - y - h)} ${fmt(w)} ${fmt(h)} re ${paint}`);
    this.pages[page].push(ops.join(' '));
  }

  /** Dibuja un JPEG. Devuelve false (sin dibujar nada) si los bytes no son JPEG. */
  image(page: number, bytes: Uint8Array, x: number, y: number, w: number, h: number): boolean {
    const info = jpegInfo(bytes);
    if (!info) return false;
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, bytes, info });
    this.pages[page].push(
      `q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(this.height - y - h)} cm /${name} Do Q`,
    );
    return true;
  }

  /** Serializa el archivo. Los objetos van en orden fijo: catálogo, pages, 2
   * fuentes, N imágenes, y por página (contenido, página). */
  build(): Uint8Array {
    if (this.pages.length === 0) this.addPage();
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let size = 0;

    const push = (data: Uint8Array | string) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      size += bytes.length;
    };
    const obj = (id: number, body: string) => {
      offsets[id] = size;
      push(`${id} 0 obj\n${body}\nendobj\n`);
    };
    const streamObj = (id: number, dict: string, data: Uint8Array | string) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      offsets[id] = size;
      push(`${id} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      push('\nendstream\nendobj\n');
    };

    const FONT_H = 3, FONT_HB = 4;
    const imgStart = 5;
    const contentStart = imgStart + this.images.length;
    const pageStart = contentStart + this.pages.length;
    const pageIds = this.pages.map((_, i) => pageStart + i);

    push('%PDF-1.4\n%\xC7\xEC\x8F\xA2\n');

    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    obj(FONT_H, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(FONT_HB, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    this.images.forEach((img, i) => {
      const cs = img.info.components === 1 ? '/DeviceGray' : img.info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      streamObj(
        imgStart + i,
        `/Type /XObject /Subtype /Image /Width ${img.info.width} /Height ${img.info.height} ` +
        `/ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode`,
        img.bytes,
      );
    });

    this.pages.forEach((ops, i) => streamObj(contentStart + i, '', ops.join('\n')));

    const xobjects = this.images.length
      ? ` /XObject << ${this.images.map((img, i) => `/${img.name} ${imgStart + i} 0 R`).join(' ')} >>`
      : '';
    this.pages.forEach((_, i) => {
      obj(
        pageIds[i],
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(this.width)} ${fmt(this.height)}] ` +
        `/Resources << /Font << /H ${FONT_H} 0 R /HB ${FONT_HB} 0 R >>${xobjects} >> ` +
        `/Contents ${contentStart + i} 0 R >>`,
      );
    });

    const maxId = pageIds[pageIds.length - 1];
    const xrefAt = size;
    let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= maxId; id++) {
      xref += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
