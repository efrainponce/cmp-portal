// Las tres piezas puras de la foto de producto. `sniffTipo` es la que más pesa:
// es lo único que impide que un .webp renombrado a .jpg se guarde bien y después
// salga como recuadro gris en la OC, sin que nadie sepa por qué.
import { describe, it, expect } from 'vitest';
import { skuKey, isSkuUsable, esSkuDeCatalogo, segmentoR2, sniffTipo, hayQueBuscar, SIN_FOTO_REINTENTO_DIAS } from './ocImagenes';

describe('skuKey', () => {
  it('es la misma foto sin importar cómo escribieron el SKU en la línea', () => {
    expect(skuKey(' 74434 ')).toBe('74434');
    expect(skuKey('abc-1')).toBe(skuKey('ABC-1'));
  });
});

describe('esSkuDeCatalogo', () => {
  it('acepta los SKUs reales del catálogo', () => {
    expect(esSkuDeCatalogo('74434')).toBe(true);
    expect(esSkuDeCatalogo('TDU-511.2')).toBe(true);
  });

  it('rechaza lo que rompería un LIKE de SQLite', () => {
    expect(esSkuDeCatalogo('')).toBe(false);
    expect(esSkuDeCatalogo('a b')).toBe(false);
    expect(esSkuDeCatalogo('74%34')).toBe(false);
    expect(esSkuDeCatalogo('../../etc')).toBe(false);
    expect(esSkuDeCatalogo('x'.repeat(80))).toBe(false);
  });
});

describe('isSkuUsable', () => {
  // 2026-09-21: con la regla del catálogo, TODA subida a una línea manual salía
  // "SKU inválido" (accion_log de prod: "LOGO AIC", `Bota Táctica 8" 4863`).
  it('acepta el texto libre de las líneas manuales', () => {
    expect(isSkuUsable('74434')).toBe(true);
    expect(isSkuUsable('LOGO AIC')).toBe(true);
    expect(isSkuUsable('Bota Táctica 8" 4863')).toBe(true);
    expect(isSkuUsable('CAMISA M/L')).toBe(true);
  });

  it('rechaza vacío, control y lo desmedido', () => {
    expect(isSkuUsable('  ')).toBe(false);
    expect(isSkuUsable('a\nb')).toBe(false);
    expect(isSkuUsable('x'.repeat(301))).toBe(false);
  });
});

describe('segmentoR2', () => {
  it('deja igual el SKU del catálogo (los keys viejos no cambian)', async () => {
    expect(await segmentoR2(' tdu-511.2 ')).toBe('TDU-511.2');
  });

  it('el texto libre nunca llega crudo al key', async () => {
    const seg = await segmentoR2('../../etc/LOGO AIC');
    expect(seg).toMatch(/^libre-[0-9a-f]{32}$/);
    expect(await segmentoR2('logo aic')).toBe(await segmentoR2(' LOGO AIC '));
  });
});

describe('sniffTipo', () => {
  it('reconoce JPEG y PNG por sus bytes, no por el nombre', () => {
    expect(sniffTipo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffTipo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('un WEBP (o cualquier otra cosa) se rechaza en la subida', () => {
    // "RIFF....WEBP" — el motor de PDF no lo sabe embeber, así que aceptarlo
    // solo cambiaría el error de sitio: saldría como placeholder en la OC.
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffTipo(webp)).toBeNull();
    expect(sniffTipo(new Uint8Array([]))).toBeNull();
  });
});

describe('marca de "el catálogo no tiene foto"', () => {
  // Es lo que evita volver a preguntarle a Airtable por los mismos productos
  // cada vez que alguien abre el tab. La regla delicada: esa marca PISA la fila
  // existente, así que solo puede escribirse sobre SKUs que aún no tienen una —
  // sobre un producto con foto subida, la borraría.
  it('restablecer NO marca (protege la foto subida)', async () => {
    const { jalarDeAirtable, restablecerDesdeAirtable } = await import('./ocImagenes');
    // Sin AIRTABLE_API_KEY el cliente degrada en silencio y no encuentra nada:
    // el caso exacto donde la marca haría daño.
    const env = {
      AIRTABLE_API_KEY: '',
      DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), run: async () => ({}), first: async () => null }), run: async () => ({}), first: async () => null }) },
    } as never;
    // marcarFaltante=false ⇒ null, sin escribir.
    await expect(restablecerDesdeAirtable(env, 'ABC123')).resolves.toBeNull();
    await expect(jalarDeAirtable(env, 'ABC123', false)).resolves.toBeNull();
  });
});

describe('hayQueBuscar (reintento automático de "sin-foto")', () => {
  const dia = 86_400_000;
  const ahora = Date.parse('2026-09-21T12:00:00Z');
  it('sin fila se busca; con foto nunca', () => {
    expect(hayQueBuscar(undefined, ahora)).toBe(true);
    expect(hayQueBuscar({ estado: 'ok', updated_at: '2020-01-01T00:00:00Z' }, ahora)).toBe(false);
  });
  it('la marca "sin-foto" caduca y se vuelve a preguntar sola', () => {
    const reciente = new Date(ahora - dia).toISOString();
    const vieja = new Date(ahora - (SIN_FOTO_REINTENTO_DIAS + 1) * dia).toISOString();
    expect(hayQueBuscar({ estado: 'sin-foto', updated_at: reciente }, ahora)).toBe(false);
    expect(hayQueBuscar({ estado: 'sin-foto', updated_at: vieja }, ahora)).toBe(true);
    expect(hayQueBuscar({ estado: 'sin-foto', updated_at: 'basura' }, ahora)).toBe(true);
  });
});

describe('fallo de Airtable ≠ "sin foto"', () => {
  it('sin API key no se marca nada aunque marcarFaltante sea true', async () => {
    const { jalarDeAirtable } = await import('./ocImagenes');
    const escrituras: string[] = [];
    // El mirror sí conoce el producto (tiene id de Airtable); lo que falta es la llave.
    const fila = { columns: JSON.stringify([{ id: 'product_and_service_sku', text: 'ABC123' }, { id: 'text_mkzmgvc7', text: 'recXYZ' }]) };
    const env = {
      AIRTABLE_API_KEY: '',
      DB: { prepare: (sql: string) => ({
        bind: () => ({ all: async () => ({ results: sql.includes('FROM items') ? [fila] : [] }), run: async () => { escrituras.push(sql); return {}; }, first: async () => null }),
        run: async () => ({}), first: async () => null,
      }) },
    } as never;
    await expect(jalarDeAirtable(env, 'ABC123', true)).resolves.toBeNull();
    expect(escrituras.filter(q => q.includes('sin-foto'))).toEqual([]);
  });
});
