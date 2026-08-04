// worker/lib/notify.ts — Emisor del centro de notificaciones (fundación). Ruteo de
// destinatarios en shared/notifications.ts (decisión de Efraín, no cambiar solo).
// TODO envío BEST-EFFORT: nunca debe tirar el sync/write path que lo dispara —
// cualquier fallo se traga y se loguea a sync_log.
import type { Env } from '../env';
import type { Role } from '../../shared/types';
import type { RecipientSelector } from '../../shared/notifications';
import { STAGE_NOTIFY, PROJECT_STATUS_NOTIFY, PROJECT_STATUS_LABELS, PROJECT_STATUS_BOARD_KEY } from '../../shared/notifications';
import { DEAL_STAGE_LABELS } from '../../shared/dealStages';
import { logSync } from '../sync/log';
import { notifyPortalWa } from '../wa/notify';
import type { RawCol } from './serialize';

export type Severity = 'importante' | 'actualizacion';

export interface NotifyInput {
  recipientEmail: string;
  severity: Severity;
  kind: string;
  title: string;
  body?: string | null;
  boardKey?: string | null;
  boardId?: number | null;
  itemId?: number | null;
  actor?: string | null;
  dedupeKey: string;
}

/** INSERT OR IGNORE (idempotente por dedupe_key UNIQUE). Best-effort: cualquier
 * fallo se loguea a sync_log y se traga — nunca rompe al caller. */
export async function emitNotification(env: Env, n: NotifyInput): Promise<void> {
  try {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO notifications
        (recipient_email, severity, kind, title, body, board_key, board_id, item_id, actor, dedupe_key, read_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?)`,
    ).bind(
      n.recipientEmail,
      n.severity,
      n.kind,
      n.title,
      n.body ?? null,
      n.boardKey ?? null,
      n.boardId ?? null,
      n.itemId ?? null,
      n.actor ?? null,
      n.dedupeKey,
      new Date().toISOString(),
    ).run();

    // Fila nueva (no un replay del mismo dedupe_key) + severidad importante → WhatsApp.
    if (result.meta.changes > 0 && n.severity === 'importante') {
      await notifyPortalWa(env, n);
    }
  } catch (err) {
    await logSync(env, 'manual', n.boardId ?? null, n.itemId ?? null, false, 'notify: ' + err);
  }
}

async function emailByMondayUserId(env: Env, id: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT email FROM identity WHERE monday_user_id = ? AND active = 1`,
  ).bind(id).first<{ email: string }>();
  return row?.email ?? null;
}

async function emailsByRole(env: Env, role: Role): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT email FROM identity WHERE role = ? AND active = 1`,
  ).bind(role).all<{ email: string }>();
  return (results ?? []).map(r => r.email);
}

export interface ResolveContext {
  vendedorIds?: number[];      // para selector 'owner'
  actorEmail?: string;         // para selector 'actor'; SIEMPRE se excluye del set final
  mentionedEmails?: string[];  // para selector 'mentioned'
}

/** Resuelve selectores a emails de identidades ACTIVAS, de-dup, fail-closed
 * (ids/roles desconocidos se saltan). SIEMPRE excluye ctx.actorEmail del
 * resultado (nunca auto-notificar). */
export async function resolveRecipients(
  env: Env, selectors: RecipientSelector[], ctx: ResolveContext,
): Promise<string[]> {
  try {
    const set = new Set<string>();
    for (const sel of selectors) {
      if (sel === 'owner') {
        for (const id of ctx.vendedorIds ?? []) {
          const email = await emailByMondayUserId(env, id);
          if (email) set.add(email);
        }
      } else if (sel === 'actor') {
        if (ctx.actorEmail) set.add(ctx.actorEmail);
      } else if (sel === 'mentioned') {
        for (const email of ctx.mentionedEmails ?? []) set.add(email);
      } else if (sel.startsWith('role:')) {
        const role = sel.slice('role:'.length) as Role;
        for (const email of await emailsByRole(env, role)) set.add(email);
      }
    }
    if (ctx.actorEmail) set.delete(ctx.actorEmail);
    return [...set];
  } catch (err) {
    await logSync(env, 'manual', null, null, false, 'notify: resolveRecipients ' + err);
    return [];
  }
}

function statusIndex(columnsJson: string, colId: string): string | null {
  try {
    const cols: RawCol[] = JSON.parse(columnsJson || '[]');
    const col = cols.find(c => c.id === colId);
    if (!col?.value) return null;
    const parsed = JSON.parse(col.value) as { index?: number | string };
    if (parsed.index === undefined || parsed.index === null || parsed.index === '') return null;
    return String(parsed.index);
  } catch {
    return null;
  }
}

/** Diff genérico de una columna status para el chokepoint de sync
 * (worker/sync/upsert.ts). Compara el índice viejo vs nuevo de `colId`; si
 * cambió y la etiqueta nueva está en `notifyMap`, emite una 'actualizacion' a
 * los destinatarios role-based. `prevColumnsJson` = el JSON de la columna
 * `columns` de la fila anterior del mirror (string) o null si no había fila
 * (creación → no notifica). Best-effort. */
async function maybeEmitStatusChange(env: Env, args: {
  boardId: number;
  itemId: number;
  itemName: string;
  prevColumnsJson: string | null;
  newColumnsJson: string;
  vendedorIds: number[];
  colId: string;
  labels: Record<string, string>;
  notifyMap: Record<string, RecipientSelector[]>;
  boardKey: string | ((newIndex: string) => string);
  kind: string;
  dedupePrefix: string;
}): Promise<void> {
  try {
    if (args.prevColumnsJson === null) return;   // creación/hydrate — no notifica
    const oldIndex = statusIndex(args.prevColumnsJson, args.colId);
    if (oldIndex === null) return;
    const newIndex = statusIndex(args.newColumnsJson, args.colId);
    if (newIndex === null) return;
    if (oldIndex === newIndex) return;

    const label = args.labels[newIndex];
    if (!label) return;
    const selectors = args.notifyMap[label];
    if (!selectors || selectors.length === 0) return;

    const boardKey = typeof args.boardKey === 'function' ? args.boardKey(newIndex) : args.boardKey;
    const recipients = await resolveRecipients(env, selectors, { vendedorIds: args.vendedorIds });
    for (const recipientEmail of recipients) {
      await emitNotification(env, {
        recipientEmail,
        severity: 'actualizacion',
        kind: args.kind,
        title: `${args.itemName} pasó a ${label}`,
        boardKey,
        boardId: args.boardId,
        itemId: args.itemId,
        // dedupe_key es UNIQUE en toda la tabla (worker/schema.sql) — sin el
        // recipientEmail, dos destinatarios del mismo cambio de status pisan la
        // misma llave y el INSERT OR IGNORE calla a todos menos al primero.
        // Bug real preexistente (heredado de la versión original de
        // maybeEmitStageChange, un solo dedupeKey para todo el for) encontrado
        // verificando en vivo el 2026-08-04 con 'Proyecto Terminado': ['owner',
        // 'role:compras'] — solo llegaba una notificación de las 6 esperadas.
        dedupeKey: `${args.dedupePrefix}:${args.itemId}:${newIndex}:${recipientEmail}`,
      });
    }
  } catch (err) {
    await logSync(env, 'manual', args.boardId ?? null, args.itemId ?? null, false, 'notify: maybeEmitStatusChange ' + err);
  }
}

/** Diff de etapa (deal_stage) de Oportunidades — ver maybeEmitStatusChange. */
export function maybeEmitStageChange(env: Env, args: {
  boardId: number;
  itemId: number;
  itemName: string;
  prevColumnsJson: string | null;
  newColumnsJson: string;
  vendedorIds: number[];
}): Promise<void> {
  return maybeEmitStatusChange(env, {
    ...args,
    colId: 'deal_stage',
    labels: DEAL_STAGE_LABELS,
    notifyMap: STAGE_NOTIFY,
    boardKey: 'oportunidades',
    kind: 'stage_change',
    dedupePrefix: 'stage',
  });
}

/** Diff de `project_status` de Proyectos (post-venta) — ver maybeEmitStatusChange.
 * Reemplaza las notificaciones nativas de Monday por-elemento (no les llegan,
 * Compras vía WhatsApp 2026-08-04) con el mismo mecanismo D1-only ya probado
 * para Oportunidades. */
export function maybeEmitProjectStatusChange(env: Env, args: {
  boardId: number;
  itemId: number;
  itemName: string;
  prevColumnsJson: string | null;
  newColumnsJson: string;
  vendedorIds: number[];
}): Promise<void> {
  return maybeEmitStatusChange(env, {
    ...args,
    colId: 'project_status',
    labels: PROJECT_STATUS_LABELS,
    notifyMap: PROJECT_STATUS_NOTIFY,
    boardKey: (newIndex) => PROJECT_STATUS_BOARD_KEY[newIndex] ?? 'doctallas',
    kind: 'project_status_change',
    dedupePrefix: 'project_status',
  });
}
