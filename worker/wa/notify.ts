// worker/wa/notify.ts — puente entre el Centro de Notificaciones (worker/lib/notify.ts)
// y el envío saliente de WhatsApp (worker/wa/send.ts). Solo severidad 'importante'
// (decisión de alcance de Efraín, 2026-07-31) — cambios de etapa NO se mandan por WA.
import type { Env } from '../env';
import type { NotifyInput } from '../lib/notify';
import { logSync } from '../sync/log';
import { sendTemplate } from './send';

/** Best-effort: nunca lanza. Si el destinatario no tiene teléfono registrado, o la
 * notificación no trae boardKey/itemId (nada a dónde enlazar), no hace nada. */
export async function notifyPortalWa(env: Env, n: NotifyInput): Promise<void> {
  try {
    if (!n.boardKey || n.itemId == null) return;
    const row = await env.DB.prepare(
      `SELECT phone FROM identity WHERE email = ? AND active = 1`,
    ).bind(n.recipientEmail).first<{ phone: string | null }>();
    if (!row?.phone) return;

    await sendTemplate(env, row.phone, {
      bodyText: n.title,
      urlSuffix: `${n.boardKey}/${n.itemId}`,
    });
  } catch (err) {
    await logSync(env, 'manual', n.boardId ?? null, n.itemId ?? null, false, 'wa-notify: ' + err);
  }
}
