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
//
// Refetch EN LOTE (2026-09-02): cada item que cambiaba costaba su propia
// llamada a Monday (~1.5-6 s en prod), así que un latido de 6 s releía 0-3
// items y dejaba el resto para el cron — medido en sync_log el 2026-09-01:
// `events=52 refetched=0 pendientes=6`, `events=59 refetched=1 pendientes=7`.
// Ahora los pendientes de cada board van en UNA llamada (`items(ids:)`, hasta
// 100), así que un latido vacía la cola completa — Productos incluidos, que
// por ir al final de la cola casi nunca alcanzaban turno.
import type { Env } from '../env';
import { fetchActivityLogs, type ActivityWindow } from '../lib/monday';
import { persistActivityEntries } from '../lib/activityLog';
import { BOARDS, boardById, type BoardSlug } from '../../shared/boards';
import { refetchItems } from './refetch';
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

// Cuánto se vuelve a leer de la ventana anterior en cada corrida, por el
// retraso con que Monday llena su activity log (1.7-3 s medidos; ver
// calcularCheckpoints). 10 s = 3× lo medido. El checkpoint es también la
// prueba de "espejo verificado" que usa ?fresh=1 al abrir (mirrorVerificadoAt),
// así que ahora dice la verdad con este margen incluido.
const ACTIVITY_LAG_OVERLAP_MS = 10_000;

// Tope de items releídos por corrida. Con el refetch en lote cada 100 items
// cuestan ~5-8 subrequests (1 a Monday + un puñado a D1), no 6-8 POR item como
// antes, así que el tope ya no es un cuello: 300 = tres llamadas a Monday por
// board en el peor caso. La invocación comparte el presupuesto de Cloudflare
// con checkErrorsAndAlert — una ráfaga grande tronaba TODOS los refetches
// restantes con "Too many subrequests" (2026-08-14: 270 fallos en una hora).
// El excedente no se pierde: el checkpoint de cada board solo avanza hasta su
// primer evento no procesado y la siguiente corrida continúa desde ahí.
const MAX_REFETCH_PER_RUN = 300;
// El latido corre DENTRO de una petición (waitUntil), no en el cron: comparte
// presupuesto con la respuesta que el usuario está esperando, así que se queda
// con un tope más chico. Lo que no alcance lo recoge el siguiente latido.
const MAX_REFETCH_PER_HEARTBEAT = 200;
// ...y con reloj: el "Actualizar" de la lista ESPERA al latido. Los lotes (uno
// por board, una llamada a Monday cada uno) salen en paralelo, así que el
// plazo solo decide si se lanzan o no después de leer activity_logs: si ya
// venció, todo queda pendiente — el checkpoint parcial ya sabe reanudar
// (calcularCheckpoints), así que no se pierde nada.
const HEARTBEAT_DEADLINE_MS = 8_000;

// Orden de atención: primero el pipeline (lo que mira ventas y compras todo el
// día), después los catálogos. Dentro de cada grupo se respeta el orden
// cronológico. Los catálogos son los ruidosos —Productos son 1247 items y ahí
// pega el enriquecimiento automático— y son los que menos urgen en pantalla.
const PRIORITY_SLUGS: BoardSlug[] = [
  'oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub',
];
const PRIORITY_BOARD_IDS = new Set(PRIORITY_SLUGS.map(s => BOARDS[s].id));

interface Pendiente { boardId: number; itemId: number; ticks: string }

// El CREATE TABLE se paga una vez por isolate, no en cada poll de cada
// usuario (el latido cuelga de todos los GET autenticados).
let stateTableReady = false;
async function ensureStateTable(env: Env): Promise<void> {
  if (stateTableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ).run();
  stateTableReady = true;
}

async function readState(env: Env, keys: string[]): Promise<Map<string, string>> {
  const placeholders = keys.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `SELECT key, value FROM sync_state WHERE key IN (${placeholders})`,
  ).bind(...keys).all<{ key: string; value: string }>();
  return new Map((res.results ?? []).map(r => [r.key, r.value]));
}

/** Todos los pares en UN batch (un subrequest), no un UPSERT por llave: los
 * checkpoints y ventanas de los 8 boards se escriben juntos al final. */
async function writeStateMany(env: Env, pairs: Array<[string, string]>): Promise<void> {
  if (pairs.length === 0) return;
  await env.DB.batch(pairs.map(([key, value]) => env.DB.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(key, value)));
}

/**
 * ¿El espejo de estos boards fue verificado contra Monday hace menos de
 * `maxAgeMs`? Devuelve el instante de esa verificación (el más viejo de los
 * boards pedidos) o null. Lo usa `?fresh=1` al abrir una oportunidad (worker/
 * routes/boards.ts): si el latido acaba de correr y dejó a ese board sin
 * pendientes, el espejo YA es lo que Monday tiene y la relectura de un item
 * (1.5-7 s de "verificando con Monday…" + una llamada) no compra nada.
 *
 * El checkpoint sirve como prueba porque `calcularCheckpoints` solo lo
 * avanza hasta `to` cuando TODO lo tocado en la ventana se releyó (sin
 * pendientes ni saturación); con backlog se queda atrás y esto devuelve null
 * — o sea, ante la duda se relee, como antes.
 */
export async function mirrorVerificadoAt(env: Env, boardIds: number[], maxAgeMs: number): Promise<string | null> {
  if (boardIds.length === 0) return null;
  await ensureStateTable(env);
  const state = await readState(env, boardIds.map(id => STATE_PREFIX + id));
  let oldest: string | null = null;
  for (const id of boardIds) {
    const at = state.get(STATE_PREFIX + id);
    if (!at) return null;
    if (Date.now() - Date.parse(at) > maxAgeMs) return null;
    if (!oldest || at < oldest) oldest = at;
  }
  return oldest;
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
 *
 * TRASLAPE (`overlapMs`, 2026-09-02): el activity log de Monday se llena con
 * retraso — medido en prod con un item de prueba: el evento aparece 1.7-3 s
 * DESPUÉS de que la mutación ya regresó, con `created_at` anterior a ese
 * regreso. Con la ventana cortada exactamente en `to`, un cambio hecho en
 * los últimos segundos antes de `to` no estaba en la respuesta y, como la
 * siguiente ventana arrancaba en `to`, ya nunca se pedía: perdido hasta el
 * reconcile de 12 h. El checkpoint se queda `overlapMs` antes de `to` para
 * que la siguiente corrida vuelva a pedir ese tramo (refetch y activity_log
 * son idempotentes, repetir un evento no duplica nada).
 */
export function calcularCheckpoints(
  windows: { boardId: number; from: string; to: string }[],
  noAtendidos: Pendiente[],
  saturados: Set<number>,
  overlapMs = 0,
): Map<number, string> {
  const primeroPendiente = new Map<number, string>();
  for (const p of noAtendidos) {
    const prev = primeroPendiente.get(p.boardId);
    if (!prev || BigInt(p.ticks) < BigInt(prev)) primeroPendiente.set(p.boardId, p.ticks);
  }

  const out = new Map<number, string>();
  for (const w of windows) {
    const toConTraslape = overlapMs > 0 ? new Date(Date.parse(w.to) - overlapMs).toISOString() : w.to;
    let checkpoint = saturados.has(w.boardId) ? w.from : toConTraslape;
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
// Pista LOCAL del lease: si este isolate acaba de ganarlo (o de perderlo)
// sabe que no tiene caso volver a preguntarle a D1 hasta entonces. El latido
// cuelga de TODOS los GET autenticados (lista cada 5 s, campana cada 12 s,
// inicio cada 30 s, de cada usuario), así que sin esto cada poll pagaba 2-3
// statements de D1 solo para enterarse de que el lease sigue tomado. Es solo
// una pista: D1 sigue siendo la verdad entre isolates.
let leaseHintUntil = 0;
const LEASE_HINT_LOST_MS = 10_000;

export async function deltaSyncIfStale(env: Env, minIntervalMs: number): Promise<boolean> {
  const ahora = Date.now();
  if (ahora < leaseHintUntil) return false;
  await ensureStateTable(env);
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
    if (tomado.meta.changes === 0) {
      // Otro latido va en camino. No sabemos hasta cuándo tiene el lease
      // (lo tomó otro isolate), así que la pista es corta.
      leaseHintUntil = ahora + LEASE_HINT_LOST_MS;
      return false;
    }
  }
  leaseHintUntil = ahora + minIntervalMs;

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

  // Un lote por board, en el orden de la cola (pipeline primero): cada lote es
  // UNA llamada a Monday para hasta 100 items (worker/sync/refetch.ts).
  const lotes = agruparPorBoard(batch);

  // Un lote que truene (Monday/D1/ficha) NO debe tumbar la corrida entera:
  // sin este try/catch, un throw aquí aborta la función ANTES de mover los
  // checkpoints de abajo, así que la siguiente corrida vuelve a tocar lo mismo
  // y truena igual — el delta sync se queda mudo para SIEMPRE, sin dejar ni un
  // solo log de error (reproducido 2026-08-14: el checkpoint llevaba 3 días
  // congelado en 2026-08-11 sin ninguna fila en sync_log). Un lote fallido se
  // queda como PENDIENTE (no como visto): lo normal es un tropiezo transitorio
  // de Monday, y darlo por visto perdería los 100 items hasta el reconcile.
  // Si el fallo fuera persistente, el checkpoint clavado + la fila de error en
  // sync_log lo hacen visible en el cron de alertas.
  let refetched = 0;
  let cambiados = 0;
  let borrados = 0;
  let failed = 0;
  const noAtendidos: Pendiente[] = [];
  // Los lotes van EN PARALELO (uno por board, boards distintos = filas
  // distintas en D1): cada llamada a Monday tarda 1.5-3.5 s y en serie los 4
  // boards del pipeline sumaban ~8 s — justo el plazo del latido, y Productos
  // se quedaba sin turno. En paralelo el latido completo tarda lo que la
  // llamada más lenta. El plazo (solo el latido lo usa) se revisa ANTES de
  // lanzar: si la lectura de activity_logs ya se comió el tiempo, todo queda
  // pendiente y lo recoge la siguiente corrida.
  const lanzables = Date.now() > vence ? [] : lotes;
  noAtendidos.push(...lotes.slice(lanzables.length).flat());
  const resultados = await Promise.allSettled(lanzables.map(lote =>
    refetchItems(env, lote[0]!.boardId, lote.map(p => p.itemId))));
  for (let i = 0; i < resultados.length; i++) {
    const res = resultados[i]!;
    const lote = lanzables[i]!;
    if (res.status === 'fulfilled') {
      refetched += res.value.refetched;
      cambiados += res.value.changed;
      borrados += res.value.deleted;
      continue;
    }
    failed += lote.length;
    noAtendidos.push(...lote);
    const e = String(res.reason);
    // Presupuesto de la invocación agotado: el lote entero queda pendiente y
    // lo cubren los checkpoints parciales (un logSync más también gasta, pero
    // es el único rastro del corte).
    await logSync(env, 'delta', lote[0]!.boardId, null, false,
      e.includes('Too many subrequests')
        ? `refetch abortado: subrequests agotados (${lote.length} items del board quedan pendientes)`
        : `refetch en lote failed (${lote.length} items): ${e}`);
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
  const pendientes = [...noAtendidos, ...queue.slice(batch.length)];

  // Ventana adaptativa + válvula de escape. Un board que satura encoge su
  // ventana; si YA está en el piso y sigue saturando (200 eventos en 60 s en un
  // solo board), quedarse ahí sería un ciclo infinito: se deja avanzar y se
  // grita en sync_log — el reconcile de 12h es la red para lo que se perdió.
  const atorados = new Set<number>();
  const estado: Array<[string, string]> = [];
  for (const w of windows) {
    const ancho = anchoDe(w.boardId);
    if (saturated.has(w.boardId)) {
      if (ancho <= MIN_WINDOW_MS) {
        atorados.add(w.boardId);
        saturated.delete(w.boardId); // deja que el checkpoint avance
      } else {
        estado.push([WINDOW_PREFIX + w.boardId, String(Math.max(MIN_WINDOW_MS, Math.floor(ancho / 4)))]);
      }
    } else if (ancho < MAX_WINDOW_MS) {
      estado.push([WINDOW_PREFIX + w.boardId, String(MAX_WINDOW_MS)]);
    }
  }
  for (const boardId of atorados) {
    await logSync(env, 'delta', boardId, null, false,
      `board saturado con ventana mínima (>${'200'} eventos en ${MIN_WINDOW_MS / 1000}s): se avanza el checkpoint, los eventos más viejos de la ventana solo los recupera el reconcile`);
  }

  const checkpoints = calcularCheckpoints(windows, pendientes, saturated, ACTIVITY_LAG_OVERLAP_MS);
  for (const [boardId, checkpoint] of checkpoints) {
    // Se escribe siempre, aunque no haya avanzado: así queda sembrado el
    // checkpoint por board y la próxima corrida ya no cae al `legacy`.
    estado.push([STATE_PREFIX + boardId, checkpoint]);
  }
  await writeStateMany(env, estado);
  const saturados = saturated.size + atorados.size;

  await logSync(env, 'delta', 0, null, true,
    `[${trigger}] events=${entries.length} refetched=${refetched} cambiados=${cambiados}` +
    (borrados ? ` borrados=${borrados}` : '') +
    ` failed=${failed} activity=${activityLogged}` +
    (pendientes.length ? ` pendientes=${pendientes.length}` : '') +
    (saturados ? ` saturados=${saturados}` : ''));
}

/** Parte la cola en lotes por board, conservando el orden de la cola (el
 * primer lote es el del board cuyo primer pendiente va antes). Puro y con
 * test: de esto depende que el pipeline siga saliendo antes que los catálogos
 * ahora que se relee por lotes y no de a uno. */
export function agruparPorBoard(cola: Pendiente[]): Pendiente[][] {
  const porBoard = new Map<number, Pendiente[]>();
  for (const p of cola) {
    const lote = porBoard.get(p.boardId);
    if (lote) lote.push(p);
    else porBoard.set(p.boardId, [p]);
  }
  return [...porBoard.values()];
}
