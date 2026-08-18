// worker/lib/notify.ts — Emisor del centro de notificaciones (fundación). Ruteo de
// destinatarios en shared/notifications.ts (decisión de Efraín, no cambiar solo).
// TODO envío BEST-EFFORT: nunca debe tirar el sync/write path que lo dispara —
// cualquier fallo se traga y se loguea a sync_log.
import type { Env } from '../env';
import type { Role } from '../../shared/types';
import type { RecipientSelector, StageNotifyEntry } from '../../shared/notifications';
import { STAGE_NOTIFY, PROJECT_STATUS_NOTIFY, PROJECT_STATUS_LABELS, PROJECT_STATUS_BOARD_KEY } from '../../shared/notifications';
import { DEAL_STAGE_LABELS } from '../../shared/dealStages';
import { BOARDS } from '../../shared/boards';
import { logSync } from '../sync/log';
import { notifyPortalWa } from '../wa/notify';
import type { RawCol } from './serialize';
import { zonaPrivadaMemberIds, isZonaPrivadaAdminPermitido } from './zonas';

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
  /** Solo para severidad 'importante': `false` la deja en la bandeja Importantes
   * pero SIN WhatsApp. Lo usan los comentarios (worker/lib/updateNotify.ts) —
   * Efraín 2026-08-18: el comentario pide atención, pero el WhatsApp se reserva
   * para menciones @ directas. Default (undefined) = se manda, como siempre. */
  wa?: boolean;
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

    // Fila nueva (no un replay del mismo dedupe_key) + severidad importante → WhatsApp,
    // salvo que el emisor lo apague explícitamente con `wa: false`.
    if (result.meta.changes > 0 && n.severity === 'importante' && n.wa !== false) {
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

// Para 'role:admin' hay que respetar la zona privada 'Efrain' (worker/lib/zonas.ts,
// Efraín 2026-08-12): si el item cambia de etapa y su vendedor es miembro de esa
// zona, el selector 'role:admin' NO debe alcanzar a un admin fuera de su
// whitelist — si no, "nadie puede verla salvo estos dos" se rompe justo por
// notificaciones (única entrada de STAGE_NOTIFY con 'role:admin' hoy: 'Costeo
// en validación'). Cualquier otro rol se resuelve igual que antes.
async function emailsByRole(env: Env, role: Role, vendedorIds: number[] = []): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT email, monday_user_id FROM identity WHERE role = ? AND active = 1`,
  ).bind(role).all<{ email: string; monday_user_id: number }>();
  const rows = results ?? [];
  if (role !== 'admin' || vendedorIds.length === 0) return rows.map(r => r.email);
  const zonaPrivadaMembers = await zonaPrivadaMemberIds(env);
  const esZonaPrivada = vendedorIds.some(id => zonaPrivadaMembers.includes(id));
  if (!esZonaPrivada) return rows.map(r => r.email);
  return rows.filter(r => isZonaPrivadaAdminPermitido(r.monday_user_id)).map(r => r.email);
}

export interface ResolveContext {
  vendedorIds?: number[];      // para selector 'owner'
  compradorIds?: number[];     // para selector 'comprador'
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
      } else if (sel === 'comprador') {
        for (const id of ctx.compradorIds ?? []) {
          const email = await emailByMondayUserId(env, id);
          if (email) set.add(email);
        }
      } else if (sel === 'actor') {
        if (ctx.actorEmail) set.add(ctx.actorEmail);
      } else if (sel === 'mentioned') {
        for (const email of ctx.mentionedEmails ?? []) set.add(email);
      } else if (sel.startsWith('role:')) {
        const role = sel.slice('role:'.length) as Role;
        for (const email of await emailsByRole(env, role, ctx.vendedorIds ?? [])) set.add(email);
      } else if (sel.startsWith('email:')) {
        set.add(sel.slice('email:'.length));
      }
    }
    if (ctx.actorEmail) set.delete(ctx.actorEmail);
    return [...set];
  } catch (err) {
    await logSync(env, 'manual', null, null, false, 'notify: resolveRecipients ' + err);
    return [];
  }
}

/** monday_user_ids de una columna people/multiple_person dentro de un blob de
 * columnas crudo (mismo shape que `columns` del mirror). Usada para resolver el
 * selector 'comprador' sin depender de una columna dedicada en `items` (a
 * diferencia de vendedor_ids, que sí se persiste — ver worker/sync/upsert.ts). */
export function personIdsFromColumns(columnsJson: string, colId: string): number[] {
  try {
    const cols: RawCol[] = JSON.parse(columnsJson || '[]');
    const col = cols.find(c => c.id === colId);
    if (!col?.value) return [];
    const parsed = JSON.parse(col.value) as { personsAndTeams?: Array<{ id: number | string; kind?: string }> };
    return (parsed.personsAndTeams ?? [])
      .filter(p => (p.kind ?? 'person') === 'person')
      .map(p => Number(p.id))
      .filter(n => !Number.isNaN(n));
  } catch {
    return [];
  }
}

export function statusIndex(columnsJson: string, colId: string): string | null {
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
  compradorColId?: string;   // columna people del comprador asignado a ESTE item, para el selector 'comprador'
  colId: string;
  labels: Record<string, string>;
  notifyMap: Record<string, StageNotifyEntry>;
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
    const entry = args.notifyMap[label];
    if (!entry || entry.selectors.length === 0) return;

    const boardKey = typeof args.boardKey === 'function' ? args.boardKey(newIndex) : args.boardKey;
    const compradorIds = args.compradorColId ? personIdsFromColumns(args.newColumnsJson, args.compradorColId) : [];
    const recipients = await resolveRecipients(env, entry.selectors, { vendedorIds: args.vendedorIds, compradorIds });
    for (const recipientEmail of recipients) {
      await emitNotification(env, {
        recipientEmail,
        severity: entry.severity ?? 'actualizacion',
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

/** Notificación de etapa para un cambio hecho DESDE el portal (submitWrite),
 * no detectado por el diff de sync: el merge optimista de outbox.ts ya dejó la
 * etapa nueva en `items.columns`, así que cuando llega el echo de Monday
 * maybeEmitStageChange ve viejo == nuevo y calla. El caller la dispara a mano
 * con el label que acaba de escribir; misma whitelist (STAGE_NOTIFY, decisión
 * de Efraín) y mismo dedupe_key que el camino automático, así que si alguna vez
 * los dos coinciden el INSERT OR IGNORE deja una sola. Best-effort.
 * Hoy la usa "Validar costeo" (7→9, worker/lib/costeo.ts). */
export async function emitStageNotification(env: Env, args: {
  itemId: number;
  itemName: string;
  stageIndex: string;          // índice canon de DEAL_STAGE_LABELS ('9' = Costeo Confirmado)
  columnsJson: string;         // `columns` del mirror — de ahí sale el comprador asignado
  vendedorIds: number[];
  actorEmail?: string;         // quien disparó: resolveRecipients nunca se auto-notifica
}): Promise<void> {
  try {
    const label = DEAL_STAGE_LABELS[args.stageIndex];
    if (!label) return;
    const entry = STAGE_NOTIFY[label];
    if (!entry || entry.selectors.length === 0) return;

    const compradorIds = personIdsFromColumns(args.columnsJson, 'multiple_person_mm03qyw9');
    const recipients = await resolveRecipients(env, entry.selectors, {
      vendedorIds: args.vendedorIds, compradorIds, actorEmail: args.actorEmail,
    });
    for (const recipientEmail of recipients) {
      await emitNotification(env, {
        recipientEmail,
        severity: entry.severity ?? 'actualizacion',
        kind: 'stage_change',
        title: `${args.itemName} pasó a ${label}`,
        boardKey: 'oportunidades',
        boardId: BOARDS.oportunidades.id,
        itemId: args.itemId,
        actor: args.actorEmail ?? null,
        dedupeKey: `stage:${args.itemId}:${args.stageIndex}:${recipientEmail}`,
      });
    }
  } catch (err) {
    await logSync(env, 'manual', BOARDS.oportunidades.id, args.itemId, false, 'notify: emitStageNotification ' + err);
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
    compradorColId: 'multiple_person_mm03qyw9',   // "Compras" de Oportunidades
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
    compradorColId: 'project_owner',   // "Compras" de Proyectos (copiada de la Oportunidad al ganar)
    labels: PROJECT_STATUS_LABELS,
    notifyMap: PROJECT_STATUS_NOTIFY,
    boardKey: (newIndex) => PROJECT_STATUS_BOARD_KEY[newIndex] ?? 'doctallas',
    kind: 'project_status_change',
    dedupePrefix: 'project_status',
  });
}
