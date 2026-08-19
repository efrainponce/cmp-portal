// "Quitar" una línea/item del portal SIN borrarlo de Monday.
//
// Regla dura (Efraín, 2026-08-19, tras el borrado masivo del 2026-08-18):
// el portal NUNCA borra en Monday. Su superficie de escritura hacia Monday es
// solo CREAR, MODIFICAR y DUPLICAR — jamás destruir. La razón es que un bug
// del portal (o un script que le pega) puede repetirse miles de veces por
// minuto, y en Monday no hay "deshacer" masivo: el 2026-08-18 un loop borró 70
// líneas de 22 oportunidades en 4.5 minutos.
//
// Entonces "borrar una línea" en el portal significa OCULTARLA: la fila se
// marca aquí y desaparece de todas las lecturas del portal (worker/lib/dal.ts),
// pero el item sigue vivo en Monday, con su historial y sus costos intactos.
// El estado vive en su propia tabla, no en `items`, justo para que el sync lo
// respete: refetch/reconcile pueden reescribir la fila de `items` cuantas veces
// quieran y la línea NO reaparece.
//
// Excepción: los items NATIVOS (Zona Efrain, ids >= 900000000000) no existen en
// Monday — ahí sí se borra la fila de D1, porque D1 ES el sistema de registro y
// no hay nada que destruir del otro lado.
import type { Env } from '../env';

let tableReady = false;

export async function ensureItemOcultoTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS item_oculto (
    board_id   INTEGER NOT NULL,
    item_id    INTEGER NOT NULL,
    hidden_at  TEXT NOT NULL,
    by_email   TEXT,
    PRIMARY KEY (board_id, item_id)
  )`).run();
  tableReady = true;
}

/** Fragmento SQL que excluye lo oculto. Se interpola en las lecturas de
 * `dal.ts`; no lleva binds, así que no corre el orden de los parámetros. */
export const NOT_OCULTO =
  'NOT EXISTS (SELECT 1 FROM item_oculto o WHERE o.board_id = items.board_id AND o.item_id = items.item_id)';

/** Quita el item de la vista del portal. Idempotente: quitar dos veces es un
 * no-op, no un error (el mismo criterio que el DELETE viejo, que toleraba
 * borrar algo ya borrado). */
export async function ocultarItem(env: Env, boardId: number, itemId: number, byEmail?: string): Promise<void> {
  await ensureItemOcultoTable(env);
  await env.DB.prepare(
    `INSERT INTO item_oculto (board_id, item_id, hidden_at, by_email) VALUES (?,?,?,?)
     ON CONFLICT(board_id, item_id) DO NOTHING`,
  ).bind(boardId, itemId, new Date().toISOString(), byEmail ?? null).run();
}

/** Devuelve el item a la vista — la contraparte de `ocultarItem`. Existe
 * porque quitar tiene que ser reversible: es la diferencia entre esto y un
 * borrado. */
export async function restaurarItem(env: Env, boardId: number, itemId: number): Promise<void> {
  await ensureItemOcultoTable(env);
  await env.DB.prepare('DELETE FROM item_oculto WHERE board_id = ? AND item_id = ?').bind(boardId, itemId).run();
}

export async function estaOculto(env: Env, boardId: number, itemId: number): Promise<boolean> {
  await ensureItemOcultoTable(env);
  const row = await env.DB.prepare('SELECT 1 AS x FROM item_oculto WHERE board_id = ? AND item_id = ?')
    .bind(boardId, itemId).first<{ x: number }>();
  return row != null;
}
