// worker/lib/outbox.ts — optimistic write path: D1 mirror first, Monday async via waitUntil.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';
import type { WriteResponse } from '../../shared/dto';
import { BOARDS, boardById } from '../../shared/boards';
import { canWrite } from '../../shared/visibility';
import { COLUMN_META } from '../../shared/column-meta.gen';
import { canonValue, writeHash } from './canon';
import { encodeColumnValue } from './columnEncode';
import { refetchItem, upsertItem, confirmOutboxEcho } from '../sync';
import { getItem } from './dal';
import type { RawCol } from './serialize';
import type { MondayItem, MondayCol } from './monday';

export class OutboxError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function submitWrite(
  env: Env,
  ctx: ExecutionContext,
  slug: BoardSlug,
  itemId: number,
  cols: Record<string, string>,
  viewer: Identity,
  // trusted: caller already validated the write itself (e.g. the enviar-costeo
  // route, whose stage change isn't a user-writable column). Never expose to
  // a route that forwards client-chosen column ids.
  // skipFlush: caller batches several writes and will `await flushOutbox`
  // itself before anything downstream reads Monday (see quoteVersions).
  opts: { trusted?: boolean; skipFlush?: boolean } = {},
): Promise<WriteResponse> {
  const colIds = Object.keys(cols ?? {});
  if (colIds.length === 0) throw new OutboxError(400, 'no columns');
  if (!opts.trusted) {
    for (const colId of colIds) {
      if (!canWrite(slug, colId, viewer.role)) throw new OutboxError(403, `cannot write ${colId}`);
    }
  }

  const row = await getItem(env, slug, itemId, viewer);
  if (!row) throw new OutboxError(404, 'not found');

  const board = BOARDS[slug];
  const boardMeta = COLUMN_META[slug] ?? {};
  const types: Record<string, string> = {};
  for (const colId of colIds) types[colId] = boardMeta[colId]?.type ?? 'text';

  // Optimistic merge into el mirror's raw columns array, un UPSERT atómico por
  // columna via JSON1 (json_each/json_group_array) directo en SQLite en vez de
  // leer-en-JS + UPDATE del blob completo. El patrón viejo (read row -> mutar en
  // JS -> UPDATE) tenía una ventana entre el read y el write: dos submitWrite
  // concurrentes a la MISMA línea pero columnas distintas (ej. Color y Cantidad,
  // cada edición dispara su propio PATCH) podían leer el mismo `existing` antes
  // de que cualquiera de los dos escribiera, y el que terminara después pisaba
  // por completo el cambio del otro — confirmado contra la API real de Monday
  // durante el stress test 2026-07-21 (pérdida de dato, no solo en el mirror).
  // Fusionar el arreglo dentro del propio UPDATE hace que SQLite lea y escriba
  // esa columna en una sola operación atómica, sin ventana de carrera.
  const now = new Date().toISOString();
  for (const colId of colIds) {
    const canon = canonValue(types[colId], cols[colId]);
    const mergedCol: RawCol = { id: colId, type: types[colId], text: canon, value: JSON.stringify(canon) };
    const mergedJson = JSON.stringify(mergedCol);
    await env.DB
      .prepare(
        `UPDATE items SET columns = CASE
           WHEN EXISTS (SELECT 1 FROM json_each(columns) WHERE json_extract(value, '$.id') = ?)
           THEN (SELECT json_group_array(
             CASE WHEN json_extract(je.value, '$.id') = ? THEN json(?) ELSE je.value END
           ) FROM json_each(columns) AS je)
           ELSE json_insert(columns, '$[#]', json(?))
         END, synced_at = ?
         WHERE board_id = ? AND item_id = ?`,
      )
      .bind(colId, colId, mergedJson, mergedJson, now, board.id, itemId)
      .run();
  }

  const canonCols: Record<string, string> = {};
  for (const colId of colIds) canonCols[colId] = canonValue(types[colId], cols[colId]);
  const contentHash = writeHash(canonCols, types);

  await env.DB
    .prepare(
      `INSERT INTO outbox (board_id, item_id, cols, content_hash, author_email, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
    .bind(board.id, itemId, JSON.stringify(cols), contentHash, viewer.email, now, now)
    .run();

  if (!opts.skipFlush) ctx.waitUntil(flushOutbox(env));
  return { ok: true, pending: true };
}

interface OutboxRow {
  id: number;
  board_id: number;
  item_id: number;
  cols: string;
  attempts: number;
}

export async function flushOutbox(env: Env): Promise<void> {
  const claimed = await claimPendingBatch(env);
  if (claimed.length === 0) return;
  // Agrupa por item: un change_multiple_column_values + una confirmación por item,
  // sin importar cuántas filas pendientes se acumularon (created_at-ordered, así que
  // una edición posterior a la misma columna gana en el merge).
  const groups = new Map<string, OutboxRow[]>();
  for (const row of claimed) {
    const key = `${row.board_id}:${row.item_id}`;
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }
  // Grupos en paralelo — flushGroup atrapa sus propios errores y nunca relanza,
  // así que el fallo de un item no bloquea ni tumba a los demás.
  await Promise.all([...groups.values()].map(group => flushGroup(env, group)));
}

// Reclama un lote de filas 'pending' de forma ATÓMICA marcándolas 'sent' en el mismo
// UPDATE (RETURNING) — evita que dos flushOutbox solapados (cada PATCH dispara su
// propio ctx.waitUntil(flushOutbox)) lean las mismas filas 'pending' y muten el mismo
// item dos veces en Monday.
//
// No se introduce un estado nuevo tipo 'sending': la tabla outbox tiene
// `CHECK (status IN ('pending','sent','confirmed','conflict','failed'))` (ver
// worker/schema.sql) y agregar un valor fuera de esa lista rompería el INSERT/UPDATE.
// dal.ts y echo.ts ya tratan 'pending' y 'sent' como equivalentes ("en vuelo, sin
// confirmar todavía" — ver `status IN ('pending','sent')` en ambos), así que reusar
// 'sent' como marca de reclamo es compatible con ese contrato existente. Si el mutate
// a Monday falla, flushGroup regresa esas filas puntuales a 'pending' (o 'failed' si
// ya agotaron intentos) — nunca quedan varadas en un estado intermedio.
async function claimPendingBatch(env: Env): Promise<OutboxRow[]> {
  const now = new Date().toISOString();
  const res = await env.DB
    .prepare(
      `UPDATE outbox SET status = 'sent', attempts = attempts + 1, updated_at = ?
       WHERE id IN (
         SELECT id FROM outbox WHERE status = 'pending' AND attempts < 5
         ORDER BY created_at LIMIT 20
       )
       RETURNING id, board_id, item_id, cols, attempts`,
    )
    .bind(now)
    .all<OutboxRow>();
  return res.results ?? [];
}

async function flushGroup(env: Env, group: OutboxRow[]): Promise<void> {
  const { board_id, item_id } = group[0];
  const now = new Date().toISOString();
  const ids = group.map(r => r.id);

  const cols: Record<string, string> = {};
  for (const row of group) Object.assign(cols, JSON.parse(row.cols) as Record<string, string>);
  const slug = boardById(board_id)?.slug;
  const boardMeta = slug ? (COLUMN_META[slug] ?? {}) : {};
  // Structured per-type encoding (not canonValue's flattened scalar) — Monday
  // rejects/no-ops complex types like board_relation without {item_ids:[...]}.
  const values: Record<string, unknown> = {};
  for (const [colId, raw] of Object.entries(cols)) {
    values[colId] = encodeColumnValue(boardMeta[colId]?.type ?? 'text', raw);
  }

  let item: MondayItem | null;
  try {
    item = await mondayMutate(env, board_id, item_id, values);
  } catch (err) {
    // La mutación en sí falló — Monday nunca recibió el write. Las filas ya estaban
    // reclamadas como 'sent' (claimPendingBatch); regrésalas a 'pending' para que el
    // siguiente flush reintente (o 'failed' si ya agotaron los 5 intentos).
    const detail = err instanceof Error ? err.message : String(err);
    for (const row of group) {
      const status = row.attempts >= 5 ? 'failed' : 'pending';
      await env.DB
        .prepare(`UPDATE outbox SET status = ?, updated_at = ? WHERE id = ?`)
        .bind(status, now, row.id)
        .run();
    }
    await env.DB
      .prepare(`INSERT INTO sync_log (kind, board_id, item_id, ok, detail, at) VALUES ('outbox', ?, ?, 0, ?, ?)`)
      .bind(board_id, item_id, detail, now)
      .run();
    return;
  }

  // El write ya llegó a Monday — de aquí en adelante las filas se quedan 'sent' pase
  // lo que pase. Un fallo al reflejarlo en D1 (abajo) NO debe reintentar la mutación:
  // el webhook posterior o el reconcile de 6h terminan de corregir el espejo.
  await env.DB
    .prepare(`INSERT INTO sync_log (kind, board_id, item_id, ok, detail, at) VALUES ('outbox', ?, ?, 1, ?, ?)`)
    .bind(board_id, item_id, `sent (${ids.length} row${ids.length > 1 ? 's' : ''})`, now)
    .run();

  try {
    if (item && slug) {
      // Confirma desde la respuesta de la MUTACIÓN misma — sin refetch extra a Monday
      // (era el round-trip que este cambio elimina).
      //
      // OJO — columnas mirror/lookup asíncronas (p.ej. Institución `lookup_mm1bs976`,
      // que Monday recalcula SOLA tras cambiar Cliente `deal_contact`) NO vienen
      // actualizadas en esta respuesta inmediata de la mutación. Eso es esperado y
      // está BIEN: el `refetchItem` que este código reemplaza tampoco las veía al
      // instante (Monday las recalcula de forma diferida del lado suyo) — las recoge
      // el webhook posterior o el reconcile de 6h, igual que antes. No "arreglar" esto
      // agregando otro fetch aquí.
      await upsertItem(env, slug, item);
      await confirmOutboxEcho(env, board_id, item_id, item.column_values);
    } else {
      // Defensivo: la respuesta de la mutación no trajo column_values utilizables
      // (o board_id no resolvió a un slug conocido) — cae de vuelta al refetch clásico.
      await refetchItem(env, board_id, item_id);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await env.DB
      .prepare(`INSERT INTO sync_log (kind, board_id, item_id, ok, detail, at) VALUES ('outbox', ?, ?, 0, ?, ?)`)
      .bind(board_id, item_id, `write ok, confirmación de espejo falló: ${detail}`, now)
      .run();
  }
}

// Minimal inline Monday GQL client — deliberately not worker/lib/monday.ts (Module A
// owns it). ITEM_FIELDS/COL_FIELDS abajo duplican a propósito la forma que
// worker/lib/monday.ts usa en fetchItem (mismos campos que upsertItem/
// confirmOutboxEcho consumen) — si esa forma cambia allá, actualízala aquí también.
interface RawMutationCol {
  id: string; type: string; text: string | null; value: string | null;
  display_value?: string | null; linked_item_ids?: string[];
}
interface RawMutationItem {
  id: string; name: string; updated_at: string;
  group: { id: string } | null; parent_item: { id: string } | null;
  column_values: RawMutationCol[];
}
const COL_FIELDS = `id type text value ... on MirrorValue{display_value} ... on FormulaValue{display_value} ... on BoardRelationValue{display_value linked_item_ids}`;
const ITEM_FIELDS = `id name updated_at group{id} parent_item{id} column_values{${COL_FIELDS}}`;

// mirror/formula/board_relation columns no traen text/value usables en los campos
// genéricos (Monday los deja null) — display_value + linked_item_ids los sustituyen.
function normalizeCols(raw: RawMutationCol[]): MondayCol[] {
  return raw.map(c => ({
    id: c.id,
    type: c.type,
    text: (c.display_value !== undefined ? c.display_value : c.text) ?? null,
    value: c.linked_item_ids !== undefined ? JSON.stringify({ linked_item_ids: c.linked_item_ids }) : (c.value ?? null),
  }));
}

// Devuelve el item completo (con column_values) tal como quedó tras la mutación, para
// que flushGroup pueda confirmar el espejo sin un refetch aparte. null solo si Monday
// no regresó el item en la respuesta (caso defensivo — flushGroup cae a refetchItem).
async function mondayMutate(
  env: Env,
  boardId: number,
  itemId: number,
  columnValues: Record<string, unknown>,
): Promise<MondayItem | null> {
  const query = `mutation ($b: ID!, $i: ID!, $v: JSON!) {
    change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v, create_labels_if_missing: true) { ${ITEM_FIELDS} }
  }`;
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: env.MONDAY_API_KEY,
      'API-Version': '2025-04',
    },
    body: JSON.stringify({ query, variables: { b: String(boardId), i: String(itemId), v: JSON.stringify(columnValues) } }),
  });
  const body = (await res.json()) as {
    data?: { change_multiple_column_values?: RawMutationItem };
    errors?: { message: string }[];
  };
  if (!res.ok || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message ?? `monday mutation failed (${res.status})`);
  }
  const raw = body.data?.change_multiple_column_values;
  if (!raw) return null;
  return { ...raw, column_values: normalizeCols(raw.column_values ?? []) };
}
