// Upsert one Monday item into the D1 mirror (`items` table).
import type { Env } from '../env';
import type { MondayItem } from '../lib/monday';
import { rawHash, type RawColumn } from '../lib/canon';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { hydrateFichaLineas } from '../lib/ficha';
import { totalesDeLinea } from '../lib/lineaTotales';
import { maybeEmitStageChange, maybeEmitProjectStatusChange } from '../lib/notify';
import { maybeLogProductoStatus } from '../lib/estadoProducto';

// authzCols are people columns; value JSON carries personsAndTeams:[{id,kind}].
export function extractVendedorIds(item: MondayItem, authzCols: string[]): number[] {
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

export const toRawColumns = (item: MondayItem): RawColumn[] =>
  item.column_values.map(c => ({ id: c.id, type: c.type, text: c.text, value: c.value }));

// slugs cuyo mirror necesita el estado ANTERIOR de `columns` para diffear
// deal_stage/project_status/estado del producto (centro de notificaciones,
// worker/lib/notify.ts + estadoProducto.ts). El resto de boards no lo paga.
export const NEEDS_PREV_COLUMNS: ReadonlySet<BoardSlug> =
  new Set(['oportunidades', 'proyectos', 'proyectos_sub'] satisfies BoardSlug[]);

/** Dispara las notificaciones derivadas de un cambio de columnas — compartido por
 * el upsert de un solo item (webhook/refresh) y el reconcile por lote (bulk, que
 * ya trae el `prevColumnsJson` de una SELECT agregada en vez de una por item). */
export async function emitItemSideEffects(
  env: Env, slug: BoardSlug, itemId: number, itemName: string,
  parentItemId: number | null, prevColumnsJson: string | null, newColumnsJson: string, vendedorIds: number[],
): Promise<void> {
  const def = BOARDS[slug];
  if (slug === 'oportunidades') {
    await maybeEmitStageChange(env, { boardId: def.id, itemId, itemName, prevColumnsJson, newColumnsJson, vendedorIds });
  } else if (slug === 'proyectos') {
    await maybeEmitProjectStatusChange(env, { boardId: def.id, itemId, itemName, prevColumnsJson, newColumnsJson, vendedorIds });
  } else if (slug === 'proyectos_sub' && parentItemId) {
    await maybeLogProductoStatus(env, {
      proyectosBoardId: BOARDS.proyectos.id, proyectoId: parentItemId, subItemId: itemId,
      prevColumnsJson, newColumnsJson,
    });
  }
}

export interface MirrorUpsert {
  stmt: D1PreparedStatement;
  itemId: number;
  parentItemId: number | null;
  vendedorIds: number[];
  contentHash: string;
  columnsJson: string;
}

/** El INSERT ... ON CONFLICT del mirror para UN item, armado pero SIN ejecutar.
 * Para los flujos que escriben muchos items de un jalón: se juntan los
 * statements y se mandan en un `env.DB.batch()`, que es UN solo subrequest sin
 * importar cuántos traiga, en vez de un round-trip por item (worker/lib/
 * proyectoTallas.ts capturarTallas — ver el mismo patrón en reconcile.ts).
 *
 * OJO: no hace nada de lo que upsertItem hace ALREDEDOR del write (skip por
 * content_hash, lectura de `columns` previas, side effects de notificación).
 * El llamador decide qué de eso necesita — para altas no hay "antes" que
 * diffear y el batch sale gratis. Para 'oportunidades_sub' hay que pasar el
 * item ya hidratado por hydrateFichaLineas (esto es síncrono a propósito). */
export function mirrorUpsertStatement(
  env: Env,
  slug: BoardSlug,
  item: MondayItem,
  now: string = new Date().toISOString(),
): MirrorUpsert {
  const def = BOARDS[slug];
  const columns = toRawColumns(item);
  const columnsJson = JSON.stringify(columns);
  const contentHash = rawHash(columns);
  const itemId = Number(item.id);
  const parentItemId = item.parent_item?.id ? Number(item.parent_item.id) : null;
  const vendedorIds = def.parent ? [] : extractVendedorIds(item, def.authzCols ?? []);

  // Totales de la línea, materializados aquí para que la lista pueda sumarlos
  // por oportunidad con un SUM por índice — ver worker/lib/lineaTotales.ts.
  // Fuera del board de líneas las cinco columnas se quedan en NULL.
  const t = slug === 'oportunidades_sub' ? totalesDeLinea(columns) : null;

  const stmt = env.DB.prepare(
    `INSERT INTO items (board_id, item_id, parent_item_id, name, group_id, vendedor_ids, monday_updated_at, synced_at, content_hash, columns,
                        t_costo, t_subtotal, t_total, t_utilidad, t_margen_gob)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(board_id, item_id) DO UPDATE SET
       parent_item_id = excluded.parent_item_id, name = excluded.name, group_id = excluded.group_id,
       vendedor_ids = excluded.vendedor_ids, monday_updated_at = excluded.monday_updated_at,
       synced_at = excluded.synced_at, content_hash = excluded.content_hash, columns = excluded.columns,
       t_costo = excluded.t_costo, t_subtotal = excluded.t_subtotal, t_total = excluded.t_total,
       t_utilidad = excluded.t_utilidad, t_margen_gob = excluded.t_margen_gob`,
  ).bind(
    def.id, itemId, parentItemId,
    item.name, item.group?.id ?? null,
    JSON.stringify(vendedorIds), item.updated_at, now, contentHash, columnsJson,
    t?.costo ?? null, t?.subtotal ?? null, t?.total ?? null, t?.utilidad ?? null, t?.margenGob ?? null,
  );

  return { stmt, itemId, parentItemId, vendedorIds, contentHash, columnsJson };
}

/** Insert or update the mirror row. When `skipIfUnchanged`, a matching content_hash
 * short-circuits the write entirely. Single-item path (webhook/refresh/outbox echo) —
 * el reconcile por lote NO pasa por aquí, ver reconcile.ts (evita 1-2 round-trips
 * a D1 por item, que es justo lo que reventaba el límite de subrequests). */
export async function upsertItem(
  env: Env,
  slug: BoardSlug,
  item: MondayItem,
  opts: UpsertOpts = {},
): Promise<UpsertResult> {
  const def = BOARDS[slug];
  // La ficha comercial se resuelve ANTES del hash: lo que se guarda (y lo que se
  // compara para decidir si hay cambio) ya trae la descripción del catálogo, aunque
  // el mirror de Monday siga vacío — ver worker/lib/ficha.ts.
  if (slug === 'oportunidades_sub') await hydrateFichaLineas(env, [item]);
  const write = mirrorUpsertStatement(env, slug, item);

  if (opts.skipIfUnchanged) {
    const existing = await env.DB.prepare(
      `SELECT content_hash FROM items WHERE board_id = ? AND item_id = ?`,
    ).bind(def.id, write.itemId).first<{ content_hash: string }>();
    if (existing && existing.content_hash === write.contentHash) return { changed: false };
  }

  // Captura el estado previo de `columns` ANTES del write, solo para los boards
  // que lo necesitan (NEEDS_PREV_COLUMNS) — no pagar la SELECT extra en el resto.
  let prevColumnsJson: string | null = null;
  if (NEEDS_PREV_COLUMNS.has(slug)) {
    const prevRow = await env.DB.prepare(
      `SELECT columns FROM items WHERE board_id = ? AND item_id = ?`,
    ).bind(def.id, write.itemId).first<{ columns: string }>();
    prevColumnsJson = prevRow?.columns ?? null;
  }

  await write.stmt.run();

  await emitItemSideEffects(
    env, slug, write.itemId, item.name, write.parentItemId,
    prevColumnsJson, write.columnsJson, write.vendedorIds,
  );

  return { changed: true };
}
