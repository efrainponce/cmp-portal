// worker/lib/outbox.ts — optimistic write path: D1 mirror first, Monday async via waitUntil.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';
import type { WriteResponse } from '../../shared/dto';
import { BOARDS, boardById } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import { nativeStatusValue, assertNoNativeLink } from './nativeItems';
import { stampProductoEnLinea, stampInstitucionDeContacto, OPP_CONTACTO_REL } from './nativeMirrors';
import { dealStageValue } from '../../shared/dealStages';
import { canWrite } from '../../shared/visibility';
import { COLUMN_META } from '../../shared/column-meta.gen';
import { canonValue, writeHash } from './canon';
import { encodeColumnValue } from './columnEncode';
import { refetchItem, upsertItem, confirmOutboxEcho } from '../sync';
import { getItem } from './dal';
import { fichasDeProductos, productoIdDeWrite, SUB_FICHA, SUB_PRODUCTO_REL } from './ficha';
import type { RawCol } from './serialize';
import type { MondayItem, MondayCol } from './monday';
import { logProductoStatusFromPortalWrite } from './estadoProducto';
import { syncTallasPortal } from './airtable';
import { recordDirectChanges, isPortalWriteColumn, type DirectChange } from './activityLog';

/** Shape REAL de lectura de Monday para board_relation ({linked_item_ids:[...]}
 * — distinto del shape de ESCRITURA que espera la mutación, {item_ids:[...]},
 * ver columnEncode.ts). `canon` ya es el id plano (canonValue's board_relation
 * branch = colVal.trim()). IDs como STRING — verificado contra un
 * board_relation real de Monday en el mirror (deal_contact: linked_item_ids
 * llega como ["12017028945"], no [12017028945]; worker/lib/ocProveedorPdf.ts
 * compara por === contra un id de string, así que un number ahí nunca hace
 * match). Solo single-select — igual que columnEncode.ts, ningún camino de
 * este repo escribe relaciones múltiples. */
export function boardRelationValue(canon: string): { linked_item_ids: string[] } {
  const id = Number(canon);
  return { linked_item_ids: canon !== '' && Number.isFinite(id) ? [canon] : [] };
}

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
  // `name` no es una columna de Monday: es el nombre del item. Se acepta como
  // pseudo-columna dentro del mismo PATCH (change_multiple_column_values la
  // toma en su JSON — verificado en vivo 2026-08-13) y aquí abajo tiene tres
  // casos especiales: el espejo la guarda en items.name (no en el blob de
  // columnas), encodeColumnValue la manda como string pelón, y el echo la
  // compara contra item.name (worker/sync/echo.ts). Permiso normal por
  // whitelist: shared/visibility.ts la tiene con `w` en oportunidades/proyectos.
  if (cols && 'name' in cols) {
    const nombre = (cols.name ?? '').trim();
    if (!nombre) throw new OutboxError(400, 'El nombre no puede quedar vacío');
    if (nombre.length > 255) throw new OutboxError(400, 'El nombre no puede pasar de 255 caracteres');
    cols = { ...cols, name: nombre };
  }

  const colIds = Object.keys(cols ?? {});
  if (colIds.length === 0) throw new OutboxError(400, 'no columns');
  if (!opts.trusted) {
    for (const colId of colIds) {
      if (!canWrite(slug, colId, viewer.role)) throw new OutboxError(403, `cannot write ${colId}`);
    }
  }

  // scope 'own', no 'read': un líder de zona VE las oportunidades de su equipo pero
  // no las escribe (worker/lib/zonas.ts). 404 y no 403 — la propiedad no se filtra.
  const row = await getItem(env, slug, itemId, viewer, 'own');
  if (!row) throw new OutboxError(404, 'not found');

  const board = BOARDS[slug];
  const boardMeta = COLUMN_META[slug] ?? {};
  const types: Record<string, string> = {};
  for (const colId of colIds) types[colId] = boardMeta[colId]?.type ?? 'text';

  // Ligar un registro NATIVO (Zona Efrain) desde un item REAL mandaría a Monday
  // un id que allá no existe. Se ataja con un error legible en vez de dejar el
  // enlace roto — mismo guard que la creación (worker/lib/createRecord.ts).
  if (!isNativeId(itemId)) {
    for (const colId of colIds) {
      try {
        assertNoNativeLink(types[colId], colId, cols[colId], boardMeta[colId]?.title);
      } catch (err) {
        throw new OutboxError(400, err instanceof Error ? err.message : 'enlace no válido');
      }
    }
  }

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
    if (colId === 'name') {
      await env.DB
        .prepare(`UPDATE items SET name = ?, synced_at = ? WHERE board_id = ? AND item_id = ?`)
        .bind(cols.name, now, board.id, itemId)
        .run();
      continue;
    }
    const canon = canonValue(types[colId], cols[colId]);
    // Dos columnas necesitan un `value` con el shape REAL de Monday (no el
    // string plano de canonValue) porque algo más adelante lo parsea así —
    // y un item nativo nunca recibe el echo de Monday que normalmente lo
    // rellena, así que se stampea acá de una vez:
    //  - deal_stage: TODO el pipeline (crear línea, quoteVersions, notify)
    //    decide la etapa por `.index`, nunca por el label.
    //  - board_relation: dal.ts (linkedItemId/proyectoForOportunidad) espera
    //    {linked_item_ids:[...]} — lo necesita "Ganar" para encontrar el
    //    Proyecto ya ligado a una oportunidad nativa.
    let mergedValue = JSON.stringify(canon);
    if (isNativeId(itemId)) {
      if (colId === 'deal_stage') mergedValue = JSON.stringify(dealStageValue(canon));
      else if (types[colId] === 'board_relation') mergedValue = JSON.stringify(boardRelationValue(canon));
      // Cualquier otra columna `status` (project_status, Etapa Costeo,
      // embellecimiento…): también con `{index}`. Guardar el label suelto dejaba
      // al item fuera de TODOS los grupos de los boards, que filtran por índice
      // — bug real de la prueba end-to-end en producción (2026-08-18), donde el
      // Proyecto nativo desapareció del sidebar al reescribirse su status.
      else if (types[colId] === 'status') mergedValue = JSON.stringify(nativeStatusValue(slug, colId, canon));
    }
    const mergedCol: RawCol = { id: colId, type: types[colId], text: canon, value: mergedValue };
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

  // Ligar el producto arrastra su ficha comercial en el MISMO merge optimista.
  // El mirror de Monday (`lookup_mm0xw8p7`) no viene en la respuesta de la
  // mutación —Monday lo recalcula después y sin webhook— así que sin esto la
  // línea se queda sin descripción justo en el momento en que el vendedor
  // acaba de elegir el producto: la grid le pinta "Falta descripción" sobre una
  // línea que está completa, hasta que llegue un sync posterior (Efraín,
  // 2026-08-14). Los caminos de sync ya la resuelven igual (worker/lib/ficha.ts);
  // esto cubre la ventana optimista, que es la que el usuario ve.
  if (slug === 'oportunidades_sub' && SUB_PRODUCTO_REL in cols) {
    const productoId = productoIdDeWrite(cols[SUB_PRODUCTO_REL]);
    // Línea NATIVA: no hay espejos de Monday que se rellenen solos, así que se
    // copia el catálogo completo (SKU, ficha, colores, tallas, moneda, unidad,
    // proveedor) y se renombra la línea al producto — worker/lib/nativeMirrors.ts.
    if (isNativeId(itemId) && productoId) await stampProductoEnLinea(env, itemId, productoId);
    const ficha = productoId ? (await fichasDeProductos(env, [productoId])).get(productoId) : undefined;
    if (ficha) {
      const fichaJson = JSON.stringify({ id: SUB_FICHA, type: 'mirror', text: ficha, value: null } satisfies RawCol);
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
        .bind(SUB_FICHA, SUB_FICHA, fichaJson, fichaJson, now, board.id, itemId)
        .run();
    }
  }

  // Oportunidad NATIVA: la Institución es un espejo del Contacto y checkCosteo
  // la exige — sin esto "Mandar a costeo" es imposible en Zona Efrain.
  if (slug === 'oportunidades' && isNativeId(itemId) && OPP_CONTACTO_REL in cols) {
    const contactoId = Number(canonValue('board_relation', cols[OPP_CONTACTO_REL]));
    if (Number.isFinite(contactoId) && contactoId > 0) await stampInstitucionDeContacto(env, itemId, contactoId);
  }

  const canonCols: Record<string, string> = {};
  for (const colId of colIds) canonCols[colId] = canonValue(types[colId], cols[colId]);
  const contentHash = writeHash(canonCols, types);

  // Historial de "Estado del producto" (worker/lib/estadoProducto.ts) — se registra
  // AQUÍ, antes del merge optimista de arriba, porque `row` todavía trae el label
  // viejo real; una vez mergeado, el mirror pierde el shape {index} que el diff de
  // upsertItem necesita (ver notas del archivo). Solo aplica al board de líneas del
  // Proyecto — el resto de columnas/boards no llevan historial.
  if (slug === 'proyectos_sub' && 'color_mm0hqf79' in cols && row.parent_item_id) {
    const rawCols: RawCol[] = JSON.parse(row.columns || '[]');
    const oldLabel = rawCols.find(c => c.id === 'color_mm0hqf79')?.text ?? null;
    await logProductoStatusFromPortalWrite(env, {
      proyectosBoardId: BOARDS.proyectos.id,
      proyectoId: row.parent_item_id,
      subItemId: itemId,
      oldLabel,
      newLabel: cols['color_mm0hqf79'],
      actorEmail: viewer.email,
      comentario: cols['text_mm20gzsb'],
    });
  }

  // Actividad de las columnas que Monday registra con el usuario del TOKEN y
  // no con quien de verdad editó (worker/lib/activityLog.ts, PORTAL_WRITE_COLUMNS
  // — hoy el costeo de la línea del Proyecto). Se asienta aquí, con `row`
  // todavía pre-merge, para tener el valor anterior real; el eco que llegue
  // después por el delta sync se descarta al persistir. Best-effort: nunca
  // debe tumbar un write que ya quedó firme. Los items NATIVOS no pasan por
  // aquí — el bloque de abajo ya los registra completos.
  if (!isNativeId(itemId)) {
    const portalCols = colIds.filter(colId => isPortalWriteColumn(slug, colId));
    if (portalCols.length > 0) {
      try {
        const rawCols: RawCol[] = JSON.parse(row.columns || '[]');
        await recordDirectChanges(env, slug, portalCols.map(colId => ({
          boardId: board.id, itemId, event: 'update_column_value' as const,
          columnId: colId, columnTitle: boardMeta[colId]?.title ?? colId,
          previousText: rawCols.find(c => c.id === colId)?.text ?? null,
          newText: canonValue(types[colId], cols[colId]),
          userId: viewer.monday_user_id,
        })));
      } catch { /* best-effort */ }
    }
  }

  // Item nativo (Zona Efrain, "salir de Monday"): el merge optimista de arriba
  // YA ES la escritura real — no hay Monday del otro lado que confirme un echo,
  // así que jamás se encola outbox para estos ids. `pending: false`: a
  // diferencia del camino normal, esto ya quedó firme en D1.
  // Gap conocido (aceptado para este primer corte): si el patch toca una
  // authzCol (deal_owner/vendedor secundario), `vendedor_ids` NO se recalcula
  // aquí — solo se fija en la creación (submitCreateNative). Zona Efrain nace y
  // vive con un solo dueño fijo, así que no es una ruta que se ejercite hoy.
  if (isNativeId(itemId)) {
    // Tampoco hay activity_logs de Monday que jalar para este item — se
    // registra directo (worker/lib/activityLog.ts), leyendo el valor previo de
    // `row` (snapshot de ANTES del merge de arriba, todavía intacto). Best-effort:
    // nunca debe tumbar el write real que ya quedó firme en D1.
    try {
      const rawCols: RawCol[] = JSON.parse(row.columns || '[]');
      const changes: DirectChange[] = colIds.map(colId => colId === 'name'
        ? {
            boardId: board.id, itemId, event: 'update_name' as const,
            columnId: 'name', columnTitle: 'Nombre',
            previousText: row.name, newText: cols.name, userId: viewer.monday_user_id,
          }
        : {
            boardId: board.id, itemId, event: 'update_column_value' as const,
            columnId: colId, columnTitle: boardMeta[colId]?.title ?? colId,
            previousText: rawCols.find(c => c.id === colId)?.text ?? null,
            newText: canonValue(types[colId], cols[colId]),
            userId: viewer.monday_user_id,
          });
      await recordDirectChanges(env, slug, changes);
    } catch { /* best-effort */ }
    return { ok: true, pending: false };
  }

  await env.DB
    .prepare(
      `INSERT INTO outbox (board_id, item_id, cols, content_hash, author_email, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
    .bind(board.id, itemId, JSON.stringify(cols), contentHash, viewer.email, now, now)
    .run();

  // Airtable "Tallas Portal" (worker/lib/airtable.ts) — Compras es ahora el
  // dueño real de Tallas (los campos de Airtable son AI fields, la API los
  // rechaza), así que cada edición se re-empuja para que Airtable no se quede
  // con el valor viejo (Efraín, 2026-08-13).
  if (slug === 'productos' && 'text_mm5v6jhj' in cols) {
    ctx.waitUntil(syncTallasPortal(env, row, cols['text_mm5v6jhj']));
  }

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
      await confirmOutboxEcho(env, board_id, item_id, item.column_values, item.name);
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
