// worker/lib/proyectoLineaProducto.ts — "Cambiar producto" en la tabla de
// Órdenes de compra del Proyecto (Efraín, 2026-08-25): por falta de inventario
// Compras tiene que surtir OTRO producto, con OTRO proveedor, cuando las tallas
// YA se capturaron y son correctas.
//
// El punto de fondo: la talla y la cantidad son datos del RENGLÓN
// (proyectos_sub = producto+sku+color+talla+cantidad), no del producto. Si se
// conservan los renglones y solo se reescribe qué producto son, el desglose de
// tallas queda intacto — y con él la logística, el estado por línea y el
// historial de cada una. Por eso esto NO borra ni recrea líneas: reescribe
// producto/SKU/proveedor sobre las que ya existen.
//
// Alcance decidido por Efraín: SOLO la tabla de órdenes de compra. La
// Oportunidad y su cotización NO se tocan (el cliente cotizó lo que cotizó; si
// hay que renegociar, eso es "Nueva versión" allá). Consecuencia asumida: el
// badge "Cotizado" del tab Tallas cruza contra la Oportunidad por
// producto+color / SKU+color (worker/lib/proyectoTallas.ts), así que para el
// producto cambiado deja de cruzar y muestra "sin línea de cotización" — que es
// la verdad: ese producto no está cotizado.
//
// Guardas, del mismo linaje que worker/lib/itemBorrado.ts (2026-08-18: un
// script recibió una lista que no esperaba y borró 70 líneas en 4.5 minutos):
//
//   1. Las líneas NO vienen del cliente. El body describe el GRUPO por lo que
//      la línea trae hoy (producto + color) y aquí se resuelven contra los
//      hijos reales del Proyecto. Una lista de ids en el body podría apuntar a
//      cualquier subitem de cualquier board.
//   2. Respaldo del antes (producto/sku/color/proveedor/costeo) de cada línea
//      en `linea_producto_cambio` ANTES de tocar Monday.
//   3. Tope por operación y por hora/persona.
//   4. Whitelist FIJA de columnas: nunca toca talla, cantidad, estado ni nada
//      de logística. El body no elige columnas.
//
// El SKU se escribe SIEMPRE del catálogo, nunca tecleado: es la llave de la
// foto de la OC con imágenes (worker/lib/ocImagenes.ts, por SKU) y de los
// agrupados producto+color de la UI, y un typo ahí parte el grupo en dos.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import type { Identity, MirrorItem } from '../../shared/types';
import type { CambiarProductoLineasRequest, CambiarProductoLineasResponse, CambioProductoDTO } from '../../shared/dto';
import { isNativeId } from '../../shared/nativeId';
import { getItem, childrenOf } from './dal';
import { submitWrite, flushOutbox } from './outbox';
import { postUpdate } from './nativeUpdates';
import { proveedorPorId, stampProveedorEnLineaProyecto } from './nativeMirrors';
import type { RawCol } from './serialize';

export class CambiarProductoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Subelementos de Proyectos (18395657609) — docs/monday-column-map.md. Mismos
// ids que src/boards/oportunidades/proyecto/shared.tsx y ocProveedorPdf.ts;
// cada archivo declara los suyos, igual que el resto del repo.
const S_PRODUCTO = 'text_mm0hs17x';
const S_SKU = 'text_mm0hyrfs';
const S_COLOR = 'text_mm0h4a1c';
const S_TALLA = 'text_mm1antcb';
const S_PROVEEDOR = 'board_relation_mm1cfgv5';
const S_ESTADO = 'color_mm0hqf79';
const S_COSTO = 'numeric_mm1dj4fp';
const S_DESCUENTO = 'numeric_mm1dmsaz';
const S_MONEDA = 'text_mm1gdsvg';

// Productos (18395657591).
const PRODUCTO_SKU = 'product_and_service_sku';

/** Líneas que una sola operación puede tocar. Un producto+color con desglose de
 * tallas ronda las 6-12 líneas; 60 deja lugar de sobra para un caso raro (dos
 * colores del mismo producto, tallas de niño y adulto) y sigue lejos de "todo
 * el proyecto". */
const MAX_LINEAS_POR_CAMBIO = 60;
/** Líneas cambiadas por persona en la última hora. Compras corrigiendo OCs a
 * mano no se acerca; un bucle sí. */
const TOPE_POR_HORA = 300;

/** Estados que significan que la OC de ese producto YA salió al proveedor
 * anterior: cambiarle el producto a la línea no cancela nada de eso, así que se
 * pide confirmación explícita en vez de dejarlo pasar en silencio. Los labels
 * son los reales de `color_mm0hqf79` (shared/column-meta.gen.ts). */
const ESTADOS_OC_YA_SALIO = new Set([
  'OC Proveedor enviada', 'En produccion', 'En tránsito',
  'Pendiente de Recolectar', 'Pendiente de Recoleccion',
  'En CMP para embellecer', 'En embellecimiento', 'En CMP para entrega cliente',
  'Con vendedor para entrega cliente', 'ALMACEN CDMX', 'ALMACEN MERIDA', 'Entregado',
]);

export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

function txt(cols: Map<string, RawCol>, id: string): string {
  return (cols.get(id)?.text ?? '').trim();
}

function productoDe(row: MirrorItem, cols: Map<string, RawCol>): string {
  return txt(cols, S_PRODUCTO) || row.name;
}

function linkedId(col?: RawCol): number | null {
  if (!col?.value) return null;
  try {
    const ids = ((JSON.parse(col.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? []).map(Number);
    const n = ids.find(Number.isFinite);
    return n === undefined ? null : n;
  } catch {
    return null;
  }
}

/** Las líneas del grupo producto+color, resueltas SOBRE LOS HIJOS REALES del
 * Proyecto — nunca sobre una lista que mandó el cliente. `soloLineaId` acota a
 * una sola talla, pero sigue exigiendo que pertenezca al grupo: así un id
 * suelto no puede arrastrar a una línea de otro producto.
 *
 * Pura y exportada para test: es la que decide QUÉ se va a reescribir. */
export function lineasDelGrupo(
  hijos: MirrorItem[], productoActual: string, colorActual: string, soloLineaId?: number,
): MirrorItem[] {
  const grupo = hijos.filter(row => {
    const cols = colsOf(row);
    return norm(productoDe(row, cols)) === norm(productoActual)
      && norm(txt(cols, S_COLOR)) === norm(colorActual);
  });
  return soloLineaId === undefined ? grupo : grupo.filter(row => row.item_id === soloLineaId);
}

/** Avisos que obligan a confirmar (no bloquean): la OC de estas líneas ya salió
 * con el producto anterior. Pura, para test. */
export function avisosDeEstado(lineas: MirrorItem[]): string[] {
  const estados = new Map<string, number>();
  for (const row of lineas) {
    const estado = txt(colsOf(row), S_ESTADO);
    if (estado && ESTADOS_OC_YA_SALIO.has(estado)) estados.set(estado, (estados.get(estado) ?? 0) + 1);
  }
  return [...estados.entries()].map(([estado, n]) =>
    `${n} ${n === 1 ? 'línea ya va' : 'líneas ya van'} en "${estado}": la orden de compra del producto anterior ya salió y cambiar la línea aquí no la cancela.`);
}

let tableReady = false;

export async function ensureCambioTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS linea_producto_cambio (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id        INTEGER NOT NULL,
      linea_id           INTEGER NOT NULL,
      antes              TEXT NOT NULL,
      producto_despues   TEXT NOT NULL,
      sku_despues        TEXT,
      proveedor_despues  TEXT,
      by_email           TEXT NOT NULL,
      created_at         TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_lpc_email_fecha ON linea_producto_cambio (by_email, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_lpc_proyecto ON linea_producto_cambio (proyecto_id)'),
  ]);
  tableReady = true;
}

async function cambiadasEnLaHora(env: Env, byEmail: string): Promise<number> {
  const desde = new Date(Date.now() - 3600_000).toISOString();
  const row = await env.DB
    .prepare('SELECT count(*) AS n FROM linea_producto_cambio WHERE by_email = ? AND created_at > ?')
    .bind(byEmail, desde)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** La marca "este renglón ya no es el producto que se cotizó" para la tabla de
 * OC (Efraín, 2026-08-25: como los pills 'Editada'/'Dividida' de la
 * cotización). Uno por línea: el "antes" sale del PRIMER cambio —el producto
 * original, no el intermedio si se cambió dos veces— y el "después" del
 * último. Sale del respaldo, así que es el dato real, no una reconstrucción. */
export async function listCambiosProducto(env: Env, proyectoId: number): Promise<CambioProductoDTO[]> {
  await ensureCambioTable(env);
  const { results } = await env.DB.prepare(
    `SELECT linea_id, antes, producto_despues, sku_despues, proveedor_despues, by_email, created_at
       FROM linea_producto_cambio WHERE proyecto_id = ? ORDER BY id ASC`,
  ).bind(proyectoId).all<{
    linea_id: number; antes: string; producto_despues: string;
    sku_despues: string | null; proveedor_despues: string | null; by_email: string; created_at: string;
  }>();

  const porLinea = new Map<number, CambioProductoDTO>();
  for (const r of results ?? []) {
    let antes: Record<string, string> = {};
    try { antes = JSON.parse(r.antes || '{}') as Record<string, string>; } catch { /* fila vieja ilegible */ }
    const previo = porLinea.get(r.linea_id);
    porLinea.set(r.linea_id, {
      lineaId: String(r.linea_id),
      // El primero manda para el "antes": si la línea se cambió dos veces, lo
      // que hay que poder ver es de qué producto salió, no el paso intermedio.
      productoAntes: previo?.productoAntes ?? (antes.producto || ''),
      skuAntes: previo?.skuAntes ?? (antes.sku || undefined),
      proveedorAntes: previo?.proveedorAntes ?? (antes.proveedor || undefined),
      productoDespues: r.producto_despues,
      skuDespues: r.sku_despues || undefined,
      // `null` en la columna = el cambio no tocó el proveedor; conserva el que
      // ya se había registrado para no perder el dato del cambio anterior.
      proveedorDespues: r.proveedor_despues || previo?.proveedorDespues,
      por: r.by_email,
      fecha: r.created_at,
    });
  }
  // Una línea que volvió a su producto original no lleva marca: no hay nada que
  // avisar y el chip sería ruido.
  return [...porLinea.values()].filter(c => norm(c.productoAntes) !== norm(c.productoDespues));
}

/** Cambia el producto (y opcionalmente proveedor y costeo) de todas las tallas
 * de un producto+color del Proyecto, conservando talla y cantidad. */
export async function cambiarProductoLineas(
  env: Env, ctx: ExecutionContext, viewer: Identity, proyectoId: number, req: CambiarProductoLineasRequest,
): Promise<CambiarProductoLineasResponse> {
  if (viewer.role !== 'compras' && viewer.role !== 'admin') {
    throw new CambiarProductoError(403, 'Solo Compras o un admin pueden cambiar el producto de una línea.');
  }
  const productoActual = (req.productoActual ?? '').trim();
  if (!productoActual) throw new CambiarProductoError(400, 'Falta el producto actual de la línea.');
  const productoId = Number(req.productoId);
  if (!Number.isFinite(productoId)) {
    throw new CambiarProductoError(400, 'Hay que elegir el producto nuevo del catálogo.');
  }

  // scope 'own' en el Proyecto: cambiar el producto es escribir, y un líder de
  // zona solo LEE lo de su equipo (worker/lib/zonas.ts).
  const proyecto = await getItem(env, 'proyectos', proyectoId, viewer, 'own');
  if (!proyecto) throw new CambiarProductoError(404, 'not found');

  const hijos = await childrenOf(env, 'proyectos', proyectoId, viewer);
  const lineas = lineasDelGrupo(hijos, productoActual, (req.colorActual ?? '').trim(), req.soloLineaId);
  if (lineas.length === 0) {
    throw new CambiarProductoError(404,
      'Ya no hay líneas con ese producto y color en el proyecto — recarga la orden y vuelve a intentarlo.');
  }
  if (lineas.length > MAX_LINEAS_POR_CAMBIO) {
    throw new CambiarProductoError(400,
      `Son ${lineas.length} líneas y el tope por cambio es ${MAX_LINEAS_POR_CAMBIO}. Hazlo por color o avísale a Efraín.`);
  }

  await ensureCambioTable(env);
  if (await cambiadasEnLaHora(env, viewer.email) + lineas.length > TOPE_POR_HORA) {
    throw new CambiarProductoError(429,
      `Se alcanzó el tope de ${TOPE_POR_HORA} líneas cambiadas por hora. Si de verdad hay que cambiar más, avísale a Efraín.`);
  }

  // El producto nuevo se lee del catálogo (nombre + SKU + su proveedor), nunca
  // del body: es lo que garantiza que el SKU y el nombre queden idénticos en
  // las N líneas y el agrupado producto+color no se parta.
  const producto = await getItem(env, 'productos', productoId, viewer);
  if (!producto) throw new CambiarProductoError(404, 'Ese producto no está en el catálogo.');
  const productoNuevo = producto.name.trim();
  const skuNuevo = txt(colsOf(producto), PRODUCTO_SKU);

  const avisos = req.confirmado ? [] : avisosDeEstado(lineas);
  if (avisos.length > 0) return { ok: false, requiereConfirmacion: true, avisos, lineas: lineas.length };

  // Proveedor: `undefined` = conservar el que ya tiene cada línea; '' = quitarlo
  // (la saca de toda OC, igual que "Mover línea"); un id = ese.
  const proveedorPedido = req.proveedorId?.trim();
  let proveedorNuevoId: number | null | undefined;
  if (proveedorPedido === undefined) proveedorNuevoId = undefined;
  else if (proveedorPedido === '') proveedorNuevoId = null;
  else {
    const n = Number(proveedorPedido);
    if (!Number.isFinite(n)) throw new CambiarProductoError(400, 'Proveedor no válido.');
    const prov = await getItem(env, 'proveedores', n, viewer);
    if (!prov) throw new CambiarProductoError(404, 'Ese proveedor no existe.');
    proveedorNuevoId = n;
  }
  const proveedorNuevoNombre = proveedorNuevoId != null
    ? (await proveedorPorId(env, proveedorNuevoId)).nombre
    : proveedorNuevoId === null ? '' : undefined;

  // Respaldo del "antes" ANTES de tocar Monday — si alguien se equivocó de
  // producto, el dato para regresarlo está aquí (misma lección que itemBorrado).
  const ahora = new Date().toISOString();
  await env.DB.batch(lineas.map(row => {
    const cols = colsOf(row);
    const antes = {
      name: row.name,
      producto: productoDe(row, cols), sku: txt(cols, S_SKU), color: txt(cols, S_COLOR),
      talla: txt(cols, S_TALLA), proveedor: txt(cols, S_PROVEEDOR),
      proveedorId: String(linkedId(cols.get(S_PROVEEDOR)) ?? ''),
      costo: txt(cols, S_COSTO), moneda: txt(cols, S_MONEDA), descuento: txt(cols, S_DESCUENTO),
    };
    return env.DB.prepare(
      `INSERT INTO linea_producto_cambio
         (proyecto_id, linea_id, antes, producto_despues, sku_despues, proveedor_despues, by_email, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(
      proyectoId, row.item_id, JSON.stringify(antes), productoNuevo, skuNuevo || null,
      // null = este cambio no tocó el proveedor (distinto de habérselo quitado,
      // que sí es un dato que la marca de la línea tiene que poder mostrar).
      proveedorNuevoNombre === '' ? '(sin proveedor)' : (proveedorNuevoNombre ?? null),
      viewer.email, ahora,
    );
  }));

  // Whitelist FIJA — el body no elige columnas. Talla, cantidad, estado y todo
  // lo de logística quedan intactos por construcción, no por validación.
  const cols: Record<string, string> = { name: productoNuevo, [S_PRODUCTO]: productoNuevo };
  if (skuNuevo) cols[S_SKU] = skuNuevo;
  if (req.color?.trim()) cols[S_COLOR] = req.color.trim();
  if (proveedorNuevoId !== undefined) cols[S_PROVEEDOR] = proveedorNuevoId === null ? '' : String(proveedorNuevoId);
  if (req.costo !== undefined && Number.isFinite(req.costo)) cols[S_COSTO] = String(req.costo);
  if (req.descuento !== undefined && Number.isFinite(req.descuento)) cols[S_DESCUENTO] = String(req.descuento);
  if (req.moneda?.trim()) cols[S_MONEDA] = req.moneda.trim();

  // `trusted`: las columnas son esta whitelist fija, no ids que venga eligiendo
  // el cliente, y el rol ya se validó arriba. Sin esto el SKU moriría en 403 —
  // en shared/visibility.ts es de solo lectura a propósito (se teclea en ningún
  // lado; aquí sale del catálogo).
  let cambiadas = 0;
  for (const row of lineas) {
    // Solo lo que de verdad cambia en ESTA línea: el log de actividad de la OC
    // existe para auditar quién tocó qué, y un renglón "Moneda MXN → MXN" por
    // línea lo vuelve ilegible. Si no queda nada, la línea ya estaba bien.
    const propias = colsOf(row);
    const delta: Record<string, string> = {};
    for (const [id, valor] of Object.entries(cols)) {
      const actual = id === 'name' ? row.name.trim()
        : id === S_PROVEEDOR ? String(linkedId(propias.get(S_PROVEEDOR)) ?? '')
        : txt(propias, id);
      if (actual !== valor) delta[id] = valor;
    }
    if (Object.keys(delta).length === 0) continue;

    const res = await submitWrite(env, ctx, 'proyectos_sub', row.item_id, delta, viewer,
      { trusted: true, skipFlush: true });
    if (res.ok) cambiadas++;
    // Un item NATIVO (Zona Efrain) no tiene el motor de espejos de Monday: el
    // nombre del proveedor y su razón social/correo —lo que imprime la OC— se
    // resuelven aquí (worker/lib/nativeMirrors.ts).
    if (isNativeId(row.item_id) && proveedorNuevoId !== undefined && S_PROVEEDOR in delta) {
      await stampProveedorEnLineaProyecto(env, row.item_id, proveedorNuevoId);
    }
  }
  await flushOutbox(env);

  // Bitácora en el Proyecto: el log de actividad guarda el cambio columna por
  // columna (con el actor real), pero el update es lo que se lee de un vistazo
  // —y en Monday es el único rastro que ve quien no entra al portal.
  const quien = viewer.nombre || viewer.email;
  const detalleProveedor = proveedorNuevoId === undefined ? ''
    : proveedorNuevoId === null ? ' Se le quitó el proveedor (sale de toda OC).'
    : ` Proveedor: ${proveedorNuevoNombre}.`;
  try {
    await postUpdate(env, BOARDS.proyectos.id, proyectoId,
      `${quien} cambió el producto de ${cambiadas} ${cambiadas === 1 ? 'línea' : 'líneas'} de la orden de compra: `
      + `"${productoActual}"${req.colorActual ? ` (${req.colorActual})` : ''} → "${productoNuevo}"`
      + `${skuNuevo ? ` (SKU ${skuNuevo})` : ''}.${detalleProveedor}`
      + ' Las tallas y cantidades no se movieron. La cotización de la oportunidad sigue con el producto original.',
      [], { email: viewer.email, nombre: viewer.nombre ?? undefined });
  } catch { /* la bitácora nunca tumba un cambio ya aplicado */ }

  return {
    ok: true,
    cambiadas,
    lineas: lineas.length,
    productoNuevo,
    skuNuevo: skuNuevo || undefined,
    proveedorNuevo: proveedorNuevoNombre || undefined,
  };
}
