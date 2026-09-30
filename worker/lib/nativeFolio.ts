// worker/lib/nativeFolio.ts — folio "OPP-E0001" de una Oportunidad NATIVA
// (Zona Efrain, shared/nativeId.ts). En Monday el folio OPP-#### lo pone la
// columna auto-numerada `pulse_id_mm0qcq0m` y una automatización lo antepone
// al nombre; un item nativo no pasa por Monday y nacía SIN folio: el drawer y
// la lista enseñaban "—" y la cotización al cliente salía con el id sintético
// ("900818133702 - 1"). PAM (2026-09-29) no encontró el número de la
// oportunidad, la canceló y la rehízo en Monday.
//
// Secuencia propia con prefijo E (Efraín, 2026-09-29): nunca choca con la
// numeración de Monday, que no se puede consumir sin crear el item allá.
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import { isNativeId, NATIVE_ID_FLOOR } from '../../shared/nativeId';
import { rawHash, type RawColumn } from './canon';

export const OPP_FOLIO_COL = 'pulse_id_mm0qcq0m';

export function formatFolioNativo(n: number): string {
  return `OPP-E${String(n).padStart(4, '0')}`;
}

/** Nombre con el folio adelante, igual que la automatización de Monday
 * ("OPP-1138 - ESPOSAS CINCHOS"). No lo duplica si ya lo trae. */
export function nombreConFolio(folio: string, name: string): string {
  const limpio = name.trim();
  return limpio.startsWith(folio) ? limpio : `${folio} - ${limpio}`;
}

let tableReady = false;

async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS opp_folio_nativo (item_id INTEGER PRIMARY KEY, n INTEGER NOT NULL UNIQUE)`,
  ).run();
  tableReady = true;
}

/** Asigna (una sola vez) el folio de una Oportunidad nativa y lo estampa en el
 * mirror: columna Folio + prefijo en el nombre. Idempotente — si ya tiene
 * folio lo regresa sin tocar nada. `null` si no es un item nativo o no existe. */
export async function asignarFolioNativo(env: Env, itemId: number): Promise<string | null> {
  if (!isNativeId(itemId)) return null;
  const boardId = BOARDS.oportunidades.id;
  const row = await env.DB
    .prepare(`SELECT name, columns FROM items WHERE board_id = ? AND item_id = ?`)
    .bind(boardId, itemId)
    .first<{ name: string; columns: string }>();
  if (!row) return null;

  await ensureTable(env);
  // MAX+1 en UNA sola sentencia: D1 las serializa, así que dos altas al mismo
  // tiempo no pueden llevarse el mismo número (y `n` UNIQUE lo garantiza).
  await env.DB.prepare(
    `INSERT INTO opp_folio_nativo (item_id, n)
     SELECT ?, COALESCE(MAX(n), 0) + 1 FROM opp_folio_nativo WHERE true
     ON CONFLICT(item_id) DO NOTHING`,
  ).bind(itemId).run();
  const seq = await env.DB.prepare(`SELECT n FROM opp_folio_nativo WHERE item_id = ?`)
    .bind(itemId).first<{ n: number }>();
  if (!seq) throw new Error(`no se pudo asignar folio a la oportunidad nativa ${itemId}`);
  const folio = formatFolioNativo(seq.n);

  let cols: RawColumn[] = [];
  try { cols = JSON.parse(row.columns || '[]'); } catch { /* se reescribe */ }
  const actual = cols.find(c => c.id === OPP_FOLIO_COL)?.text;
  const name = nombreConFolio(folio, row.name);
  if (actual === folio && name === row.name) return folio;

  const next = cols.filter(c => c.id !== OPP_FOLIO_COL);
  next.push({ id: OPP_FOLIO_COL, type: 'item_id', text: folio, value: JSON.stringify({ item_id: folio }) });
  await env.DB
    .prepare(`UPDATE items SET name = ?, columns = ?, content_hash = ?, synced_at = ? WHERE board_id = ? AND item_id = ?`)
    .bind(name, JSON.stringify(next), rawHash(next), new Date().toISOString(), boardId, itemId)
    .run();
  return folio;
}

/** Rellena el folio de las Oportunidades nativas que nacieron antes de que
 * existiera (o cuya alta lo perdió). Lo corre la revisión de salud; devuelve
 * cuántas arregló. */
export async function rellenarFoliosNativos(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT item_id FROM items
     WHERE board_id = ? AND item_id >= ? AND parent_item_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM json_each(items.columns) j
                       WHERE json_extract(j.value, '$.id') = ? AND COALESCE(json_extract(j.value, '$.text'), '') <> '')
     ORDER BY synced_at LIMIT 50`,
  ).bind(BOARDS.oportunidades.id, NATIVE_ID_FLOOR, OPP_FOLIO_COL).all<{ item_id: number }>();
  for (const r of results) await asignarFolioNativo(env, r.item_id);
  return results.length;
}
