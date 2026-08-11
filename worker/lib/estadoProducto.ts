// worker/lib/estadoProducto.ts — historial de "Estado del producto" (color_mm0hqf79,
// board proyectos_sub, líneas producto+color+talla) + notificación de Incidencia/Retraso.
// El historial vive en D1 (estado_producto_historial, worker/schema.sql) precisamente
// para NO seguir agregando una columna de fecha en Monday por cada estado nuevo
// (Efraín, 2026-08-05: "no necesito una columna por cada una").
//
// Dos puntos de entrada, uno por origen del cambio:
//  - `logProductoStatusFromPortalWrite` — llamado SÍNCRONO desde worker/lib/outbox.ts
//    (submitWrite), comparando labels directo (la línea ya conocida antes del merge
//    optimista vs. el label que se está escribiendo). Trae `actorEmail`.
//  - `maybeLogProductoStatus` — llamado desde worker/sync/upsert.ts (mismo chokepoint
//    que maybeEmitProjectStatusChange), diffeando el `index` guardado en el mirror
//    D1 viejo vs. el nuevo. Cubre ediciones nativas en Monday (webhook/reconcile).
//
// Los dos NO se pisan: tras un write del portal, el merge optimista de submitWrite
// deja en D1 un `value` que es un string plano (sin `.index`, ver worker/lib/canon.ts
// canonValue para 'status') — así que cuando después flushGroup llama upsertItem con
// el item real de Monday, `statusIndex()` sobre ese `prevColumnsJson` no resuelve
// índice y `maybeLogProductoStatus` se sale sin registrar nada dos veces. Verificado
// contra el código real de canon.ts/outbox.ts, no asumido.
import type { Env } from '../env';
import { PRODUCT_STATUS_LABELS, PRODUCT_STATUS_NOTIFY } from '../../shared/notifications';
import { statusIndex, emitNotification, resolveRecipients, personIdsFromColumns } from './notify';
import { logSync } from '../sync/log';

const COL_ESTADO = 'color_mm0hqf79';
const VALID_LABELS = new Set(Object.values(PRODUCT_STATUS_LABELS));

let tableReady = false;

/** Mismo patrón que ensureZonaTables/ensureDocumentTables: la feature funciona sin
 * aplicar schema.sql a mano. */
async function ensureHistorialTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS estado_producto_historial (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_item_id   INTEGER NOT NULL,
    proyecto_id   INTEGER NOT NULL,
    estado_previo TEXT,
    estado_nuevo  TEXT NOT NULL,
    changed_at    TEXT NOT NULL,
    changed_by    TEXT,
    comentario    TEXT
  )`).run();
  await env.DB.batch([
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_estado_historial_proyecto ON estado_producto_historial(proyecto_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_estado_historial_sub ON estado_producto_historial(sub_item_id)'),
  ]);
  tableReady = true;
}

async function vendedorIdsOfProyecto(env: Env, proyectosBoardId: number, proyectoId: number): Promise<number[]> {
  try {
    const row = await env.DB.prepare(
      `SELECT vendedor_ids FROM items WHERE board_id = ? AND item_id = ?`,
    ).bind(proyectosBoardId, proyectoId).first<{ vendedor_ids: string }>();
    return row ? JSON.parse(row.vendedor_ids || '[]') : [];
  } catch {
    return [];
  }
}

/** monday_user_ids de la columna "Compras" (`project_owner`) del Proyecto padre —
 * para el selector 'comprador' (ver shared/notifications.ts, 2026-08-10). No hay
 * columna comprador_ids dedicada en el mirror (a diferencia de vendedor_ids), así
 * que se parsea del blob `columns` completo, igual que maybeEmitProjectStatusChange. */
async function compradorIdsOfProyecto(env: Env, proyectosBoardId: number, proyectoId: number): Promise<number[]> {
  try {
    const row = await env.DB.prepare(
      `SELECT columns FROM items WHERE board_id = ? AND item_id = ?`,
    ).bind(proyectosBoardId, proyectoId).first<{ columns: string }>();
    return row ? personIdsFromColumns(row.columns, 'project_owner') : [];
  } catch {
    return [];
  }
}

interface TransitionArgs {
  proyectosBoardId: number;
  proyectoId: number;
  subItemId: number;
  oldLabel: string | null;
  newLabel: string;
  actorEmail?: string;
  comentario?: string | null;
}

/** Inserta la fila de historial y, si el estado nuevo es "Incidencia/Retraso",
 * notifica al vendedor dueño del Proyecto + Compras. Compartido por los dos
 * puntos de entrada de abajo. */
async function recordTransition(env: Env, args: TransitionArgs): Promise<void> {
  await ensureHistorialTable(env);
  await env.DB.prepare(
    `INSERT INTO estado_producto_historial
      (sub_item_id, proyecto_id, estado_previo, estado_nuevo, changed_at, changed_by, comentario)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(
    args.subItemId, args.proyectoId, args.oldLabel, args.newLabel,
    new Date().toISOString(), args.actorEmail ?? null, args.comentario ?? null,
  ).run();

  const entry = PRODUCT_STATUS_NOTIFY[args.newLabel];
  if (!entry || entry.selectors.length === 0) return;
  const [vendedorIds, compradorIds] = await Promise.all([
    vendedorIdsOfProyecto(env, args.proyectosBoardId, args.proyectoId),
    compradorIdsOfProyecto(env, args.proyectosBoardId, args.proyectoId),
  ]);
  const recipients = await resolveRecipients(env, entry.selectors, { vendedorIds, compradorIds, actorEmail: args.actorEmail });
  for (const recipientEmail of recipients) {
    await emitNotification(env, {
      recipientEmail,
      severity: entry.severity ?? 'actualizacion',
      kind: 'product_status_change',
      title: 'Incidencia/Retraso reportada en un producto',
      boardKey: 'ejecucion',
      boardId: args.proyectosBoardId,
      itemId: args.proyectoId,
      actor: args.actorEmail,
      dedupeKey: `product_status:${args.subItemId}:${args.newLabel}:${recipientEmail}`,
    });
  }
}

export interface ProductStatusDiffArgs {
  proyectosBoardId: number;   // BOARDS.proyectos.id — para resolver 'owner' del selector de notificación
  proyectoId: number;         // parent_item_id de la línea
  subItemId: number;
  prevColumnsJson: string | null;
  newColumnsJson: string;
}

/** Diffea `color_mm0hqf79` por `index` — para el chokepoint de sync
 * (worker/sync/upsert.ts), mismo patrón que maybeEmitProjectStatusChange. Cubre
 * ediciones nativas en Monday (webhook/reconcile); las del portal ya se registraron
 * en `logProductoStatusFromPortalWrite` y no vuelven a dispararse aquí (ver nota de
 * archivo). Best-effort — nunca debe tronar el sync path que lo dispara. */
export async function maybeLogProductoStatus(env: Env, args: ProductStatusDiffArgs): Promise<void> {
  try {
    if (args.prevColumnsJson === null) return;   // creación/hydrate — sin estado previo que diffear
    const oldIndex = statusIndex(args.prevColumnsJson, COL_ESTADO);
    if (oldIndex === null) return;
    const newIndex = statusIndex(args.newColumnsJson, COL_ESTADO);
    if (newIndex === null) return;
    if (oldIndex === newIndex) return;

    const newLabel = PRODUCT_STATUS_LABELS[newIndex];
    if (!newLabel) return;
    const oldLabel = PRODUCT_STATUS_LABELS[oldIndex] ?? null;

    await recordTransition(env, {
      proyectosBoardId: args.proyectosBoardId, proyectoId: args.proyectoId, subItemId: args.subItemId,
      oldLabel, newLabel,
    });
  } catch (err) {
    await logSync(env, 'manual', args.proyectosBoardId ?? null, args.subItemId ?? null, false, 'notify: maybeLogProductoStatus ' + err);
  }
}

export interface PortalWriteArgs {
  proyectosBoardId: number;
  proyectoId: number;
  subItemId: number;
  oldLabel: string | null;   // label actual en el mirror ANTES del merge optimista
  newLabel: string;          // label que se está escribiendo (cols[COL_ESTADO] en submitWrite)
  actorEmail: string;
  comentario?: string | null;
}

/** Registra el cambio hecho vía PATCH del portal — llamado síncrono desde
 * worker/lib/outbox.ts (submitWrite) ANTES del merge optimista, para tener el label
 * viejo real. Fail-closed: una label desconocida (typo, columna mal armada) no se
 * registra en vez de ensuciar el historial. */
export async function logProductoStatusFromPortalWrite(env: Env, args: PortalWriteArgs): Promise<void> {
  try {
    const clean = args.newLabel.trim();
    if (!clean || clean === (args.oldLabel ?? '')) return;
    if (!VALID_LABELS.has(clean)) return;
    await recordTransition(env, {
      proyectosBoardId: args.proyectosBoardId, proyectoId: args.proyectoId, subItemId: args.subItemId,
      oldLabel: args.oldLabel, newLabel: clean, actorEmail: args.actorEmail, comentario: args.comentario,
    });
  } catch (err) {
    await logSync(env, 'manual', args.proyectosBoardId ?? null, args.subItemId ?? null, false, 'notify: logProductoStatusFromPortalWrite ' + err);
  }
}

/** Lectura para el tab "Ejecución" (GET /api/proyectos/:id/estado-historial). */
export interface EstadoHistorialRow {
  sub_item_id: number;
  estado_previo: string | null;
  estado_nuevo: string;
  changed_at: string;
  changed_by: string | null;
  comentario: string | null;
}

export async function listEstadoHistorial(env: Env, proyectoId: number): Promise<EstadoHistorialRow[]> {
  await ensureHistorialTable(env);
  const { results } = await env.DB.prepare(
    `SELECT sub_item_id, estado_previo, estado_nuevo, changed_at, changed_by, comentario
     FROM estado_producto_historial WHERE proyecto_id = ? ORDER BY changed_at DESC`,
  ).bind(proyectoId).all<EstadoHistorialRow>();
  return results ?? [];
}
