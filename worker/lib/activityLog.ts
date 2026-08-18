// worker/lib/activityLog.ts — Log de actividad por item (Oportunidades +
// líneas, Productos). Dos orígenes, misma tabla/shape — nunca los dos para el
// mismo item:
//  - Items REALES de Monday: sourced de los mismos activity_logs que ya jala
//    el delta sync (worker/sync/delta.ts) — antes se tiraban tras usar solo
//    `data.pulse_id`, aquí se persisten filtrados (parseEntry/persistActivityEntries).
//  - Items NATIVOS ("salir de Monday", Zona Efrain, shared/nativeId.ts): no
//    existen del lado de Monday, así que no hay activity_logs que jalar —
//    worker/lib/outbox.ts y worker/lib/createRecord.ts escriben aquí DIRECTO
//    en el momento del write (recordDirectChanges), con el mismo shape para
//    que el mismo GET .../activity y el mismo ActividadTab sirvan a los dos
//    sin que el front tenga que saber cuál es cuál (Efraín, 2026-08-14: "no
//    quiero duplicar info, cuando está en Monday es solo Monday").
// NO usa shared/visibility.ts: esa whitelist es de PERMISOS (quién lee/escribe),
// esta es de RUIDO (qué columna vale la pena mostrar como "actividad" — la
// mayoría de las columnas de un item son mirrors/formulas que se recalculan
// solas, o campos que automatizaciones tocan constantemente sin que sea una
// decisión de alguien). PROPUESTA 2026-08-14, pendiente ajuste de Efraín —
// mismo trato que las columnas "PROPOSED" de shared/visibility.ts.
import type { Env } from '../env';
import type { BoardSlug } from '../../shared/boards';
import { boardById } from '../../shared/boards';
import type { ActivityLogEntry } from './monday';

// create_pulse y update_name siempre se registran (ver parseEntry abajo), sin
// importar la columna — bajo volumen, alta señal: verificado en vivo, ~28
// create_pulse / ~38 update_name en un día completo de Oportunidades, contra
// 590 update_column_value.
const WHITELIST: Partial<Record<BoardSlug, Set<string>>> = {
  oportunidades: new Set([
    'deal_stage', 'deal_owner', 'multiple_person_mm0wt53c', 'multiple_person_mm03qyw9',
    'multiple_person_mm1m73qp', 'dropdown_mm03g067', 'deal_expected_close_date',
    'deal_contact', 'color_mm0ex0ed', 'dropdown_mm0mg00', 'text_mm47xmh',
    'text_mm0gje0', 'text_mm0gjrrd', 'long_text_mm1m416j',
    'file_mm0zjras', 'file_mm0hpefr', 'boolean_mm3qf8yv', 'boolean_mm3q9zxm',
  ]),
  // Líneas de producto/costeo de la Oportunidad — incluye numeric_mkzneg3d
  // (Precio de Venta C/U) a propósito: es la columna "solo admin escribe"
  // (shared/visibility.ts, Efraín 2026-07-24), la más importante a poder
  // rastrear quién la cambió.
  oportunidades_sub: new Set([
    'color_mm084gvf', 'color_mm1eq4a0', 'text_mm0bxy39', 'text_mm07s2mg', 'text_mm0bkm1j',
    'numeric_mkzm6399', 'color_mm1b34bg', 'long_text_mm1bj4pt', 'long_text_mm1hyszv',
    'numeric_mm0bph99', 'numeric_mkzn2q51', 'numeric_mm0rvhgs', 'numeric_mkzngs9x',
    'numeric_mm0gxvpa', 'numeric_mkznpn83', 'numeric_mkzneg3d', 'numeric_mm0cg0bm',
    'numeric_mkznnm5s', 'color_mm5s709s', 'color_mm1r1052', 'board_relation_mkzmafgp',
    'file_mm5akjy5',
  ]),
  productos: new Set([
    'product_and_service_sku', 'text_mm0wvga2', 'product_and_service_description',
    'dropdown_mkztty4b', 'text_mkzp9428', 'numeric_mkzpx7eb', 'text_mkzp59zf',
    'numeric_mm0bnkch', 'numeric_mm0bgd2f', 'text_mkzpbhb5', 'long_text_mm0xse7v',
    'dropdown_mm07pjsv', 'board_relation_mm1cwqky', 'boolean_mm5cqtjs', 'text_mm5v6jhj',
    'long_text_mm1tcga0',
  ]),
  // Líneas del Proyecto — el costeo de la OC (Efraín, 2026-08-18: "guardar la
  // actividad por si cometemos error"). Estado del producto NO va aquí: ya
  // tiene su propio historial con comentario (worker/lib/estadoProducto.ts) y
  // duplicarlo llenaría de ruido el tab.
  proyectos_sub: new Set([
    'numeric_mm1dj4fp', 'numeric_mm1dmsaz', 'text_mm1gdsvg', 'numeric_mm0hj2q4',
    'board_relation_mm1cfgv5', 'date_mm20xdtm',
  ]),
};

// Columnas cuyo cambio DESDE EL PORTAL se registra directo en el momento del
// write (worker/lib/outbox.ts), aunque el item sea real de Monday. Motivo:
// Monday atribuye TODA escritura del portal al dueño del token de la API, así
// que su activity_log dice siempre la misma persona — inútil justo donde el
// punto es saber quién se equivocó (Efraín, 2026-08-18, costo de la OC).
// El camino de Monday sigue activo para estas columnas (alguien puede editarlas
// dentro de Monday.com); el eco del propio portal se descarta al persistir —
// ver `recentPortalWrite` en persistActivityEntries.
const PORTAL_WRITE_COLUMNS: Partial<Record<BoardSlug, Set<string>>> = {
  proyectos_sub: WHITELIST.proyectos_sub,
};

function isWhitelisted(boardSlug: BoardSlug, columnId: string): boolean {
  return WHITELIST[boardSlug]?.has(columnId) ?? false;
}

/** ¿Este write del portal se registra directo, sin esperar al activity_log de
 * Monday? Lo consulta worker/lib/outbox.ts para armar las filas con el actor real. */
export function isPortalWriteColumn(boardSlug: BoardSlug, columnId: string): boolean {
  return PORTAL_WRITE_COLUMNS[boardSlug]?.has(columnId) ?? false;
}

/** `created_at` de Monday son ticks de 100ns desde epoch Unix (verificado en
 * vivo 2026-08-14: dividir entre 10,000 da milisegundos que calzan con la
 * fecha real del evento). El valor excede Number.MAX_SAFE_INTEGER, así que la
 * división va en BigInt — Number() directo sobre el string pierde precisión y
 * corre la fecha varios minutos. */
export function ticksToIso(ticks: string): string {
  const ms = BigInt(ticks) / 10000n;
  return new Date(Number(ms)).toISOString();
}

interface ParsedRow {
  boardId: number; itemId: number; event: string;
  columnId: string | null; columnTitle: string | null;
  previousText: string | null; newText: string | null;
  userId: number | null; createdAtTicks: string;
}

/** Traduce un ActivityLogEntry crudo a la fila a insertar, o null si no pasa
 * la whitelist — pura, testeada aparte del I/O de D1. */
export function parseEntry(entry: ActivityLogEntry): ParsedRow | null {
  if (entry.entity !== 'pulse') return null;
  const board = boardById(entry.boardId);
  if (!board || !(board.slug in WHITELIST)) return null;

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(entry.data); } catch { return null; }
  const pulseId = Number(parsed.pulse_id);
  if (!Number.isFinite(pulseId)) return null;
  const userId = Number(entry.userId);

  const base = {
    boardId: entry.boardId, itemId: pulseId,
    userId: Number.isFinite(userId) ? userId : null,
    createdAtTicks: entry.createdAt,
  };

  if (entry.event === 'create_pulse') {
    return { ...base, event: entry.event, columnId: null, columnTitle: null, previousText: null, newText: (parsed.pulse_name as string) ?? null };
  }
  if (entry.event === 'update_name') {
    const prev = parsed.previous_value as { name?: string } | undefined;
    const next = parsed.value as { name?: string } | undefined;
    return { ...base, event: entry.event, columnId: 'name', columnTitle: 'Nombre', previousText: prev?.name ?? null, newText: next?.name ?? null };
  }
  if (entry.event !== 'update_column_value') return null;
  const columnId = parsed.column_id as string | undefined;
  if (!columnId || !isWhitelisted(board.slug, columnId)) return null;
  return {
    ...base, event: entry.event, columnId,
    columnTitle: (parsed.column_title as string) ?? columnId,
    previousText: (parsed.previous_textual_value as string) ?? null,
    newText: (parsed.textual_value as string) ?? null,
  };
}

let tableReady = false;

async function ensureTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS activity_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id      INTEGER NOT NULL,
    item_id       INTEGER NOT NULL,
    event         TEXT NOT NULL,
    column_id     TEXT,
    column_title  TEXT,
    previous_text TEXT,
    new_text      TEXT,
    user_id       INTEGER,
    created_at    TEXT NOT NULL,
    dedupe_key    TEXT NOT NULL UNIQUE
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_activity_log_item ON activity_log(board_id, item_id)').run();
  tableReady = true;
}

// `action_record_uuid` (visto en algunos update_column_value) NO siempre viene
// en la respuesta de Monday — no sirve como llave de dedupe. Se arma una
// propia con lo que SIEMPRE está: es prácticamente imposible que dos eventos
// distintos calcen en board+item+evento+columna+tick (resolución de 100ns).
function dedupeKey(r: ParsedRow): string {
  return `${r.boardId}:${r.itemId}:${r.event}:${r.columnId ?? '_'}:${r.createdAtTicks}`;
}

// Ventana para reconocer el eco de un write del portal en el activity_log de
// Monday. El delta sync corre cada 15 min sobre una ventana que arranca en su
// checkpoint anterior, así que un evento puede tardar hasta ~15 min en llegar;
// 45 dan holgura para una corrida saltada sin abrir tanto como para tragarse
// una edición distinta. Si alguien pone EL MISMO valor a mano en Monday dentro
// de la ventana, esa fila se descarta — no se pierde información (el valor
// nuevo ya está registrado), solo el segundo asiento redundante.
const PORTAL_ECHO_WINDOW_MS = 45 * 60 * 1000;

/** ¿Ya existe una fila de este mismo cambio, escrita directo por el portal
 * (worker/lib/outbox.ts), dentro de la ventana de eco? Solo se consulta para
 * las columnas de PORTAL_WRITE_COLUMNS — el resto no tiene camino directo con
 * el que chocar. */
async function recentPortalWrite(env: Env, r: ParsedRow, createdAt: string): Promise<boolean> {
  const since = new Date(new Date(createdAt).getTime() - PORTAL_ECHO_WINDOW_MS).toISOString();
  const hit = await env.DB.prepare(
    `SELECT 1 FROM activity_log
      WHERE board_id = ? AND item_id = ? AND column_id = ?
        AND created_at >= ? AND created_at <= ?
        AND IFNULL(new_text, '') = IFNULL(?, '')
        AND dedupe_key LIKE 'direct:%'
      LIMIT 1`,
  ).bind(r.boardId, r.itemId, r.columnId, since, createdAt, r.newText).first();
  return hit != null;
}

/** Filtra + persiste. Best-effort por fila: un tick/columna rara en un evento
 * no debe tumbar el resto del batch (mismo espíritu que el resto del delta
 * sync — ver worker/sync/delta.ts). Devuelve cuántas filas nuevas insertó. */
export async function persistActivityEntries(env: Env, entries: ActivityLogEntry[]): Promise<number> {
  const rows = entries.map(parseEntry).filter((r): r is ParsedRow => r !== null);
  if (rows.length === 0) return 0;
  await ensureTable(env);

  let inserted = 0;
  for (const r of rows) {
    try {
      const createdAt = ticksToIso(r.createdAtTicks);
      const slug = boardById(r.boardId)?.slug;
      if (slug && r.columnId && isPortalWriteColumn(slug, r.columnId)
          && await recentPortalWrite(env, r, createdAt)) continue;
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO activity_log
          (board_id, item_id, event, column_id, column_title, previous_text, new_text, user_id, created_at, dedupe_key)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        r.boardId, r.itemId, r.event, r.columnId, r.columnTitle,
        r.previousText, r.newText, r.userId, createdAt, dedupeKey(r),
      ).run();
      if (result.meta.changes > 0) inserted++;
    } catch { /* fila rara (tick no numérico, etc.) — se salta, no tumba el batch */ }
  }
  return inserted;
}

export interface DirectChange {
  // 'delete_pulse' no existe en el activity_log de Monday (borrar un item se
  // registra allá como un evento de otra forma que el delta sync no jala): lo
  // asienta el portal contra el item PADRE, porque una fila colgada del item
  // borrado sería inalcanzable — GET .../activity arma sus targets con los
  // hijos VIGENTES (worker/routes/boards.ts).
  boardId: number; itemId: number; event: 'create_pulse' | 'update_name' | 'update_column_value' | 'delete_pulse';
  columnId: string | null; columnTitle: string | null;
  previousText: string | null; newText: string | null;
  userId: number;
}

/** Escritura directa, sin pasar por el activity_log de Monday. Dos llamadores:
 *  - items NATIVOS (ver nota de archivo): no existen del lado de Monday.
 *  - columnas de PORTAL_WRITE_COLUMNS en items REALES: Monday sí las registra,
 *    pero atribuidas al dueño del token de la API; el actor real solo lo
 *    conoce el portal. El eco de Monday se descarta después (recentPortalWrite).
 * El caller (outbox.ts/createRecord.ts) ya trae todo lo que parseEntry extrae
 * de un activity_log real: valor previo/nuevo, actor y momento del write.
 * Best-effort por fila — nunca debe tumbar el write real que la dispara.
 * Dedupe con UUID: es un INSERT único por write, no un poll con ventanas que
 * se traslapan; el prefijo `direct:` es lo que marca la fila como "escrita por
 * el portal" para recentPortalWrite. */
export async function recordDirectChanges(env: Env, boardSlug: BoardSlug, changes: DirectChange[]): Promise<void> {
  const relevant = changes.filter(c => c.event !== 'update_column_value' || isWhitelisted(boardSlug, c.columnId ?? ''));
  if (relevant.length === 0) return;
  await ensureTable(env);
  const now = new Date().toISOString();
  for (const c of relevant) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO activity_log
          (board_id, item_id, event, column_id, column_title, previous_text, new_text, user_id, created_at, dedupe_key)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        c.boardId, c.itemId, c.event, c.columnId, c.columnTitle,
        c.previousText, c.newText, c.userId, now, `direct:${crypto.randomUUID()}`,
      ).run();
    } catch { /* best-effort — nunca debe tumbar el write real */ }
  }
}

export interface ActivityLogRow {
  board_id: number; item_id: number; event: string;
  column_id: string | null; column_title: string | null;
  previous_text: string | null; new_text: string | null; user_id: number | null; created_at: string;
}

// D1 rechaza queries con más de ~100 parámetros ligados; a 2 binds por target,
// una oportunidad con 50+ líneas tiraba el tab Actividad completo. Lotes de 45
// (90 binds) y el orden/cap se resuelven al final sobre el total.
const TARGETS_PER_QUERY = 45;

/** Actividad para uno o más (board, item) — Oportunidades trae también sus
 * líneas (oportunidades_sub), el caller arma la lista. Cap de 200: es un tab
 * de drawer, no un reporte. Trae board_id/column_id para que el caller pueda
 * aplicar visibilidad por rol (shared/visibility.ts) — la WHITELIST de arriba
 * es de ruido, no de permisos. */
export async function listActivity(
  env: Env, targets: { boardId: number; itemId: number }[],
): Promise<ActivityLogRow[]> {
  if (targets.length === 0) return [];
  await ensureTable(env);
  const all: ActivityLogRow[] = [];
  for (let i = 0; i < targets.length; i += TARGETS_PER_QUERY) {
    const chunk = targets.slice(i, i + TARGETS_PER_QUERY);
    const clauses = chunk.map(() => '(board_id = ? AND item_id = ?)').join(' OR ');
    const binds = chunk.flatMap(t => [t.boardId, t.itemId]);
    const { results } = await env.DB.prepare(
      `SELECT board_id, item_id, event, column_id, column_title, previous_text, new_text, user_id, created_at
       FROM activity_log WHERE ${clauses} ORDER BY created_at DESC LIMIT 200`,
    ).bind(...binds).all<ActivityLogRow>();
    all.push(...(results ?? []));
  }
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return all.slice(0, 200);
}
