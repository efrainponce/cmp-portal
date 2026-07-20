// worker/lib/dal.ts — all reads scoped by viewer. Handlers cannot bypass these predicates.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';
import { BOARDS } from '../../shared/boards';

interface Scope {
  where: string;
  binds: unknown[];
}

// admin/compras: everything. vendedor/almacen (and any other non-privileged role): rows
// whose owning board's authzCols include the viewer; subitem boards check the PARENT's
// owners. Boards without authzCols (productos/instituciones/contactos) are open to all
// (the serializer still strips columns per-role — shared/visibility.ts).
function scopeFor(slug: BoardSlug, viewer: Identity): Scope {
  if (viewer.role === 'admin' || viewer.role === 'compras') return { where: '1=1', binds: [] };

  const board = BOARDS[slug];
  const owningBoard = board.parent ? BOARDS[board.parent] : board;
  if (!owningBoard.authzCols || owningBoard.authzCols.length === 0) return { where: '1=1', binds: [] };

  if (board.parent) {
    return {
      where: `EXISTS (
        SELECT 1 FROM items p, json_each(p.vendedor_ids) je
        WHERE p.board_id = ? AND p.item_id = items.parent_item_id AND je.value = ?
      )`,
      binds: [owningBoard.id, viewer.monday_user_id],
    };
  }
  return {
    where: `EXISTS (SELECT 1 FROM json_each(items.vendedor_ids) je WHERE je.value = ?)`,
    binds: [viewer.monday_user_id],
  };
}

export function childSlugOf(slug: BoardSlug): BoardSlug | undefined {
  return (Object.keys(BOARDS) as BoardSlug[]).find(k => BOARDS[k].parent === slug);
}

// Columns whose `text` participates in search beyond the item name (JSON, so
// json_each over `columns` finds them regardless of board — other boards simply
// have no matching id). Vendedor/Compras + Institución/Folio/Contacto: users
// search by client or institution name ("zeus"), not just the item name.
const SEARCHABLE_COLS = [
  'deal_owner', 'multiple_person_mm03qyw9',        // Vendedor / Compras
  'lookup_mm1bs976', 'pulse_id_mm0qcq0m', 'deal_contact', // Institución / Folio / Contacto
];

export async function listItems(env: Env, slug: BoardSlug, viewer: Identity, q?: string): Promise<MirrorItem[]> {
  const board = BOARDS[slug];
  const scope = scopeFor(slug, viewer);
  const binds: unknown[] = [board.id, ...scope.binds];
  let sql = `SELECT * FROM items WHERE board_id = ? AND (${scope.where})`;
  if (q) {
    const placeholders = SEARCHABLE_COLS.map(() => '?').join(',');
    sql += ` AND (
      name LIKE ? COLLATE NOCASE
      OR EXISTS (
        SELECT 1 FROM json_each(items.columns) je
        WHERE json_extract(je.value, '$.id') IN (${placeholders})
          AND json_extract(je.value, '$.text') LIKE ? COLLATE NOCASE
      )
    )`;
    binds.push(`%${q}%`, ...SEARCHABLE_COLS, `%${q}%`);
  }
  sql += ' ORDER BY name LIMIT 4000';
  const res = await env.DB.prepare(sql).bind(...binds).all<MirrorItem>();
  return res.results ?? [];
}

// Returns null (never throws) when the item doesn't exist OR isn't owned by viewer —
// callers must answer 404, not 403, so ownership never leaks.
export async function getItem(env: Env, slug: BoardSlug, itemId: number, viewer: Identity): Promise<MirrorItem | null> {
  const board = BOARDS[slug];
  const scope = scopeFor(slug, viewer);
  const sql = `SELECT * FROM items WHERE board_id = ? AND item_id = ? AND (${scope.where})`;
  const row = await env.DB.prepare(sql).bind(board.id, itemId, ...scope.binds).first<MirrorItem>();
  return row ?? null;
}

export async function childrenOf(env: Env, parentSlug: BoardSlug, itemId: number, viewer: Identity): Promise<MirrorItem[]> {
  const childSlug = childSlugOf(parentSlug);
  if (!childSlug) return [];
  const childBoard = BOARDS[childSlug];
  const scope = scopeFor(childSlug, viewer);
  const sql = `SELECT * FROM items WHERE board_id = ? AND parent_item_id = ? AND (${scope.where}) ORDER BY name`;
  const res = await env.DB.prepare(sql).bind(childBoard.id, itemId, ...scope.binds).all<MirrorItem>();
  return res.results ?? [];
}

// El Proyecto ligado a una Oportunidad (Proyectos board_relation_mm0hf0y3 →
// Oportunidad). Filtra por LIKE sobre el JSON de columnas y verifica en JS que
// linked_item_ids realmente contenga el id (el LIKE solo es el índice barato).
// El scoping del viewer aplica igual que en getItem: si el vendedor no está en
// los authzCols del Proyecto, para él no existe (null, nunca 403).
export const PROYECTO_OPP_REL = 'board_relation_mm0hf0y3';

/** Primer id ligado de una columna board_relation en un row ya cargado del
 * mirror ({linked_item_ids:[...]} — ver worker/lib/monday.ts normalizeCols).
 * null si la columna viene vacía o el mirror aún no la capturó (stale). */
export function linkedItemId(row: MirrorItem, colId: string): number | null {
  try {
    const cols: { id: string; value?: string | null }[] = JSON.parse(row.columns || '[]');
    const rel = cols.find(c => c.id === colId);
    if (!rel?.value) return null;
    const ids: unknown[] = (JSON.parse(rel.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
    const first = ids.map(Number).find(Number.isFinite);
    return first ?? null;
  } catch {
    return null;
  }
}

export async function proyectoForOportunidad(env: Env, oppItemId: number, viewer: Identity): Promise<MirrorItem | null> {
  const scope = scopeFor('proyectos', viewer);
  const sql = `SELECT * FROM items WHERE board_id = ? AND columns LIKE ? AND (${scope.where}) LIMIT 20`;
  const res = await env.DB
    .prepare(sql)
    .bind(BOARDS.proyectos.id, `%${oppItemId}%`, ...scope.binds)
    .all<MirrorItem>();

  for (const row of res.results ?? []) {
    try {
      const cols: { id: string; value?: string | null }[] = JSON.parse(row.columns || '[]');
      const rel = cols.find(c => c.id === PROYECTO_OPP_REL);
      if (!rel?.value) continue;
      const ids: unknown[] = (JSON.parse(rel.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
      if (ids.some(id => Number(id) === oppItemId)) return row;
    } catch { /* fila con columns corruptas — se ignora */ }
  }
  return null;
}

// Must fold in the viewer's scope: scopeFor() returns a different row set per
// viewer, so an ETag keyed only on the board (count + max synced_at) collides
// across viewers whenever the board itself hasn't changed — a 304 then makes
// the requester (or their browser's own HTTP cache) reuse another viewer's
// response body. Concretely: any two vendedores with different visible rows
// would get the same board-only ETag and could 304 off each other's cached
// list. 'admin'/'compras' share one scope key since scopeFor() gives them the
// same unrestricted row set.
export async function etagFor(env: Env, slug: BoardSlug, viewer: Identity): Promise<string> {
  const board = BOARDS[slug];
  const row = await env.DB
    .prepare('SELECT COUNT(*) as c, MAX(synced_at) as m FROM items WHERE board_id = ?')
    .bind(board.id)
    .first<{ c: number; m: string | null }>();
  const scopeKey = viewer.role === 'admin' || viewer.role === 'compras' ? 'all' : `u${viewer.monday_user_id}`;
  return `"${slug}:${scopeKey}:${row?.c ?? 0}:${row?.m ?? ''}"`;
}

// role: 'vendedor' (default) o 'compras' — alimenta los selects de personas del
// form de nueva oportunidad. Cualquier otro valor cae a 'vendedor'. Los admins
// siempre se incluyen en ambas listas (pueden ser dueños de una oportunidad o
// responsables de compras aunque su fila de identity sea role='admin' — pedido
// de Efraín, 2026-07-20).
export async function listVendedores(env: Env, role: string = 'vendedor'): Promise<{ monday_user_id: number; nombre: string }[]> {
  const safeRole = role === 'compras' ? 'compras' : 'vendedor';
  const res = await env.DB
    .prepare(`SELECT monday_user_id, nombre FROM identity WHERE (role = ? OR role = 'admin') AND active = 1 ORDER BY nombre`)
    .bind(safeRole)
    .all<{ monday_user_id: number; nombre: string }>();
  return res.results ?? [];
}

// Admin-only (route guards): full identity roster, active or not.
export async function listIdentities(env: Env): Promise<Identity[]> {
  const res = await env.DB.prepare('SELECT * FROM identity ORDER BY nombre, email').all<Identity>();
  return res.results ?? [];
}

export async function upsertIdentity(
  env: Env,
  row: { email: string; phone: string | null; nombre: string | null; monday_user_id: number; role: string; active: number },
): Promise<void> {
  await env.DB
    .prepare(`INSERT INTO identity (email, phone, nombre, monday_user_id, role, active) VALUES (?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET phone=excluded.phone, nombre=excluded.nombre,
        monday_user_id=excluded.monday_user_id, role=excluded.role, active=excluded.active`)
    .bind(row.email, row.phone, row.nombre, row.monday_user_id, row.role, row.active)
    .run();
}

export async function pendingItemIds(env: Env, boardId: number): Promise<Set<number>> {
  const res = await env.DB
    .prepare(`SELECT DISTINCT item_id FROM outbox WHERE board_id = ? AND status IN ('pending','sent')`)
    .bind(boardId)
    .all<{ item_id: number }>();
  return new Set((res.results ?? []).map(r => r.item_id));
}
