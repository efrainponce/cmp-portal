// Upsert one Monday item into the D1 mirror (`items` table).
import type { Env } from '../env';
import type { MondayItem } from '../lib/monday';
import { rawHash, type RawColumn } from '../lib/canon';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { maybeEmitStageChange } from '../lib/notify';

// authzCols are people columns; value JSON carries personsAndTeams:[{id,kind}].
function extractVendedorIds(item: MondayItem, authzCols: string[]): number[] {
  const ids = new Set<number>();
  for (const col of item.column_values) {
    if (!authzCols.includes(col.id) || !col.value) continue;
    try {
      const parsed = JSON.parse(col.value) as { personsAndTeams?: Array<{ id: number | string }> };
      for (const p of parsed.personsAndTeams ?? []) {
        const n = Number(p.id);
        if (!Number.isNaN(n)) ids.add(n);
      }
    } catch { /* not JSON — ignore */ }
  }
  return [...ids];
}

export interface UpsertResult { changed: boolean }
export interface UpsertOpts { skipIfUnchanged?: boolean }

/** Insert or update the mirror row. When `skipIfUnchanged`, a matching content_hash
 * short-circuits the write entirely (used by bulk reconcile to save D1 writes). */
export async function upsertItem(
  env: Env,
  slug: BoardSlug,
  item: MondayItem,
  opts: UpsertOpts = {},
): Promise<UpsertResult> {
  const def = BOARDS[slug];
  const columns: RawColumn[] = item.column_values.map(c => ({
    id: c.id, type: c.type, text: c.text, value: c.value,
  }));
  const contentHash = rawHash(columns);
  const itemId = Number(item.id);

  if (opts.skipIfUnchanged) {
    const existing = await env.DB.prepare(
      `SELECT content_hash FROM items WHERE board_id = ? AND item_id = ?`,
    ).bind(def.id, itemId).first<{ content_hash: string }>();
    if (existing && existing.content_hash === contentHash) return { changed: false };
  }

  const vendedorIds = def.parent ? [] : extractVendedorIds(item, def.authzCols ?? []);
  const now = new Date().toISOString();

  // Solo para el board padre de Oportunidades: captura el estado previo de
  // `columns` ANTES del write para poder diffear deal_stage después (el centro
  // de notificaciones — worker/lib/notify.ts). Se hace aquí, no antes del
  // skipIfUnchanged, para no pagar una SELECT extra en el resto de boards ni
  // cuando el contenido no cambió.
  const isOportunidades = slug === 'oportunidades';
  let prevColumnsJson: string | null = null;
  if (isOportunidades) {
    const prevRow = await env.DB.prepare(
      `SELECT columns FROM items WHERE board_id = ? AND item_id = ?`,
    ).bind(def.id, itemId).first<{ columns: string }>();
    prevColumnsJson = prevRow?.columns ?? null;
  }

  await env.DB.prepare(
    `INSERT INTO items (board_id, item_id, parent_item_id, name, group_id, vendedor_ids, monday_updated_at, synced_at, content_hash, columns)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(board_id, item_id) DO UPDATE SET
       parent_item_id = excluded.parent_item_id, name = excluded.name, group_id = excluded.group_id,
       vendedor_ids = excluded.vendedor_ids, monday_updated_at = excluded.monday_updated_at,
       synced_at = excluded.synced_at, content_hash = excluded.content_hash, columns = excluded.columns`,
  ).bind(
    def.id, itemId,
    item.parent_item?.id ? Number(item.parent_item.id) : null,
    item.name, item.group?.id ?? null,
    JSON.stringify(vendedorIds), item.updated_at, now, contentHash, JSON.stringify(columns),
  ).run();

  if (isOportunidades) {
    await maybeEmitStageChange(env, {
      boardId: def.id,
      itemId,
      itemName: item.name,
      prevColumnsJson,
      newColumnsJson: JSON.stringify(columns),
      vendedorIds,
    });
  }

  return { changed: true };
}
