// worker/lib/notify.ts — Emisor del centro de notificaciones (fundación). Ruteo de
// destinatarios en shared/notifications.ts (decisión de Efraín, no cambiar solo).
// TODO envío BEST-EFFORT: nunca debe tirar el sync/write path que lo dispara —
// cualquier fallo se traga y se loguea a sync_log.
import type { Env } from '../env';
import type { Role } from '../../shared/types';
import type { RecipientSelector } from '../../shared/notifications';
import { STAGE_NOTIFY } from '../../shared/notifications';
import { DEAL_STAGE_LABELS } from '../../shared/dealStages';
import { logSync } from '../sync/log';
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
    await env.DB.prepare(
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

function dealStageIndex(columnsJson: string): string | null {
  try {
    const cols: RawCol[] = JSON.parse(columnsJson || '[]');
    const col = cols.find(c => c.id === 'deal_stage');
    if (!col?.value) return null;
    const parsed = JSON.parse(col.value) as { index?: number | string };
    if (parsed.index === undefined || parsed.index === null || parsed.index === '') return null;
    return String(parsed.index);
  } catch {
    return null;
  }
}

/** Diff de etapa para el chokepoint de sync (worker/sync/upsert.ts). Compara el
 * índice de deal_stage viejo vs nuevo; si cambió y la etapa nueva está en
 * STAGE_NOTIFY, emite una 'actualizacion' a los destinatarios role-based.
 * `prevColumnsJson` = el JSON de la columna `columns` de la fila anterior del
 * mirror (string) o null si no había fila (creación → no notifica). `item` trae
 * name + item_id + boardId; `vendedorIds` ya extraído por upsert. Best-effort. */
export async function maybeEmitStageChange(env: Env, args: {
  boardId: number;
  itemId: number;
  itemName: string;
  prevColumnsJson: string | null;
  newColumnsJson: string;
  vendedorIds: number[];
}): Promise<void> {
  try {
    if (args.prevColumnsJson === null) return;   // creación/hydrate — no notifica
    const oldIndex = dealStageIndex(args.prevColumnsJson);
    if (oldIndex === null) return;
    const newIndex = dealStageIndex(args.newColumnsJson);
    if (newIndex === null) return;
    if (oldIndex === newIndex) return;

    const label = DEAL_STAGE_LABELS[newIndex];
    if (!label) return;
    const selectors = STAGE_NOTIFY[label];
    if (!selectors || selectors.length === 0) return;

    const recipients = await resolveRecipients(env, selectors, { vendedorIds: args.vendedorIds });
    for (const recipientEmail of recipients) {
      await emitNotification(env, {
        recipientEmail,
        severity: 'actualizacion',
        kind: 'stage_change',
        title: `${args.itemName} pasó a ${label}`,
        boardKey: 'oportunidades',
        boardId: args.boardId,
        itemId: args.itemId,
        dedupeKey: `stage:${args.itemId}:${newIndex}`,
      });
    }
  } catch (err) {
    await logSync(env, 'manual', args.boardId ?? null, args.itemId ?? null, false, 'notify: maybeEmitStageChange ' + err);
  }
}
