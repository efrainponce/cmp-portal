// worker/lib/pdf/png.ts — PNG → imagen embebible en PDF (2026-08-24).
//
// El writer (worker/lib/pdf/writer.ts) nació embebiendo solo JPEG: la firma
// trazada en el canvas sale JPEG y con eso bastaba. La OC con imágenes cambia
// eso — la foto de producto viene de Airtable y ahí la mitad del catálogo son
// PNG, así que sin esto la OC "con imágenes" saldría con huecos justo en los
// productos que motivan la función.
//
// No hay dependencias nuevas: Workers trae DecompressionStream/CompressionStream
// nativos, así que el PNG se infla, se le deshacen los filtros por scanline, se
// tira el canal alfa sobre BLANCO (el PDF se imprime en papel; un alfa real
// obligaría a un /SMask aparte) y se vuelve a comprimir como /FlateDecode. El
// PDF queda con la imagen cruda RGB/Gray, que es lo que sabe leer cualquier
// visor sin filtros exóticos.
//
// Lo que NO se soporta, a propósito (devuelve null y el llamador dibuja el
// placeholder gris): entrelazado Adam7, profundidad distinta de 8 bits, y
// cualquier imagen arriba de MAX_PIXELS. Son casos raros en fotos de catálogo y
// cada uno costaría bastante más código del que vale.

/** Imagen ya lista para el writer: bytes en el filtro que declara. */
export interface PdfImageData {
  width: number;
  height: number;
  colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK';
  filter: 'DCTDecode' | 'FlateDecode';
  bytes: Uint8Array;
}

/** Tope de pixeles a descomprimir. 4 MP ya es más resolución de la que cabe en
 * media hoja carta; el límite existe por el presupuesto de CPU del Worker, que
 * en el plan actual es corto (una imagen de 40 MP tumbaría el request). */
const MAX_PIXELS = 4_000_000;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Ihdr {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

/** Canales por pixel de cada tipo de color PNG (0 gris, 2 RGB, 3 paleta,
 * 4 gris+alfa, 6 RGBA). -1 = tipo inválido. */
function channelsOf(colorType: number): number {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: return -1;
  }
}

function readU32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return SIGNATURE.every((v, i) => bytes[i] === v);
}

interface PngChunks {
  ihdr: Ihdr;
  idat: Uint8Array;
  plte: Uint8Array | null;
  trns: Uint8Array | null;
}

/** Recorre los chunks y devuelve lo único que necesitamos: cabecera, paleta,
 * transparencia y el IDAT concatenado. Null si el archivo no es un PNG que
 * sepamos dibujar. Pura — el test la usa sin streams. */
export function parsePngChunks(bytes: Uint8Array): PngChunks | null {
  if (!isPng(bytes)) return null;
  let at = 8;
  let ihdr: Ihdr | null = null;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];
  let idatLength = 0;

  while (at + 8 <= bytes.length) {
    const len = readU32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const dataAt = at + 8;
    if (dataAt + len + 4 > bytes.length) break; // chunk truncado: lo que haya servido
    if (type === 'IHDR') {
      if (len < 13) return null;
      ihdr = {
        width: readU32(bytes, dataAt),
        height: readU32(bytes, dataAt + 4),
        bitDepth: bytes[dataAt + 8],
        colorType: bytes[dataAt + 9],
        interlace: bytes[dataAt + 12],
      };
    } else if (type === 'PLTE') {
      plte = bytes.subarray(dataAt, dataAt + len);
    } else if (type === 'tRNS') {
      trns = bytes.subarray(dataAt, dataAt + len);
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataAt, dataAt + len));
      idatLength += len;
    } else if (type === 'IEND') {
      break;
    }
    at = dataAt + len + 4; // + CRC
  }

  if (!ihdr || idatLength === 0) return null;
  if (ihdr.width <= 0 || ihdr.height <= 0) return null;
  if (ihdr.bitDepth !== 8) return null;          // 1/2/4/16 bits: fuera de alcance
  if (ihdr.interlace !== 0) return null;          // Adam7: fuera de alcance
  if (channelsOf(ihdr.colorType) < 0) return null;
  if (ihdr.colorType === 3 && !plte) return null; // paleta sin PLTE = corrupto
  if (ihdr.width * ihdr.height > MAX_PIXELS) return null;

  const idat = new Uint8Array(idatLength);
  let o = 0;
  for (const part of idatParts) { idat.set(part, o); o += part.length; }
  return { ihdr, idat, plte, trns };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Deshace los 5 filtros por scanline del PNG. `raw` trae, por renglón, 1 byte
 * de filtro + width*bpp bytes. Devuelve solo los pixeles, ya sin el byte de
 * filtro. Pura y anclada en test: es donde un off-by-one se ve como una imagen
 * "rayada" y no como un error. */
export function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array | null {
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) return null;
  const out = new Uint8Array(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    const prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[row + i - bpp] : 0;                 // izquierda
      const b = y > 0 ? out[prev + i] : 0;                          // arriba
      const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;        // diagonal
      let value: number;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: value = x + paeth(a, b, c); break;
        default: return null;
      }
      out[row + i] = value & 0xff;
    }
    src += stride;
  }
  return out;
}

/** Mezcla un canal sobre fondo BLANCO. El PDF va a papel: un producto recortado
 * con fondo transparente debe verse sobre blanco, no sobre negro (que es lo que
 * pasa si uno simplemente tira el alfa). */
function overWhite(c: number, alpha: number): number {
  return Math.round((c * alpha + 255 * (255 - alpha)) / 255);
}

/** Pixeles ya sin filtro → bytes RGB/Gray sin alfa, listos para el PDF. Pura. */
export function toPdfSamples(
  pixels: Uint8Array, width: number, height: number,
  colorType: number, plte: Uint8Array | null, trns: Uint8Array | null,
): { bytes: Uint8Array; colorSpace: 'DeviceGray' | 'DeviceRGB' } | null {
  const count = width * height;
  switch (colorType) {
    case 0: // gris opaco — se embebe tal cual
      return { bytes: pixels.subarray(0, count), colorSpace: 'DeviceGray' };
    case 2: // RGB opaco — tal cual
      return { bytes: pixels.subarray(0, count * 3), colorSpace: 'DeviceRGB' };
    case 3: { // paleta (+ tRNS opcional por índice)
      if (!plte) return null;
      const out = new Uint8Array(count * 3);
      for (let i = 0; i < count; i++) {
        const idx = pixels[i];
        const p = idx * 3;
        const alpha = trns && idx < trns.length ? trns[idx] : 255;
        out[i * 3] = overWhite(plte[p] ?? 0, alpha);
        out[i * 3 + 1] = overWhite(plte[p + 1] ?? 0, alpha);
        out[i * 3 + 2] = overWhite(plte[p + 2] ?? 0, alpha);
      }
      return { bytes: out, colorSpace: 'DeviceRGB' };
    }
    case 4: { // gris + alfa
      const out = new Uint8Array(count);
      for (let i = 0; i < count; i++) out[i] = overWhite(pixels[i * 2], pixels[i * 2 + 1]);
      return { bytes: out, colorSpace: 'DeviceGray' };
    }
    case 6: { // RGBA
      const out = new Uint8Array(count * 3);
      for (let i = 0; i < count; i++) {
        const s = i * 4;
        const alpha = pixels[s + 3];
        out[i * 3] = overWhite(pixels[s], alpha);
        out[i * 3 + 1] = overWhite(pixels[s + 1], alpha);
        out[i * 3 + 2] = overWhite(pixels[s + 2], alpha);
      }
      return { bytes: out, colorSpace: 'DeviceRGB' };
    }
    default:
      return null;
  }
}

async function pipe(data: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  // `data` puede ser una vista sobre un buffer mayor (subarray): se copia para
  // no arrastrar el resto del archivo al stream.
  const copy = new Uint8Array(data);
  const out = new Response(new Blob([copy]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** zlib inflate/deflate nativos del runtime — 'deflate' en la Web API es el
 * formato zlib (con cabecera), que es exactamente lo que llevan el IDAT del PNG
 * y el /FlateDecode del PDF. */
export async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream('deflate'));
}
export async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new CompressionStream('deflate'));
}

/** PNG → imagen lista para `PdfWriter.image`. Devuelve null (sin lanzar) ante
 * cualquier PNG fuera de alcance o corrupto: el llamador pinta el placeholder. */
export async function pngToPdfImage(bytes: Uint8Array): Promise<PdfImageData | null> {
  const parsed = parsePngChunks(bytes);
  if (!parsed) return null;
  const { ihdr, idat, plte, trns } = parsed;
  const channels = channelsOf(ihdr.colorType);

  let raw: Uint8Array;
  try {
    raw = await inflateZlib(idat);
  } catch {
    return null;
  }

  const pixels = unfilter(raw, ihdr.width, ihdr.height, channels);
  if (!pixels) return null;

  const samples = toPdfSamples(pixels, ihdr.width, ihdr.height, ihdr.colorType, plte, trns);
  if (!samples) return null;

  try {
    return {
      width: ihdr.width,
      height: ihdr.height,
      colorSpace: samples.colorSpace,
      filter: 'FlateDecode',
      bytes: await deflateZlib(samples.bytes),
    };
  } catch {
    return null;
  }
}
