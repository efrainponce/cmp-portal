// Delta sync: cada 15 min (worker/index.ts, mismo cron que las alertas), jala
// los eventos recientes de Monday (activity_logs) de las 8 boards en UNA call y
// refetchea solo los items que de verdad cambiaron. Complementa al full reconcile
// (cada 12h, worker/sync/reconcile.ts): lo de HOY no debe esperar 12h para verse
// fresco en el portal — Efraín, 2026-08-11, a raíz de OPP-0504 con el mirror
// congelado desde su creación.
import type { Env } from '../env';
import { fetchActivityLogs } from '../lib/monday';
import { persistActivityEntries } from '../lib/activityLog';
import { BOARDS, boardById } from '../../shared/boards';
import { refetchItem } from './refetch';
import { logSync } from './log';

const STATE_KEY = 'delta_last_polled_at';
// Primera corrida (sin checkpoint todavía): cubre los últimos 20 min en vez de
// desde siempre — evita un refetch masivo de "todo lo reciente" al desplegar.
const FIRST_RUN_LOOKBACK_MS = 20 * 60 * 1000;
// Tope de refetches por corrida. Cada refetch cuesta ~6-8 subrequests (1 a
// Monday + varias a D1) y la invocación entera comparte el presupuesto de
// Cloudflare con checkErrorsAndAlert — una ráfaga grande (backlog tras un
// silencio, cmp-tallas reescribiendo subitems) tronaba TODOS los refetches
// restantes con "Too many subrequests" (2026-08-14: 270 fallos en una hora).
// El excedente no se pierde: el checkpoint solo avanza hasta el primer evento
// no procesado y la siguiente corrida (15 min) continúa desde ahí.
const MAX_REFETCH_PER_RUN = 50;

export async function deltaSync(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ).run();

  const stateRow = await env.DB.prepare(`SELECT value FROM sync_state WHERE key = ?`)
    .bind(STATE_KEY).first<{ value: string }>();
  const from = stateRow?.value ?? new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString();
  const to = new Date().toISOString();

  const boardIds = Object.values(BOARDS).map(b => b.id);

  let entries;
  try {
    entries = await fetchActivityLogs(env, boardIds, from, to);
  } catch (e) {
    await logSync(env, 'delta', 0, null, false, `activity_logs failed: ${e}`);
    return;
  }

  // Log de actividad (worker/lib/activityLog.ts) — mismos `entries` que ya se
  // pidieron para el refetch de abajo, filtrados y persistidos aparte. Nunca
  // debe tumbar el refetch: sin esto, un bug en el parseo de actividad dejaría
  // el checkpoint sin avanzar y el portal se quedaría mudo de nuevo (mismo
  // riesgo documentado abajo para el refetch).
  let activityLogged = 0;
  try {
    activityLogged = await persistActivityEntries(env, entries);
  } catch (e) {
    await logSync(env, 'delta', 0, null, false, `activity_log failed: ${e}`);
  }

  // Items tocados en la ventana, con el tick (100ns, ver ticksToIso) de su
  // PRIMER evento — ordenados cronológicamente para poder cortar el batch y
  // dejar el checkpoint justo antes del primer no procesado.
  const touched = new Map<string, { boardId: number; itemId: number; ticks: string }>();
  for (const entry of entries) {
    if (entry.entity !== 'pulse') continue;
    if (!boardById(entry.boardId)) continue; // board fuera del registry (no debería pasar)
    try {
      const parsed = JSON.parse(entry.data) as { pulse_id?: number | string };
      const pulseId = Number(parsed.pulse_id);
      if (!Number.isFinite(pulseId)) continue;
      const key = `${entry.boardId}:${pulseId}`;
      const prev = touched.get(key);
      if (!prev || BigInt(entry.createdAt) < BigInt(prev.ticks)) {
        touched.set(key, { boardId: entry.boardId, itemId: pulseId, ticks: entry.createdAt });
      }
    } catch { /* evento sin pulse_id parseable (a nivel board, no item) — ignorar */ }
  }
  const queue = [...touched.values()]
    .sort((a, b) => (BigInt(a.ticks) < BigInt(b.ticks) ? -1 : 1));
  const batch = queue.slice(0, MAX_REFETCH_PER_RUN);

  // Un solo item que truene (fetch/D1/ficha) NO debe tumbar el batch entero:
  // sin este try/catch, un throw aquí aborta la función ANTES de mover el
  // checkpoint de abajo, así que la siguiente corrida (15 min después) vuelve
  // a tocar el mismo item y truena igual — el delta sync se queda mudo para
  // SIEMPRE, sin dejar ni un solo log de error (reproducido 2026-08-14: el
  // checkpoint llevaba 3 días congelado en 2026-08-11 sin ninguna fila en
  // sync_log, ni éxito ni fallo).
  let refetched = 0;
  let failed = 0;
  let attempted = 0;
  for (const { boardId, itemId } of batch) {
    try {
      await refetchItem(env, boardId, itemId);
      attempted++;
      refetched++;
    } catch (e) {
      // Presupuesto de la invocación agotado: TODOS los intentos que siguen
      // fallarían igual (y cada logSync de fallo también gasta) — cortar ya;
      // el item actual queda pendiente y lo cubre el checkpoint parcial.
      if (String(e).includes('Too many subrequests')) {
        await logSync(env, 'delta', boardId, itemId, false,
          `refetch abortado: subrequests agotados tras ${attempted}/${batch.length}`);
        break;
      }
      attempted++;
      failed++;
      await logSync(env, 'delta', boardId, itemId, false, `refetch failed: ${e}`);
    }
  }

  // Checkpoint: `to` si se procesó todo; si quedaron pendientes (tope o
  // presupuesto), 1ms antes del primer evento no procesado — la siguiente
  // corrida los recoge (refetch y activity_log son idempotentes, re-leer un
  // pedazo de ventana no duplica nada). Nunca antes de `from`: sin avance no
  // se reescribe el checkpoint (queda igual que hoy, reintento completo).
  const pending = queue.slice(attempted);
  let checkpoint = to;
  if (pending.length > 0) {
    const firstPendingMs = Number(BigInt(pending[0].ticks) / 10000n) - 1;
    const partial = new Date(firstPendingMs).toISOString();
    checkpoint = partial > from ? partial : from;
  }
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(STATE_KEY, checkpoint).run();

  await logSync(env, 'delta', 0, null, true,
    `events=${entries.length} refetched=${refetched} failed=${failed} activity=${activityLogged}` +
    (pending.length ? ` pendientes=${pending.length}` : ''));
}
