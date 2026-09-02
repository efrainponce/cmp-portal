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

// Statements por env.DB.batch() — cada llamada ES un solo subrequest sin
// importar cuántos traiga, pero se acota igual para no armar un payload
// gigante (primer reconcile tras un hueco largo).
const BATCH_CHUNK = 100;
// Parámetros ligados por UNA query — D1 rechaza más de ~100 (mismo tope que
// documenta worker/lib/updateSeen.ts). 99 ids + el board_id = 100.
const BIND_CHUNK = 99;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface BulkUpsertOpts {
  /** content_hash actual de los items del board, si el llamador ya lo trae (el
   * reconcile lee el board completo una vez). Ausente = se consulta para los
   * ids de este lote, en trozos de BIND_CHUNK. */
  existingHash?: Map<number, string>;
}

export interface BulkUpsertResult {
  /** ids que sí se escribieron (contenido distinto al del espejo, o nuevos). */
  changed: number[];
}

/**
 * Upsert de MUCHOS items del mismo board con un puñado de subrequests, no uno
 * o dos por item: 1 SELECT de hashes (si no vienen), 1 SELECT de `columns`
 * previas solo para los boards que las diffean (NEEDS_PREV_COLUMNS), y los
 * writes por `env.DB.batch()`. Es el MISMO camino para el reconcile por lote
 * y para el refetch en lote del delta sync (worker/sync/refetch.ts), así que
 * los dos escriben exactamente lo mismo que `upsertItem` — incluidos los
 * totales t_* de la línea (worker/lib/lineaTotales.ts), que el INSERT propio
 * que tenía reconcile.ts NO escribía: una línea cambiada por el reconcile se
 * quedaba con los totales viejos en la lista hasta que algo la refetcheara.
 *
 * Semántica idéntica a `upsertItem({ skipIfUnchanged: true })` por item:
 * mismo hash → no se toca (ni `synced_at`, que es lo que mantiene válido el
 * ETag de la lista para los demás); ficha comercial hidratada ANTES del hash;
 * side effects (notificaciones de etapa/estado) solo para lo que cambió.
 */
export async function upsertItemsBulk(
  env: Env,
  slug: BoardSlug,
  items: MondayItem[],
  opts: BulkUpsertOpts = {},
): Promise<BulkUpsertResult> {
  if (items.length === 0) return { changed: [] };
  const def = BOARDS[slug];
  const needsPrev = NEEDS_PREV_COLUMNS.has(slug);
  if (slug === 'oportunidades_sub') await hydrateFichaLineas(env, items);

  const now = new Date().toISOString();
  const writes = items.map(item => ({ item, write: mirrorUpsertStatement(env, slug, item, now) }));

  let existingHash = opts.existingHash;
  if (!existingHash) {
    existingHash = new Map();
    for (const ids of chunk(writes.map(w => w.write.itemId), BIND_CHUNK)) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT item_id, content_hash FROM items WHERE board_id = ? AND item_id IN (${placeholders})`,
      ).bind(def.id, ...ids).all<{ item_id: number; content_hash: string }>();
      for (const r of rows.results ?? []) existingHash.set(r.item_id, r.content_hash);
    }
  }

  const changed = writes.filter(w => existingHash!.get(w.write.itemId) !== w.write.contentHash);
  if (changed.length === 0) return { changed: [] };

  // Prev-columns solo para los boards que las necesitan, y solo para items que
  // YA existían (los nuevos no tienen "antes" — mismo semantics que upsertItem).
  const prevColumns = new Map<number, string>();
  if (needsPrev) {
    const needPrevIds = changed.filter(w => existingHash!.has(w.write.itemId)).map(w => w.write.itemId);
    for (const ids of chunk(needPrevIds, BIND_CHUNK)) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT item_id, columns FROM items WHERE board_id = ? AND item_id IN (${placeholders})`,
      ).bind(def.id, ...ids).all<{ item_id: number; columns: string }>();
      for (const r of rows.results ?? []) prevColumns.set(r.item_id, r.columns);
    }
  }

  for (const group of chunk(changed, BATCH_CHUNK)) {
    await env.DB.batch(group.map(w => w.write.stmt));
  }

  if (needsPrev) {
    for (const { item, write } of changed) {
      await emitItemSideEffects(
        env, slug, write.itemId, item.name, write.parentItemId,
        prevColumns.get(write.itemId) ?? null, write.columnsJson, write.vendedorIds,
      );
    }
  }

  return { changed: changed.map(w => w.write.itemId) };
}

/** Insert or update the mirror row. When `skipIfUnchanged`, a matching content_hash
 * short-circuits the write entirely. Single-item path (webhook/refresh/outbox echo) —
 * los caminos por lote (reconcile, refetch del delta) van por `upsertItemsBulk`
 * (evita 1-2 round-trips a D1 por item, que es justo lo que reventaba el
 * límite de subrequests). */
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
