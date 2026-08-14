// Búsqueda flexible sobre el catálogo de Productos (18395657591). El picker de
// línea de cotización era un <datalist> cuyas opciones eran solo `name`, así
// que el match dependía de cómo cada navegador filtra un datalist (en Android
// prácticamente no filtra) y solo servía si el texto tecleado coincidía con el
// PRINCIPIO del nombre. Teclear un SKU suelto ("72002") no resolvía a un
// producto real y la línea terminaba guardada como texto libre, sin SKU ni
// descripción ni colores (Efraín, 2026-07-30).
//
// Aquí el match es propio y flexible: cada palabra del query puede caer en el
// nombre, el SKU, el nombre corto o la marca, en cualquier orden, ignorando
// acentos, mayúsculas y puntuación ("511" encuentra "5.11 Tactical").
//
// Ids de columna del board Productos — de shared/column-meta.gen.ts, todas
// visibles para vendedor (shared/visibility.ts).
import type { ItemDTO } from '../../shared/dto';

export const PRODUCTO_SKU_COL = 'product_and_service_sku';
export const PRODUCTO_NOMBRE_COL = 'text_mm0wvga2';   // "Nombre Producto" (sin el SKU al frente)
export const PRODUCTO_MARCA_COL = 'product_and_service_description';

/** Las ÚNICAS columnas del board Productos que viajan en el catálogo que carga
 * la pestaña Cotización (`getCatalogoProductos`). El board trae 19; con estas 7
 * el catálogo pasa de 260 KB a 72 KB, y como es de lo primero que carga una
 * oportunidad editable o de Costeo, se nota.
 *
 * La lista NO está hecha a ojo: sale de recorrer el cierre de imports desde la
 * grid de cotización y el picker (44 archivos) y quedarse con toda cadena que
 * sea llave del board `productos` en shared/column-meta.gen.ts.
 * `catalogoCols.test.ts` rehace ese recorrido y falla si aparece una columna
 * que no esté declarada — sin eso, leer un campo que no se pidió se ve como un
 * valor VACÍO en la UI (checkbox desmarcado, "Sin proveedor" donde sí hay),
 * sin ningún error de por medio.
 *
 * `name` no va: es campo propio del item (item.name), no una columna. */
export const CATALOGO_COLS = [
  PRODUCTO_SKU_COL,
  PRODUCTO_NOMBRE_COL,
  PRODUCTO_MARCA_COL,
  'dropdown_mkztty4b',            // Color (opciones del selector de la línea)
  'text_mm5v6jhj',                // Tallas (gate de "Mandar a validación")
  'boolean_mm5cqtjs',             // Descripción y tallas confirmadas (checkbox de Compras)
  'board_relation_mm1cwqky',      // Proveedor (gate de "Mandar a validación")
] as const;

/** Columnas del board Productos que el código SÍ lee, pero que a propósito NO
 * viajan en el catálogo masivo: se piden del producto puntual cuando hacen
 * falta. Existe para que el test pueda distinguir "falta una columna" (bug
 * silencioso) de "esta se trae aparte a propósito". */
export const COLS_BAJO_DEMANDA = [
  // Descripción cotización (largo): pesaba 115 KB de los 188 KB del catálogo
  // —el 61%— y sólo se usa como fallback en el panel de detalle de UNA línea,
  // y sólo mientras el mirror del subitem no se pobló. LineDetailPanel la pide
  // con getItem('productos', id) en ese caso: 1.7 KB en vez de 115.
  'long_text_mm0xse7v',
] as const;

const DIACRITICS = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9]+/g;

/** minúsculas + sin acentos + espacios colapsados. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** norm() + sin nada que no sea letra o dígito — "5.11 Tactical" y "511tactical"
 * caen en la misma cadena, y "TDU ®" deja de estorbar. */
export function alnum(s: string): string {
  return norm(s).replace(NON_ALNUM, '');
}

export function productoSku(item: ItemDTO): string {
  return item.cols[PRODUCTO_SKU_COL]?.text?.trim() ?? '';
}

export function productoMarca(item: ItemDTO): string {
  return item.cols[PRODUCTO_MARCA_COL]?.text?.trim() ?? '';
}

/** Nombre corto del catálogo; cae al `name` del item (que viene como
 * "12443 - ATAC 2.0 6 Shield Boot") cuando la columna está vacía. */
export function productoNombreCorto(item: ItemDTO): string {
  return item.cols[PRODUCTO_NOMBRE_COL]?.text?.trim() || item.name;
}

interface Entry {
  item: ItemDTO;
  name: string;      // norm(item.name)
  sku: string;       // alnum(SKU)
  hay: string;       // norm(name + sku + nombre corto + marca)
  hayAlnum: string;  // alnum del mismo texto
}

// Normalizar 1.2k productos en cada tecla es puro desperdicio: el índice se
// arma una vez por referencia del array (mismo patrón que catalogIndex en
// cotizacion/gridMeta.tsx) y se tira solo cuando el catálogo cambia de verdad.
const indexCache = new WeakMap<ItemDTO[], Entry[]>();

export function productSearchIndex(catalog: ItemDTO[]): Entry[] {
  let idx = indexCache.get(catalog);
  if (!idx) {
    idx = catalog.map((item) => {
      const raw = [item.name, productoSku(item), productoNombreCorto(item), productoMarca(item)].join(' ');
      return {
        item,
        name: norm(item.name),
        sku: alnum(productoSku(item)),
        hay: norm(raw),
        hayAlnum: alnum(raw),
      };
    });
    indexCache.set(catalog, idx);
  }
  return idx;
}

/** Orden del resultado: primero lo que el usuario claramente quiso decir.
 * 0 SKU exacto · 1 SKU que empieza igual · 2 nombre que empieza igual ·
 * 3 palabra del nombre que empieza igual · 4 aparece en algún lado. */
function rank(e: Entry, q: string, qAlnum: string): number {
  if (qAlnum && e.sku === qAlnum) return 0;
  if (qAlnum && e.sku.startsWith(qAlnum)) return 1;
  if (e.name.startsWith(q)) return 2;
  if (e.name.includes(` ${q}`)) return 3;
  return 4;
}

/**
 * Productos que coinciden con `query`, ordenados por relevancia. Cada palabra
 * del query debe aparecer en el producto (AND), pero puede caer en campos
 * distintos y en cualquier orden: "511 bota", "bota 511" y "atac 12443" llegan
 * al mismo item. Query vacío devuelve el catálogo alfabético.
 */
export function searchProductos(catalog: ItemDTO[], query: string, limit = 60): ItemDTO[] {
  const entries = productSearchIndex(catalog);
  const q = norm(query);
  if (!q) {
    return [...entries]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((e) => e.item);
  }
  const qAlnum = alnum(query);
  const tokens = q.split(' ').filter(Boolean);
  const tokensAlnum = tokens.map(alnum).filter(Boolean);

  const hits: { e: Entry; r: number }[] = [];
  for (const e of entries) {
    const ok = tokens.every((t, i) => {
      const ta = tokensAlnum[i];
      return e.hay.includes(t) || (!!ta && e.hayAlnum.includes(ta));
    });
    if (ok) hits.push({ e, r: rank(e, q, qAlnum) });
  }
  hits.sort((a, b) => (a.r - b.r) || a.e.name.localeCompare(b.e.name));
  return hits.slice(0, limit).map((h) => h.e.item);
}

/** El producto del catálogo que corresponde EXACTAMENTE a lo tecleado — por
 * nombre completo o por SKU. Sirve para no ofrecer "usar como texto libre"
 * cuando lo escrito ya es un producto real. */
export function exactProducto(catalog: ItemDTO[], query: string): ItemDTO | undefined {
  const q = norm(query);
  if (!q) return undefined;
  const qAlnum = alnum(query);
  return productSearchIndex(catalog)
    .find((e) => e.name === q || (!!qAlnum && e.sku === qAlnum))?.item;
}
