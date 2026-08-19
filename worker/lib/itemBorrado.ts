// Borrar de verdad: el portal borra en Monday y en D1, en la misma operación.
//
// Regla (Efraín, 2026-08-19, tarde): el portal y Monday tienen que quedar 1-1.
// Entre la mañana y la tarde de ese día "borrar" fue OCULTAR (la línea salía
// del portal y seguía viva en Monday) y eso rompió costeo el mismo día: el
// vendedor quitó una línea vacía de OPP-0923, el portal ya no se la mostraba a
// nadie, pero validar_costeo (cmp-tallas) lee los subitems DIRECTO de Monday,
// encontró la línea fantasma y rechazó el envío con "⚠️ Cantidad incorrecta"
// sobre una línea que nadie podía ver ni arreglar. Lo mismo habría pasado con
// la cotización al cliente: una línea quitada del portal seguía saliendo en el
// PDF de Eledo. Mientras costeo/cotización/tallas/OC se ejecuten leyendo
// Monday, todo lo que el portal esconde reaparece allá como error.
//
// Lo que SÍ queda del episodio del 2026-08-18 (un script pidió una lista con
// un filtro que la ruta no conocía, recibió el board completo y borró 70
// líneas de 22 oportunidades en 4.5 minutos, sin deshacer posible):
//
//   1. Este archivo es el ÚNICO lugar del worker con `delete_item`. Anclado en
//      worker/lib/monday.destructivo.test.ts — un `delete_item` en cualquier
//      otro fuente tumba el test.
//   2. Se borra de a UN item, siempre por id, nunca a partir de una lista.
//   3. Antes de borrar se guarda el renglón completo (nombre + todas las
//      columnas) en `item_borrado`: si algo se fue por error, el dato está para
//      recrearlo. Eso es lo que faltó el 18.
//   4. Tope de ritmo por persona (TOPE_POR_HORA): un humano quitando líneas no
//      lo alcanza; un bucle sí, y se corta ahí en vez de vaciar el board.
//
// Items NATIVOS (Zona Efrain, ids >= 900000000000): no existen en Monday, así
// que solo se borra la fila de D1 — D1 es su sistema de registro.
import type { Env } from '../env';
import { gql } from './monday';
import { isNativeId } from '../../shared/nativeId';

export class BorradoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Borrados permitidos por persona en la última hora. Dimensionado sobre el uso
 * real: la operación legítima más grande es restaurar una versión vieja, que
 * quita las líneas que esa versión no tenía (una cotización grande ronda las 15
 * líneas). El incidente del 2026-08-18 iba a ~16 por minuto. */
const TOPE_POR_HORA = 40;

let tableReady = false;

export async function ensureItemBorradoTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS item_borrado (
    board_id       INTEGER NOT NULL,
    item_id        INTEGER NOT NULL,
    parent_item_id INTEGER,
    name           TEXT,
    columns        TEXT,
    deleted_at     TEXT NOT NULL,
    by_email       TEXT,
    PRIMARY KEY (board_id, item_id)
  )`).run();
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_item_borrado_email_fecha ON item_borrado (by_email, deleted_at)',
  ).run();
  tableReady = true;
}

/** Cuántos lleva esta persona en la última hora. Sin email (llamadas internas
 * sin viewer) el tope no aplica: no hay bucle de usuario que frenar. */
async function borradosRecientes(env: Env, byEmail?: string): Promise<number> {
  if (!byEmail) return 0;
  const desde = new Date(Date.now() - 3600_000).toISOString();
  const row = await env.DB
    .prepare('SELECT count(*) AS n FROM item_borrado WHERE by_email = ? AND deleted_at > ?')
    .bind(byEmail, desde)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Borra el item en Monday y en el mirror, dejando copia del renglón en
 * `item_borrado`. Idempotente hacia afuera: si Monday ya no lo tiene, la fila de
 * D1 se limpia igual (el webhook `subitem_deleted` puede habérsele adelantado).
 *
 * El orden importa: primero el respaldo, luego Monday, al final D1. Si Monday
 * falla, no se pierde nada; si Monday borra y D1 falla, el reconcile arregla el
 * mirror solo. */
export async function borrarItem(
  env: Env, boardId: number, itemId: number, byEmail?: string,
): Promise<void> {
  await ensureItemBorradoTable(env);

  if (await borradosRecientes(env, byEmail) >= TOPE_POR_HORA) {
    throw new BorradoError(429,
      `Se alcanzó el tope de ${TOPE_POR_HORA} borrados por hora. Si de verdad hay que quitar más, avísale a Efraín.`);
  }

  const row = await env.DB
    .prepare('SELECT parent_item_id, name, columns FROM items WHERE board_id = ? AND item_id = ?')
    .bind(boardId, itemId)
    .first<{ parent_item_id: number | null; name: string; columns: string }>();

  await env.DB.prepare(
    `INSERT INTO item_borrado (board_id, item_id, parent_item_id, name, columns, deleted_at, by_email)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(board_id, item_id) DO UPDATE SET deleted_at = excluded.deleted_at, by_email = excluded.by_email`,
  ).bind(
    boardId, itemId, row?.parent_item_id ?? null, row?.name ?? null, row?.columns ?? null,
    new Date().toISOString(), byEmail ?? null,
  ).run();

  if (!isNativeId(itemId)) {
    await gql(env, `mutation($i:ID!){ delete_item(item_id:$i){ id } }`, { i: String(itemId) });
  }

  await env.DB.prepare('DELETE FROM items WHERE board_id = ? AND item_id = ?').bind(boardId, itemId).run();
}
