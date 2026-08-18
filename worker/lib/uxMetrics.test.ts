// Corre las consultas REALES de uxMetrics.ts contra sqlite en memoria con datos
// sembrados a mano. Existe por una razón concreta: la clasificación del
// clic-sin-acuse tenía un bug de ventana (comparaba contra el acuse del clic
// inmediatamente anterior en vez de contra la primera señal que hubiera
// llegado), que inflaba el 58% a costa del 42%. El typecheck no puede ver eso —
// es SQL en un string— y en producción habría salido como un número creíble y
// equivocado, justo el tipo de error que arruina la comparación de feb-2027.
//
// `node:sqlite` viene con Node (>=22.5), así que no agrega dependencias. Si
// corriera en un Node más viejo se salta en vez de tumbar el deploy.
import { describe, it, expect } from 'vitest';
import {
  Q_ATRIBUCION, Q_AMBIGUOS, Q_CLIC_SIN_ACUSE, Q_REEDICION,
  Q_TIEMPO_TAREA, Q_ADOPCION, Q_LATENCIA, Q_ATRIBUCION_DETALLE, Q_AUTOMATIZACIONES,
} from './uxMetrics';

let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { all(...binds: unknown[]): Record<string, unknown>[] };
}
try {
  ({ DatabaseSync } = await import('node:sqlite') as { DatabaseSync: new (p: string) => SqliteDb });
} catch { /* Node sin node:sqlite — la suite se salta */ }

const DESDE = '2026-08-01T00:00:00.000Z';
const HASTA = '2026-09-01T00:00:00.000Z';
const OPP = 18395657596;
const SES = 'sesion-aaaa-bbbb-cccc-dddd1111';

/** T0 = 2026-08-15T10:00:00Z, + segundos. Mismo formato ISO con milisegundos
 * que producen activity_log (ticksToIso) y outbox (new Date().toISOString()):
 * las comparaciones de rango son lexicográficas, así que el shape importa. */
const at = (s: number) => new Date(Date.UTC(2026, 7, 15, 10, 0, 0) + s * 1000).toISOString();

function seed(): SqliteDb {
  const db = new DatabaseSync!(':memory:');
  db.exec(`
    CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id INTEGER, item_id INTEGER,
      event TEXT, column_id TEXT, column_title TEXT, previous_text TEXT, new_text TEXT,
      user_id INTEGER, created_at TEXT, dedupe_key TEXT UNIQUE);
    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id INTEGER, item_id INTEGER,
      cols TEXT, content_hash TEXT, author_email TEXT, status TEXT, attempts INTEGER,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE identity (email TEXT PRIMARY KEY, phone TEXT, nombre TEXT,
      monday_user_id INTEGER, role TEXT, active INTEGER);
    CREATE TABLE ux_event (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
      user_id INTEGER NOT NULL, role TEXT NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL,
      target TEXT NOT NULL, corr TEXT, board_slug TEXT, item_id INTEGER, column_id TEXT,
      latency_ms INTEGER, meta TEXT);
    INSERT INTO identity VALUES ('ana@cmp.com',NULL,'Ana',101,'vendedor',1),
                                ('luis@cmp.com',NULL,'Luis',102,'compras',1);
  `);
  const log = db.prepare(`INSERT INTO activity_log (board_id,item_id,event,column_id,user_id,created_at,dedupe_key)
    VALUES (?,?,'update_column_value',?,?,?,?)`);
  const out = db.prepare(`INSERT INTO outbox (board_id,item_id,cols,content_hash,author_email,status,attempts,created_at,updated_at)
    VALUES (?,?,?,'h',?,'confirmed',0,?,?)`);
  const ux = db.prepare(`INSERT INTO ux_event (created_at,user_id,role,session_id,kind,target,corr,board_slug,item_id,column_id,latency_ms,meta)
    VALUES (?,101,'vendedor',?,?,?,?,'oportunidades',?,?,?,NULL)`);

  // Ana toca la MISMA celda dos veces DESDE EL PORTAL, con 40s de diferencia.
  // Cada edición trae su fila de outbox 3s antes = el rastro que la atribuye.
  [0, 40].forEach((s, k) => {
    log.all(OPP, 555, 'deal_stage', 101, at(s), `p${k}`);
    out.all(OPP, 555, JSON.stringify({ deal_stage: 'En costeo' }), 'ana@cmp.com', at(s - 3), at(s));
  });
  // Luis toca la misma celda dos veces EN MONDAY (sin outbox), con 120s.
  [0, 120].forEach((s, k) => log.all(OPP, 777, 'deal_owner', 102, at(s), `m${k}`));

  // Fila escrita POR EL PORTAL vía recordDirectChanges: se reconoce por el
  // dedupe_key 'direct:<uuid>' (el delta sync usa board:item:evento:col:tick).
  // El fixture decía 'native:' — el prefijo que nunca escribió nadie, así que
  // este rastro estaba muerto en producción y el test lo daba por bueno.
  // Item con id REAL de Monday a propósito: el marcador tiene que bastar solo.
  log.all(OPP, 666, 'deal_stage', 101, at(150), 'direct:9f8b7a6c-1234-4def-8888-aabbccddeeff');

  // Automatización de Monday: user_id NEGATIVO. No es una persona — no debe
  // contar como fricción humana ni aparecer en adopción.
  [0, 30].forEach((s, k) => log.all(OPP, 444, 'deal_stage', -4, at(s), `bot${k}`));

  // Item NATIVO (id sobre NATIVE_ID_FLOOR): no pasa por outbox — worker/lib/
  // outbox.ts retorna antes y escribe activity_log directo. Solo el portal
  // escribe ahí, así que es portal por definición.
  log.all(OPP, 900000000123, 'deal_stage', 101, at(200), 'nat0');

  // Edición del portal SIN fila de outbox pero CON rastro de interacción
  // (`ux_event` edit, que es lo que emite patchItem). Es el caso que en
  // producción quedaba mal etiquetado como Monday.
  log.all(OPP, 888, 'deal_stage', 101, at(300), 'uxo0');
  ux.all(at(298), SES, 'edit', 'edit:celda', null, 888, 'deal_stage', null);

  // Tres clics al mismo botón: el 2º sin ninguna señal todavía; el 3º cuando el
  // acuse del PRIMERO ya había llegado (= "respondió y no esperó").
  ux.all(at(0),   SES, 'click', 'drawer:mandar-costeo', 'corr-1111-2222-3333-4444aaaa', 555, null, null);
  ux.all(at(2),   SES, 'click', 'drawer:mandar-costeo', 'corr-2222-2222-3333-4444aaaa', 555, null, null);
  ux.all(at(4),   SES, 'ack',   'drawer:mandar-costeo', 'corr-1111-2222-3333-4444aaaa', 555, null, 4000);
  ux.all(at(6),   SES, 'click', 'drawer:mandar-costeo', 'corr-3333-2222-3333-4444aaaa', 555, null, null);
  ux.all(at(6.5), SES, 'ack',   'drawer:mandar-costeo', 'corr-3333-2222-3333-4444aaaa', 555, null, 500);

  // Tiempo por tarea: abre el drawer y guarda 90s después.
  ux.all(at(10),  SES, 'nav',  'drawer:open',  null, 555, null, null);
  ux.all(at(100), SES, 'edit', 'edit:celda',   null, 555, 'deal_stage', null);

  // Latencia: 10 acuses del mismo endpoint.
  [50, 120, 300, 80, 900, 150, 70, 200, 110, 4000].forEach((ms, i) =>
    ux.all(at(200 + i), SES, 'ack', 'api:patch:boards:slug:items:id', `lat-0000-0000-0000-0000000${i}`, null, null, ms));
  return db;
}

const run = (db: SqliteDb, q: string) => db.prepare(q).all(DESDE, HASTA);

describe.skipIf(!DatabaseSync)('uxMetrics — SQL contra sqlite real', () => {
  it('atribuye por los TRES rastros: nativo, ux_event y outbox', () => {
    // El punto entero de la feature: en activity_log las 6 ediciones son
    // idénticas; los rastros son lo único que separa las 4 del portal.
    //   portal = 2 (outbox) + 1 (dedupe_key direct:) + 1 (item nativo) + 1 (ux_event)
    //   monday = 2 (las de Luis, sin ningún rastro)
    // Las 2 del bot NO entran: user_id negativo queda fuera del CTE.
    expect(run(seed(), Q_ATRIBUCION)[0]).toMatchObject({ ediciones: 7, portal: 5, monday: 2 });
  });

  it('un item nativo es portal aunque no tenga NADA de outbox', () => {
    // Regresión de un fallo real: con solo el cruce de outbox, los items
    // nativos —que jamás encolan outbox— se contaban como Monday.
    const filas = run(seed(), Q_ATRIBUCION_DETALLE) as { item_id: number; origen: string }[];
    expect(filas.find(f => f.item_id === 900000000123)?.origen).toBe('portal');
  });

  it('una edición con rastro de ux_event es portal aunque no tenga outbox', () => {
    const filas = run(seed(), Q_ATRIBUCION_DETALLE) as { item_id: number; origen: string }[];
    expect(filas.find(f => f.item_id === 888)?.origen).toBe('portal');
  });

  it('el marcador dedupe_key "direct:" basta por sí solo, sin outbox ni ux_event', () => {
    const filas = run(seed(), Q_ATRIBUCION_DETALLE) as { item_id: number; origen: string }[];
    expect(filas.find(f => f.item_id === 666)?.origen).toBe('portal');
  });

  it('excluye las automatizaciones de Monday (user_id negativo) y las reporta aparte', () => {
    // Verificado en producción: son ~11% de las ediciones. Si contaran, un bot
    // reescribiendo la misma columna se vería igual que alguien corrigiéndose.
    const filas = run(seed(), Q_ATRIBUCION_DETALLE) as { item_id: number }[];
    expect(filas.some(f => f.item_id === 444)).toBe(false);
    expect(run(seed(), Q_AUTOMATIZACIONES)[0]).toMatchObject({ n: 2 });
  });

  it('una edición sin ningún rastro se queda en Monday', () => {
    const filas = run(seed(), Q_ATRIBUCION_DETALLE) as { item_id: number; origen: string }[];
    expect(filas.find(f => f.item_id === 777)?.origen).toBe('monday');
  });

  it('no reporta ambigüedad cuando nadie tocó la misma celda en las dos herramientas', () => {
    expect(run(seed(), Q_AMBIGUOS)[0]).toMatchObject({ n: 0 });
  });

  it('clic sin acuse: separa "ninguna señal" de "respondió y no esperó"', () => {
    // El 3er clic NO es "sin señal": el acuse del 1º ya había llegado. Este es
    // exactamente el caso que el bug de ventana clasificaba mal.
    expect(run(seed(), Q_CLIC_SIN_ACUSE)[0]).toMatchObject({
      clics: 3, repeticiones: 2, sin_senal: 1, no_espero: 1,
    });
  });

  it('re-edición: cuenta los pares POR SEPARADO para portal y para Monday', () => {
    const filas = run(seed(), Q_REEDICION) as { origen: string; pares: number; m1: number; m5: number }[];
    const porOrigen = Object.fromEntries(filas.map(f => [f.origen, f]));
    // Portal: 40s de diferencia → cae en "<1 min" y en "<5 min".
    expect(porOrigen.portal).toMatchObject({ pares: 1, m1: 1, m5: 1 });
    // Monday: 120s → solo "<5 min".
    expect(porOrigen.monday).toMatchObject({ pares: 1, m1: 0, m5: 1 });
  });

  it('tiempo por tarea: del drawer:open al primer guardado', () => {
    const r = run(seed(), Q_TIEMPO_TAREA)[0] as { n: number; p50: number };
    expect(r.n).toBe(1);
    expect(Math.round(r.p50)).toBe(90);
  });

  it('adopción semanal: personas distintas por semana y por origen', () => {
    expect(run(seed(), Q_ADOPCION)[0]).toMatchObject({ portal: 1, monday: 1 });
  });

  it('latencia: p50 y p90 por endpoint', () => {
    // Ordenadas: 50,70,80,110,120,150,200,300,900,4000 → p50=120, p90=900.
    const r = run(seed(), Q_LATENCIA) as { target: string; n: number; p50: number; p90: number }[];
    expect(r[0]).toMatchObject({ target: 'api:patch:boards:slug:items:id', n: 10, p50: 120, p90: 900 });
  });
});
