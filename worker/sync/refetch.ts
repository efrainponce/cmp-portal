// Single-item refetch: never trust webhook/UI payloads — always re-pull from Monday.
import type { Env } from '../env';
import { fetchItem, fetchItemWithSubitems } from '../lib/monday';
import { boardById, BOARDS, type BoardSlug } from '../../shared/boards';
import { upsertItem, toRawColumns } from './upsert';
import { hydrateFichaLineas } from '../lib/ficha';
import { rawHash } from '../lib/canon';
import { isNativeId } from '../../shared/nativeId';
import { confirmOutboxEcho } from './echo';
import { logSync } from './log';
import { upsertMondayOrder } from '../lib/itemOrder';

export async function refetchItem(env: Env, boardId: number, itemId: number): Promise<void> {
  // Item nativo (Zona Efrain): D1 ya es la fuente de verdad, no existe en Monday
  // que "refetchear" — y llamar a Monday con este id devolvería not-found, lo
  // que borraría la fila del mirror (ver rama de abajo). No-op a propósito.
  if (isNativeId(itemId)) return;

  const def = boardById(boardId);
  if (!def) {
    await logSync(env, 'manual', boardId, itemId, false, 'unknown board_id');
    return;
  }

  const item = await fetchItem(env, itemId);
  if (!item) {
    await env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`)
      .bind(boardId, itemId).run();
    await logSync(env, 'manual', boardId, itemId, true, 'not found on Monday — mirror row deleted');
    return;
  }

  // Mismo motivo que en refetchItemTree: no mover `synced_at` si nada cambió,
  // para no invalidarle la lista a todos los demás.
  await upsertItem(env, def.slug, item, { skipIfUnchanged: true });
  await confirmOutboxEcho(env, boardId, itemId, item.column_values, item.name);
  await logSync(env, 'manual', boardId, itemId, true, 'refetched');
}

/** Item + subitems refetch in one Monday call. Upserts everything and DELETES
 * mirror subitem rows that no longer exist on Monday — needed after cmp-tallas
 * flows that rewrite subitems (import_tallas) or snapshot columns on them
 * (validar_costeo). No-op child cleanup for boards without a subitem board. */
export async function refetchItemTree(env: Env, boardId: number, itemId: number): Promise<void> {
  if (isNativeId(itemId)) return; // ver comentario en refetchItem

  const def = boardById(boardId);
  if (!def) {
    await logSync(env, 'manual', boardId, itemId, false, 'unknown board_id');
    return;
  }

  const tree = await fetchItemWithSubitems(env, itemId);
  if (!tree) {
    await env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`)
      .bind(boardId, itemId).run();
    await logSync(env, 'manual', boardId, itemId, true, 'not found on Monday — mirror row deleted');
    return;
  }

  // skipIfUnchanged: sin esto, ABRIR una oportunidad reescribía `synced_at` de
  // la fila (y de sus 30+ líneas) aunque Monday no hubiera cambiado nada. Como
  // el ETag de las listas cuelga de MAX(synced_at) del board, eso invalidaba la
  // lista de TODOS los demás usuarios: cada apertura de cualquiera obligaba al
  // resto a re-bajar el board completo en su siguiente poll (comprobado, 2026-
  // 08-13). Ahora `synced_at` solo se mueve cuando el contenido cambió de
  // verdad, que es lo que ya hacía reconcile. Los cambios de columnas mirror sí
  // quedan cubiertos: entran en `content_hash`, no en `updated_at` de Monday.
  await upsertItem(env, def.slug, tree.item, { skipIfUnchanged: true });
  await confirmOutboxEcho(env, boardId, itemId, tree.item.column_values, tree.item.name);

  const childSlug = (Object.keys(BOARDS) as BoardSlug[]).find(k => BOARDS[k].parent === def.slug);
  if (childSlug) {
    const childBoardId = BOARDS[childSlug].id;
    // Los hashes de TODAS las líneas en UNA consulta, no una por línea.
    // `skipIfUnchanged` por sí solo cambia 31 escrituras por 31 SELECTs
    // secuenciales, y cada ida a D1 desde el Worker es un round-trip: en una
    // oportunidad de 31 líneas eso es 31 viajes para, casi siempre, no escribir
    // nada. Reconcile ya resuelve esto igual (una lectura de hashes + escribir
    // solo lo que cambió).
    // La ficha comercial se resuelve para TODAS las líneas de un jalón (una
    // consulta) y ANTES de comparar hashes: así una línea guardada sin ficha se
    // repara en esta misma relectura en vez de saltarse por "igual a lo que hay"
    // (worker/lib/ficha.ts).
    if (childSlug === 'oportunidades_sub') await hydrateFichaLineas(env, tree.subitems);

    const subIds = tree.subitems.map(s => Number(s.id));
    // El orden en sí no entra en content_hash (no es una columna) — se captura
    // siempre, aunque ninguna línea haya cambiado de valor, para que un
    // reacomodo puro en Monday no se quede sin reflejar (worker/lib/itemOrder.ts).
    await upsertMondayOrder(env, childBoardId, itemId, subIds);
    const hashActual = new Map<number, string>();
    if (subIds.length) {
      const placeholders = subIds.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT item_id, content_hash FROM items WHERE board_id = ? AND item_id IN (${placeholders})`,
      ).bind(childBoardId, ...subIds).all<{ item_id: number; content_hash: string }>();
      for (const r of rows.results ?? []) hashActual.set(r.item_id, r.content_hash);
    }
    for (const sub of tree.subitems) {
      // Mismo hash = línea idéntica: ni se toca (no mover `synced_at` es lo que
      // mantiene válido el ETag de la lista para todos los demás).
      if (hashActual.get(Number(sub.id)) === rawHash(toRawColumns(sub))) continue;
      await upsertItem(env, childSlug, sub);
    }
    const keep = tree.subitems.map(s => Number(s.id));
    const placeholders = keep.map(() => '?').join(',');
    await env.DB.prepare(
      `DELETE FROM items WHERE board_id = ? AND parent_item_id = ?${keep.length ? ` AND item_id NOT IN (${placeholders})` : ''}`,
    ).bind(childBoardId, itemId, ...keep).run();
  }

  await logSync(env, 'manual', boardId, itemId, true, `refetched tree (${tree.subitems.length} subitems)`);
}
