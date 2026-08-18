// worker/lib/nativeMirrors.ts — lo que en un item REAL llega por columnas
// ESPEJO de Monday (`lookup_*`), resuelto LOCALMENTE para un item NATIVO
// (Zona Efrain, shared/nativeId.ts).
//
// Un item nativo no existe del otro lado, así que el motor de espejos de Monday
// nunca corre para él y esas columnas se quedan vacías para siempre. No es
// cosmético: medio pipeline las lee como si fueran datos propios —
// `checkCosteo` exige la Institución, `checkTodoCuadra` cruza por el NOMBRE de
// la línea (que en Monday renombra una automatización al elegir producto), y el
// PDF de la OC imprime el nombre y la razón social del proveedor. Sin esto, la
// prueba end-to-end en producción (2026-08-18) se atoraba en "Mandar a costeo"
// y llegaba a la OC con el id del proveedor en vez de su nombre.
//
// Ojo con los tres "(auto)" de costo/descuento/gastos: de ahí sale el SNAPSHOT
// que congela "Mandar a costeo" (worker/lib/costeo.ts computeSnapshot). Sin
// ellos el snapshot nativo escribía 0 y borraba el costo, y la OC salía en $0.
//
// La copia se hace UNA vez, cuando se liga la relación que la alimenta (elegir
// producto / elegir contacto), igual que Monday recalcularía el espejo. Si el
// catálogo cambia después, el valor copiado se queda como estaba — que es
// exactamente lo que ya hacen los snapshots de costeo (worker/lib/costeo.ts).
import type { Env } from '../env';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import type { RawColumn } from './canon';

// ── Oportunidad ───────────────────────────────────────────────────────────────
const OPP_CONTACTO_REL = 'deal_contact';
const OPP_INSTITUCION = 'lookup_mm1bs976';        // espejo: Contacto → Institución
const OPP_PUESTO = 'lookup_mm0xf2r5';             // espejo: Contacto → Puesto
const CONTACTO_INSTITUCION_REL = 'contact_account';
const CONTACTO_PUESTO = 'text_mm0dz8yj';

// ── Línea de cotización (oportunidades_sub) ← Producto ────────────────────────
const LINEA_PRODUCTO_REL = 'board_relation_mkzmafgp';
/** espejo en la línea → columna real en el board Productos. */
const LINEA_DESDE_PRODUCTO: Record<string, string> = {
  lookup_mkzn7x9a: 'product_and_service_sku',      // SKU
  lookup_mm0xw8p7: 'long_text_mm0xse7v',           // Ficha comercial (checkCosteo la exige)
  lookup_mkznm0h3: 'dropdown_mkztty4b',            // Colores disponibles (checkCosteo valida contra ella)
  lookup_mm0x4kda: 'text_mm0wvga2',                // Nombre del producto
  lookup_mm19c0b6: 'long_text_mm174q0j',           // Tallas (json del catálogo)
  lookup_mm5v1qb:  'text_mm5v6jhj',                // Tallas disponibles (boxes de captura)
  lookup_mm5ck4b3: 'numeric_mkzpx7eb',             // Costo (auto) — de aquí sale el snapshot de costeo
  lookup_mm0bdwb5: 'numeric_mm0bgd2f',             // Descuento (auto)
  lookup_mm0bbz02: 'numeric_mm0bnkch',             // Gastos % (auto)
  lookup_mm11t8gj: 'text_mkzp59zf',                // Moneda
  lookup_mm0w4f4v: 'text_mkzp9428',                // Unidad
  lookup_mm0xn98d: 'product_and_service_description', // Marca/línea
  lookup_mm1tjv9n: 'long_text_mm1tcga0',           // Histórico de precios
  lookup_mm0z4exs: 'text_mkzmgvc7',                // id de Airtable
};
/** Columnas de TEXTO reales de la línea que el flujo real llena por automatización
 * al elegir el producto (no son espejos, pero nacen del mismo evento). */
const LINEA_TEXTO_DESDE_PRODUCTO: Record<string, string> = {
  text_mm0bxy39: 'product_and_service_sku',        // SKU
  text_mm0bkm1j: 'text_mm0wvga2',                  // Nombre del producto (SNAP_NOMBRE del costeo)
};
const PRODUCTO_NOMBRE = 'text_mm0wvga2';
const PRODUCTO_PROVEEDOR_REL = 'board_relation_mm1cwqky';
const PROVEEDOR_RAZON_SOCIAL = 'text_mm1d43t4';

function colsOf(columnsJson: string): Map<string, RawColumn> {
  const map = new Map<string, RawColumn>();
  try {
    for (const c of JSON.parse(columnsJson || '[]') as RawColumn[]) map.set(c.id, c);
  } catch { /* fila sin columnas parseables */ }
  return map;
}

async function rowOf(env: Env, slug: BoardSlug, itemId: number): Promise<{ name: string; cols: Map<string, RawColumn> } | null> {
  const row = await env.DB
    .prepare(`SELECT name, columns FROM items WHERE board_id = ? AND item_id = ?`)
    .bind(BOARDS[slug].id, itemId)
    .first<{ name: string; columns: string }>();
  return row ? { name: row.name, cols: colsOf(row.columns) } : null;
}

/** Primer id ligado de un board_relation ya guardado en el mirror. */
function linkedId(col: RawColumn | undefined): number | null {
  if (!col?.value) return null;
  try {
    const ids = (JSON.parse(col.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
    const n = Number(ids[0]);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** Mergea columnas (y opcionalmente el nombre) en la fila nativa, respetando lo
 * que ya estaba. Read-modify-write en una sola pasada: estas estampas siempre
 * corren dentro del mismo request que acaba de escribir la relación, así que no
 * compiten con nadie más (a diferencia del merge optimista de outbox.ts, que sí
 * carrera contra el echo de Monday). */
async function merge(
  env: Env, slug: BoardSlug, itemId: number, nuevas: RawColumn[], name?: string,
): Promise<void> {
  if (nuevas.length === 0 && !name) return;
  const boardId = BOARDS[slug].id;
  const row = await env.DB
    .prepare(`SELECT columns FROM items WHERE board_id = ? AND item_id = ?`)
    .bind(boardId, itemId)
    .first<{ columns: string }>();
  if (!row) return;
  const byId = colsOf(row.columns);
  for (const c of nuevas) byId.set(c.id, c);
  const json = JSON.stringify([...byId.values()]);
  const now = new Date().toISOString();
  if (name) {
    await env.DB
      .prepare(`UPDATE items SET columns = ?, name = ?, synced_at = ? WHERE board_id = ? AND item_id = ?`)
      .bind(json, name, now, boardId, itemId).run();
  } else {
    await env.DB
      .prepare(`UPDATE items SET columns = ?, synced_at = ? WHERE board_id = ? AND item_id = ?`)
      .bind(json, now, boardId, itemId).run();
  }
}

/** Escribe columnas de TEXTO sueltas en una fila nativa (id → texto). Para
 * datos que el flujo real recibe por otro canal y en nativo hay que dejar en el
 * mirror — p.ej. método/condiciones de pago que la OC imprime. */
export async function mergeNativeCols(
  env: Env, slug: BoardSlug, itemId: number, cols: Record<string, string>,
): Promise<void> {
  await merge(env, slug, itemId, Object.entries(cols).map(([id, text]) => texto(id, text)));
}

const mirror = (id: string, text: string): RawColumn => ({ id, type: 'mirror', text, value: null });
const texto = (id: string, text: string): RawColumn => ({ id, type: 'text', text, value: JSON.stringify(text) });

/** Institución (y puesto) de la Oportunidad nativa a partir del Contacto ligado.
 * `checkCosteo` rechaza sin Institución, así que sin esto "Mandar a costeo" es
 * imposible en Zona Efrain. */
export async function stampInstitucionDeContacto(env: Env, oppId: number, contactoId: number): Promise<void> {
  const contacto = await rowOf(env, 'contactos', contactoId);
  if (!contacto) return;
  const cols: RawColumn[] = [];
  const institucionId = linkedId(contacto.cols.get(CONTACTO_INSTITUCION_REL));
  const institucionText = contacto.cols.get(CONTACTO_INSTITUCION_REL)?.text?.trim()
    || (institucionId ? (await rowOf(env, 'instituciones', institucionId))?.name : '') || '';
  if (institucionText) cols.push(mirror(OPP_INSTITUCION, institucionText));
  const puesto = contacto.cols.get(CONTACTO_PUESTO)?.text?.trim();
  if (puesto) cols.push(mirror(OPP_PUESTO, puesto));
  await merge(env, 'oportunidades', oppId, cols);
}

/** Todo lo que la línea hereda del Producto: los espejos del catálogo, las dos
 * columnas de texto que el flujo real llena por automatización, y el NOMBRE de
 * la línea (en Monday lo renombra una automatización al elegir el producto —
 * `checkTodoCuadra` cruza tallas contra ese nombre, así que una línea nativa
 * llamada "Nueva línea" nunca cuadraba). */
export async function stampProductoEnLinea(env: Env, lineaId: number, productoId: number): Promise<void> {
  const producto = await rowOf(env, 'productos', productoId);
  if (!producto) return;
  const cols: RawColumn[] = [];
  for (const [destino, origen] of Object.entries(LINEA_DESDE_PRODUCTO)) {
    const text = producto.cols.get(origen)?.text?.trim();
    if (text) cols.push(mirror(destino, text));
  }
  for (const [destino, origen] of Object.entries(LINEA_TEXTO_DESDE_PRODUCTO)) {
    const text = producto.cols.get(origen)?.text?.trim();
    if (text) cols.push(texto(destino, text));
  }
  // Proveedor: la línea guarda su id y su nombre corto (los lee el agrupado de
  // la OC y el cruce de tallas).
  const proveedorId = linkedId(producto.cols.get(PRODUCTO_PROVEEDOR_REL));
  const proveedorNombre = producto.cols.get(PRODUCTO_PROVEEDOR_REL)?.text?.trim();
  if (proveedorId) cols.push(mirror('lookup_mm1cs054', String(proveedorId)));
  if (proveedorNombre) cols.push(mirror('lookup_mm1ck0mr', proveedorNombre));

  const nombre = producto.cols.get(PRODUCTO_NOMBRE)?.text?.trim() || producto.name;
  await merge(env, 'oportunidades_sub', lineaId, cols, nombre || undefined);
}

/** Nombre y razón social del proveedor de un producto — los imprime el PDF de
 * la OC a proveedor, que en un Proyecto nativo solo tenía el id. */
export async function proveedorDeProducto(
  env: Env, productoId: number,
): Promise<{ id: number; nombre: string; razonSocial: string } | null> {
  const producto = await rowOf(env, 'productos', productoId);
  if (!producto) return null;
  const rel = producto.cols.get(PRODUCTO_PROVEEDOR_REL);
  const id = linkedId(rel);
  if (id === null) return null;
  const proveedor = await rowOf(env, 'proveedores', id);
  return {
    id,
    nombre: proveedor?.name || rel?.text?.trim() || String(id),
    razonSocial: proveedor?.cols.get(PROVEEDOR_RAZON_SOCIAL)?.text?.trim() || '',
  };
}

/** Nombre + razón social de un proveedor por su id — mismo dato que arriba,
 * cuando el id ya se conoce (las líneas de talla del Proyecto lo heredan del
 * costeo, no del producto). */
export async function proveedorPorId(
  env: Env, proveedorId: number,
): Promise<{ nombre: string; razonSocial: string }> {
  const proveedor = await rowOf(env, 'proveedores', proveedorId);
  return {
    nombre: proveedor?.name || String(proveedorId),
    razonSocial: proveedor?.cols.get(PROVEEDOR_RAZON_SOCIAL)?.text?.trim() || '',
  };
}

export { OPP_CONTACTO_REL, LINEA_PRODUCTO_REL };
