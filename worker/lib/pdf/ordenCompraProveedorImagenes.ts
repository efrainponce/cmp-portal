// worker/lib/pdf/ordenCompraProveedorImagenes.ts — Orden de Compra a Proveedor
// CON IMÁGENES (Efraín, 2026-08-24).
//
// Es una plantilla APARTE, no una bandera dentro de ordenCompraProveedor.ts:
// esa es el template de referencia que copian la solicitud de costeo y la
// cotización vista previa, y meterle un layout distinto por dentro arriesgaba
// tres documentos para arreglar uno.
//
// Estructura (Efraín, 2026-08-24: "si necesita la orden de compra básica al
// principio, las imágenes son como anexo"): PRIMERO la OC de siempre, completa
// y sin tocar —tabla de líneas, totales, notas y las tres firmas, reusando sus
// bloques tal cual (`buildOcProveedorBlocks`)— y DESPUÉS, en página aparte, el
// ANEXO de fichas.
//
// Que la tabla vaya primero no es cosmético: es el documento que rige. El anexo
// resuelve un problema de identidad, no de números —el mismo SKU puede llegar
// con broches o con velcro y el proveedor no tiene cómo saber cuál le tocaba—,
// así que las fotos son referencia visual y las cantidades que mandan siguen
// siendo las de la tabla. Si alguna vez discreparan, el anexo es el que sobra.
//
// Cada ficha es media hoja por PRODUCTO: foto grande a la izquierda, tallas a
// la derecha, dos por página. Las tallas de un producto se juntan en su ficha en
// vez de repetir la foto 10 veces. Los embellecimientos no llevan ficha (no son
// un artículo del catálogo, son un trabajo sobre uno): salen en la tabla de la
// OC de arriba, como siempre.
import type { Block } from './layout';
import { renderDocument, PRODUCT_CARD_TALLAS_MAX } from './layout';
import type { PdfImageData } from './png';
import { fmtNumMx } from '../importeEnLetras';
import { buildOcProveedorBlocks, ocProveedorMeta, type OcProveedorLinea, type OcProveedorPdfInput } from './ordenCompraProveedor';

export interface OcProveedorImagenesPdfInput extends OcProveedorPdfInput {
  /** Foto por SKU (llave ya canónica, `skuKey` de worker/lib/ocImagenes.ts).
   * Un SKU ausente sale con el placeholder gris, no con error. */
  imagenes: Map<string, PdfImageData>;
  /** Imágenes que alguien subió para ESTE proyecto (renders, la muestra
   * aprobada, el detalle del bordado) — worker/lib/proyectoImagenes.ts, Efraín
   * 2026-08-25. Cada una se lleva su PROPIA ficha, con la foto grande: para eso
   * se sube un render, para que el proveedor lo vea. */
  extras?: Map<string, { nombre: string; imagen: PdfImageData }[]>;
}

/** Una ficha del documento: todas las líneas de un mismo producto juntas. */
export interface ProductoGrupo {
  sku: string;
  producto: string;
  colores: string[];
  unidad: string;
  moneda: string;
  /** Precio unitario de la primera línea; `preciosVarios` avisa si el grupo no
   * es homogéneo (pasa cuando una talla especial cuesta distinto). */
  precio: number;
  preciosVarios: boolean;
  descuento: number;
  cantidad: number;
  importe: number;
  tallas: { talla: string; cantidad: string }[];
}

function fmtMoney(n: number, moneda: string): string {
  const s = n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `US$${s}` : `$${s}`;
}

/** Agrupa las líneas de producto por SKU conservando el orden en que llegaron.
 * Las de embellecimiento (las que traen `zona`) se quedan fuera: no tienen ficha.
 * Pura y anclada en test — es la pieza que decide cuántas hojas sale la OC. */
export function agruparPorProducto(lineas: OcProveedorLinea[]): ProductoGrupo[] {
  /** El color viaja con cada talla mientras se agrupa y se descarta al final:
   * solo sirve para decidir si la etiqueta lo necesita. */
  interface TallaCruda { talla: string; cantidad: string; color: string }
  const orden: string[] = [];
  const mapa = new Map<string, { grupo: ProductoGrupo; tallas: TallaCruda[] }>();

  for (const l of lineas) {
    if (l.zona) continue;
    const key = (l.sku || l.producto || '—').trim().toUpperCase();
    let entrada = mapa.get(key);
    if (!entrada) {
      entrada = {
        grupo: {
          sku: l.sku, producto: l.producto, colores: [], unidad: l.unidad, moneda: l.moneda,
          precio: l.precio, preciosVarios: false, descuento: l.descuento,
          cantidad: 0, importe: 0, tallas: [],
        },
        tallas: [],
      };
      mapa.set(key, entrada);
      orden.push(key);
    }
    const g = entrada.grupo;
    if (l.color && !g.colores.includes(l.color)) g.colores.push(l.color);
    if (l.precio !== g.precio) g.preciosVarios = true;
    g.cantidad += l.cantidad;
    g.importe += l.cantidad * l.precio * (1 - l.descuento);
    entrada.tallas.push({ talla: l.talla || '—', cantidad: String(l.cantidad), color: l.color });
  }

  // La etiqueta de talla incluye el color SOLO cuando el grupo trae más de uno:
  // repetir "Dark Navy" en las 10 tallas de un producto de un solo color es
  // ruido en una columna que ya va angosta.
  for (const { grupo, tallas } of mapa.values()) {
    grupo.tallas = tallas.map(t => ({
      talla: grupo.colores.length > 1 && t.color ? `${t.color} · ${t.talla}` : t.talla,
      cantidad: t.cantidad,
    }));
  }

  return orden.map(k => mapa.get(k)!.grupo);
}

/** Grupos → fichas de media hoja. Un producto con más tallas de las que caben
 * se reparte en VARIAS fichas en vez de recortarse: la lista de tallas es el
 * pedido, y un "+4 tallas más" al pie es una orden mal surtida esperando a
 * pasar. Exportada para poder anclar justo eso en test. */
export function construirFichas(
  grupos: ProductoGrupo[], imagenes: Map<string, PdfImageData>, sinCostos = false,
  extras: Map<string, { nombre: string; imagen: PdfImageData }[]> = new Map(),
): Extract<Block, { kind: 'productCard' }>[] {
  return grupos.flatMap(g => {
    const partes: { talla: string; cantidad: string }[][] = [];
    for (let i = 0; i < g.tallas.length; i += PRODUCT_CARD_TALLAS_MAX) {
      partes.push(g.tallas.slice(i, i + PRODUCT_CARD_TALLAS_MAX));
    }
    if (partes.length === 0) partes.push([]);
    const nombre = g.producto || g.sku || '—';
    const imagen = imagenes.get((g.sku || '').trim().toUpperCase()) ?? null;

    const fichasDeTallas = partes.map((tallas, i) => ({
      kind: 'productCard' as const,
      titulo: partes.length > 1 ? `${nombre} (${i + 1} de ${partes.length})` : nombre,
      datos: [
        ['SKU / Modelo', g.sku || '—'],
        ['Color', g.colores.join(', ') || '—'],
        ['Unidad', g.unidad || '—'],
      ] as [string, string][],
      tallas,
      // Los totales del producto van solo en su ÚLTIMA ficha: repetirlos en cada
      // parte se leería como si el pedido fuera el doble.
      pie: i === partes.length - 1
        ? sinCostos
          // Sin dinero queda lo que sí necesita quien surte: cuántas piezas y
          // en cuántas tallas. El segundo renglón va vacío a propósito — el alto
          // del pie no puede cambiar entre versiones (define cuántas tallas caben).
          ? [`${fmtNumMx(g.cantidad)} ${g.unidad || 'pzas'} · ${g.tallas.length} talla${g.tallas.length === 1 ? '' : 's'}`, '']
          : [
              `${fmtNumMx(g.cantidad)} ${g.unidad || 'pzas'} · ${fmtMoney(g.precio, g.moneda)} c/u${g.preciosVarios ? ' (varios)' : ''}`,
              `${g.descuento > 0 ? `Desc. ${Math.round(g.descuento * 100)}% · ` : ''}Importe ${fmtMoney(g.importe, g.moneda)} ${g.moneda}`,
            ]
        // Dos renglones también aquí (el segundo vacío): el alto del pie define
        // cuántas tallas caben, y no puede cambiar entre partes del mismo grupo.
        : ['Continúa en la ficha siguiente', ''],
      imagen,
    }));

    // Una ficha por imagen extra del proyecto, después de las de tallas. No
    // repiten tallas ni totales a propósito: el pedido ya está en las de
    // arriba, y repetirlo se leería como si fuera el doble (mismo criterio que
    // el pie de las partes). Solo llevan la foto grande y de qué producto es.
    const extrasDelSku = extras.get((g.sku || '').trim().toUpperCase()) ?? [];
    // El total que se numera incluye la foto del catálogo cuando la hay: para
    // quien recibe la OC, "imagen 2 de 3" cuenta lo que ve, no de dónde salió.
    const total = extrasDelSku.length + (imagen ? 1 : 0);
    const fichasExtra = extrasDelSku.map((extra, i) => ({
      kind: 'productCard' as const,
      titulo: `${nombre} — imagen ${i + 1 + (imagen ? 1 : 0)} de ${total}`,
      datos: [
        ['SKU / Modelo', g.sku || '—'],
        ['Color', g.colores.join(', ') || '—'],
        ['Referencia', extra.nombre],
      ] as [string, string][],
      tallas: [],
      pie: ['Imagen de referencia de esta orden', ''],
      imagen: extra.imagen,
    }));

    return [...fichasDeTallas, ...fichasExtra];
  });
}

export function buildOrdenCompraProveedorImagenesPdf(input: OcProveedorImagenesPdfInput): Uint8Array {
  const fichas = construirFichas(
    agruparPorProducto(input.lineas), input.imagenes, !!input.sinCostos, input.extras);

  const blocks: Block[] = [
    // La orden básica, íntegra: tabla de líneas, totales, notas y firmas.
    ...buildOcProveedorBlocks(input),
    ...(fichas.length
      ? ([
          { kind: 'pageBreak' },
          { kind: 'heading', text: 'Anexo — fichas de producto' },
          {
            kind: 'note',
            text: 'Referencia visual de los productos de esta orden. Las cantidades que rigen son las de la tabla de la orden; este anexo sirve para identificar la variante exacta de cada modelo.',
          },
          ...fichas,
        ] as Block[])
      : []),
  ];

  return renderDocument(ocProveedorMeta(input), blocks);
}
