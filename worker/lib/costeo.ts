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
import { getItem, childrenOf, linkedItemId } from './dal';
import { validarCosteo } from './automations';
import { submitWrite } from './outbox';
import type { RawCol } from './serialize';

// Oportunidades subitems (18395657607) — ids de docs/monday-column-map.md.
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_COLORES_DISP = 'lookup_mkznm0h3';       // mirror: colores del producto
const SUB_PRODUCTO_REL = 'board_relation_mkzmafgp';
const SUB_PRODUCTO_TXT = 'text_mm0bkm1j';
const SUB_FICHA = 'lookup_mm0xw8p7';              // ficha comercial (validar_costeo la exige)
const SUB_ETAPA_COSTEO = 'color_mm084gvf';        // Etapa Costeo por línea

// Oportunidad
const OPP_INSTITUCION = 'lookup_mm1bs976';        // validar_costeo rechaza sin institución

// Productos (18395657591) — checkbox creada 2026-07-18, docs/monday-column-map.md.
const PRODUCTO_CONFIRM_COL = 'boolean_mm5cqtjs';  // "Descripción y tallas confirmadas"

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
 * Espejo local de las validaciones de cmp-tallas/api/validar_costeo.py. */
export function validateLinea(name: string, cols: Map<string, RawCol>): string[] {
  const errors: string[] = [];

  if (!hasLinkedProduct(cols.get(SUB_PRODUCTO_REL)) && !(cols.get(SUB_PRODUCTO_TXT)?.text ?? '').trim()) {
    errors.push(`"${name}": no tiene producto asignado.`);
  }

  const cantidad = Number((cols.get(SUB_CANTIDAD)?.text ?? '').replace(/,/g, ''));
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    errors.push(`"${name}": falta la cantidad.`);
  }

  const color = (cols.get(SUB_COLOR)?.text ?? '').trim();
  const disponibles = (cols.get(SUB_COLORES_DISP)?.text ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!color) {
    errors.push(`"${name}": falta elegir un color.`);
  } else if (disponibles.length > 0 && !disponibles.some(d => norm(d) === norm(color))) {
    errors.push(`"${name}": el color "${color}" no está en la lista del producto (${disponibles.join(', ')}).`);
  }

  if (!(cols.get(SUB_FICHA)?.text ?? '').trim()) {
    errors.push(`"${name}": falta la ficha comercial (Compras debe subirla al catálogo).`);
  }

  return errors;
}

export interface EnviarCosteoResult {
  ok: boolean;
  errors?: string[];
  /** Folio del PDF de costeo generado, cuando ok. */
  folio?: string;
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
    errors.push(...lineas.flatMap(l => validateLinea(l.name, colsOf(l))));
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** Convierte el texto "checks" de validar_costeo (una línea por producto) en la
 * lista de errores legibles — solo las líneas con problemas. */
function checksToErrors(checks: unknown): string[] {
  if (typeof checks !== 'string' || !checks.trim()) return [];
  return checks.split('\n').filter(line => line.includes('⚠️'));
}

export async function enviarACosteo(
  env: Env,
  itemId: number,
  viewer: Identity,
): Promise<EnviarCosteoResult> {
  // Pre-chequeo local: respuesta instantánea y sin tocar Monday cuando falta algo.
  const pre = await checkCosteo(env, itemId, viewer);
  if (!pre.ok) return pre;

  // Flujo real de cmp-tallas — snapshotea, genera el PDF de costeo y mueve el stage.
  // Si rechaza, el endpoint mismo revierte a "Nueva oportunidad" y postea el update.
  const res = await validarCosteo(env, itemId, false);

  if (res.ok) {
    return { ok: true, folio: typeof res.folio_costeo === 'string' ? res.folio_costeo : undefined };
  }

  const errors = checksToErrors(res.checks);
  if (typeof res.reason === 'string' && res.reason) errors.push(res.reason);
  return { ok: false, errors: errors.length ? errors : ['La solicitud de costeo fue rechazada. Revisa el update en Monday.'] };
}

/** Solo lectura: cada línea debe tener su producto de catálogo ligado y ese
 * producto debe traer "Descripción y tallas confirmadas" marcado por Compras
 * (boolean_mm5cqtjs, Productos 18395657591) — Efraín 2026-07-18: la ficha
 * (descripción/tallas) vive en el catálogo por SKU, no por línea de cotización,
 * así que la confirmación también se guarda ahí. Dedupe por producto: un SKU
 * repetido en varias líneas solo dispara un `getItem` de Productos. */
export async function checkValidacion(env: Env, itemId: number, viewer: Identity): Promise<EnviarCosteoResult> {
  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  const errors: string[] = [];
  const productoCache = new Map<number, boolean>(); // productoId -> confirmado

  for (const linea of lineas) {
    const productoId = linkedItemId(linea, SUB_PRODUCTO_REL);
    if (productoId === null) {
      errors.push(`"${linea.name}": sin producto de catálogo vinculado.`);
      continue;
    }
    if (!productoCache.has(productoId)) {
      const producto = await getItem(env, 'productos', productoId, viewer);
      const confirmado = !!producto && !!colsOf(producto).get(PRODUCTO_CONFIRM_COL)?.text;
      productoCache.set(productoId, confirmado);
    }
    if (!productoCache.get(productoId)) {
      errors.push(`"${linea.name}": descripción y tallas sin confirmar.`);
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
  const item = await getItem(env, 'oportunidades', itemId, viewer);
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
