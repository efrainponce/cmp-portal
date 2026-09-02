// Full-board and full-mirror reconciliation (cron + manual trigger).
import type { Env } from '../env';
import { fetchItems, fetchBoardsUpdatedAt } from '../lib/monday';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import { upsertItemsBulk } from './upsert';
import { logSync } from './log';

// Even if a board's updated_at never moves, force a full pass this often —
// bounds any staleness the light check could theoretically miss.
const FORCE_FULL_MS = 24 * 60 * 60 * 1000;

// DELETEs por env.DB.batch() — un solo subrequest por llamada, acotado para no
// armar un payload gigante.
const BATCH_CHUNK = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Full board sweep. Antes hacía 1-2 queries D1 POR ITEM (SELECT de skip-check +
 * SELECT de prevColumns), lo que reventaba el límite de ~1000 subrequests por
 * invocación de Workers en cualquier board de más de ~500 items — moría a medias
 * sin excepción ni log (visto en prod: 12 días sin un reconcile completo en
 * oportunidades_sub/proyectos/proyectos_sub/productos/instituciones). Ahora: UNA
 * SELECT de content_hash para todo el board, comparación en memoria, y los
 * writes van por env.DB.batch() en lotes — de miles de subrequests a un puñado.
 * El upsert en sí vive en `upsertItemsBulk` (compartido con el refetch en lote
 * del delta sync): antes este archivo traía su propio INSERT, que no escribía
 * los totales t_* de la línea y dejaba la lista con cifras viejas tras un
 * reconcile. Los items se procesan página por página, no todos en memoria. */
export async function reconcileBoard(env: Env, slug: BoardSlug): Promise<{ upserts: number; deletes: number }> {
  const def = BOARDS[slug];

  const existingRows = await env.DB.prepare(
    `SELECT item_id, content_hash FROM items WHERE board_id = ?`,
  ).bind(def.id).all<{ item_id: number; content_hash: string }>();
  const existingHash = new Map((existingRows.results ?? []).map(r => [r.item_id, r.content_hash]));

  const seen = new Set<number>();
  let upserts = 0;
  let cursor: string | null | undefined;

  do {
    const page = await fetchItems(env, def.id, cursor);
    for (const item of page.items) seen.add(Number(item.id));
    const { changed } = await upsertItemsBulk(env, slug, page.items, { existingHash });
    upserts += changed.length;
    cursor = page.cursor;
  } while (cursor);

  // Items nativos (Zona Efrain, "salir de Monday") nunca existen del lado de
  // Monday por diseño — sin este filtro, cada reconcile los vería como
  // "borrados allá" y los purgaría del mirror en la siguiente pasada.
  const toDelete = [...existingHash.keys()].filter(id => !seen.has(id) && !isNativeId(id));
  for (const ids of chunk(toDelete, BATCH_CHUNK)) {
    await env.DB.batch(ids.map(id => env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`).bind(def.id, id)));
  }

  await logSync(env, 'reconcile', def.id, null, true, `upserts=${upserts} deletes=${toDelete.length}`);
  return { upserts, deletes: toDelete.length };
}

interface BoardState { board_id: number; monday_updated_at: string; reconciled_at: string }

/** One light Monday call for all boards; only boards whose updated_at moved
 * (or that haven't had a full pass in FORCE_FULL_MS) get paged in full.
 *
 * `slugs` limits which boards this pass covers. Necesario porque procesar los
 * 8 boards en una sola invocación se corta a medias por límites de CPU/subrequests
 * de Cloudflare — visto en prod: el loop siempre llegaba hasta 'proyectos' (3er
 * board) y moría ahí sin excepción ni log, dejando productos/instituciones/
 * contactos/proveedores sin sincronizar jamás (encontrado 2026-08-04, board
 * Proveedores vacío). worker/index.ts reparte los 8 boards en dos cron triggers. */
export async function reconcileAll(env: Env, slugs: BoardSlug[] = Object.keys(BOARDS) as BoardSlug[]): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS board_state (
       board_id INTEGER PRIMARY KEY, monday_updated_at TEXT NOT NULL, reconciled_at TEXT NOT NULL)`,
  ).run();

  let remote: Map<number, string> | null = null;
  try {
    remote = await fetchBoardsUpdatedAt(env, slugs.map(s => BOARDS[s].id));
  } catch (e) {
    await logSync(env, 'reconcile', 0, null, false, `boards updated_at check failed: ${e}`);
  }
  const stored = new Map<number, BoardState>();
  if (remote) {
    const res = await env.DB.prepare(`SELECT * FROM board_state`).all<BoardState>();
    for (const r of res.results ?? []) stored.set(r.board_id, r);
  }

  const now = new Date().toISOString();
  for (const slug of slugs) {
    const id = BOARDS[slug].id;
    const remoteAt = remote?.get(id);
    const prev = stored.get(id);
    const fresh = !!remoteAt && !!prev && prev.monday_updated_at === remoteAt
      && Date.now() - Date.parse(prev.reconciled_at) < FORCE_FULL_MS;
    if (fresh) {
      await logSync(env, 'reconcile', id, null, true, 'skipped — board updated_at unchanged');
      continue;
    }
    try {
      await reconcileBoard(env, slug);
      if (remoteAt) {
        await env.DB.prepare(
          `INSERT INTO board_state (board_id, monday_updated_at, reconciled_at) VALUES (?,?,?)
           ON CONFLICT(board_id) DO UPDATE SET monday_updated_at=excluded.monday_updated_at, reconciled_at=excluded.reconciled_at`,
        ).bind(id, remoteAt, now).run();
      }
    } catch (e) {
      await logSync(env, 'reconcile', id, null, false, String(e));
    }
  }

  // Retención del centro de notificaciones: purga leídas con más de 30 días —
  // best-effort, nunca debe tumbar el resto del reconcile.
  try {
    await env.DB.prepare(
      `DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < datetime('now','-30 days')`,
    ).run();
  } catch (e) {
    await logSync(env, 'reconcile', 0, null, false, `notifications prune failed: ${e}`);
  }
}
