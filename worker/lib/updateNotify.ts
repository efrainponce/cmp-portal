// worker/lib/updateNotify.ts — Notificaciones de COMENTARIOS (updates de Monday).
//
// Hasta 2026-08-18 un comentario solo generaba notificación si se escribía DESDE
// el portal Y etiquetaba a alguien con @: los comentarios que el equipo escribe
// dentro de monday.com no producían nada (ni siquiera las menciones nativas), así
// que en el portal "no llegaba ningún comentario" — solo cambios de etapa
// (Efraín, 2026-08-18). Este módulo es el emisor compartido por los dos caminos:
//
//   1. POST /api/boards/:slug/items/:id/updates (comentario escrito en el portal)
//   2. webhook `create_update` de Monday (comentario escrito dentro de monday.com)
//
// Ruteo (decisión de Efraín, 2026-08-18): vendedor dueño + comprador(es)
// asignado(s) al item + los mencionados, nunca el autor. Bandeja 'Importantes'
// (un comentario pide respuesta, no se debe perder entre 500+ cambios de etapa),
// pero SIN WhatsApp salvo que sea una mención directa — `wa: false` en el
// comentario simple.
import type { Env } from '../env';
import type { BoardSlug } from '../../shared/boards';
import { BOARDS, boardById } from '../../shared/boards';
import { emitNotification, resolveRecipients, personIdsFromColumns } from './notify';
import { logSync } from '../sync/log';

/** Firma que el portal agrega a todo update que publica (worker/routes/boards.ts).
 * El webhook la usa para NO re-notificar lo que ese POST ya notificó. */
export const PORTAL_SIGNATURE = 'vía Portal CMP';

// Updates de máquina: cmp-tallas/Make/automations de Monday publican en el mismo
// feed que las personas. Notificarlos duplicaría lo que ya avisa el cambio de
// etapa (STAGE_NOTIFY) y llenaría la campana de ruido. Los reportes del portal
// (cotización/OC/advertencias) salen con creator = dueño del token, así que el
// filtro es por CONTENIDO, no por autor. Textos verificados contra el feed real
// de Oportunidades y Proyectos el 2026-08-18.
const AUTOMATION_PATTERNS: RegExp[] = [
  /ha solicitado el costeo/i,
  /ha solicitado la validaci[óo]n del costeo/i,
  /ha solicitado confirmaci[óo]n de tallas/i,
  /el costeo fu[eé] validado/i,
  /^se intent[oó] generar/i,
  /^proceso omitido/i,
];

/** true = update de máquina (no notificar). Vacío también cuenta como no-notificable. */
export function isAutomationUpdate(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // Encabezados de los reportes que genera el propio portal/cmp-tallas.
  if (t.startsWith('**') || t.startsWith('⚠️') || t.startsWith('✅')) return true;
  return AUTOMATION_PATTERNS.some(re => re.test(t));
}

/** monday_user_ids etiquetados dentro del HTML de un update. Monday los emite como
 * `<a ... data-mention-type="User" data-mention-id="99293456">@Nombre</a>` (verificado
 * contra un update real, 2026-08-18) — así se recogen las menciones escritas DENTRO
 * de monday.com, que antes el portal ignoraba por completo. */
export function mentionIdsFromBody(html: string): number[] {
  const ids = new Set<number>();
  const re = /data-mention-type="User"[^>]*?data-mention-id="(\d+)"|data-mention-id="(\d+)"[^>]*?data-mention-type="User"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = Number(m[1] ?? m[2]);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/** board_key del deep link de la notificación (src/lib/routing.ts): Proyectos se
 * lista bajo 'doctallas'. Compartido con la ruta de updates de boards.ts. */
export function notifyBoardKey(slug: string): string {
  if (slug === 'proyectos') return 'doctallas';
  return slug;
}

async function identityByMondayUserId(
  env: Env, id: number,
): Promise<{ email: string; nombre: string | null } | null> {
  if (!Number.isFinite(id)) return null;
  const row = await env.DB.prepare(
    `SELECT email, nombre FROM identity WHERE monday_user_id = ? AND active = 1`,
  ).bind(id).first<{ email: string; nombre: string | null }>();
  return row ?? null;
}

export interface CommentNotifyArgs {
  slug: BoardSlug;
  itemId: number;
  itemName: string;
  updateId: string;
  text: string;                 // texto plano del comentario (para el cuerpo)
  columnsJson: string;          // `columns` del mirror — de ahí sale el comprador asignado
  vendedorIds: number[];
  actorEmail?: string | null;   // nunca se auto-notifica
  actorName?: string | null;
  mentionIds?: number[];        // monday_user_ids etiquetados con @
}

/** Emite las notificaciones de UN comentario. Best-effort: nunca lanza — un fallo
 * aquí no debe tumbar ni el POST del portal ni el webhook. Idempotente por
 * dedupe_key, así que un reintento del webhook no duplica.
 *
 * Las menciones conservan la llave `mention:<updateId>:<email>` que ya usaba el
 * portal: si el mismo comentario llega por los dos caminos, el INSERT OR IGNORE
 * deja una sola fila. */
export async function notifyItemComment(env: Env, args: CommentNotifyArgs): Promise<void> {
  try {
    const boardKey = notifyBoardKey(args.slug);
    const boardId = BOARDS[args.slug].id;
    const preview = args.text.trim().slice(0, 140);
    const actor = args.actorName ?? args.actorEmail ?? null;

    // 1) Menciones → 'Importantes' + WhatsApp (mismo trato que ya tenían las del portal).
    const mentioned = new Set<string>();
    for (const id of args.mentionIds ?? []) {
      const row = await identityByMondayUserId(env, id);
      if (!row || row.email === args.actorEmail) continue;
      mentioned.add(row.email);
      await emitNotification(env, {
        recipientEmail: row.email,
        severity: 'importante',
        kind: 'mention',
        title: `Te mencionaron en ${args.itemName}`,
        body: preview,
        boardKey, boardId, itemId: args.itemId,
        actor,
        dedupeKey: `mention:${args.updateId}:${row.email}`,
      });
    }

    // 2) Vendedor dueño + comprador(es) asignado(s) → 'Importantes' sin WhatsApp.
    const comprasCol = BOARDS[args.slug].comprasCol;
    const compradorIds = comprasCol ? personIdsFromColumns(args.columnsJson, comprasCol) : [];
    const recipients = await resolveRecipients(env, ['owner', 'comprador'], {
      vendedorIds: args.vendedorIds,
      compradorIds,
      actorEmail: args.actorEmail ?? undefined,
    });
    for (const recipientEmail of recipients) {
      if (mentioned.has(recipientEmail)) continue;   // ya recibió la mención, no duplicar
      await emitNotification(env, {
        recipientEmail,
        severity: 'importante',
        wa: false,
        kind: 'update_comment',
        title: `Nuevo comentario en ${args.itemName}`,
        body: preview,
        boardKey, boardId, itemId: args.itemId,
        actor,
        dedupeKey: `update:${args.updateId}:${recipientEmail}`,
      });
    }
  } catch (err) {
    await logSync(env, 'manual', BOARDS[args.slug]?.id ?? null, args.itemId, false, 'notify: comment ' + err);
  }
}

export interface WebhookUpdateEvent {
  boardId: number;
  itemId: number;
  updateId?: number | string;
  body?: string;        // HTML (trae las menciones)
  textBody?: string;    // texto plano
  userId?: number | string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** Entrada del webhook `create_update` de Monday: comentario escrito DENTRO de
 * monday.com. Se salta lo que ya notificó el portal (firma "vía Portal CMP") y
 * los updates de máquina. Best-effort; loguea a sync_log lo que decide saltarse
 * para poder auditarlo sin adivinar. */
export async function notifyUpdateFromWebhook(env: Env, e: WebhookUpdateEvent): Promise<void> {
  try {
    const board = boardById(e.boardId);
    // Solo boards de primer nivel: una notificación sobre un subitem no tiene
    // deep link al que apuntar (el drawer abre por el item padre).
    if (!board || board.parent) return;

    const html = e.body ?? '';
    const text = (e.textBody ?? stripHtml(html)).trim();
    if (text.includes(PORTAL_SIGNATURE)) return;      // ya notificado en el POST del portal
    if (isAutomationUpdate(text)) return;

    const updateId = String(e.updateId ?? '');
    if (!updateId) return;

    const actor = await identityByMondayUserId(env, Number(e.userId));
    if (!actor) {
      // Sin identidad activa detrás del update no se puede excluir al autor ni
      // saber si es persona o automatización nueva — se salta y se deja rastro.
      await logSync(env, 'webhook', e.boardId, e.itemId, true,
        `create_update sin identidad (userId ${e.userId}) — no se notificó`);
      return;
    }

    const row = await env.DB.prepare(
      `SELECT name, vendedor_ids, columns FROM items WHERE board_id = ? AND item_id = ?`,
    ).bind(e.boardId, e.itemId).first<{ name: string; vendedor_ids: string; columns: string }>();
    if (!row) {
      await logSync(env, 'webhook', e.boardId, e.itemId, true, 'create_update sobre item fuera del mirror — no se notificó');
      return;
    }

    let vendedorIds: number[] = [];
    try { vendedorIds = JSON.parse(row.vendedor_ids || '[]') as number[]; } catch { vendedorIds = []; }

    await notifyItemComment(env, {
      slug: board.slug,
      itemId: e.itemId,
      itemName: row.name,
      updateId,
      text,
      columnsJson: row.columns,
      vendedorIds,
      actorEmail: actor.email,
      actorName: actor.nombre,
      mentionIds: mentionIdsFromBody(html),
    });
  } catch (err) {
    await logSync(env, 'webhook', e.boardId ?? null, e.itemId ?? null, false, 'notify: create_update ' + err);
  }
}
