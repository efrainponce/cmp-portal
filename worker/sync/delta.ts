// Delta sync: jala los eventos recientes de Monday (activity_logs) de las 8
// boards en UNA call y refetchea solo los items que de verdad cambiaron.
// Complementa al full reconcile (cada 12h, worker/sync/reconcile.ts): lo de HOY
// no debe esperar 12h para verse fresco en el portal — Efraín, 2026-08-11, a
// raíz de OPP-0504 con el mirror congelado desde su creación.
//
// Dispara por dos lados (2026-08-27, "compras tarda hasta 30 min en ver una
// oportunidad nueva aunque le piquen a actualizar"):
//   1. el cron de 15 min (worker/index.ts) — piso garantizado, corra o no gente;
//   2. el LATIDO a demanda (`deltaSyncIfStale`) que dispara el poll de la lista.
// El portal no tiene webhooks de cambio de columna desde 2026-07-31 (se comían
// ~80% de la cuota de acciones de Monday, ver scripts/create-webhooks.mjs), así
// que TODO lo que se edita dentro de Monday o lo que escribe cmp-tallas
// —costos, cantidades, Etapa Costeo, el asignado de Compras— entraba al espejo
// solo por este camino. Medido en prod ese día: las 12 oportunidades más
// recientes tenían entre 6 y 18 min de retraso y TODAS caían exactamente en un
// tick del cron. Con el latido el retraso típico baja a ~30 s.
import type { Env } from '../env';
import { fetchActivityLogs, type ActivityWindow } from '../lib/monday';
import { persistActivityEntries } from '../lib/activityLog';
import { BOARDS, boardById, type BoardSlug } from '../../shared/boards';
import { refetchItem } from './refetch';
import { logSync } from './log';

// Checkpoint POR BOARD. Antes era uno solo y global (`delta_last_polled_at`),
// y con el tope de refetches compartido eso dejaba que un board ruidoso
// atrasara a los demás: el 2026-08-27 a las 17:31 el delta gastó ~50 refetches
// seguidos en Productos, abortó por presupuesto de subrequests y dejó 21
// pendientes — entre ellos las líneas de oportunidad que compras estaba
// esperando, que se fueron al ciclo siguiente. Con checkpoint propio, diferir
// Productos ya no retrasa a Oportunidades.
const STATE_PREFIX = 'delta_last_polled_at:';
const LEGACY_STATE_KEY = 'delta_last_polled_at';
const LEASE_KEY = 'delta_lease_until';

// Primera corrida de un board (sin checkpoint todavía): cubre los últimos 20
// min en vez de desde siempre — evita un refetch masivo de "todo lo reciente"
// al desplegar.
const FIRST_RUN_LOOKBACK_MS = 20 * 60 * 1000;

// Ventana máxima que se pide de una vez. Monday devuelve los activity_logs MÁS
// RECIENTES primero con tope de 200 por board (ACTIVITY_LOG_LIMIT), así que una
// ventana larga y ocupada no se trunca por la cola: se pierden los eventos más
// VIEJOS, justo los pegados al checkpoint, y antes el checkpoint avanzaba igual
// hasta `to` — esos cambios no reaparecían hasta el reconcile de 12h. Pasó el
// 2026-08-27: tras un hueco de una hora sin cron, la corrida de las 21:01
// reportó `events=200` exacto. Acotando la ventana, un atraso se recupera en
// rebanadas (cada corrida avanza 20 min) en vez de tirar lo que no cupo.
const MAX_WINDOW_MS = 20 * 60 * 1000;
// ...y ventana ADAPTATIVA por board: si aun así satura, la suya se encoge a un
// cuarto en la siguiente corrida hasta que los eventos quepan bajo el tope de
// 200, y vuelve a MAX_WINDOW_MS en cuanto deja de saturar. Sin esto un board
// saturado se quedaría pidiendo EXACTAMENTE la misma ventana para siempre
// (checkpoint clavado en `from`), que es peor que el problema original.
const MIN_WINDOW_MS = 60 * 1000;
const WINDOW_PREFIX = 'delta_window_ms:';

// Tope de refetches por corrida. Cada refetch cuesta ~6-8 subrequests (1 a
// Monday + varias a D1) y la invocación entera comparte el presupuesto de
// Cloudflare con checkErrorsAndAlert — una ráfaga grande (backlog tras un
// silencio, cmp-tallas reescribiendo subitems) tronaba TODOS los refetches
// restantes con "Too many subrequests" (2026-08-14: 270 fallos en una hora).
// El excedente no se pierde: el checkpoint de cada board solo avanza hasta su
// primer evento no procesado y la siguiente corrida continúa desde ahí.
const MAX_REFETCH_PER_RUN = 50;
// El latido corre DENTRO de una petición de lista (waitUntil), no en el cron:
// comparte presupuesto con la respuesta que el usuario está esperando, así que
// se queda con un tope más chico. Lo que no alcance lo recoge el siguiente
// latido 60 s después.
const MAX_REFETCH_PER_HEARTBEAT = 15;
// ...y con reloj: el "Actualizar" de la lista ESPERA al latido, y en prod cada
// refetch tarda ~1.5 s, así que 15 seguidos serían 20 s de botón colgado. Al
// vencer el plazo se corta y lo que falta queda pendiente — el checkpoint
// parcial ya sabe reanudar (calcularCheckpoints), así que no se pierde nada.
const HEARTBEAT_DEADLINE_MS = 6_000;

// Orden de atención: primero el pipeline (lo que mira ventas y compras todo el
// día), después los catálogos. Dentro de cada grupo se respeta el orden
// cronológico. Los catálogos son los ruidosos —Productos son 1247 items y ahí
// pega el enriquecimiento automático— y son los que menos urgen en pantalla.
const PRIORITY_SLUGS: BoardSlug[] = [
  'oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub',
];
const PRIORITY_BOARD_IDS = new Set(PRIORITY_SLUGS.map(s => BOARDS[s].id));

interface Pendiente { boardId: number; itemId: number; ticks: string }

async function ensureStateTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ).run();
}

async function readState(env: Env, keys: string[]): Promise<Map<string, string>> {
  const placeholders = keys.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `SELECT key, value FROM sync_state WHERE key IN (${placeholders})`,
  ).bind(...keys).all<{ key: string; value: string }>();
  return new Map((res.results ?? []).map(r => [r.key, r.value]));
}

async function writeState(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(key, value).run();
}

/** Orden de atención de la cola: pipeline primero, catálogos después,
 * cronológico dentro de cada grupo. Puro y con test (delta.test.ts) porque de
 * esto depende que un board ruidoso no atrase al que sí se está mirando. */
export function ordenarCola(pendientes: Pendiente[], prioritarios: Set<number>): Pendiente[] {
  const porTicks = (a: Pendiente, b: Pendiente) => (BigInt(a.ticks) < BigInt(b.ticks) ? -1 : 1);
  return [
    ...pendientes.filter(p => prioritarios.has(p.boardId)).sort(porTicks),
    ...pendientes.filter(p => !prioritarios.has(p.boardId)).sort(porTicks),
  ];
}

/**
 * Checkpoint nuevo de cada board. PURO y con test a propósito: es la pieza que
 * puede dejar el delta sync mudo sin que se note (2026-08-14: un checkpoint
 * congelado 3 días sin una sola fila de error en sync_log) o, al revés, hacerle
 * perder cambios para siempre.
 *
 * Tres reglas, en orden de fuerza (gana la más atrasada):
 *  1. sin pendientes ni saturación → avanza a `to` de su ventana;
 *  2. con pendientes (tope, prioridad o presupuesto agotado) → 1 ms antes del
 *     primer evento suyo que no se atendió;
 *  3. SATURADO (Monday devolvió el tope de 200) → se queda en `from`. Monday
 *     manda primero lo más reciente, así que lo truncado es lo más VIEJO de la
 *     ventana: darlo por visto es perderlo hasta el reconcile de 12h.
 * Nunca retrocede antes de `from`.
 */
export function calcularCheckpoints(
  windows: { boardId: number; from: string; to: string }[],
  noAtendidos: Pendiente[],
  saturados: Set<number>,
): Map<number, string> {
  const primeroPendiente = new Map<number, string>();
  for (const p of noAtendidos) {
    const prev = primeroPendiente.get(p.boardId);
    if (!prev || BigInt(p.ticks) < BigInt(prev)) primeroPendiente.set(p.boardId, p.ticks);
  }

  const out = new Map<number, string>();
  for (const w of windows) {
    let checkpoint = saturados.has(w.boardId) ? w.from : w.to;
    const pendiente = primeroPendiente.get(w.boardId);
    if (pendiente) {
      // ticks de 100ns -> ms (ver ticksToIso); BigInt porque Number pierde
      // precisión pasado 2^53.
      const parcial = new Date(Number(BigInt(pendiente) / 10000n) - 1).toISOString();
      if (parcial < checkpoint) checkpoint = parcial;
    }
    out.set(w.boardId, checkpoint < w.from ? w.from : checkpoint);
  }
  return out;
}

/**
 * Latido a demanda: lo llama el poll de la lista (worker/routes/boards.ts) en
 * `waitUntil`. Toma un lease en D1 para que los ~N usuarios que están poleando
 * cada 5 s no disparen N deltas — se ejecuta como mucho uno cada
 * `minIntervalMs`, así que el costo en llamadas a Monday es fijo (1 por
 * intervalo) sin importar cuánta gente esté conectada, y CERO cuando nadie usa
 * el portal.
 *
 * El lease se toma con un UPDATE condicional (`WHERE value < ?`), que en D1 es
 * atómico: dos peticiones simultáneas no pueden ganarlo las dos.
 */
export async function deltaSyncIfStale(env: Env, minIntervalMs: number): Promise<boolean> {
  await ensureStateTable(env);
  const ahora = Date.now();
  const proximo = String(ahora + minIntervalMs);

  // INSERT para el primer arranque; si ya existe, solo gana quien encuentre el
  // lease vencido. `changes` dice si este llamador se lo llevó.
  const insertado = await env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
  ).bind(LEASE_KEY, proximo).run();
  if (insertado.meta.changes === 0) {
    const tomado = await env.DB.prepare(
      `UPDATE sync_state SET value = ? WHERE key = ? AND CAST(value AS INTEGER) <= ?`,
    ).bind(proximo, LEASE_KEY, ahora).run();
    if (tomado.meta.changes === 0) return false; // otro latido va en camino
  }

  await deltaSync(env, {
    maxRefetch: MAX_REFETCH_PER_HEARTBEAT,
    deadlineMs: HEARTBEAT_DEADLINE_MS,
    trigger: 'latido',
  });
  return true;
}

export async function deltaSync(
  env: Env,
  opts: { maxRefetch?: number; deadlineMs?: number; trigger?: string } = {},
): Promise<void> {
  const maxRefetch = opts.maxRefetch ?? MAX_REFETCH_PER_RUN;
  const trigger = opts.trigger ?? 'cron';
  const vence = opts.deadlineMs ? Date.now() + opts.deadlineMs : Infinity;
  await ensureStateTable(env);

  const boardIds = Object.values(BOARDS).map(b => b.id);
  const keys = boardIds.flatMap(id => [STATE_PREFIX + id, WINDOW_PREFIX + id]);
  const state = await readState(env, [...keys, LEGACY_STATE_KEY]);
  // Migración del checkpoint único: la primera corrida con checkpoints por
  // board arranca cada uno donde iba el global, no 20 min atrás.
  const legacy = state.get(LEGACY_STATE_KEY);
  const ahoraIso = new Date().toISOString();
  const piso = new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString();

  const anchoDe = (boardId: number) => {
    const guardado = Number(state.get(WINDOW_PREFIX + boardId));
    return Number.isFinite(guardado) && guardado > 0
      ? Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, guardado))
      : MAX_WINDOW_MS;
  };
  const windows: ActivityWindow[] = boardIds.map(boardId => {
    const from = state.get(STATE_PREFIX + boardId) ?? legacy ?? piso;
    // Ventana acotada: un board atrasado avanza de a lo suyo por corrida en vez
    // de pedir 3 horas de golpe y perder por truncado lo más viejo.
    const techo = new Date(Date.parse(from) + anchoDe(boardId)).toISOString();
    return { boardId, from, to: techo < ahoraIso ? techo : ahoraIso };
  });

  let entries;
  let saturated: Set<number>;
  try {
    ({ entries, saturated } = await fetchActivityLogs(env, windows));
  } catch (e) {
    await logSync(env, 'delta', 0, null, false, `activity_logs failed: ${e}`);
    return;
  }

  // Log de actividad (worker/lib/activityLog.ts) — mismos `entries` que ya se
  // pidieron para el refetch de abajo, filtrados y persistidos aparte. Nunca
  // debe tumbar el refetch: sin esto, un bug en el parseo de actividad dejaría
  // los checkpoints sin avanzar y el portal se quedaría mudo de nuevo (mismo
  // riesgo documentado abajo para el refetch).
  let activityLogged = 0;
  try {
    activityLogged = await persistActivityEntries(env, entries);
  } catch (e) {
    await logSync(env, 'delta', 0, null, false, `activity_log failed: ${e}`);
  }

  // Items tocados en la ventana, con el tick (100ns, ver ticksToIso) de su
  // PRIMER evento — ordenados cronológicamente para poder cortar el batch y
  // dejar el checkpoint de cada board justo antes de su primer no procesado.
  const touched = new Map<string, Pendiente>();
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

  const queue = ordenarCola([...touched.values()], PRIORITY_BOARD_IDS);
  const batch = queue.slice(0, maxRefetch);

  // Un solo item que truene (fetch/D1/ficha) NO debe tumbar el batch entero:
  // sin este try/catch, un throw aquí aborta la función ANTES de mover los
  // checkpoints de abajo, así que la siguiente corrida vuelve a tocar el mismo
  // item y truena igual — el delta sync se queda mudo para SIEMPRE, sin dejar
  // ni un solo log de error (reproducido 2026-08-14: el checkpoint llevaba 3
  // días congelado en 2026-08-11 sin ninguna fila en sync_log).
  let refetched = 0;
  let failed = 0;
  let atendidos = 0;   // cuántos del batch se intentaron (para saber qué queda)
  let cortado = false; // presupuesto agotado: lo no atendido NO cuenta como visto
  for (const { boardId, itemId } of batch) {
    // Plazo vencido (solo el latido lo usa): corta limpio, lo que falta queda
    // como pendiente y lo recoge la siguiente corrida.
    if (Date.now() > vence) { cortado = true; break; }
    try {
      await refetchItem(env, boardId, itemId);
      atendidos++;
      refetched++;
    } catch (e) {
      // Presupuesto de la invocación agotado: TODOS los intentos que siguen
      // fallarían igual (y cada logSync de fallo también gasta) — cortar ya;
      // el item actual queda pendiente y lo cubren los checkpoints parciales.
      if (String(e).includes('Too many subrequests')) {
        await logSync(env, 'delta', boardId, itemId, false,
          `refetch abortado: subrequests agotados tras ${atendidos}/${batch.length}`);
        cortado = true;
        break;
      }
      atendidos++;
      failed++;
      await logSync(env, 'delta', boardId, itemId, false, `refetch failed: ${e}`);
    }
  }

  // Checkpoint POR BOARD: `to` de su ventana si se procesó todo lo suyo; si
  // quedaron pendientes (tope, prioridad o presupuesto), 1ms antes de su primer
  // evento no procesado — la siguiente corrida los recoge (refetch y
  // activity_log son idempotentes, re-leer un pedazo de ventana no duplica
  // nada). Nunca antes de `from`: sin avance no se reescribe.
  //
  // Un board SATURADO (200 eventos, ver ACTIVITY_LOG_LIMIT) no avanza a `to`
  // aunque se haya atendido todo lo recibido: Monday manda primero lo más
  // reciente, así que lo que falta es lo más VIEJO de la ventana y darlo por
  // visto es perderlo. Se queda en `from` y la ventana acotada hace que la
  // siguiente corrida pida el mismo tramo con presupuesto nuevo.
  const pendientes = queue.slice(cortado ? atendidos : batch.length);

  // Ventana adaptativa + válvula de escape. Un board que satura encoge su
  // ventana; si YA está en el piso y sigue saturando (200 eventos en 60 s en un
  // solo board), quedarse ahí sería un ciclo infinito: se deja avanzar y se
  // grita en sync_log — el reconcile de 12h es la red para lo que se perdió.
  const atorados = new Set<number>();
  for (const w of windows) {
    const ancho = anchoDe(w.boardId);
    if (saturated.has(w.boardId)) {
      if (ancho <= MIN_WINDOW_MS) {
        atorados.add(w.boardId);
        saturated.delete(w.boardId); // deja que el checkpoint avance
      } else {
        await writeState(env, WINDOW_PREFIX + w.boardId, String(Math.max(MIN_WINDOW_MS, Math.floor(ancho / 4))));
      }
    } else if (ancho < MAX_WINDOW_MS) {
      await writeState(env, WINDOW_PREFIX + w.boardId, String(MAX_WINDOW_MS));
    }
  }
  for (const boardId of atorados) {
    await logSync(env, 'delta', boardId, null, false,
      `board saturado con ventana mínima (>${'200'} eventos en ${MIN_WINDOW_MS / 1000}s): se avanza el checkpoint, los eventos más viejos de la ventana solo los recupera el reconcile`);
  }

  const checkpoints = calcularCheckpoints(windows, pendientes, saturated);
  for (const [boardId, checkpoint] of checkpoints) {
    // Se escribe siempre, aunque no haya avanzado: así queda sembrado el
    // checkpoint por board y la próxima corrida ya no cae al `legacy`.
    await writeState(env, STATE_PREFIX + boardId, checkpoint);
  }
  const saturados = saturated.size + atorados.size;

  await logSync(env, 'delta', 0, null, true,
    `[${trigger}] events=${entries.length} refetched=${refetched} failed=${failed} activity=${activityLogged}` +
    (pendientes.length ? ` pendientes=${pendientes.length}` : '') +
    (saturados ? ` saturados=${saturados}` : ''));
}
