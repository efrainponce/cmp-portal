// El decodificador de PNG es la pieza nueva más delicada de la OC con imágenes:
// un off-by-one en los filtros no truena, sale como una foto "rayada" dentro de
// un PDF que nadie vuelve a revisar. Estos tests fijan los 5 filtros, los tipos
// de color que soportamos y —sobre todo— lo que se REHÚSA a dibujar, que es lo
// que decide si el proveedor ve la foto o el recuadro gris.
import { describe, it, expect } from 'vitest';
import {
  parsePngChunks, unfilter, toPdfSamples, pngToPdfImage, isPng,
  inflateZlib, deflateZlib,
} from './png';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // CRC en cero: el parser no lo verifica (un PNG que llegó completo por HTTPS
  // ya viene íntegro, y rechazarlo por CRC solo daría fotos perdidas).
  return out;
}

function ihdr(width: number, height: number, colorType: number, bitDepth = 8, interlace = 0): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = bitDepth;
  data[9] = colorType;
  data[12] = interlace;
  return chunk('IHDR', data);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** PNG sintético sin filtros (filtro 0 por scanline) — lo mínimo para probar el
 * camino completo sin meter una imagen binaria al repo. */
async function makePng(
  width: number, height: number, colorType: number, samples: number[],
  extra: { plte?: number[]; trns?: number[] } = {},
): Promise<Uint8Array> {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro None
    raw.set(samples.slice(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = await deflateZlib(raw);
  return concat([
    new Uint8Array(SIG),
    ihdr(width, height, colorType),
    ...(extra.plte ? [chunk('PLTE', new Uint8Array(extra.plte))] : []),
    ...(extra.trns ? [chunk('tRNS', new Uint8Array(extra.trns))] : []),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

describe('isPng / parsePngChunks', () => {
  it('reconoce la firma y lee la cabecera', async () => {
    const png = await makePng(2, 1, 2, [1, 2, 3, 4, 5, 6]);
    expect(isPng(png)).toBe(true);
    const parsed = parsePngChunks(png);
    expect(parsed?.ihdr).toMatchObject({ width: 2, height: 1, bitDepth: 8, colorType: 2 });
  });

  it('un JPEG no pasa por PNG', () => {
    expect(isPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(parsePngChunks(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });

  it('rechaza entrelazado y profundidades que no sabemos leer', () => {
    const base = [new Uint8Array(SIG), chunk('IDAT', new Uint8Array([1]))];
    const entrelazado = concat([new Uint8Array(SIG), ihdr(4, 4, 2, 8, 1), base[1]]);
    const dieciseis = concat([new Uint8Array(SIG), ihdr(4, 4, 2, 16, 0), base[1]]);
    expect(parsePngChunks(entrelazado)).toBeNull();
    expect(parsePngChunks(dieciseis)).toBeNull();
  });

  it('rechaza una imagen absurdamente grande antes de descomprimirla', () => {
    const gigante = concat([new Uint8Array(SIG), ihdr(9000, 9000, 2), chunk('IDAT', new Uint8Array([1]))]);
    expect(parsePngChunks(gigante)).toBeNull();
  });
});

describe('unfilter', () => {
  // Un pixel gris por renglón, cada filtro apuntando al mismo resultado: 10, 20.
  const casos: [string, number, number[]][] = [
    ['None (0)', 0, [0, 10, 0, 20]],
    ['Sub (1)', 1, [1, 10, 1, 20]],
    ['Up (2)', 2, [2, 10, 2, 10]],
    ['Average (3)', 3, [3, 10, 3, 15]],
    ['Paeth (4)', 4, [4, 10, 4, 10]],
  ];
  for (const [nombre, , bytes] of casos) {
    it(`deshace ${nombre}`, () => {
      expect([...unfilter(new Uint8Array(bytes), 1, 2, 1)!]).toEqual([10, 20]);
    });
  }

  it('un filtro inexistente devuelve null en vez de dibujar basura', () => {
    expect(unfilter(new Uint8Array([9, 10]), 1, 1, 1)).toBeNull();
  });

  it('datos más cortos que la imagen devuelven null', () => {
    expect(unfilter(new Uint8Array([0, 10]), 4, 4, 1)).toBeNull();
  });
});

describe('toPdfSamples', () => {
  it('RGB opaco pasa tal cual', () => {
    const r = toPdfSamples(new Uint8Array([1, 2, 3]), 1, 1, 2, null, null);
    expect(r?.colorSpace).toBe('DeviceRGB');
    expect([...r!.bytes]).toEqual([1, 2, 3]);
  });

  it('el alfa se mezcla sobre BLANCO, no sobre negro', () => {
    // Rojo puro totalmente transparente debe quedar blanco: en papel no hay
    // "transparente", y tirar el alfa a secas lo dejaría rojo.
    const invisible = toPdfSamples(new Uint8Array([255, 0, 0, 0]), 1, 1, 6, null, null);
    expect([...invisible!.bytes]).toEqual([255, 255, 255]);
    const opaco = toPdfSamples(new Uint8Array([255, 0, 0, 255]), 1, 1, 6, null, null);
    expect([...opaco!.bytes]).toEqual([255, 0, 0]);
  });

  it('la paleta se expande a RGB respetando tRNS', () => {
    const r = toPdfSamples(new Uint8Array([0, 1]), 2, 1, 3, new Uint8Array([10, 20, 30, 40, 50, 60]), new Uint8Array([255, 0]));
    expect([...r!.bytes]).toEqual([10, 20, 30, 255, 255, 255]);
  });

  it('gris + alfa queda en gris', () => {
    const r = toPdfSamples(new Uint8Array([0, 0]), 1, 1, 4, null, null);
    expect(r?.colorSpace).toBe('DeviceGray');
    expect([...r!.bytes]).toEqual([255]);
  });
});

describe('pngToPdfImage', () => {
  it('devuelve las muestras crudas que el PDF sabe leer', async () => {
    const png = await makePng(2, 2, 2, [
      255, 0, 0, 0, 255, 0,
      0, 0, 255, 9, 9, 9,
    ]);
    const img = await pngToPdfImage(png);
    expect(img).toMatchObject({ width: 2, height: 2, colorSpace: 'DeviceRGB', filter: 'FlateDecode' });
    // Los bytes van comprimidos: se inflan de vuelta para comprobar el pixel.
    const crudo = await inflateZlib(img!.bytes);
    expect([...crudo]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
  });

  it('un PNG con alfa sale sin canal alfa y sobre blanco', async () => {
    const png = await makePng(1, 1, 6, [0, 0, 255, 128]);
    const img = await pngToPdfImage(png);
    const crudo = await inflateZlib(img!.bytes);
    expect(crudo.length).toBe(3);
    expect(crudo[2]).toBeGreaterThan(crudo[0]); // sigue tirando a azul, aclarado
  });

  it('bytes corruptos devuelven null en vez de lanzar', async () => {
    const roto = concat([new Uint8Array(SIG), ihdr(2, 2, 2), chunk('IDAT', new Uint8Array([1, 2, 3, 4]))]);
    await expect(pngToPdfImage(roto)).resolves.toBeNull();
  });
});
