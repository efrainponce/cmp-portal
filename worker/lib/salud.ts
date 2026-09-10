// worker/lib/salud.ts — Revisión de SALUD del portal (2026-09-10, Efraín: "haz
// lo necesario para tener telemetría o algo que puedas ver cuando las cosas no
// funcionan correctamente").
//
// Complementa los registros de EVENTOS que ya existían (sync_log, accion_log,
// ux_event, outbox) con revisiones de INTEGRIDAD de los datos: los bugs de
// dividir/SKU/borrado del 2026-09-10 no tiraban ningún error, dejaban datos mal
// que nadie veía hasta que el archivo de tallas no cuadraba dos semanas después
// (OPP-0970). Cada revisión busca un síntoma concreto de algo que ya pasó:
//  - division_borrada: la línea nueva de un 'dividir' se borró en Monday y la
//    cotización quedó recortada (OPP-0970).
//  - sku_desfasado: línea con producto del catálogo cuyo SKU/Producto en texto
//    está vacío o es de otro producto (cmp-tallas imprime esos textos). Los
//    VACÍOS se rellenan solos desde el catálogo (la automatización de Monday
//    que debía hacerlo falla también con líneas creadas a mano allá).
//  - linea_fantasma: línea en el espejo sin padre (borrada en Monday y
//    reinsertada, o huérfana).
//  - outbox_atorado / outbox_fallido / outbox_conflicto: escrituras del portal
//    que no llegaron a Monday, o que Monday tiene distinto a lo que se mandó.
//  - tallas_no_cuadran: las tallas del Proyecto no suman lo cotizado por
//    producto y color.
//  - errores_servidor / http_500 / errores_front / sync_fallido: errores de la
//    última hora (worker/lib/errores.ts, accion_log, sync_log).
//
// Corre cada hora (cron de 15 min en worker/index.ts, solo en el primer cuarto
// de hora) y bajo demanda (POST /api/admin/salud/revisar). Cada hallazgo vive en
// `salud_hallazgo` con una clave estable: si sigue apareciendo se actualiza
// `ultima_vez`; si deja de aparecer se marca resuelto. Los de severidad 'alta'
// nuevos generan UNA notificación por corrida (bandeja Importantes, sin
// WhatsApp: las alertas por WhatsApp se pausaron por ruido el 2026-08-15).
//
// Para leerlo: GET /api/admin/salud (admin) o, desde la terminal,
// `node scripts/salud.mjs`.
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import { emitNotification } from './notify';
import { ensureAjustesTable, ensureDescartadasTable, textosDeProducto } from './lineaAjustes';
import { ensureItemBorradoTable } from './itemBorrado';
import { registrarError } from './errores';
import { updateItemColumns } from './monday';
import { upsertItem } from '../sync';
import { logSync } from '../sync/log';

export type Severidad = 'alta' | 'media' | 'baja';

export interface Hallazgo {
  clave: string;
  tipo: string;
  severidad: Severidad;
  titulo: string;
  detalle?: Record<string, unknown>;
  boardId?: number | null;
  itemId?: number | null;
}

/** Quién recibe el aviso de hallazgos graves nuevos. */
export const SALUD_AVISAR = ['salinasefrain@mexicanadeproteccion.com'];

const OPP = BOARDS.oportunidades.id;
const SUB = BOARDS.oportunidades_sub.id;
const PRO = BOARDS.proyectos.id;
const PSUB = BOARDS.proyectos_sub.id;

// Líneas de cotización (oportunidades_sub) — docs/monday-column-map.md.
const REL_PRODUCTO = 'board_relation_mkzmafgp';
const SKU_TXT = 'text_mm0bxy39';
const PROD_TXT = 'text_mm0bkm1j';
const SKU_CAT = 'lookup_mkzn7x9a';
const COLOR = 'text_mm07s2mg';
const CANTIDAD = 'numeric_mkzm6399';
// Proyecto y sus líneas (proyectos / proyectos_sub).
const PRO_OPP_REL = 'board_relation_mm0hf0y3';
const PRO_ESTADO = 'project_status';
const PS_SKU = 'text_mm0hyrfs';
const PS_COLOR = 'text_mm0h4a1c';
const PS_CANTIDAD = 'numeric_mm0hj2q4';

const ETAPAS_CERRADAS = new Set(['Perdida', 'Cancelada']);
// Proyectos cuyas tallas ya deberían cuadrar con la cotización: en "Desglose de
// tallas" todavía se están capturando y "Proyecto Terminado" ya no se toca.
const ESTADOS_CON_TALLAS = new Set(['En confirmacion de tallas', 'Tallas Confirmadas', 'Ordenes de compra listas', 'Ejecución']);
const OUTBOX_ATORADO_MIN = 15;
// Tope de líneas a las que la revisión les rellena SKU/Producto en texto por
// corrida (cada una es una llamada a Monday).
const AUTO_RELLENO_MAX = 25;
const RETENCION_RESUELTOS_DIAS = 30;

// Qué tipos produce cada revisión: si una revisión falla, sus hallazgos
// abiertos NO se marcan resueltos (no sabemos si siguen).
const TIPOS_DE: Record<string, string[]> = {
  divisiones: ['division_borrada'],
  sku: ['sku_desfasado'],
  fantasmas: ['linea_fantasma'],
  outbox: ['outbox_atorado', 'outbox_fallido', 'outbox_conflicto'],
  tallas: ['tallas_no_cuadran'],
  errores: ['errores_servidor', 'http_500', 'errores_front', 'sync_fallido'],
};

/** Subconsulta que saca un campo de UNA columna del blob JSON del espejo, para
 * no traer blobs completos (~3.5 KB por renglón) a JS. Ids de columna fijos. */
function campo(alias: string, colId: string, prop: 'text' | 'value' = 'text'): string {
  return `(SELECT json_extract(j.value, '$.${prop}') FROM json_each(${alias}.columns) j WHERE json_extract(j.value, '$.id') = '${colId}')`;
}

export function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function numero(s: unknown): number {
  const n = Number(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function idsLigados(valor: unknown): number[] {
  try {
    const v = JSON.parse(String(valor ?? '')) as { linked_item_ids?: unknown[] };
    return (v.linked_item_ids ?? []).map(Number).filter(Number.isFinite);
  } catch {
    return [];
  }
}

function lotes<T>(xs: T[], n = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Ruta con los ids largos cambiados por :id, para agrupar. Puro. */
export function normalizarRuta(ruta: string): string {
  return ruta.replace(/\/\d{5,}/g, '/:id');
}

// ───────────────────────────── revisiones ─────────────────────────────

async function divisionesBorradas(env: Env): Promise<Hallazgo[]> {
  await ensureAjustesTable(env);
  await ensureItemBorradoTable(env);
  await ensureDescartadasTable(env);
  const { results } = await env.DB.prepare(
    `SELECT a.item_id, a.subversion, a.linea_id, a.linea_origen_id, a.resumen,
            (SELECT o.name FROM items o WHERE o.board_id = ? AND o.item_id = a.item_id) AS opp
       FROM cotizacion_ajustes a
      WHERE a.linea_origen_id IS NOT NULL
        AND a.version = COALESCE((SELECT MAX(v.version) FROM cotizacion_versions v WHERE v.item_id = a.item_id), 0) + 1
        AND NOT EXISTS (SELECT 1 FROM items i WHERE i.board_id = ? AND i.item_id = a.linea_id)
        AND EXISTS (SELECT 1 FROM items g WHERE g.board_id = ? AND g.item_id = a.linea_origen_id AND g.parent_item_id = a.item_id)
        AND NOT EXISTS (SELECT 1 FROM item_borrado b WHERE b.board_id = ? AND b.item_id = a.linea_id)
        AND NOT EXISTS (SELECT 1 FROM ajuste_descartado d WHERE d.item_id = a.item_id AND d.version = a.version AND d.subversion = a.subversion)
      ORDER BY a.item_id, a.subversion`,
  ).bind(OPP, SUB, SUB, SUB).all<{ item_id: number; subversion: number; linea_id: number; linea_origen_id: number; resumen: string; opp: string | null }>();
  const vistas = new Set<string>();
  const out: Hallazgo[] = [];
  for (const r of results ?? []) {
    const k = `${r.item_id}:${r.linea_id}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push({
      clave: `division_borrada:${r.item_id}:${r.linea_id}`, tipo: 'division_borrada', severidad: 'alta',
      titulo: `${r.opp ?? `Oportunidad ${r.item_id}`}: la línea nueva de una división (.${r.subversion}) se borró directo en Monday y la cotización quedó recortada`,
      detalle: { subversion: r.subversion, lineaBorrada: r.linea_id, lineaOrigen: r.linea_origen_id, resumen: r.resumen },
      boardId: OPP, itemId: r.item_id,
    });
  }
  return out;
}

async function skuDesfasado(env: Env): Promise<Hallazgo[]> {
  await ensureAjustesTable(env);
  const { results } = await env.DB.prepare(
    `SELECT s.item_id, s.parent_item_id, o.name AS opp, ${campo('o', 'deal_stage')} AS etapa,
            ${campo('s', REL_PRODUCTO, 'value')} AS rel, ${campo('s', SKU_TXT)} AS sku_txt,
            ${campo('s', PROD_TXT)} AS prod_txt, ${campo('s', SKU_CAT)} AS sku_cat,
            EXISTS (SELECT 1 FROM cotizacion_ajustes a WHERE a.linea_id = s.item_id) AS ajustada
       FROM items s JOIN items o ON o.board_id = ? AND o.item_id = s.parent_item_id
      WHERE s.board_id = ? AND s.item_id < 900000000000`,
  ).bind(OPP, SUB).all<{
    item_id: number; parent_item_id: number; opp: string; etapa: string | null; rel: string | null;
    sku_txt: string | null; prod_txt: string | null; sku_cat: string | null; ajustada: number;
  }>();
  const out: Hallazgo[] = [];
  const vacias: { linea: number; padre: number; opp: string; rel: number; skuTxt: string; prodTxt: string; skuCat: string }[] = [];
  for (const r of results ?? []) {
    if (ETAPAS_CERRADAS.has(r.etapa ?? '') || idsLigados(r.rel).length === 0) continue;
    const skuTxt = (r.sku_txt ?? '').trim();
    const prodTxt = (r.prod_txt ?? '').trim();
    const skuCat = (r.sku_cat ?? '').trim();
    let motivo: string | null = null;
    if (!prodTxt || (!skuTxt && skuCat)) {
      // Se intenta rellenar abajo; solo queda como hallazgo si no se pudo.
      vacias.push({ linea: r.item_id, padre: r.parent_item_id, opp: r.opp, rel: idsLigados(r.rel)[0], skuTxt, prodTxt, skuCat });
      continue;
    }
    // Solo en líneas tocadas por "Ajustar línea": las demás pueden traer un SKU
    // capturado a mano a propósito (159 así al 2026-09-10) y serían puro ruido.
    else if (r.ajustada && skuCat && norm(skuTxt) !== norm(skuCat)) motivo = `dice SKU "${skuTxt}" pero su producto es "${skuCat}"`;
    if (!motivo) continue;
    out.push({
      clave: `sku_desfasado:${r.item_id}`, tipo: 'sku_desfasado', severidad: 'media',
      titulo: `${r.opp}: la línea ${r.item_id} ${motivo} (cmp-tallas imprime esos textos en tallas y cotización)`,
      detalle: { linea: r.item_id, skuTexto: skuTxt, productoTexto: prodTxt, skuCatalogo: skuCat },
      boardId: OPP, itemId: r.parent_item_id,
    });
  }

  // Autocorrección de los VACÍOS: SKU y Producto en texto desde el catálogo,
  // exactamente lo que la automatización de Monday debió hacer al ligar el
  // producto (OPP-1047, 2026-09-10: dos líneas creadas a mano en Monday
  // quedaron sin SKU). Solo campos vacíos —nunca pisa un texto capturado—,
  // con tope por corrida y rastro en sync_log.
  const catalogo = new Map<number, { nombre: string; sku: string }>();
  for (const lote of lotes([...new Set(vacias.slice(0, AUTO_RELLENO_MAX).map(v => v.rel))])) {
    const { results: prods } = await env.DB.prepare(
      `SELECT item_id, name, columns FROM items WHERE board_id = ? AND item_id IN (${lote.map(() => '?').join(',')})`,
    ).bind(BOARDS.productos.id, ...lote).all<{ item_id: number; name: string; columns: string }>();
    for (const pr of prods ?? []) catalogo.set(Number(pr.item_id), textosDeProducto(pr));
  }
  for (const [i, v] of vacias.entries()) {
    const cat = i < AUTO_RELLENO_MAX ? catalogo.get(v.rel) : undefined;
    const cambios: Record<string, string> = {};
    if (cat && !v.skuTxt && cat.sku) cambios[SKU_TXT] = cat.sku;
    if (cat && !v.prodTxt && cat.nombre) cambios[PROD_TXT] = cat.nombre;
    if (Object.keys(cambios).length > 0) {
      try {
        const item = await updateItemColumns(env, SUB, v.linea, cambios);
        if (item) {
          try { await upsertItem(env, 'oportunidades_sub', item); } catch { /* lo trae el delta sync */ }
        }
        await logSync(env, 'manual', SUB, v.linea, true, `salud: SKU/Producto en texto rellenados del catálogo ${JSON.stringify(cambios)}`);
        if ((cambios[SKU_TXT] || v.skuTxt) && (cambios[PROD_TXT] || v.prodTxt)) continue; // quedó completa
      } catch (err) {
        await registrarError(env, 'salud:rellenar-textos', err, { itemId: v.linea });
      }
    }
    out.push({
      clave: `sku_desfasado:${v.linea}`, tipo: 'sku_desfasado', severidad: 'media',
      titulo: `${v.opp}: la línea ${v.linea} tiene el SKU o el Producto en texto vacío y no se pudo rellenar solo (cmp-tallas imprime esos textos)`,
      detalle: { linea: v.linea, skuTexto: v.skuTxt, productoTexto: v.prodTxt, skuCatalogo: v.skuCat, producto: v.rel },
      boardId: OPP, itemId: v.padre,
    });
  }
  return out;
}

async function lineasFantasma(env: Env): Promise<Hallazgo[]> {
  const { results } = await env.DB.prepare(
    'SELECT board_id, item_id, name FROM items WHERE board_id IN (?, ?) AND parent_item_id IS NULL',
  ).bind(SUB, PSUB).all<{ board_id: number; item_id: number; name: string }>();
  return (results ?? []).map(r => ({
    clave: `linea_fantasma:${r.item_id}`, tipo: 'linea_fantasma', severidad: 'baja' as const,
    titulo: `Línea sin padre en el espejo: "${r.name}" (${r.item_id}) — probablemente borrada en Monday`,
    boardId: r.board_id, itemId: r.item_id,
  }));
}

interface FilaOutbox {
  id: number; board_id: number; item_id: number; cols: string; status: string; author_email: string;
  attempts: number; updated_at: string; nombre: string | null; columnas: string | null;
}

/** ¿Lo que el espejo tiene HOY coincide con lo que el outbox mandó? Un
 * 'conflict' que después sí quedó igual (Monday normalizó, o una escritura
 * posterior lo alcanzó) no es un dato perdido. Puro. */
export function diferenciasOutbox(enviado: Record<string, string>, nombre: string | null, columnasJson: string | null): Record<string, { enviado: string; actual: string }> {
  let cols: { id: string; text?: string | null; value?: string | null }[] = [];
  try { cols = JSON.parse(columnasJson || '[]'); } catch { /* sin espejo */ }
  const porId = new Map(cols.map(c => [c.id, c]));
  const out: Record<string, { enviado: string; actual: string }> = {};
  for (const [colId, valor] of Object.entries(enviado)) {
    const mandado = String(valor ?? '');
    if (colId === 'name') {
      if (norm(nombre) !== norm(mandado)) out[colId] = { enviado: mandado, actual: nombre ?? '' };
      continue;
    }
    const col = porId.get(colId);
    if (colId.startsWith('board_relation')) {
      const ligados = idsLigados(col?.value);
      const iguales = mandado.trim() === '' ? ligados.length === 0 : ligados.includes(Number(mandado));
      if (!iguales) out[colId] = { enviado: mandado, actual: ligados.join(',') };
      continue;
    }
    const actual = String(col?.text ?? '');
    const a = norm(actual).replace(/,/g, '');
    const b = norm(mandado).replace(/,/g, '');
    const numA = Number(a); const numB = Number(b);
    const igual = a === b || (a !== '' && b !== '' && Number.isFinite(numA) && Number.isFinite(numB) && numA === numB);
    if (!igual) out[colId] = { enviado: mandado, actual };
  }
  return out;
}

async function outboxProblemas(env: Env, ahora: Date): Promise<Hallazgo[]> {
  const atorado = new Date(ahora.getTime() - OUTBOX_ATORADO_MIN * 60_000).toISOString();
  const dia = new Date(ahora.getTime() - 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    // El blob de columnas (~3.5 KB por item) solo hace falta para clasificar
    // un 'conflict'; la cuenta está en Workers Free y esto corre dentro del
    // mismo cron que el delta sync, así que se trae lo mínimo.
    `SELECT o.id, o.board_id, o.item_id, o.cols, o.status, o.author_email, o.attempts, o.updated_at,
            i.name AS nombre, CASE WHEN o.status = 'conflict' THEN i.columns END AS columnas
       FROM outbox o LEFT JOIN items i ON i.board_id = o.board_id AND i.item_id = o.item_id
      WHERE (o.status IN ('pending', 'sent') AND o.updated_at < ?)
         OR (o.status IN ('failed', 'conflict') AND o.updated_at > ?)
      ORDER BY o.id DESC LIMIT 100`,
  ).bind(atorado, dia).all<FilaOutbox>();
  // Columnas que el portal volvió a escribir DESPUÉS de un 'conflict' en el
  // mismo item: ese valor ya no es el que debe estar, lo reemplazó una
  // escritura posterior (p.ej. el precio 890 que luego se corrigió a 910).
  const conflictos = (results ?? []).filter(r => r.status === 'conflict');
  const reescritas = new Map<number, { id: number; cols: string[] }[]>();
  if (conflictos.length > 0) {
    const desde = Math.min(...conflictos.map(r => r.id));
    for (const lote of lotes([...new Set(conflictos.map(r => r.item_id))])) {
      const { results: posteriores } = await env.DB.prepare(
        `SELECT id, item_id, cols FROM outbox WHERE id > ? AND item_id IN (${lote.map(() => '?').join(',')})`,
      ).bind(desde, ...lote).all<{ id: number; item_id: number; cols: string }>();
      for (const w of posteriores ?? []) {
        let llaves: string[] = [];
        try { llaves = Object.keys(JSON.parse(w.cols) as Record<string, unknown>); } catch { /* cols ilegible */ }
        const lista = reescritas.get(w.item_id) ?? [];
        lista.push({ id: w.id, cols: llaves });
        reescritas.set(w.item_id, lista);
      }
    }
  }
  const out: Hallazgo[] = [];
  for (const r of results ?? []) {
    let enviado: Record<string, string> = {};
    try { enviado = JSON.parse(r.cols); } catch { /* cols ilegible */ }
    const donde = `${r.nombre ?? `item ${r.item_id}`} (board ${r.board_id})`;
    if (r.status === 'pending' || r.status === 'sent') {
      out.push({
        clave: `outbox_atorado:${r.id}`, tipo: 'outbox_atorado', severidad: 'alta',
        titulo: `Escritura atorada en el outbox #${r.id} (${r.status}, ${r.attempts} intentos) desde ${r.updated_at.slice(0, 16)}: ${donde}`,
        detalle: { enviado, autor: r.author_email }, boardId: r.board_id, itemId: r.item_id,
      });
    } else if (r.status === 'failed') {
      out.push({
        clave: `outbox_fallido:${r.id}`, tipo: 'outbox_fallido', severidad: 'alta',
        titulo: `Monday rechazó una escritura del portal (#${r.id}, ${r.attempts} intentos) en ${donde}: el cambio NO está en Monday`,
        detalle: { enviado, autor: r.author_email }, boardId: r.board_id, itemId: r.item_id,
      });
    } else {
      const difs = diferenciasOutbox(enviado, r.nombre, r.columnas);
      for (const w of reescritas.get(r.item_id) ?? []) {
        if (w.id > r.id) for (const col of w.cols) delete difs[col];
      }
      if (Object.keys(difs).length === 0) continue; // al final sí quedó igual, o se reescribió después
      out.push({
        clave: `outbox_conflicto:${r.id}`, tipo: 'outbox_conflicto', severidad: 'media',
        titulo: `Monday tiene otro valor del que escribió el portal (#${r.id}) en ${donde}: ${Object.entries(difs).map(([k, v]) => `${k} mandado "${v.enviado}", hoy "${v.actual}"`).join('; ')}`.slice(0, 480),
        detalle: { diferencias: difs, autor: r.author_email }, boardId: r.board_id, itemId: r.item_id,
      });
    }
  }
  return out;
}

export interface LineaCantidad { sku: string; color: string; cantidad: number }
export interface DiferenciaTallas { sku: string; color: string; cotizado: number; enProyecto: number }

/** Tallas del Proyecto contra la cotización, por SKU + color. Puro. Si el
 * Proyecto todavía no tiene ninguna talla de los productos cotizados, no hay
 * nada que comparar (se están capturando). Las líneas del Proyecto con un SKU
 * que la cotización no tiene (embellecimientos, "BORDADO DIRECTO"…) se ignoran. */
export function compararTallas(cot: LineaCantidad[], pro: LineaCantidad[]): DiferenciaTallas[] {
  const sumar = (xs: LineaCantidad[]) => {
    const m = new Map<string, LineaCantidad>();
    for (const x of xs) {
      if (!norm(x.sku)) continue;
      const k = `${norm(x.sku)}|${norm(x.color)}`;
      const prev = m.get(k);
      m.set(k, { sku: prev?.sku ?? x.sku.trim(), color: prev?.color ?? x.color.trim(), cantidad: (prev?.cantidad ?? 0) + x.cantidad });
    }
    return m;
  };
  const c = sumar(cot);
  const p = sumar(pro);
  const skusCot = new Set([...c.values()].map(v => norm(v.sku)));
  if (![...p.values()].some(v => skusCot.has(norm(v.sku)))) return [];
  const out: DiferenciaTallas[] = [];
  for (const [k, v] of c) {
    const n = p.get(k)?.cantidad ?? 0;
    if (Math.abs(n - v.cantidad) > 1e-6) out.push({ sku: v.sku, color: v.color, cotizado: v.cantidad, enProyecto: n });
  }
  for (const [k, v] of p) {
    if (!c.has(k) && skusCot.has(norm(v.sku))) out.push({ sku: v.sku, color: v.color, cotizado: 0, enProyecto: v.cantidad });
  }
  return out;
}

async function tallasNoCuadran(env: Env): Promise<Hallazgo[]> {
  const { results: proys } = await env.DB.prepare(
    `SELECT p.item_id, p.name, ${campo('p', PRO_ESTADO)} AS estado, ${campo('p', PRO_OPP_REL, 'value')} AS opp
       FROM items p WHERE p.board_id = ?`,
  ).bind(PRO).all<{ item_id: number; name: string; estado: string | null; opp: string | null }>();
  const activos = (proys ?? [])
    .filter(p => ESTADOS_CON_TALLAS.has(p.estado ?? ''))
    .map(p => ({ id: p.item_id, nombre: p.name, estado: p.estado ?? '', opp: idsLigados(p.opp)[0] }))
    .filter((p): p is { id: number; nombre: string; estado: string; opp: number } => p.opp != null);
  if (activos.length === 0) return [];

  const cot = new Map<number, LineaCantidad[]>();
  for (const lote of lotes([...new Set(activos.map(p => p.opp))])) {
    const { results } = await env.DB.prepare(
      `SELECT s.parent_item_id AS padre, ${campo('s', SKU_TXT)} AS sku, ${campo('s', SKU_CAT)} AS sku_cat,
              ${campo('s', COLOR)} AS color, ${campo('s', CANTIDAD)} AS cantidad
         FROM items s WHERE s.board_id = ? AND s.parent_item_id IN (${lote.map(() => '?').join(',')})`,
    ).bind(SUB, ...lote).all<{ padre: number; sku: string | null; sku_cat: string | null; color: string | null; cantidad: string | null }>();
    for (const r of results ?? []) {
      const lista = cot.get(r.padre) ?? [];
      lista.push({ sku: (r.sku || r.sku_cat || '').trim(), color: r.color ?? '', cantidad: numero(r.cantidad) });
      cot.set(r.padre, lista);
    }
  }
  const pro = new Map<number, LineaCantidad[]>();
  for (const lote of lotes(activos.map(p => p.id))) {
    const { results } = await env.DB.prepare(
      `SELECT s.parent_item_id AS padre, ${campo('s', PS_SKU)} AS sku, ${campo('s', PS_COLOR)} AS color, ${campo('s', PS_CANTIDAD)} AS cantidad
         FROM items s WHERE s.board_id = ? AND s.parent_item_id IN (${lote.map(() => '?').join(',')})`,
    ).bind(PSUB, ...lote).all<{ padre: number; sku: string | null; color: string | null; cantidad: string | null }>();
    for (const r of results ?? []) {
      const lista = pro.get(r.padre) ?? [];
      lista.push({ sku: r.sku ?? '', color: r.color ?? '', cantidad: numero(r.cantidad) });
      pro.set(r.padre, lista);
    }
  }

  const out: Hallazgo[] = [];
  for (const p of activos) {
    const difs = compararTallas(cot.get(p.opp) ?? [], pro.get(p.id) ?? []);
    if (difs.length === 0) continue;
    const ejemplo = difs.slice(0, 3).map(d => `${d.sku} ${d.color}: cotizado ${d.cotizado}, en Proyecto ${d.enProyecto}`).join('; ');
    out.push({
      clave: `tallas_no_cuadran:${p.id}`, tipo: 'tallas_no_cuadran', severidad: 'media',
      titulo: `${p.nombre} (${p.estado}): las tallas no cuadran con la cotización en ${difs.length} producto(s)/color(es) — ${ejemplo}`.slice(0, 480),
      detalle: { oportunidad: p.opp, diferencias: difs.slice(0, 40) }, boardId: PRO, itemId: p.id,
    });
  }
  return out;
}

async function erroresRecientes(env: Env, desde: string): Promise<Hallazgo[]> {
  const out: Hallazgo[] = [];
  const { results: sl } = await env.DB.prepare(
    `SELECT CASE WHEN kind = 'error' AND detail LIKE 'front %' THEN 'front' ELSE kind END AS origen,
            COUNT(*) AS n, MAX(at) AS ultimo, MAX(id) AS ultimo_id
       FROM sync_log WHERE ok = 0 AND at > ? AND detail NOT LIKE 'error-alert:%'
      GROUP BY origen`,
  ).bind(desde).all<{ origen: string; n: number; ultimo: string; ultimo_id: number }>();
  for (const r of sl ?? []) {
    if (r.origen === 'outbox') continue; // lo cubre la revisión del outbox con más detalle
    const ej = await env.DB.prepare('SELECT detail FROM sync_log WHERE id = ?').bind(r.ultimo_id).first<{ detail: string }>();
    const tipo = r.origen === 'front' ? 'errores_front' : (r.origen === 'error' || r.origen === 'http') ? 'errores_servidor' : 'sync_fallido';
    out.push({
      clave: `${tipo}:${r.origen}`, tipo, severidad: tipo === 'errores_servidor' ? 'alta' : 'media',
      titulo: `${r.n} error(es) de ${r.origen} en la última hora — el último: ${(ej?.detail ?? '').slice(0, 220)}`,
      detalle: { n: r.n, ultimo: r.ultimo },
    });
  }
  try {
    const { results: ac } = await env.DB.prepare(
      'SELECT ruta, COUNT(*) AS n, MAX(detalle) AS detalle, MAX(at) AS ultimo FROM accion_log WHERE status >= 500 AND at > ? GROUP BY ruta',
    ).bind(desde).all<{ ruta: string; n: number; detalle: string | null; ultimo: string }>();
    const porRuta = new Map<string, { n: number; detalle: string | null; ultimo: string }>();
    for (const r of ac ?? []) {
      const k = normalizarRuta(r.ruta);
      const prev = porRuta.get(k);
      porRuta.set(k, { n: (prev?.n ?? 0) + r.n, detalle: r.detalle ?? prev?.detalle ?? null, ultimo: r.ultimo > (prev?.ultimo ?? '') ? r.ultimo : prev!.ultimo });
    }
    for (const [ruta, v] of porRuta) {
      out.push({
        clave: `http_500:${ruta}`, tipo: 'http_500', severidad: 'alta',
        titulo: `${v.n} respuesta(s) 500 en ${ruta} en la última hora${v.detalle ? ` — ${v.detalle.slice(0, 160)}` : ''}`,
        detalle: v,
      });
    }
  } catch { /* accion_log todavía no existe (se crea con el primer POST) */ }
  return out;
}

// ───────────────────────────── corrida y reporte ─────────────────────────────

let tablaLista = false;

export async function ensureSaludTable(env: Env): Promise<void> {
  if (tablaLista) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS salud_hallazgo (
      clave         TEXT PRIMARY KEY,
      tipo          TEXT NOT NULL,
      severidad     TEXT NOT NULL,
      titulo        TEXT NOT NULL,
      detalle       TEXT,
      board_id      INTEGER,
      item_id       INTEGER,
      primera_vez   TEXT NOT NULL,
      ultima_vez    TEXT NOT NULL,
      resuelto_at   TEXT,
      notificado_at TEXT
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_salud_abiertos ON salud_hallazgo (resuelto_at, severidad)'),
  ]);
  tablaLista = true;
}

export interface ResultadoSalud {
  revisadoAt: string;
  ms: number;
  encontrados: number;
  abiertosPorTipo: Record<string, number>;
  nuevosAlta: number;
  revisionesFallidas: string[];
}

export async function revisarSalud(env: Env): Promise<ResultadoSalud> {
  const t0 = Date.now();
  const ahora = new Date();
  const inicio = ahora.toISOString();
  await ensureSaludTable(env);
  const desde = new Date(ahora.getTime() - 3_600_000).toISOString();

  const revisiones: [string, () => Promise<Hallazgo[]>][] = [
    ['divisiones', () => divisionesBorradas(env)],
    ['sku', () => skuDesfasado(env)],
    ['fantasmas', () => lineasFantasma(env)],
    ['outbox', () => outboxProblemas(env, ahora)],
    ['tallas', () => tallasNoCuadran(env)],
    ['errores', () => erroresRecientes(env, desde)],
  ];
  const hallazgos: Hallazgo[] = [];
  const fallidas: string[] = [];
  for (const [nombre, fn] of revisiones) {
    try {
      hallazgos.push(...await fn());
    } catch (err) {
      fallidas.push(nombre);
      await registrarError(env, `salud:${nombre}`, err);
      hallazgos.push({
        clave: `revision_fallida:${nombre}`, tipo: 'revision_fallida', severidad: 'alta',
        titulo: `La revisión de salud "${nombre}" falló: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      });
    }
  }

  const stmts = hallazgos.map(h => env.DB.prepare(
    `INSERT INTO salud_hallazgo (clave, tipo, severidad, titulo, detalle, board_id, item_id, primera_vez, ultima_vez, resuelto_at, notificado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(clave) DO UPDATE SET
       tipo = excluded.tipo, severidad = excluded.severidad, titulo = excluded.titulo, detalle = excluded.detalle,
       board_id = excluded.board_id, item_id = excluded.item_id, ultima_vez = excluded.ultima_vez,
       resuelto_at = NULL,
       notificado_at = CASE WHEN salud_hallazgo.resuelto_at IS NULL THEN salud_hallazgo.notificado_at ELSE NULL END`,
  ).bind(
    h.clave, h.tipo, h.severidad, h.titulo.slice(0, 500), h.detalle ? JSON.stringify(h.detalle).slice(0, 4000) : null,
    h.boardId ?? null, h.itemId ?? null, inicio, inicio,
  ));
  for (const lote of lotes(stmts, 50)) await env.DB.batch(lote);

  // Lo que no apareció en esta corrida ya no está: resuelto. Una revisión que
  // falló no resuelve sus propios hallazgos, y su propio "revision_fallida" se
  // resuelve solo cuando vuelve a correr bien.
  const noResolver = [...fallidas.flatMap(f => TIPOS_DE[f] ?? [])];
  const excluir = noResolver.length > 0 ? ` AND tipo NOT IN (${noResolver.map(() => '?').join(',')})` : '';
  await env.DB.prepare(`UPDATE salud_hallazgo SET resuelto_at = ? WHERE resuelto_at IS NULL AND ultima_vez < ?${excluir}`)
    .bind(inicio, inicio, ...noResolver).run();

  // Aviso: UNA notificación por corrida con los graves nuevos.
  const { results: nuevos } = await env.DB.prepare(
    `SELECT clave, titulo FROM salud_hallazgo WHERE resuelto_at IS NULL AND severidad = 'alta' AND notificado_at IS NULL ORDER BY primera_vez`,
  ).all<{ clave: string; titulo: string }>();
  const lista = nuevos ?? [];
  if (lista.length > 0) {
    const cuerpo = lista.slice(0, 5).map(n => `• ${n.titulo}`).join('\n')
      + (lista.length > 5 ? `\n… y ${lista.length - 5} más.` : '')
      + '\n\nDetalle completo: node scripts/salud.mjs (terminal) o GET /api/admin/salud.';
    for (const email of SALUD_AVISAR) {
      await emitNotification(env, {
        recipientEmail: email, severity: 'importante', kind: 'salud', wa: false,
        title: `Salud del portal: ${lista.length} problema(s) nuevo(s)`, body: cuerpo,
        dedupeKey: `salud:${inicio}:${email}`,
      });
    }
    for (const lote of lotes(lista.map(n => n.clave))) {
      await env.DB.prepare(`UPDATE salud_hallazgo SET notificado_at = ? WHERE clave IN (${lote.map(() => '?').join(',')})`)
        .bind(inicio, ...lote).run();
    }
  }

  const corte = new Date(ahora.getTime() - RETENCION_RESUELTOS_DIAS * 86_400_000).toISOString();
  await env.DB.prepare('DELETE FROM salud_hallazgo WHERE resuelto_at IS NOT NULL AND resuelto_at < ?').bind(corte).run();

  const { results: porTipo } = await env.DB.prepare(
    'SELECT tipo, COUNT(*) AS n FROM salud_hallazgo WHERE resuelto_at IS NULL GROUP BY tipo',
  ).all<{ tipo: string; n: number }>();
  return {
    revisadoAt: inicio, ms: Date.now() - t0, encontrados: hallazgos.length,
    abiertosPorTipo: Object.fromEntries((porTipo ?? []).map(r => [r.tipo, r.n])),
    nuevosAlta: lista.length, revisionesFallidas: fallidas,
  };
}

/** Cron de 15 min: la revisión corre una vez por hora (primer cuarto de hora
 * UTC). Nunca lanza: una falla queda en sync_log. */
export async function revisarSaludSiToca(env: Env, ahora = new Date()): Promise<void> {
  if (ahora.getUTCMinutes() >= 15) return;
  try {
    await revisarSalud(env);
  } catch (err) {
    await registrarError(env, 'salud', err);
  }
}

/** Lo que ve el admin (GET /api/admin/salud) y el script de la terminal. */
export async function reporteSalud(env: Env, horas: number) {
  await ensureSaludTable(env);
  const desde = new Date(Date.now() - horas * 3_600_000).toISOString();
  const { results: abiertos } = await env.DB.prepare(
    `SELECT clave, tipo, severidad, titulo, detalle, board_id, item_id, primera_vez, ultima_vez
       FROM salud_hallazgo WHERE resuelto_at IS NULL
      ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, ultima_vez DESC LIMIT 300`,
  ).all();
  const ultima = await env.DB.prepare('SELECT MAX(ultima_vez) AS t FROM salud_hallazgo').first<{ t: string | null }>();
  const { results: errores } = await env.DB.prepare(
    `SELECT CASE WHEN kind = 'error' AND detail LIKE 'front %' THEN 'front' ELSE kind END AS origen, COUNT(*) AS n, MAX(at) AS ultimo
       FROM sync_log WHERE ok = 0 AND at > ? GROUP BY origen ORDER BY n DESC`,
  ).bind(desde).all();
  const { results: ejemplos } = await env.DB.prepare(
    `SELECT at, kind, detail FROM sync_log WHERE ok = 0 AND kind IN ('error', 'http') AND at > ? ORDER BY id DESC LIMIT 25`,
  ).bind(desde).all();
  let rechazos: { ruta: string; status: number; detalle: string | null; n: number }[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT ruta, status, detalle, COUNT(*) AS n FROM accion_log WHERE status >= 400 AND at > ? GROUP BY ruta, status, detalle`,
    ).bind(desde).all<{ ruta: string; status: number; detalle: string | null; n: number }>();
    const m = new Map<string, { ruta: string; status: number; detalle: string | null; n: number }>();
    for (const r of results ?? []) {
      const k = `${normalizarRuta(r.ruta)}|${r.status}|${r.detalle ?? ''}`;
      const prev = m.get(k);
      m.set(k, { ruta: normalizarRuta(r.ruta), status: r.status, detalle: r.detalle, n: (prev?.n ?? 0) + r.n });
    }
    rechazos = [...m.values()].sort((a, b) => b.n - a.n).slice(0, 40);
  } catch { /* accion_log todavía no existe */ }
  const { results: outbox } = await env.DB.prepare(
    'SELECT status, COUNT(*) AS n FROM outbox WHERE updated_at > ? GROUP BY status',
  ).bind(desde).all();
  return { horas, ultimaRevision: ultima?.t ?? null, abiertos, errores, ejemplos, rechazos, outbox };
}
