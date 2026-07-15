// worker/lib/costeo.ts — "Mandar a costeo" con validaciones automáticas.
// Reglas (Efraín 2026-07-15, reducir errores desde el principio): la oportunidad
// debe tener ≥1 línea de producto, y cada línea necesita producto asignado,
// cantidad > 0 y un color elegido de la lista del catálogo ("Colores disponibles").
// Si todo pasa, la etapa cambia a "En costeo" vía el outbox (optimista + echo).
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { getItem, childrenOf } from './dal';
import { submitWrite } from './outbox';
import type { RawCol } from './serialize';

// Oportunidades subitems (18395657607) — ids de docs/monday-column-map.md.
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_COLORES_DISP = 'lookup_mkznm0h3';       // mirror: colores del producto
const SUB_PRODUCTO_REL = 'board_relation_mkzmafgp';
const SUB_PRODUCTO_TXT = 'text_mm0bkm1j';

const STAGE_BLOCKED: Record<string, string> = {
  '15': 'La oportunidad ya está en costeo.',
  '7': 'La oportunidad ya está en validación de costeo.',
};

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

/** Errores de una línea de producto; [] cuando la línea está lista para costeo. */
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

  return errors;
}

export interface EnviarCosteoResult { ok: boolean; errors?: string[] }

export async function enviarACosteo(
  env: Env,
  ctx: ExecutionContext,
  itemId: number,
  viewer: Identity,
): Promise<EnviarCosteoResult> {
  const item = await getItem(env, 'oportunidades', itemId, viewer);
  if (!item) throw new CosteoError(404, 'not found');

  const stageCol = colsOf(item).get('deal_stage');
  let stageIndex = '';
  try {
    stageIndex = String((JSON.parse(stageCol?.value ?? 'null') as { index?: unknown })?.index ?? '');
  } catch { /* value optimista o vacío — no bloquea */ }
  if (STAGE_BLOCKED[stageIndex]) return { ok: false, errors: [STAGE_BLOCKED[stageIndex]] };

  const lineas = await childrenOf(env, 'oportunidades', itemId, viewer);
  if (lineas.length === 0) {
    return { ok: false, errors: ['La oportunidad no tiene líneas de producto. Agrega al menos una antes de mandar a costeo.'] };
  }

  const errors = lineas.flatMap(l => validateLinea(l.name, colsOf(l)));
  if (errors.length > 0) return { ok: false, errors };

  await submitWrite(env, ctx, 'oportunidades', itemId, { deal_stage: 'En costeo' }, viewer, { trusted: true });
  return { ok: true };
}
