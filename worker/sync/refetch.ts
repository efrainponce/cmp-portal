// Single-item refetch: never trust webhook/UI payloads — always re-pull from Monday.
import type { Env } from '../env';
import { fetchItem, fetchItemWithSubitems, fetchItemsByIds, fetchSubitemsOf, ITEMS_BY_IDS_MAX, type MondayItem } from '../lib/monday';
import { boardById, BOARDS, type BoardSlug } from '../../shared/boards';
import { upsertItem, upsertItemsBulk, chunk, BIND_CHUNK } from './upsert';
import { isNativeId } from '../../shared/nativeId';
import { confirmOutboxEcho, confirmOutboxEchoMany } from './echo';
import { logSync } from './log';
import { upsertMondayOrder } from '../lib/itemOrder';

export interface RefetchManyResult {
  /** ids releídos de Monday (existían allá). */
  refetched: number;
  /** ids que Monday ya no devolvió: se quitaron del espejo. */
  deleted: number;
  /** ids cuyo contenido cambió de verdad (se escribieron). */
  changed: number;
}

/**
 * Relee VARIOS items del mismo board en lotes de 100 por llamada a Monday
 * (`fetchItemsByIds`) — la pieza que cambia el delta sync de "1 item por
 * llamada, 0-3 por latido" a "toda la cola en 1-2 llamadas". Por lote:
 * 1 llamada a Monday + 1 SELECT de hashes + 1 batch de writes + 1 SELECT del
 * outbox (+ la SELECT de columnas previas y las notificaciones solo en los
 * boards que las diffean), en vez de ~6-8 subrequests por item.
 *
 * Misma semántica que `refetchItem` repetido: contenido igual → no se toca;
 * id que Monday no devuelve → se borra del espejo (igual que el `null` de
 * fetchItem); ids nativos se ignoran. Lo que sí cambia: en vez de una fila de
 * sync_log por item, una por lote — el detalle por item era ruido.
 */
export async function refetchItems(
  env: Env, boardId: number, itemIds: number[], opts: { conPadres?: boolean } = {},
): Promise<RefetchManyResult> {
  const out: RefetchManyResult = { refetched: 0, deleted: 0, changed: 0 };
  const def = boardById(boardId);
  if (!def) {
    await logSync(env, 'manual', boardId, null, false, 'unknown board_id');
    return out;
  }
  const ids = [...new Set(itemIds.filter(id => !isNativeId(id)))];
  const padres = new Set<number>();
  for (let i = 0; i < ids.length; i += ITEMS_BY_IDS_MAX) {
    const slice = ids.slice(i, i + ITEMS_BY_IDS_MAX);
    const items = await fetchItemsByIds(env, slice);
    const found = new Set(items.map(it => Number(it.id)));

    const { changed } = await upsertItemsBulk(env, def.slug, items);
    await confirmOutboxEchoMany(env, boardId, items.map(it => ({
      itemId: Number(it.id), columns: it.column_values, name: it.name,
    })));
    for (const it of items) {
      const padre = Number(it.parent_item?.id);
      if (Number.isFinite(padre) && padre > 0) padres.add(padre);
    }

    const missing = slice.filter(id => !found.has(id));
    if (missing.length) {
      await env.DB.batch(missing.map(id =>
        env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`).bind(boardId, id)));
    }
    out.refetched += items.length;
    out.deleted += missing.length;
    out.changed += changed.length;
  }
  if (ids.length) {
    await logSync(env, 'manual', boardId, null, true,
      `refetched batch: ${out.refetched} releídos, ${out.changed} cambiados, ${out.deleted} borrados en Monday`);
  }

  // `conPadres`: releer también el PADRE de cada línea releída (una llamada
  // más por lote, con los padres de hasta 100 líneas). Una línea que cambia en
  // Monday o por cmp-tallas (validar_costeo, import_tallas) solo deja evento
  // en el board de LÍNEAS: el padre no se entera, y sus espejos que agregan
  // las líneas —"Etapa Costeo" (lookup_mm087at6), que es el badge que Compras
  // mira en la lista de Costeo; "Estado de productos" (lookup_mm20g4n6) en
  // Proyectos— se quedaban viejos hasta el reconcile de 12 h o hasta que
  // alguien abriera ESA oportunidad con `?fresh=1`. Desde que abrir se salta
  // la ida a Monday cuando el latido está fresco (2026-09-02), ni eso: por
  // eso va aquí, en el mismo latido que relee la línea. Monday recalcula los
  // espejos del padre de forma diferida (segundos); el evento de la línea
  // llega al activity log 2-3 s después de la mutación y el latido lo recoge
  // hasta 30 s más tarde, así que casi siempre ya está — y si no, el
  // siguiente cambio en cualquier línea de esa oportunidad lo vuelve a traer.
  if (opts.conPadres && def.parent && padres.size) {
    const boardPadre = BOARDS[def.parent].id;
    const res = await refetchItems(env, boardPadre, [...padres]);
    out.refetched += res.refetched;
    out.deleted += res.deleted;
    out.changed += res.changed;
  }
  return out;
}

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
 * (validar_costeo). No-op child cleanup for boards without a subitem board.
 *
 * `soloLineas`: relee y asienta SOLO las líneas; la fila del padre no se toca.
 * Para cuando el padre tiene un write propio en vuelo que su eco del outbox
 * asentará (Validar costeo escribe deal_stage y en paralelo necesita las
 * líneas frescas): releer al padre aquí costaba ~1.5-2 s de sus fórmulas y
 * espejos, y si la lectura le ganaba a la mutación podía regresar la etapa
 * vieja al espejo. */
export async function refetchItemTree(
  env: Env, boardId: number, itemId: number, opts: { soloLineas?: boolean } = {},
): Promise<void> {
  if (isNativeId(itemId)) return; // ver comentario en refetchItem

  const def = boardById(boardId);
  if (!def) {
    await logSync(env, 'manual', boardId, itemId, false, 'unknown board_id');
    return;
  }

  const childSlug = (Object.keys(BOARDS) as BoardSlug[]).find(k => BOARDS[k].parent === def.slug);

  let subitems: MondayItem[];
  if (opts.soloLineas && childSlug) {
    const subs = await fetchSubitemsOf(env, itemId);
    if (!subs) {
      await env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`)
        .bind(boardId, itemId).run();
      await logSync(env, 'manual', boardId, itemId, true, 'not found on Monday — mirror row deleted');
      return;
    }
    subitems = subs;
  } else {
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
    subitems = tree.subitems;
  }

  if (childSlug) {
    const childBoardId = BOARDS[childSlug].id;
    const subIds = subitems.map(s => Number(s.id));
    // El orden en sí no entra en content_hash (no es una columna) — se captura
    // siempre, aunque ninguna línea haya cambiado de valor, para que un
    // reacomodo puro en Monday no se quede sin reflejar (worker/lib/itemOrder.ts).
    await upsertMondayOrder(env, childBoardId, itemId, subIds);
    // Las líneas por el MISMO camino que el refetch por lote del delta sync
    // (upsertItemsBulk): hashes en trozos de BIND_CHUNK, ficha comercial
    // hidratada ANTES del hash (una línea guardada sin ficha se repara aquí en
    // vez de saltarse por "igual a lo que hay", worker/lib/ficha.ts), mismo
    // hash = ni se toca (no mover `synced_at` mantiene válido el ETag de la
    // lista para los demás), writes en `env.DB.batch()` y side effects solo de
    // lo que cambió. Antes esto iba línea por línea con upsertItem (3-4 idas a
    // D1 por línea cambiada, en serie) y la consulta de hashes llevaba TODOS
    // los ids en un solo IN: un Proyecto con más de 99 líneas reventaba el
    // tope de parámetros de D1 ("too many SQL variables") y la ruta respondía
    // 500 aunque la acción ya hubiera pasado en Monday — generar-oc, 2026-09-16.
    await upsertItemsBulk(env, childSlug, subitems);
    // Líneas que ya no existen en Monday: se quitan del espejo. Se leen las
    // del padre (2 parámetros) y se borran de a BIND_CHUNK, en vez de un
    // `NOT IN (...)` con todos los ids vivos — mismo tope de D1 de arriba.
    const vivos = new Set(subIds);
    const { results } = await env.DB.prepare(
      `SELECT item_id FROM items WHERE board_id = ? AND parent_item_id = ?`,
    ).bind(childBoardId, itemId).all<{ item_id: number }>();
    const sobrantes = lineasSobrantes((results ?? []).map(r => r.item_id), vivos);
    if (sobrantes.length) {
      await env.DB.batch(chunk(sobrantes, BIND_CHUNK).map(ids =>
        env.DB.prepare(
          `DELETE FROM items WHERE board_id = ? AND parent_item_id = ? AND item_id IN (${ids.map(() => '?').join(',')})`,
        ).bind(childBoardId, itemId, ...ids)));
    }
  }

  await logSync(env, 'manual', boardId, itemId, true,
    `refetched tree (${subitems.length} subitems${opts.soloLineas ? ', solo líneas' : ''})`);
}

/** Ids del espejo que Monday ya no devolvió (se borran). Pura: la ancla
 * worker/sync/refetch.test.ts. */
export function lineasSobrantes(enEspejo: number[], vivos: ReadonlySet<number>): number[] {
  return enEspejo.filter(id => !vivos.has(Number(id)));
}
