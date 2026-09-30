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

// Alertas por WhatsApp pausadas a pedido de Efraín (2026-08-15) — reactivar
// cambiando esto a true cuando se confirme que ya no es ruido. Apagadas, ni
// siquiera se cuenta: era un recorrido de sync_log cada 15 min para nada.
const ALERTAS_WA_ACTIVAS = false;

export async function checkErrorsAndAlert(env: Env): Promise<void> {
  if (!ALERTAS_WA_ACTIVAS) return;
  // Las filas 'error-alert:' (el fallo del PROPIO envío de la alerta, logueado
  // abajo en sendAlert) se excluyen del conteo: contarlas convierte un envío
  // fallido en un loop infinito — el fallo de hoy dispara la alerta de mañana,
  // que falla igual y se re-loguea (pasó del 2026-08-05 al 08-14: 879 filas,
  // una cada 15 min, y ninguna alerta real entregada en 10 días).
  const { results } = await env.DB.prepare(
    `SELECT kind, COUNT(*) as n FROM sync_log
     WHERE ok = 0 AND at > datetime('now', ?)
       AND detail NOT LIKE 'error-alert:%'
     GROUP BY kind`,
  ).bind(`-${WINDOW_MINUTES} minutes`).all<KindCount>();

  const rows = results ?? [];
  const total = rows.reduce((sum, r) => sum + r.n, 0);

  if (total > 0) await sendAlert(env, total, rows);
}

/** Retención de sync_log y de la bitácora de WhatsApp. Corría en el cron de
 * 15 min; desde 2026-09-30 una vez por noche (BACKUP_CRON en worker/index.ts):
 * borrar lo de hace 90 días no necesita pasar 96 veces al día. */
export async function purgeSyncLog(env: Env): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM sync_log WHERE at < datetime('now', ?)`,
  ).bind(`-${RETENTION_DAYS} days`).run();

  // Bitácora de WhatsApp (worker/wa/log.ts) — misma retención. created_at es ISO.
  try {
    await env.DB.prepare('DELETE FROM wa_mensaje WHERE created_at < ?')
      .bind(new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()).run();
  } catch { /* tabla todavía no existe */ }
}

async function sendAlert(env: Env, total: number, rows: KindCount[]): Promise<void> {
  if (!env.ADMIN_ALERT_PHONE) return;

  const breakdown = rows.map(r => `${r.kind}: ${r.n}`).join(', ');
  const bodyText = `⚠️ CMP Portal: ${total} error(es) en los últimos ${WINDOW_MINUTES} min (${breakdown})`;

  try {
    // El botón URL del template exige su parámetro NO vacío — Meta rechaza ''
    // con #100 "Parameter 'text' is mandatory ... cannot be empty" (la causa
    // original del loop de arriba). La alerta no apunta a un item concreto,
    // así que el link cae en la lista de Oportunidades (ruta válida del
    // portal, src/lib/routing.ts).
    await sendTemplate(env, env.ADMIN_ALERT_PHONE, { bodyText, urlSuffix: 'oportunidades' }, { tipo: 'alerta' });
  } catch (err) {
    await logSync(env, 'manual', null, null, false, 'error-alert: ' + err);
  }
}
