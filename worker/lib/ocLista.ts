// worker/lib/ocLista.ts — el tablero "Lista de OC" (Elisa, 2026-09-18): TODAS
// las órdenes de compra en una sola lista, con su proyecto, zona y proveedor,
// para no tener que entrar a cada Proyecto a buscarlas.
//
// De dónde sale la lista: de la columna de archivos de cada Proyecto del
// espejo, NO de `oc_emitida`. Medido el día que se escribió: el espejo llegaba
// a OC-317 y el ledger seguía en OC-235 — producción emite por cmp-tallas
// (OC_NATIVE apagado), que sube el PDF directo a Monday y nunca escribe en el
// ledger. Montado sobre esa tabla, el tablero habría nacido sin las ~75 órdenes
// más recientes y sin ningún error que lo delatara. El ledger solo ENRIQUECE
// (monto, fecha, quién) cuando la fila existe y no es del backfill.
//
// Lo que sí es propio: "pagada". No existe en Monday, vive en `oc_pago`.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { OcListaRow, ProyectoFiltrosDTO } from '../../shared/dto';
import { canRead } from '../../shared/visibility';
import { etagFor, listItems, scopeFor } from './dal';
import { BOARDS } from '../../shared/boards';
import { ensureOcLedger, numeroDeFolio, type OcEmitidaRow } from './ocLedger';
import { fechaValida, montoCuadra } from '../../shared/ocMontoPdf';

const PROYECTO_OC_PDF = 'file_mm0hj9pn';
// "OC Prov. Firmada": la copia firmada que Compras sube a mano. Casi siempre
// repite un folio de la columna de arriba, pero no siempre — medido
// 2026-09-23: OC-214, 216, 237 y 238 SOLO existen aquí y la lista no las
// mostraba (ni el buscador por folio ni el filtro de proveedor las encontraban).
const PROYECTO_OC_FIRMADA = 'file_mm1g7cqz';
const PROYECTO_ZONA = 'dropdown_mm0hnyv';
const PROYECTO_FOLIO = 'pulse_id_mm1a12gy';
// Líneas del Proyecto (proyectos_sub) — mismos ids que worker/lib/oc.ts.
const SUB_ESTADO = 'color_mm0hqf79';
const SUB_CANTIDAD = 'numeric_mm0hj2q4';
const SUB_PROVEEDOR_REL = 'board_relation_mm1cfgv5';
const SUB_PROVEEDOR_RZ = 'lookup_mm1d2y9b';

export class OcListaError extends Error {
  status: 400 | 404;
  constructor(message: string, status: 400 | 404 = 400) { super(message); this.status = status; }
}

let tablaLista = false;
async function ensureOcListaTables(env: Env): Promise<void> {
  if (tablaLista) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_pago (
      folio      TEXT PRIMARY KEY,
      pagada     INTEGER NOT NULL DEFAULT 0,
      por_email  TEXT,
      updated_at TEXT NOT NULL
    )`),
    // Lo que dice el PDF de la orden (shared/ocMontoPdf.ts). Lo lee el
    // navegador —pdfjs no corre en el Worker— y lo asienta una sola vez. La
    // fila existe = ese PDF ya se leyó; los totales pueden ir vacíos (OC-200 a
    // 205 traen fecha pero no el bloque de totales).
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_pdf_datos (
      folio      TEXT PRIMARY KEY,
      fecha      TEXT,
      subtotal   REAL,
      iva        REAL,
      total      REAL,
      moneda     TEXT,
      asset_id   TEXT,
      por_email  TEXT,
      updated_at TEXT NOT NULL
    )`),
    // Resumen de estados de las líneas de Proyecto, ya agregado (ver
    // lineasEstadoCacheadas). `sello` = cuántas líneas hay y cuándo se
    // sincronizó la última: si cambia cualquiera, se recalcula.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_lista_cache (
      clave TEXT PRIMARY KEY,
      sello TEXT NOT NULL,
      json  TEXT NOT NULL
    )`),
  ]);
  tablaLista = true;
}

/** `OC_<folio>_<razón social>[_SIN-COSTOS].pdf`, sobre el NOMBRE del archivo ya
 * decodificado. `(\.pdf)+`: los proyectos clonados en Monday guardan la copia
 * como "….pdf.pdf", y con un regex que corta en el primer ".pdf" el nombre
 * quedaba trunco y el link daba 404 (OC-107, 2026-09-18). */
const OC_NOMBRE_RE = /^OC_(OC-\d+)_(.+?)(_SIN-COSTOS)?(?:\.pdf)+$/i;

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

type Col = { id: string; text?: string | null };

/** Las OC de UN proyecto, a partir de su renglón del espejo. Pura. Las dos
 * copias de una orden (con y sin costos) comparten folio y salen en UNA fila. */
export function ordenesDeProyecto(row: MirrorItem): OcListaRow[] {
  let cols: Col[] = [];
  try { cols = JSON.parse(row.columns || '[]'); } catch { return []; }
  const texto = (id: string) => cols.find(c => c.id === id)?.text?.trim() ?? '';
  // El key cuelga SIEMPRE del Proyecto, aunque tenga Oportunidad ligada. El key
  // por oportunidad obliga a /api/files a adivinar el proyecto
  // (proyectoForOportunidad), y cuando la oportunidad está ligada a dos —los
  // clones— cae en el otro y responde 404: medido, 15 de 279 links muertos.
  // Aquí el proyecto dueño del archivo ya se sabe. El costo: no pega al R2 de
  // `oportunidades/…` y siempre se sirve desde Monday, que es de donde sale
  // esta lista de todos modos.
  const url = (archivo: string, categoria = 'oc') => `/api/files/proyectos/${row.item_id}/${categoria}/${encodeURIComponent(archivo)}`;

  const archivos = (colId: string) => texto(colId).split(',').map(s => s.trim()).filter(Boolean).map(entrada => {
    const archivo = decode(entrada.split('/').pop() ?? '');
    return { archivo, assetId: /\/resources\/(\d+)\//.exec(entrada)?.[1] ?? null, m: OC_NOMBRE_RE.exec(archivo) };
  });

  const porFolio = new Map<string, OcListaRow>();
  for (const { archivo, assetId, m } of archivos(PROYECTO_OC_PDF)) {
    if (!m) continue;
    const folio = m[1].toUpperCase();
    let fila = porFolio.get(folio);
    if (!fila) {
      fila = {
        folio, proveedor: m[2].replace(/_/g, ' ').trim(),
        proyectoId: String(row.item_id), proyecto: row.name, proyectoFolio: texto(PROYECTO_FOLIO) || null,
        zona: texto(PROYECTO_ZONA) || null, tambienEn: [], reemplazadaPor: null,
        url: null, urlSinCostos: null, assetId: null,
        fecha: null, subtotal: null, iva: null, total: null, moneda: null, pdfLeido: false, pagada: false, editable: false, estados: null,
      };
      porFolio.set(folio, fila);
    }
    if (m[3]) fila.urlSinCostos = url(archivo);
    else { fila.url = url(archivo); fila.assetId = assetId; fila.proveedor = m[2].replace(/_/g, ' ').trim(); }
  }
  // Folios que solo están firmados: entran con el PDF firmado como su PDF.
  for (const { archivo, assetId, m } of archivos(PROYECTO_OC_FIRMADA)) {
    if (!m || m[3] || porFolio.has(m[1].toUpperCase())) continue;
    porFolio.set(m[1].toUpperCase(), {
      folio: m[1].toUpperCase(), proveedor: m[2].replace(/_/g, ' ').trim(),
      proyectoId: String(row.item_id), proyecto: row.name, proyectoFolio: texto(PROYECTO_FOLIO) || null,
      zona: texto(PROYECTO_ZONA) || null, tambienEn: [], reemplazadaPor: null,
      url: url(archivo, 'oc-firmada'), urlSinCostos: null, assetId,
      fecha: null, subtotal: null, iva: null, total: null, moneda: null, pdfLeido: false, pagada: false, editable: false, estados: null,
    });
  }
  return [...porFolio.values()];
}

/** Una fila por FOLIO. Un proyecto clonado en Monday se lleva la columna de
 * archivos, así que el mismo PDF aparece en el original y en el clon (10 folios
 * el 2026-09-18). Es UNA orden y se paga una vez: dos filas duplicarían el
 * dinero en los totales. Gana el proyecto más viejo (item_id menor = el
 * original) y los demás quedan como referencia en `tambienEn`. Pura. */
export function unaFilaPorFolio(filas: OcListaRow[]): OcListaRow[] {
  const porFolio = new Map<string, OcListaRow[]>();
  for (const f of filas) (porFolio.get(f.folio) ?? porFolio.set(f.folio, []).get(f.folio)!).push(f);
  const out: OcListaRow[] = [];
  for (const grupo of porFolio.values()) {
    grupo.sort((a, b) => Number(a.proyectoId) - Number(b.proyectoId));
    const [original, ...clones] = grupo;
    out.push({
      ...original,
      // El clon a veces es el único que conserva el PDF con costos.
      url: original.url ?? clones.find(c => c.url)?.url ?? null,
      assetId: original.url ? original.assetId : clones.find(c => c.url)?.assetId ?? null,
      tambienEn: clones.map(c => ({ proyectoId: c.proyectoId, proyectoFolio: c.proyectoFolio, proyecto: c.proyecto })),
    });
  }
  return out;
}

/** Mismo proveedor aunque el nombre del archivo lo haya saneado distinto
 * ("5_11 Tactical de México" vs "5 11 TACTICAL DE MEXICO"). */
function claveProveedor(nombre: string): string {
  return nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Re-emisiones (Efraín, 2026-09-18: "no sumes las reemisiones, solo la última
 * OC"): "Generar OC" rehace la orden COMPLETA del proveedor, así que dentro de
 * un proyecto la OC más reciente de un proveedor reemplaza a las anteriores —
 * OC-312, 313 y 317 son la misma compra corregida dos veces, no tres compras.
 * La de folio más alto queda vigente y las demás apuntan a ella; se siguen
 * listando (el papel existe y se le mandó a alguien), pero no suman. Pura.
 *
 * Límite conocido: el día que se escribió, en 14 de 102 pares la anterior y la
 * vigente tenían montos muy distintos (OC-100 $92k → OC-109 $6k), que huele a
 * orden complementaria y no a corrección. La regla las trata igual. */
export function marcarReemplazadas(filas: OcListaRow[]): OcListaRow[] {
  const vigente = new Map<string, OcListaRow>();
  const clave = (o: OcListaRow) => `${o.proyectoId}|${claveProveedor(o.proveedor)}`;
  for (const o of filas) {
    const actual = vigente.get(clave(o));
    if (!actual || numeroDeFolio(o.folio) > numeroDeFolio(actual.folio)) vigente.set(clave(o), o);
  }
  return filas.map(o => {
    const v = vigente.get(clave(o))!;
    return { ...o, reemplazadaPor: v.folio === o.folio ? null : v.folio };
  });
}

export interface LineaEstado { proyectoId: string; proveedores: string[]; estado: string; piezas: number }

/** Lo que importa de una línea del Proyecto para el estado de su OC. Pura. */
export function lineaEstadoDe(row: MirrorItem): LineaEstado | null {
  if (row.parent_item_id == null) return null;
  let cols: (Col & { value?: string | null })[] = [];
  try { cols = JSON.parse(row.columns || '[]'); } catch { return null; }
  const texto = (id: string) => cols.find(c => c.id === id)?.text?.trim() ?? '';
  // Una OC se nombra con la razón social, o con el nombre del proveedor cuando
  // no la tiene (worker/lib/oc.ts): la línea responde por los dos.
  const proveedores = [...new Set([texto(SUB_PROVEEDOR_REL), texto(SUB_PROVEEDOR_RZ)].map(claveProveedor).filter(Boolean))];
  const estado = texto(SUB_ESTADO);
  if (proveedores.length === 0 || !estado) return null;
  const piezas = Number(texto(SUB_CANTIDAD));
  return { proyectoId: String(row.parent_item_id), proveedores, estado, piezas: Number.isFinite(piezas) && piezas > 0 ? piezas : 0 };
}

/** Estado de los productos de cada OC VIGENTE = el de las líneas de su
 * proveedor en su proyecto HOY, en piezas por etiqueta (Efraín, 2026-09-18:
 * "si ya está entregado o no"). Aquí sí se usan las líneas y no el PDF: el
 * estado es del presente, y la línea sí dice quién es su proveedor. Una
 * re-emisión no lleva estado — es el de la orden que la reemplazó.
 *
 * El nombre del archivo corta la razón social a 40 caracteres, así que también
 * empata por prefijo (mínimo 12, para que "GRUPO" no empate con medio mundo).
 * Medido: 241 de 269 empatan; en el resto el proveedor de la OC ya no está en
 * las líneas del proyecto (se movieron a otro) y se queda sin estado. Pura. */
export function conEstados(filas: OcListaRow[], lineas: LineaEstado[]): OcListaRow[] {
  const porProyecto = new Map<string, LineaEstado[]>();
  for (const l of lineas) (porProyecto.get(l.proyectoId) ?? porProyecto.set(l.proyectoId, []).get(l.proyectoId)!).push(l);
  return filas.map(o => {
    if (o.reemplazadaPor) return o;
    const clave = claveProveedor(o.proveedor);
    const empata = (p: string) => p === clave || (clave.length >= 12 && (p.startsWith(clave) || clave.startsWith(p)) && p.length >= 12);
    const suyas = (porProyecto.get(o.proyectoId) ?? []).filter(l => l.proveedores.some(empata));
    if (suyas.length === 0) return o;
    const piezas = new Map<string, number>();
    for (const l of suyas) piezas.set(l.estado, (piezas.get(l.estado) ?? 0) + l.piezas);
    return { ...o, estados: [...piezas].map(([label, n]) => ({ label, piezas: n })) };
  });
}

/** Junta las líneas iguales (mismo proyecto, proveedor y estado) sumando
 * piezas: ~1,900 líneas quedan en unos cientos de renglones. Pura. */
export function agruparLineas(lineas: LineaEstado[]): LineaEstado[] {
  const grupos = new Map<string, LineaEstado>();
  for (const l of lineas) {
    const k = `${l.proyectoId}|${l.proveedores.join('~')}|${l.estado}`;
    const g = grupos.get(k);
    if (g) g.piezas += l.piezas; else grupos.set(k, { ...l });
  }
  return [...grupos.values()];
}

async function selloLineas(env: Env): Promise<string> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS c, MAX(synced_at) AS m FROM items WHERE board_id = ?')
    .bind(BOARDS.proyectos_sub.id).first<{ c: number; m: string | null }>();
  return `${r?.c ?? 0}:${r?.m ?? ''}`;
}

/** El resumen de estados de TODAS las líneas de Proyecto, guardado en D1.
 *
 * Medido en producción (2026-09-18, "tarda en cargar"): sacar el estado obligaba
 * a traer las 1,910 líneas completas — 7.1 MB de JSON del D1 al Worker, y a
 * parsearlos — en CADA carga y en cada refresco de 60 s, para usar 4 campos.
 * Agregar en SQL con json_each se midió y se descartó: no era más rápido
 * (200-317 ms vs 165) y leía 70,627 filas en vez de 1,911, que es cuota de D1.
 * Así que se calcula una vez, se guarda agregado (decenas de KB) y solo se
 * rehace cuando el sello cambia — es decir, cuando el sync tocó alguna línea.
 *
 * Es GLOBAL, no por viewer: el scoping ya lo hizo `listItems` al decidir qué
 * proyectos entran, y `conEstados` solo busca en esos. */
async function lineasEstadoCacheadas(env: Env): Promise<LineaEstado[]> {
  const sello = await selloLineas(env);
  const fila = await env.DB.prepare(`SELECT sello, json FROM oc_lista_cache WHERE clave = 'lineas-estado'`)
    .first<{ sello: string; json: string }>();
  if (fila?.sello === sello) {
    try { return JSON.parse(fila.json) as LineaEstado[]; } catch { /* caché corrupta: se rehace */ }
  }
  const { results } = await env.DB.prepare('SELECT * FROM items WHERE board_id = ? AND parent_item_id IS NOT NULL')
    .bind(BOARDS.proyectos_sub.id).all<MirrorItem>();
  const lineas = agruparLineas((results ?? []).map(lineaEstadoDe).filter((l): l is LineaEstado => l != null));
  await env.DB.prepare(
    `INSERT INTO oc_lista_cache (clave, sello, json) VALUES ('lineas-estado', ?, ?)
     ON CONFLICT(clave) DO UPDATE SET sello = excluded.sello, json = excluded.json`,
  ).bind(sello, JSON.stringify(lineas)).run();
  return lineas;
}

/** Proveedor de una línea del Proyecto tal como se LEE (el nombre de la
 * relación; la razón social solo si la relación viene vacía). Pura. */
export function proveedorDeLinea(row: MirrorItem): { proyectoId: string; proveedor: string } | null {
  if (row.parent_item_id == null) return null;
  let cols: Col[] = [];
  try { cols = JSON.parse(row.columns || '[]'); } catch { return null; }
  const texto = (id: string) => cols.find(c => c.id === id)?.text?.trim() ?? '';
  const proveedor = texto(SUB_PROVEEDOR_REL) || texto(SUB_PROVEEDOR_RZ);
  return proveedor ? { proyectoId: String(row.parent_item_id), proveedor } : null;
}

/** proyecto -> sus proveedores (nombres, sin repetir), de TODAS las líneas.
 * Mismo caché y mismo sello que `lineasEstadoCacheadas`: las líneas completas
 * pesan 7 MB y esto se pide en cada carga del Reporte de Proyectos. Global,
 * no por viewer — quien llama lo recorta a los proyectos que sí puede leer. */
async function proveedoresPorProyectoCacheados(env: Env): Promise<Record<string, string[]>> {
  const sello = await selloLineas(env);
  const fila = await env.DB.prepare(`SELECT sello, json FROM oc_lista_cache WHERE clave = 'proveedores-proyecto'`)
    .first<{ sello: string; json: string }>();
  if (fila?.sello === sello) {
    try { return JSON.parse(fila.json) as Record<string, string[]>; } catch { /* caché corrupta: se rehace */ }
  }
  const { results } = await env.DB.prepare('SELECT * FROM items WHERE board_id = ? AND parent_item_id IS NOT NULL')
    .bind(BOARDS.proyectos_sub.id).all<MirrorItem>();
  const sets = new Map<string, Set<string>>();
  for (const row of results ?? []) {
    const l = proveedorDeLinea(row);
    if (!l) continue;
    if (!sets.has(l.proyectoId)) sets.set(l.proyectoId, new Set());
    sets.get(l.proyectoId)!.add(l.proveedor);
  }
  const mapa: Record<string, string[]> = {};
  for (const [id, set] of sets) mapa[id] = [...set].sort((a, b) => a.localeCompare(b));
  await env.DB.prepare(
    `INSERT INTO oc_lista_cache (clave, sello, json) VALUES ('proveedores-proyecto', ?, ?)
     ON CONFLICT(clave) DO UPDATE SET sello = excluded.sello, json = excluded.json`,
  ).bind(sello, JSON.stringify(mapa)).run();
  return mapa;
}

/** Lo que el Reporte de Proyectos necesita para filtrar y buscar y que NO viaja
 * en la lista de Proyectos: los proveedores (viven en las líneas) y los folios
 * de sus OC (viven en el nombre de los PDFs). Solo de los proyectos que el
 * viewer puede leer, y cada dato solo si su rol lee la columna de donde sale —
 * ventas no ve proveedores (shared/visibility.ts). Proyectos sin nada no salen. */
export async function filtrosPorProyecto(env: Env, viewer: Identity): Promise<Record<string, ProyectoFiltrosDTO>> {
  const verProveedor = canRead('proyectos_sub', SUB_PROVEEDOR_REL, viewer.role, viewer.email);
  const verOc = canRead('proyectos', PROYECTO_OC_PDF, viewer.role, viewer.email);
  if (!verProveedor && !verOc) return {};
  await ensureOcListaTables(env);
  const [proyectos, proveedores] = await Promise.all([
    listItems(env, 'proyectos', viewer),
    verProveedor ? proveedoresPorProyectoCacheados(env) : Promise.resolve({} as Record<string, string[]>),
  ]);
  const out: Record<string, ProyectoFiltrosDTO> = {};
  for (const row of proyectos) {
    const id = String(row.item_id);
    const provs = proveedores[id] ?? [];
    const ocs = verOc ? [...new Set(ordenesDeProyecto(row).map(o => o.folio))] : [];
    if (provs.length || ocs.length) out[id] = { proveedores: provs, ocs };
  }
  return out;
}

/** ETag de los filtros: los proyectos de ESTE viewer + las líneas. */
export async function etagFiltrosProyecto(env: Env, viewer: Identity): Promise<string> {
  const [proyectos, lineas] = await Promise.all([etagFor(env, 'proyectos', viewer), selloLineas(env)]);
  return `"proy-filtros:${proyectos.replace(/"/g, '')}:${lineas}"`;
}

/** ETag de la lista: cambia si cambia algo de lo que la compone — los
 * proyectos que ve ESTE viewer (etagFor ya trae su scope), las líneas, los
 * pagos o lo leído de los PDFs. Con él, el refresco de cada minuto contesta 304
 * sin tocar nada pesado. */
export async function etagOcLista(env: Env, viewer: Identity): Promise<string> {
  await Promise.all([ensureOcLedger(env), ensureOcListaTables(env)]);
  const [proyectos, lineas, propias] = await Promise.all([
    etagFor(env, 'proyectos', viewer),
    selloLineas(env),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM oc_pago)
        || '|' || (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM oc_pdf_datos)
        || '|' || (SELECT COUNT(*) || ':' || COALESCE(MAX(emitida_at), '') FROM oc_emitida) AS s`,
    ).first<{ s: string }>(),
  ]);
  return `"oc-lista:${proyectos.replace(/"/g, '')}:${lineas}:${propias?.s ?? ''}"`;
}

/** Todas las OC de los proyectos que el viewer puede LEER (scoping de dal.ts),
 * de la más reciente a la más vieja (`porFechaDeCreacion`). */
export async function listarOrdenesCompra(env: Env, viewer: Identity): Promise<OcListaRow[]> {
  await Promise.all([ensureOcLedger(env), ensureOcListaTables(env)]);
  // Todas las OC para todos (Efraín, 2026-09-23): compras lee los Proyectos de
  // todo el equipo desde 2026-09-21 y aquí seguía viendo solo los SUYOS — cada
  // comprador veía 41-87 de 272 órdenes, y buscar un folio o filtrar un
  // proveedor "perdía" las de los proyectos de otro comprador. Marcar pagada
  // sigue siendo solo sobre lo propio (`editable`, scope 'own').
  const [proyectos, propios] = await Promise.all([
    listItems(env, 'proyectos', viewer),
    idsPropios(env, viewer),
  ]);
  const base = marcarReemplazadas(unaFilaPorFolio(proyectos.flatMap(ordenesDeProyecto)));
  // `conEstados` solo mira los proyectos de `base` (los que el viewer ya puede
  // leer): el scoping de Proyectos se hereda, no se vuelve a decidir aquí.
  const ordenes = conEstados(base, await lineasEstadoCacheadas(env));

  const [ledger, pagos, montos] = await Promise.all([
    env.DB.prepare(`SELECT folio, monto, moneda, emitida_at FROM oc_emitida WHERE motor != 'backfill'`)
      .all<Pick<OcEmitidaRow, 'folio' | 'monto' | 'moneda' | 'emitida_at'>>(),
    env.DB.prepare(`SELECT folio FROM oc_pago WHERE pagada = 1`).all<{ folio: string }>(),
    env.DB.prepare(`SELECT folio, fecha, subtotal, iva, total, moneda, asset_id FROM oc_pdf_datos`)
      .all<{ folio: string; fecha: string | null; subtotal: number | null; iva: number | null; total: number | null; moneda: string | null; asset_id: string | null }>(),
  ]);
  const delLedger = new Map((ledger.results ?? []).map(r => [r.folio, r]));
  const pagadas = new Set((pagos.results ?? []).map(r => r.folio));
  const delPdf = new Map((montos.results ?? []).map(r => [r.folio, r]));
  for (const o of ordenes) {
    const l = delLedger.get(o.folio);
    if (l) { o.fecha = l.emitida_at.slice(0, 10); o.subtotal = l.monto; o.moneda = l.moneda; }
    // Lo leído del PDF gana, y solo vale si es del asset que HOY está en la
    // columna. Por asset y no por nombre: una orden regenerada conserva el
    // nombre del archivo, pero Monday le da un asset nuevo — y se vuelve a leer.
    const m = delPdf.get(o.folio);
    if (m && m.asset_id === o.assetId) {
      o.pdfLeido = true;
      o.fecha = m.fecha ?? o.fecha;
      if (m.subtotal != null) { o.subtotal = m.subtotal; o.iva = m.iva; o.total = m.total; o.moneda = m.moneda ?? o.moneda; }
    }
    o.pagada = pagadas.has(o.folio);
    o.editable = propios.has(o.proyectoId) || o.tambienEn.some(t => propios.has(t.proyectoId));
  }
  return ordenes.sort(porFechaDeCreacion);
}

/** De la más reciente a la más vieja por la FECHA impresa en la orden (Efraín,
 * 2026-09-18), con el folio de desempate — es global y nunca decrece, así que
 * dentro de un mismo día sigue siendo el orden de creación. Una orden cuyo PDF
 * aún no se lee no tiene fecha: se acomoda por folio junto a sus vecinas en vez
 * de irse al fondo (medido: fecha y folio ordenan igual, cero inversiones). */
export function porFechaDeCreacion(a: OcListaRow, b: OcListaRow): number {
  if (a.fecha && b.fecha && a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
  return numeroDeFolio(b.folio) - numeroDeFolio(a.folio);
}

/** Proyectos que el viewer puede ESCRIBIR (scope 'own'), solo ids. */
async function idsPropios(env: Env, viewer: Identity): Promise<Set<string>> {
  const scope = scopeFor('proyectos', viewer, 'own');
  const { results } = await env.DB.prepare(`SELECT item_id FROM items WHERE board_id = ? AND (${scope.where})`)
    .bind(BOARDS.proyectos.id, ...scope.binds).all<{ item_id: number }>();
  return new Set((results ?? []).map(r => String(r.item_id)));
}

async function ordenVisible(env: Env, viewer: Identity, folio: string): Promise<OcListaRow> {
  const f = folio.trim().toUpperCase();
  if (!numeroDeFolio(f)) throw new OcListaError('folio inválido');
  const orden = (await listarOrdenesCompra(env, viewer)).find(o => o.folio === f);
  if (!orden) throw new OcListaError('orden no encontrada', 404);
  return orden;
}

/** Marca/desmarca una OC como pagada. El folio tiene que ser de una orden que
 * el viewer SÍ ve: sin eso, cualquiera con la ruta marcaría folios ajenos. */
export async function marcarPagada(env: Env, viewer: Identity, folio: string, pagada: boolean): Promise<void> {
  const orden = await ordenVisible(env, viewer, folio);
  // Ver no es poder marcar: solo sobre proyectos propios (mismo 404 que un extraño).
  if (!orden.editable) throw new OcListaError('orden no encontrada', 404);
  await env.DB.prepare(
    `INSERT INTO oc_pago (folio, pagada, por_email, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(folio) DO UPDATE SET pagada = excluded.pagada, por_email = excluded.por_email, updated_at = excluded.updated_at`,
  ).bind(orden.folio, pagada ? 1 : 0, viewer.email, new Date().toISOString()).run();
}

export interface PdfDatosInput { fecha?: string | null; subtotal?: number | null; iva?: number | null; total?: number | null; moneda?: string | null }

/** Asienta lo que el navegador leyó del PDF de la orden: fecha y totales. El
 * server no puede releer el PDF, así que valida lo que sí puede: que la orden
 * sea visible, que la fecha exista en el calendario, que las tres cifras
 * cuadren entre sí y que la moneda tenga forma de moneda. Los totales son
 * todo-o-nada; pueden faltar (PDF sin bloque de totales) y la fila igual se
 * guarda, para no rebajar ese PDF en cada visita. Ligado al asset vigente. */
export async function guardarPdfDatos(env: Env, viewer: Identity, folio: string, input: PdfDatosInput): Promise<void> {
  const orden = await ordenVisible(env, viewer, folio);
  if (!orden.url || !orden.assetId) throw new OcListaError('la orden no tiene PDF con costos');
  const fecha = input.fecha ?? null;
  if (fecha != null && !fechaValida(fecha)) throw new OcListaError('fecha inválida');
  const { subtotal = null, iva = null, total = null } = input;
  const hayTotales = subtotal != null || iva != null || total != null;
  if (hayTotales && (![subtotal, iva, total].every(n => typeof n === 'number' && Number.isFinite(n)) || !montoCuadra(subtotal!, iva!, total!))) {
    throw new OcListaError('subtotal + IVA no da el total');
  }
  const moneda = hayTotales && input.moneda && /^[A-Z]{3}$/.test(input.moneda) ? input.moneda : null;
  await env.DB.prepare(
    `INSERT INTO oc_pdf_datos (folio, fecha, subtotal, iva, total, moneda, asset_id, por_email, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(folio) DO UPDATE SET fecha = excluded.fecha, subtotal = excluded.subtotal, iva = excluded.iva, total = excluded.total,
       moneda = excluded.moneda, asset_id = excluded.asset_id, por_email = excluded.por_email, updated_at = excluded.updated_at`,
  ).bind(orden.folio, fecha, subtotal, iva, total, moneda, orden.assetId, viewer.email, new Date().toISOString()).run();
}
