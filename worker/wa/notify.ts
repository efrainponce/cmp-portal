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

/** Anuncio del portal por WhatsApp (Efraín, 2026-08-17): a diferencia de
 * notifyPortalWa, no cuelga del centro de notificaciones ni apunta a un item —
 * el botón del template lleva a la pantalla de Anuncios. Solo sale cuando el
 * admin marca la casilla al publicar, nunca por severidad sola. Best-effort y
 * secuencial: si un envío falla se loguea y sigue con el resto.
 *
 * Tope de 50 destinatarios por anuncio: cada envío es un subrequest y el roster
 * real ronda las 20 personas — el tope es red de seguridad, no una política.
 * Devuelve cuántos se mandaron para dejarlo en la fila del anuncio. */
export async function notifyAnuncioWa(
  env: Env, titulo: string, destinatarios: Array<{ email: string; phone: string }>,
): Promise<number> {
  const MAX = 50;
  const lote = destinatarios.slice(0, MAX);
  if (destinatarios.length > MAX) {
    await logSync(env, 'manual', null, null, false,
      `wa-anuncio: ${destinatarios.length} destinatarios, se mandó solo a los primeros ${MAX}`);
  }
  let enviados = 0;
  for (const d of lote) {
    try {
      await sendTemplate(env, d.phone, { bodyText: `Anuncio: ${titulo}`, urlSuffix: 'anuncios' });
      enviados++;
    } catch (err) {
      await logSync(env, 'manual', null, null, false, `wa-anuncio ${d.email}: ${err}`);
    }
  }
  return enviados;
}
