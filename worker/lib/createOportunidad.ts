// worker/lib/createOportunidad.ts — create an Oportunidad + product-line subitems.
// Built for the WhatsApp bot but UI-agnostic (same shape as createRecord.ts).
// Column ids come from docs/monday-column-map.md / column-meta.gen.ts — never fabricate.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { createItem, createSubitem, gql } from './monday';
import { upsertItem } from '../sync';

export class OportunidadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Oportunidades (18395657596)
const COL_ETAPA = 'deal_stage';                     // status — initial "Nueva oportunidad"
const COL_VENDEDOR = 'deal_owner';                  // people — authz key
const COL_CONTACTO = 'deal_contact';                // board_relation → Contactos
const COL_FECHA_LIMITE = 'deal_expected_close_date';// date
const COL_ZONA = 'dropdown_mm03g067';               // dropdown

// Oportunidades subitems (18395657607)
const SUB_PRODUCTO_REL = 'board_relation_mkzmafgp'; // "Producto (auto)" → Productos; mirrors follow
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_COMENTARIOS = 'long_text_mm1hyszv';       // Comentarios Ventas

export interface LineaInput {
  /** Free-text product name (subitem name). */
  nombre: string;
  /** Productos board item_id when the line matches the catalog; omit for off-catalog. */
  productoItemId?: number;
  cantidad: number;
  color?: string;
  comentarios?: string;
}

export interface OportunidadInput {
  nombre: string;
  contactoItemId?: number;
  fechaLimite?: string;   // YYYY-MM-DD
  zona?: string;
  lineas: LineaInput[];
}

export interface OportunidadResult {
  ok: true;
  id: number;
  lineas: { id: number; nombre: string }[];
  /** False when Monday accepted the create but the contact link didn't land. */
  contactoVinculado: boolean;
  warnings: string[];
}

const CREATOR_ROLES: Identity['role'][] = ['vendedor', 'compras', 'admin'];

export async function createOportunidad(
  env: Env,
  input: OportunidadInput,
  viewer: Identity,
): Promise<OportunidadResult> {
  if (!CREATOR_ROLES.includes(viewer.role)) throw new OportunidadError(403, 'cannot create');
  if (!input.nombre?.trim()) throw new OportunidadError(400, 'nombre is required');
  if (!input.lineas?.length) throw new OportunidadError(400, 'at least one product line is required');
  for (const l of input.lineas) {
    if (!l.nombre?.trim()) throw new OportunidadError(400, 'every line needs a product name');
    if (!Number.isFinite(l.cantidad) || l.cantidad <= 0) {
      throw new OportunidadError(400, `invalid cantidad for "${l.nombre}"`);
    }
  }

  const cols: Record<string, unknown> = {
    [COL_ETAPA]: { label: 'Nueva oportunidad' },
    [COL_VENDEDOR]: { personsAndTeams: [{ id: viewer.monday_user_id, kind: 'person' }] },
  };
  if (input.contactoItemId) cols[COL_CONTACTO] = { item_ids: [Number(input.contactoItemId)] };
  if (input.fechaLimite?.trim()) cols[COL_FECHA_LIMITE] = { date: input.fechaLimite.trim() };
  if (input.zona?.trim()) cols[COL_ZONA] = { labels: [input.zona.trim()] };

  let item;
  try {
    item = await createItem(env, BOARDS.oportunidades.id, input.nombre.trim(), cols);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new OportunidadError(502, `monday create failed: ${detail}`);
  }
  await upsertItem(env, 'oportunidades', item);
  const itemId = Number(item.id);

  const warnings: string[] = [];
  const lineas: { id: number; nombre: string }[] = [];
  for (const l of input.lineas) {
    const subCols: Record<string, unknown> = { [SUB_CANTIDAD]: String(l.cantidad) };
    if (l.productoItemId) subCols[SUB_PRODUCTO_REL] = { item_ids: [Number(l.productoItemId)] };
    if (l.color?.trim()) subCols[SUB_COLOR] = l.color.trim();
    const comentarios = [
      l.comentarios?.trim(),
      l.productoItemId ? undefined : 'Producto fuera de catálogo (creado desde WhatsApp).',
    ].filter(Boolean).join(' ');
    if (comentarios) subCols[SUB_COMENTARIOS] = comentarios;

    try {
      const sub = await createSubitem(env, itemId, l.nombre.trim(), subCols);
      await upsertItem(env, 'oportunidades_sub', sub);
      lineas.push({ id: Number(sub.id), nombre: l.nombre.trim() });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      warnings.push(`La línea "${l.nombre}" no se pudo crear: ${detail}`);
    }
  }

  if (lineas.length === 0) {
    warnings.push('La oportunidad se creó pero ninguna línea de producto se pudo agregar.');
  }

  // deal_contact is a CRM-template relation: create_item's echo (and even text/value on
  // a refetch) stay null at first — but BoardRelationValue.linked_item_ids is reliable
  // immediately (verified live 2026-07-15). Query exactly that.
  let contactoVinculado = true;
  if (input.contactoItemId) {
    contactoVinculado = false;
    try {
      const data = await gql(env,
        `query($id:[ID!]){ items(ids:$id){ column_values(ids:["${COL_CONTACTO}"]){ ... on BoardRelationValue{linked_item_ids} } } }`,
        { id: [String(itemId)] },
      );
      const linked: string[] = data?.items?.[0]?.column_values?.[0]?.linked_item_ids ?? [];
      contactoVinculado = linked.includes(String(input.contactoItemId));
    } catch { /* verification is best-effort */ }
    if (!contactoVinculado) warnings.push('No pude confirmar el vínculo del contacto; revísalo en Monday.');
  }

  return { ok: true, id: itemId, lineas, contactoVinculado, warnings };
}
