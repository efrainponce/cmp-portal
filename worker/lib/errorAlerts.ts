// worker/lib/errorAlerts.ts — cron cada 15 min (worker/index.ts scheduled()): revisa
// `sync_log` (worker/sync/log.ts, ya alimentado por reconcile/webhook/outbox/notify/wa)
// por filas ok=0 recientes y avisa por WhatsApp. Sin tabla de cursor: la ventana de
// 16 min (1 de colchón sobre el intervalo de 15) puede reportar una fila dos veces si
// una corrida se atrasa, pero nunca la pierde — más simple que trackear un cursor.
import type { Env } from '../env';
import { logSync } from '../sync/log';
import { sendTemplate } from '../wa/send';

const WINDOW_MINUTES = 16;
const RETENTION_DAYS = 90;

interface KindCount {
  kind: string;
  n: number;
}

export async function checkErrorsAndAlert(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT kind, COUNT(*) as n FROM sync_log
     WHERE ok = 0 AND at > datetime('now', ?)
     GROUP BY kind`,
  ).bind(`-${WINDOW_MINUTES} minutes`).all<KindCount>();

  const rows = results ?? [];
  const total = rows.reduce((sum, r) => sum + r.n, 0);

  if (total > 0) await sendAlert(env, total, rows);

  await env.DB.prepare(
    `DELETE FROM sync_log WHERE at < datetime('now', ?)`,
  ).bind(`-${RETENTION_DAYS} days`).run();
}

async function sendAlert(env: Env, total: number, rows: KindCount[]): Promise<void> {
  if (!env.ADMIN_ALERT_PHONE) return;

  const breakdown = rows.map(r => `${r.kind}: ${r.n}`).join(', ');
  const bodyText = `⚠️ CMP Portal: ${total} error(es) en los últimos ${WINDOW_MINUTES} min (${breakdown})`;

  try {
    await sendTemplate(env, env.ADMIN_ALERT_PHONE, { bodyText, urlSuffix: '' });
  } catch (err) {
    await logSync(env, 'manual', null, null, false, 'error-alert: ' + err);
  }
}
