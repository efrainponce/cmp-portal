// worker/lib/pdf/ordenCompraProveedorImagenes.ts — Orden de Compra a Proveedor
// CON IMÁGENES (Efraín, 2026-08-24).
//
// Es una plantilla APARTE, no una bandera dentro de ordenCompraProveedor.ts:
// esa es el template de referencia que copian la solicitud de costeo y la
// cotización vista previa, y meterle un layout distinto por dentro arriesgaba
// tres documentos para arreglar uno.
//
// Diferencia de fondo: la OC normal es una tabla, renglón por línea. Esta es
// una FICHA de media hoja por PRODUCTO (foto grande a la izquierda, tallas a la
// derecha), porque el problema que resuelve no es de números sino de identidad:
// el mismo SKU puede llegar con broches o con velcro y el proveedor no tiene
// cómo saber cuál le tocaba. Las tallas de un producto se juntan en su ficha en
// vez de repetir la foto 10 veces.
//
// Los embellecimientos no llevan ficha (no son un artículo del catálogo, son un
// trabajo sobre uno): van en una tabla compacta al final, igual que en la OC
// normal. Los totales, el importe en letras, las notas y las tres firmas son
// los MISMOS que la OC normal — el documento sigue siendo la misma orden.
import type { Block, DocumentMeta } from './layout';
import { renderDocument, PRODUCT_CARD_TALLAS_MAX } from './layout';
import type { PdfImageData } from './png';
import { LOGO_JPG_BASE64, CMP_ORANGE } from './logo';
import { importeEnLetras, fmtNumMx } from '../importeEnLetras';
import type { OcProveedorLinea, OcProveedorPdfInput } from './ordenCompraProveedor';

export interface OcProveedorImagenesPdfInput extends OcProveedorPdfInput {
  /** Foto por SKU (llave ya canónica, `skuKey` de worker/lib/ocImagenes.ts).
   * Un SKU ausente sale con el placeholder gris, no con error. */
  imagenes: Map<string, PdfImageData>;
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

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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
  grupos: ProductoGrupo[], imagenes: Map<string, PdfImageData>,
): Extract<Block, { kind: 'productCard' }>[] {
  return grupos.flatMap(g => {
    const partes: { talla: string; cantidad: string }[][] = [];
    for (let i = 0; i < g.tallas.length; i += PRODUCT_CARD_TALLAS_MAX) {
      partes.push(g.tallas.slice(i, i + PRODUCT_CARD_TALLAS_MAX));
    }
    if (partes.length === 0) partes.push([]);
    const nombre = g.producto || g.sku || '—';
    const imagen = imagenes.get((g.sku || '').trim().toUpperCase()) ?? null;

    return partes.map((tallas, i) => ({
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
        ? [
            `${fmtNumMx(g.cantidad)} ${g.unidad || 'pzas'} · ${fmtMoney(g.precio, g.moneda)} c/u${g.preciosVarios ? ' (varios)' : ''}`,
            `${g.descuento > 0 ? `Desc. ${Math.round(g.descuento * 100)}% · ` : ''}Importe ${fmtMoney(g.importe, g.moneda)} ${g.moneda}`,
          ]
        // Dos renglones también aquí (el segundo vacío): el alto del pie define
        // cuántas tallas caben, y no puede cambiar entre partes del mismo grupo.
        : ['Continúa en la ficha siguiente', ''],
      imagen,
    }));
  });
}

export function buildOrdenCompraProveedorImagenesPdf(input: OcProveedorImagenesPdfInput): Uint8Array {
  const moneda = input.lineas[0]?.moneda || 'MXN';
  // Totales sobre TODAS las líneas (incluidas las de embellecimiento): el
  // documento es la misma orden que la versión sin imágenes y tiene que sumar
  // exactamente igual.
  const monto = input.lineas.reduce((s, l) => s + l.cantidad * l.precio * (1 - l.descuento), 0);
  const totalUnidades = input.lineas.reduce((s, l) => s + l.cantidad, 0);

  const grupos = agruparPorProducto(input.lineas);
  const embellecimientos = input.lineas.filter(l => l.zona);

  const fichas = construirFichas(grupos, input.imagenes);

  const blocks: Block[] = [
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Proveedor', input.proveedor],
        ['Razón social', input.proveedorRazonSocial],
        ...(input.folioOrden ? [['Folio OC', input.folioOrden] as [string, string]] : []),
        ['Folio oportunidad', input.folioOpp],
        ['Folio proyecto', input.folioProyecto],
        ['Comprador', input.comprador],
        ['Fecha', input.fecha],
      ],
    },
    { kind: 'divider' },
    { kind: 'heading', text: 'Productos' },
    ...fichas,
    ...(embellecimientos.length
      ? ([
          { kind: 'spacer', height: 8 },
          { kind: 'heading', text: 'Embellecimientos' },
          {
            kind: 'wrapTable',
            wrapCols: [0, 1],
            columns: [
              { header: 'Producto', width: 0.26 },
              { header: 'Zona/Tipo', width: 0.20 },
              { header: 'Modelo', width: 0.14 },
              { header: 'Cant.', width: 0.10, align: 'right' },
              { header: 'Precio', width: 0.14, align: 'right' },
              { header: 'Subtotal', width: 0.16, align: 'right' },
            ],
            rows: embellecimientos.map(l => [
              l.producto,
              l.zona,
              [l.sku, l.color].filter(Boolean).join(', '),
              String(l.cantidad),
              fmtMoney(l.precio, l.moneda),
              fmtMoney(l.cantidad * l.precio * (1 - l.descuento), l.moneda),
            ]),
            headerFill: CMP_ORANGE,
            headerTextColor: '#ffffff',
          },
        ] as Block[])
      : []),
    { kind: 'spacer', height: 8 },
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Método de pago', input.metodoPago || '—'],
        ['Subtotal', fmtMoney(monto, moneda)],
        ['Condiciones de pago', input.condicionesPago || '—'],
        ['IVA (16%)', fmtMoney(monto * 0.16, moneda)],
        ['Unidades', fmtNumMx(totalUnidades)],
        ['Total', fmtMoney(monto * 1.16, moneda)],
      ],
    },
    { kind: 'text', text: `Importe con IVA en letras: ${importeEnLetras(monto * 1.16, moneda)}`, size: 9, bold: true },
    ...(input.notas.trim()
      ? ([
          { kind: 'spacer', height: 8 },
          { kind: 'text', text: 'Notas para el proveedor', size: 9.5, bold: true },
          { kind: 'text', text: input.notas.trim(), size: 9 },
        ] as Block[])
      : []),
    { kind: 'spacer', height: 10 },
    { kind: 'signature', label: 'Elaborado por', name: input.elaboradoNombre || '—', detail: [] },
    { kind: 'signature', label: 'Revisado por', name: input.revisadoNombre || '—', detail: [] },
    { kind: 'signature', label: 'Autorizado por', name: input.autorizadoNombre || '—', detail: [] },
  ];

  const meta: DocumentMeta = {
    title: 'Orden de Compra a Proveedor',
    subtitle: input.nombreProyecto,
    docId: input.folioOrden || `${input.folioProyecto}-${input.proveedor}`,
    generatedAt: input.fecha,
    logo: base64ToBytes(LOGO_JPG_BASE64),
    hideGeneratedByLine: true,
  };

  return renderDocument(meta, blocks);
}
