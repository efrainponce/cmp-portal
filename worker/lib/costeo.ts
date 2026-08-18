// worker/lib/costeo.ts — "Mandar a costeo".
// Dos piezas (Efraín 2026-07-15): checkCosteo = validación local de solo lectura
// (la UI deshabilita el botón y lista lo que falta), y enviarACosteo = dispara el
// flujo REAL de cmp-tallas (validar_costeo: snapshot de costos, reparación de
// embellecimiento, PDF de solicitud de costeo, deal_stage→"En costeo" o rechazo
// automático). El portal ya no cambia el stage por su cuenta — es 100% el mismo
// flujo que el botón "Solicitar costeo" de Monday.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { postUpdate } from './nativeUpdates';
import { getItem, childrenOf, linkedItemId, ownsItem } from './dal';
import { hydrateFichaLineas } from './ficha';
import { validarCosteo } from './automations';
import { submitWrite } from './outbox';
import { gql, moveItemToGroup, fetchItemWithSubitems, cvText, cvNum, type MondayCol } from './monday';
import { BOARDS } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import type { RawCol } from './serialize';
import {
  EMB_STATUS_COL, EMB_LABEL_CON, explodeEmbellecimiento,
  repairEmbellecimiento, embellecimientoTemplateError,
} from '../../shared/embellecimiento';

// Oportunidades subitems (18395657607) — ids de docs/monday-column-map.md.
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_COLORES_DISP = 'lookup_mkznm0h3';       // mirror: colores del producto
const SUB_PRODUCTO_REL = 'board_relation_mkzmafgp';
const SUB_PRODUCTO_TXT = 'text_mm0bkm1j';
const SUB_FICHA = 'lookup_mm0xw8p7';              // ficha comercial (validar_costeo la exige)
const SUB_ETAPA_COSTEO = 'color_mm084gvf';        // Etapa Costeo por línea
const SUB_EMB_DESC = 'long_text_mm1bj4pt';        // descripción de posiciones de embellecimiento

// Oportunidad
const OPP_INSTITUCION = 'lookup_mm1bs976';        // validar_costeo rechaza sin institución

// Snapshot nativo de costeo (Fase 1, plan "salir de Monday" 2026-08-12) — mismos ids
// que validar_costeo.py, verificados contra shared/column-meta.gen.ts (sección
// "oportunidades_sub"). SCOL_* = lecturas (lookup/mirror del catálogo/línea); SNAP_* =
// columnas EDITABLES donde se congela el valor al momento de costear.
const SCOL_COSTO = 'lookup_mm5ck4b3';            // Costo (auto)
const SCOL_MONEDA = 'lookup_mm11t8gj';           // Moneda
const SCOL_DESCUENTO = 'lookup_mm0bdwb5';        // Descuento (auto) — fracción 0-1
const SCOL_GASTOS = 'lookup_mm0bbz02';           // Gastos % (auto) — fracción 0-1
const SCOL_PRODUCTO_NOMBRE = 'lookup_mm0x4kda';  // Nombre del Producto (mirror)
const SCOL_SKU = 'lookup_mkzn7x9a';              // SKU (auto)
const SNAP_NOMBRE = SUB_PRODUCTO_TXT;            // 'text_mm0bkm1j' — mismo id, doble uso
const SNAP_SKU = 'text_mm0bxy39';
const SNAP_COSTO = 'numeric_mm0bph99';
const SNAP_DESC_PCT = 'numeric_mkzn2q51';
const SNAP_GAST_PCT = 'numeric_mkzngs9x';
const SNAP_IVA = 'numeric_mm0cg0bm';
const SNAP_TC = 'numeric_mm0rvhgs';
const SNAP_PRECIO = 'numeric_mm2qzzbe';          // "Precio de Venta (formula)" — DISTINTO
                                                  // de numeric_mkzneg3d (Precio de Venta
                                                  // C/U, solo-admin, shared/visibility.ts).

// Oportunidad — reject/accept del flujo nativo.
const OPP_FOLIO = 'pulse_id_mm0qcq0m';
const GROUP_EN_COSTEO = 'group_mkzmdg9c'; // "Oportunidades en Costeo" (validar_costeo.py)

// Productos (18395657591) — checkbox creada 2026-07-18, docs/monday-column-map.md.
const PRODUCTO_CONFIRM_COL = 'boolean_mm5cqtjs';  // "Descripción y tallas confirmadas"
// Tallas — lista simple ("S,M,XL" / "unitalla"), reemplazó el JSON por género
// (long_text_mm174q0j) el 2026-08-03. El llenado automático deja el literal
// "error" cuando no pudo determinar tallas del texto libre del producto — eso
// tampoco cuenta como válido aunque Compras haya marcado el checkbox de arriba.
const PRODUCTO_TALLAS_COL = 'text_mm5v6jhj';
// Proveedor del producto (Efraín, 2026-08-04: "la línea de proveedor la debe
// llenar compras en costeo, y no puede pasar si no tiene proveedor") — mismo
// patrón que Tallas: vive en el catálogo por SKU, se edita desde el panel de
// detalle de línea en Costeo (LineDetailPanel.tsx) y bloquea "Mandar a
// Validación de costeo" mientras falte. Se copia al Proyecto al capturar
// tallas (worker/lib/proyectoTallas.ts).
const PRODUCTO_PROVEEDOR_COL = 'board_relation_mm1cwqky';

const ETAPA_NO_INICIADO = 'No iniciado';

const STAGE_BLOCKED: Record<string, string> = {
  '15': 'La oportunidad ya está en costeo.',
  '7': 'La oportunidad ya está en validación de costeo.',
  '1': 'La oportunidad ya está Ganada.',
  '2': 'La oportunidad ya está Perdida.',
  '5': 'La oportunidad está Cancelada.',
};

// Costeo (15) → Costeo en validación (7): sin endpoint de cmp-tallas para este
// paso (docs/cmp-tallas-endpoint-map.md — "sin endpoint, cambio de stage
// manual"), así que el portal escribe deal_stage directo, sin el gate de
// canWrite (Efraín 2026-07-16: avance manual de Compras, sin validación extra).
const STAGE_EN_COSTEO = '15';
const DEAL_STAGE_VALIDACION_LABEL = 'Costeo en validación';

export class CosteoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

// Comparación tolerante: sin acentos, sin mayúsculas, sin espacios sobrantes —
// "Azul Marino" debe contar como "azul marino".
function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function hasLinkedProduct(col?: RawCol): boolean {
  if (!col?.value) return false;
  try {
    const ids = (JSON.parse(col.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
    return ids.length > 0;
  } catch {
    return false;
  }
}

/** Errores de una línea de producto; [] cuando la línea está lista para costeo.
 * Espejo local de las validaciones de cmp-tallas/api/validar_costeo.py.
 * `partida` es el número 1-based de la línea en la grid — las líneas nuevas
 * nacen todas con el nombre literal "Nueva línea" (worker/routes/oportunidades.ts),
 * así que sin esto varios errores idénticos no dicen cuál línea es cuál
 * (Efraín, 2026-07-20). */
export function validateLinea(name: string, cols: Map<string, RawCol>, partida: number): string[] {
  const errors: string[] = [];
  const tag = `#${partida} "${name}"`;

  if (!hasLinkedProduct(cols.get(SUB_PRODUCTO_REL)) && !(cols.get(SUB_PRODUCTO_TXT)?.text ?? '').trim()) {
    errors.push(`${tag}: no tiene producto asignado.`);
  }

  const cantidad = Number((cols.get(SUB_CANTIDAD)?.text ?? '').replace(/,/g, ''));
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    errors.push(`${tag}: falta la cantidad.`);
  }

  const color = (cols.get(SUB_COLOR)?.text ?? '').trim();
  const disponibles = (cols.get(SUB_COLORES_DISP)?.text ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!color) {
    errors.push(`${tag}: falta elegir un color.`);
  } else if (disponibles.length > 0 && !disponibles.some(d => norm(d) === norm(color))) {
    errors.push(`${tag}: el color "${color}" no está en la lista del producto (${disponibles.join(', ')}).`);
  }

  if (!(cols.get(SUB_FICHA)?.text ?? '').trim()) {
    errors.push(`${tag}: falta la ficha comercial (Compras debe subirla al catálogo).`);
  }

  const embStatus = (cols.get(EMB_STATUS_COL)?.text ?? '').trim();
  if (embStatus === EMB_LABEL_CON && explodeEmbellecimiento(cols.get(SUB_EMB_DESC)?.text, true).length === 0) {
    errors.push(`${tag}: está marcada "Con Embellecimiento" pero no tiene ninguna posición capturada (tab Embellecimientos).`);
  }

  return errors;
}

export interface EnviarCosteoResult {
  ok: boolean;
  errors?: string[];
  /** Folio del PDF de costeo generado, cuando ok. */
  folio?: string;
  /** true cuando el flujo real (nativo o cmp-tallas) llegó a correr y escribió en
   * Monday, incluso si rechazó (revierte deal_stage + postea el update) — a
   * diferencia de un rechazo del pre-chequeo LOCAL (checkCosteo), que nunca toca
   * Monday. El caller (worker/routes/oportunidades.ts) lo usa para decidir si
   * vale la pena refrescar el mirror. */
  mutated?: boolean;
}

/** Validación de solo lectura (sin ningún efecto): la UI la usa para deshabilitar
 * el botón y mostrar la lista de pendientes antes de que alguien pueda dar click. */
export async function checkCosteo(env: Env, itemId: number, viewer: Identity): Promise<EnviarCosteoResult> {
  const item = await getItem(env, 'oportunidades', itemId, viewer);
  if (!item) throw new CosteoError(404, 'not found');

  const cols = colsOf(item);
  const stageCol = cols.get('deal_stage');
  let stageIndex = '';
  try {
    stageIndex = String((JSON.parse(stageCol?.value ?? 'null') as { index?: unknown })?.index ?? '');
  } catch { /* value optimista o vacío — no bloquea */ }
  if (STAGE_BLOCKED[stageIndex]) return { ok: false, errors: [STAGE_BLOCKED[stageIndex]] };

  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);

  // Después de "Nueva oportunidad", el botón vive siempre visible pero solo se
  // reactiva cuando el vendedor duplicó una nueva versión (Efraín, 2026-07-17):
  // duplicateVersion regresa la Etapa Costeo de todas las líneas a "No iniciado"
  // y las líneas nuevas nacen sin ella — si TODAS ya están costeadas, la vigente
  // es la que ya pasó por costeo y no hay nada que reenviar.
  if (stageIndex && stageIndex !== '4' && lineas.length > 0) {
    const pendiente = lineas.some(l => {
      const etapa = (colsOf(l).get(SUB_ETAPA_COSTEO)?.text ?? '').trim();
      return !etapa || etapa === ETAPA_NO_INICIADO;
    });
    if (!pendiente) {
      return { ok: false, errors: ['La cotización vigente ya se costeó — crea una nueva versión para regresarla a costeo.'] };
    }
  }

  const errors: string[] = [];

  if (!(cols.get(OPP_INSTITUCION)?.text ?? '').trim()) {
    errors.push('Asigna una institución a la oportunidad.');
  }

  if (lineas.length === 0) {
    errors.push('La oportunidad no tiene líneas de producto. Agrega al menos una.');
  } else {
    errors.push(...lineas.flatMap((l, i) => validateLinea(l.name, colsOf(l), i + 1)));
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** Convierte el texto "checks" de validar_costeo (una línea por producto) en la
 * lista de errores legibles — solo las líneas con problemas. */
function checksToErrors(checks: unknown): string[] {
  if (typeof checks !== 'string' || !checks.trim()) return [];
  return checks.split('\n').filter(line => line.includes('⚠️'));
}

// ═══════════════════════════════════════════════════════════════════════════
// Flujo nativo de "Mandar a costeo" (Fase 1, plan "salir de Monday",
// 2026-08-12) — reimplementa validar_costeo.py 1:1: snapshot de costos,
// reparación+validación de embellecimiento, reject/accept, mueve
// deal_stage+grupo. Ya NO llama a Eledo para el PDF (ver
// worker/routes/oportunidades.ts::generarSolicitudCosteo — el PDF propio del
// portal, worker/lib/documents.ts, pasa a ser el oficial). Gateado por
// env.COSTEO_NATIVE mientras corre en paralelo contra oportunidades reales.
// ═══════════════════════════════════════════════════════════════════════════

interface SnapshotValues {
  nombre: string;
  sku: string;
  costo: number;
  descPct: number;
  gastPct: number;
  tc: number;
  precio: number;
}

/** precio = (1+gastos%)·(costo·(1-desc%))·TC·1.3 — TC=18 si Moneda es USD, 1 si no.
 * Mirror 1:1 de validar_costeo.py's compute_snapshot_values. */
export function computeSnapshot(cols: MondayCol[]): SnapshotValues {
  const costo = cvNum(cols, SCOL_COSTO);
  const descFrac = cvNum(cols, SCOL_DESCUENTO);
  const gastosFrac = cvNum(cols, SCOL_GASTOS);
  const tc = cvText(cols, SCOL_MONEDA).toUpperCase() === 'USD' ? 18 : 1;
  const precio = Math.round((1 + gastosFrac) * (costo * (1 - descFrac)) * tc * 1.3 * 100) / 100;
  return {
    nombre: cvText(cols, SCOL_PRODUCTO_NOMBRE),
    sku: cvText(cols, SCOL_SKU),
    costo, descPct: Math.round(descFrac * 100), gastPct: Math.round(gastosFrac * 100), tc, precio,
  };
}

async function writeSubitemCols(env: Env, subId: string, cols: Record<string, string>): Promise<void> {
  await gql(
    env,
    `mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
    { b: String(BOARDS.oportunidades_sub.id), i: subId, cv: JSON.stringify(cols) },
  );
}

function writeSnapshot(env: Env, subId: string, snap: SnapshotValues): Promise<void> {
  return writeSubitemCols(env, subId, {
    [SNAP_NOMBRE]: snap.nombre,
    [SNAP_SKU]: snap.sku,
    [SNAP_COSTO]: String(snap.costo),
    [SNAP_DESC_PCT]: String(snap.descPct),
    [SNAP_GAST_PCT]: String(snap.gastPct),
    [SNAP_IVA]: '16',
    [SNAP_TC]: String(snap.tc),
    [SNAP_PRECIO]: String(snap.precio),
  });
}

interface SubitemCheck {
  ok: boolean;
  line: string;
  embellRepairedText?: string;
}

/** Valida una línea contra las mismas 4 reglas que validar_costeo.py's
 * validate_subitems: cantidad>0, color en la lista del producto, ficha comercial
 * presente, embellecimiento (con auto-reparación) completo. `nombre` ya resuelto
 * por el caller (snapshot recién escrito o, si la línea ya estaba costeada, el
 * nombre ya congelado en SNAP_NOMBRE). */
export function checkSubitemNative(cols: MondayCol[], nombre: string): SubitemCheck {
  const errs: string[] = [];

  if (cvNum(cols, SUB_CANTIDAD) <= 0) errs.push('⚠️ Cantidad incorrecta.');

  const disponibles = cvText(cols, SUB_COLORES_DISP);
  const color = cvText(cols, SUB_COLOR).toLowerCase();
  if (disponibles) {
    const opciones = disponibles.split(',').map(s => s.trim().toLowerCase());
    if (!color) errs.push('⚠️ Color no especificado.');
    else if (!opciones.includes(color)) errs.push('⚠️ Verificar color.');
  }

  if (!cvText(cols, SUB_FICHA)) errs.push('⚠️ Falta la ficha comercial (Compras debe subirla al catálogo).');

  let embellText = cvText(cols, SUB_EMB_DESC);
  const repair = repairEmbellecimiento(embellText);
  if (repair.repaired) embellText = repair.text;
  const embellErr = embellecimientoTemplateError(embellText);
  if (embellErr) errs.push(`⚠️ ${embellErr}`);

  const repairedNote = repair.repaired && errs.length === 0 ? ' (embellecimiento reparado ✅)' : '';
  return {
    ok: errs.length === 0,
    line: errs.length ? `${nombre}: ${errs.join(' ')}` : `${nombre}: ✅ OK${repairedNote}`,
    embellRepairedText: repair.repaired ? repair.text : undefined,
  };
}

async function rejectCosteoNative(env: Env, itemId: number, body: string): Promise<void> {
  await gql(
    env,
    `mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
    { b: String(BOARDS.oportunidades.id), i: String(itemId), cv: JSON.stringify({ deal_stage: { label: 'Nueva oportunidad' } }) },
  );
  await postUpdate(env, BOARDS.oportunidades.id, itemId, `⛔ Solicitud de costeo rechazada.\n\n${body}`);
}

// Folio propio del costeo nativo — reemplaza el conteo de archivos en
// file_mm10k65a que hacía validar_costeo.py (frágil/racy): un contador por
// oportunidad en D1, incrementado en cada envío exitoso. Lazy, mismo patrón
// que ensureDocumentTables (worker/lib/documents.ts).
let costeoFolioTableReady = false;
async function nextCosteoSeq(env: Env, itemId: number): Promise<number> {
  if (!costeoFolioTableReady) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS costeo_folios (item_id INTEGER PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0)`,
    ).run();
    costeoFolioTableReady = true;
  }
  await env.DB.prepare(
    `INSERT INTO costeo_folios (item_id, seq) VALUES (?, 1)
     ON CONFLICT(item_id) DO UPDATE SET seq = seq + 1`,
  ).bind(itemId).run();
  const row = await env.DB.prepare(`SELECT seq FROM costeo_folios WHERE item_id = ?`).bind(itemId).first<{ seq: number }>();
  return row?.seq ?? 1;
}

async function runCosteoNative(env: Env, itemId: number): Promise<EnviarCosteoResult> {
  const fetched = await fetchItemWithSubitems(env, itemId);
  if (!fetched) throw new CosteoError(404, 'not found');
  const { item, subitems } = fetched;

  if (subitems.length === 0) {
    await rejectCosteoNative(env, itemId, 'La oportunidad no tiene productos.');
    return { ok: false, errors: ['La oportunidad no tiene productos.'], mutated: true };
  }

  // 1) Snapshot de costos — solo líneas todavía "No iniciado" (una vez costeada,
  // el valor queda congelado aunque el catálogo/costo cambien después).
  const toSnapshot = subitems.filter(s => cvText(s.column_values, SUB_ETAPA_COSTEO) === ETAPA_NO_INICIADO);
  const snapOverrides = new Map<string, SnapshotValues>();
  for (const s of toSnapshot) snapOverrides.set(s.id, computeSnapshot(s.column_values));
  if (toSnapshot.length > 0) {
    const results = await Promise.allSettled(toSnapshot.map(s => writeSnapshot(env, s.id, snapOverrides.get(s.id)!)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length > 0) {
      throw new CosteoError(502, `No se pudieron guardar ${failed.length} snapshot(s) de subitems: ${String(failed[0].reason)}`);
    }
  }

  // 1.5) Este flujo valida contra la lectura FRESCA de Monday, no contra el
  // mirror: si la ficha comercial no se ha recalculado allá, se resuelve igual
  // desde el catálogo (worker/lib/ficha.ts). Sin esto el envío se rechaza —y
  // revierte la etapa— por una columna que Monday no había calculado todavía.
  await hydrateFichaLineas(env, subitems);

  // 2) Validar cada línea (con auto-reparación de embellecimiento detectada, no
  // escrita todavía — se escribe en el paso 3, en paralelo).
  const lines: string[] = [];
  let hasErrors = false;
  const embellRepairs: { id: string; text: string; nombre: string }[] = [];
  for (const sub of subitems) {
    const override = snapOverrides.get(sub.id);
    const nombre = override?.nombre || cvText(sub.column_values, SNAP_NOMBRE) || sub.name;
    const check = checkSubitemNative(sub.column_values, nombre);
    lines.push(check.line);
    if (!check.ok) hasErrors = true;
    if (check.embellRepairedText !== undefined) embellRepairs.push({ id: sub.id, text: check.embellRepairedText, nombre });
  }

  // 3) Escribir las reparaciones de embellecimiento detectadas — un fallo aquí
  // también rechaza el envío (mismo criterio que validar_costeo.py).
  if (embellRepairs.length > 0) {
    const results = await Promise.allSettled(embellRepairs.map(r => writeSubitemCols(env, r.id, { [SUB_EMB_DESC]: r.text })));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        hasErrors = true;
        lines.push(`⚠️ No se pudo reparar el embellecimiento del subitem ${embellRepairs[i].id}: ${String(r.reason)}`);
      }
    });
  }

  // 4) Reject o accept.
  const institucion = cvText(item.column_values, OPP_INSTITUCION);
  const shouldReject = hasErrors || !institucion;
  if (shouldReject) {
    const checksText = lines.join('\n');
    await rejectCosteoNative(env, itemId, hasErrors ? checksText : '⚠️ Asigna una institución.');
    const errors = hasErrors ? checksToErrors(checksText) : ['Asigna una institución.'];
    return { ok: false, errors: errors.length ? errors : ['La solicitud de costeo fue rechazada.'], mutated: true };
  }

  const seq = await nextCosteoSeq(env, itemId);
  const folioBase = cvText(item.column_values, OPP_FOLIO) || String(itemId);
  const folio = `${folioBase} : Costeo ${seq}`;

  await gql(
    env,
    `mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
    { b: String(BOARDS.oportunidades.id), i: String(itemId), cv: JSON.stringify({ deal_stage: { label: 'En costeo' } }) },
  );
  // Best-effort: mover de grupo es organización visual, nunca debe tumbar el envío.
  try { await moveItemToGroup(env, itemId, GROUP_EN_COSTEO); } catch { /* best-effort */ }
  if (embellRepairs.length > 0) {
    try {
      await postUpdate(env, BOARDS.oportunidades.id, itemId, `✅ Se corrigió el embellecimiento de: ${embellRepairs.map(r => r.nombre).join(', ')}.`);
    } catch { /* best-effort */ }
  }

  return { ok: true, folio };
}

/** Escribe varias columnas de una línea nativa directo en D1 (read-modify-write
 * simple, sin la merge atómica JSON1 de outbox.ts — esto es cómputo interno del
 * servidor sobre una línea a la vez, no un PATCH de usuario que pueda competir
 * con otro concurrente). `text` es lo único que le importa a cvNum/cvText
 * (worker/lib/monday.ts) y a todo lo que lee snapshots después; `value` solo
 * necesita ser JSON válido. */
async function writeNativeLineCols(env: Env, lineId: number, patch: Record<string, { type: string; text: string }>): Promise<void> {
  const row = await env.DB
    .prepare(`SELECT columns FROM items WHERE board_id = ? AND item_id = ?`)
    .bind(BOARDS.oportunidades_sub.id, lineId)
    .first<{ columns: string }>();
  const existing: RawCol[] = row ? JSON.parse(row.columns || '[]') : [];
  const byId = new Map(existing.map(c => [c.id, c]));
  for (const [id, v] of Object.entries(patch)) {
    byId.set(id, { id, type: v.type, text: v.text, value: JSON.stringify(v.text) });
  }
  await env.DB
    .prepare(`UPDATE items SET columns = ?, synced_at = ? WHERE board_id = ? AND item_id = ?`)
    .bind(JSON.stringify([...byId.values()]), new Date().toISOString(), BOARDS.oportunidades_sub.id, lineId)
    .run();
}

// "Mandar a costeo" para una oportunidad nativa (Zona Efrain, "salir de
// Monday") — versión simplificada a propósito (Efraín, 2026-08-13: los checks
// elaborados de runCosteoNative de abajo —reparación de embellecimiento,
// mover de grupo, posts de update— compensaban no tener otra forma de
// validar; acá `checkCosteo` YA corrió antes (D1, mismo pre-chequeo que el
// flujo real) así que no hay que repetirlo). Solo congela el snapshot de
// costo/precio por línea (dato financiero real) y mueve la etapa.
async function runCosteoNativeD1(
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity,
): Promise<EnviarCosteoResult> {
  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  if (lineas.length === 0) return { ok: false, errors: ['La oportunidad no tiene productos.'] };

  for (const linea of lineas) {
    const cols: MondayCol[] = JSON.parse(linea.columns || '[]');
    const etapa = (cols.find(c => c.id === SUB_ETAPA_COSTEO)?.text ?? '').trim();
    if (etapa && etapa !== ETAPA_NO_INICIADO) continue; // ya costeada — no recongelar
    const snap = computeSnapshot(cols);
    await writeNativeLineCols(env, linea.item_id, {
      [SNAP_NOMBRE]: { type: 'text', text: snap.nombre },
      [SNAP_SKU]: { type: 'text', text: snap.sku },
      [SNAP_COSTO]: { type: 'numeric', text: String(snap.costo) },
      [SNAP_DESC_PCT]: { type: 'numeric', text: String(snap.descPct) },
      [SNAP_GAST_PCT]: { type: 'numeric', text: String(snap.gastPct) },
      [SNAP_IVA]: { type: 'numeric', text: '16' },
      [SNAP_TC]: { type: 'numeric', text: String(snap.tc) },
      [SNAP_PRECIO]: { type: 'numeric', text: String(snap.precio) },
    });
  }

  const seq = await nextCosteoSeq(env, itemId);
  const item = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  const folioBase = colsOf(item!).get(OPP_FOLIO)?.text || String(itemId);
  const folio = `${folioBase} : Costeo ${seq}`;

  await submitWrite(env, ctx, 'oportunidades', itemId, { deal_stage: 'En costeo' }, viewer, { trusted: true });

  return { ok: true, folio };
}

export async function enviarACosteo(
  env: Env,
  ctx: ExecutionContext,
  itemId: number,
  viewer: Identity,
): Promise<EnviarCosteoResult> {
  // Mandar a costeo MUTA (stage, snapshots, PDF): exige que la oportunidad sea del
  // viewer mismo, no de su zona. checkCosteo de abajo corre con scope de lectura,
  // así que sin este guard un líder podría disparar el flujo sobre lo de su equipo.
  if (!(await ownsItem(env, 'oportunidades', itemId, viewer))) throw new CosteoError(404, 'not found');

  // Pre-chequeo local: respuesta instantánea y sin tocar Monday cuando falta algo.
  const pre = await checkCosteo(env, itemId, viewer);
  if (!pre.ok) return pre;

  if (isNativeId(itemId)) return runCosteoNativeD1(env, ctx, itemId, viewer);

  if (env.COSTEO_NATIVE === '1') return runCosteoNative(env, itemId);

  // Flujo real de cmp-tallas — snapshotea, genera el PDF de costeo y mueve el stage.
  // Si rechaza, el endpoint mismo revierte a "Nueva oportunidad" y postea el update.
  const res = await validarCosteo(env, itemId, false);

  if (res.ok) {
    return { ok: true, folio: typeof res.folio_costeo === 'string' ? res.folio_costeo : undefined };
  }

  const errors = checksToErrors(res.checks);
  if (typeof res.reason === 'string' && res.reason) errors.push(res.reason);
  // cmp-tallas ya revirtió deal_stage + posteó el update aunque haya rechazado
  // (validar_costeo.py's reject_costeo) — no es un skip sin efecto.
  return { ok: false, errors: errors.length ? errors : ['La solicitud de costeo fue rechazada. Revisa el update en Monday.'], mutated: true };
}

/** Solo lectura: cada línea debe tener su producto de catálogo ligado y ese
 * producto debe traer "Descripción y tallas confirmadas" marcado por Compras
 * (boolean_mm5cqtjs, Productos 18395657591) — Efraín 2026-07-18: la ficha
 * (descripción/tallas) vive en el catálogo por SKU, no por línea de cotización,
 * así que la confirmación también se guarda ahí. Dedupe por producto: un SKU
 * repetido en varias líneas solo dispara un `getItem` de Productos. */
export async function checkValidacion(env: Env, itemId: number, viewer: Identity): Promise<EnviarCosteoResult> {
  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  // Sin líneas el loop de abajo nunca corre y devolvía ok — una oportunidad
  // vacía podía pasar a "Costeo en validación" (Efraín, 2026-07-24).
  if (lineas.length === 0) {
    return { ok: false, errors: ['La oportunidad no tiene líneas de producto.'] };
  }
  const errors: string[] = [];
  const productoCache = new Map<number, { confirmado: boolean; tallasOk: boolean; proveedorOk: boolean }>();

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const tag = `#${i + 1} "${linea.name}"`;
    const productoId = linkedItemId(linea, SUB_PRODUCTO_REL);
    if (productoId === null) {
      errors.push(`${tag}: sin producto de catálogo vinculado.`);
      continue;
    }
    if (!productoCache.has(productoId)) {
      const producto = await getItem(env, 'productos', productoId, viewer);
      const pCols = producto ? colsOf(producto) : undefined;
      const confirmado = !!pCols?.get(PRODUCTO_CONFIRM_COL)?.text;
      const tallas = (pCols?.get(PRODUCTO_TALLAS_COL)?.text ?? '').trim();
      const tallasOk = tallas !== '' && tallas.toLowerCase() !== 'error';
      const proveedorOk = hasLinkedProduct(pCols?.get(PRODUCTO_PROVEEDOR_COL));
      productoCache.set(productoId, { confirmado, tallasOk, proveedorOk });
    }
    const estado = productoCache.get(productoId)!;
    if (!estado.confirmado) {
      errors.push(`${tag}: descripción y tallas sin confirmar.`);
    }
    if (!estado.tallasOk) {
      errors.push(`${tag}: el producto no tiene tallas definidas en el catálogo.`);
    }
    if (!estado.proveedorOk) {
      errors.push(`${tag}: el producto no tiene proveedor asignado en el catálogo.`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** "Mandar a Validación de costeo" — botón de Compras en el board Costeo (etapa
 * 15). Sin validación de líneas de costeo (a diferencia de enviarACosteo): Compras
 * decide cuándo terminó de costear. Sí exige checkValidacion (descripción/tallas
 * confirmadas por producto) — Efraín 2026-07-18. */
export async function enviarAValidacion(
  env: Env,
  ctx: ExecutionContext,
  itemId: number,
  viewer: Identity,
): Promise<EnviarCosteoResult> {
  // scope 'own': muta el stage (ver worker/lib/zonas.ts).
  const item = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!item) throw new CosteoError(404, 'not found');

  const cols = colsOf(item);
  const stageCol = cols.get('deal_stage');
  let stageIndex = '';
  try {
    stageIndex = String((JSON.parse(stageCol?.value ?? 'null') as { index?: unknown })?.index ?? '');
  } catch { /* value optimista o vacío — no bloquea */ }
  if (stageIndex !== STAGE_EN_COSTEO) {
    return { ok: false, errors: ['La oportunidad no está en "En costeo".'] };
  }

  const confirm = await checkValidacion(env, itemId, viewer);
  if (!confirm.ok) return confirm;

  await submitWrite(env, ctx, 'oportunidades', itemId, { deal_stage: DEAL_STAGE_VALIDACION_LABEL }, viewer, { trusted: true });
  return { ok: true };
}
