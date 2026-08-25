// worker/lib/ocLedger.ts — el registro de las Órdenes de Compra que EMITE el
// portal (Efraín, 2026-08-25).
//
// El porqué, con números del día que se escribió: el contador `oc_folios` iba
// en 230 y el espejo llegaba a OC-235, pero no existía UNA sola fila que dijera
// qué es cada folio. 219 se podían reconstruir escarbando nombres de archivo;
// **16 no dejaban rastro de ningún tipo**. El portal ya era dueño de la
// numeración y no del significado — la peor mitad: carga con que los folios no
// choquen, sin poder responder qué fue cada uno.
//
// La regla que hace que esto sirva: la fila se escribe **ANTES** de generar el
// PDF, en la misma operación que asigna el folio (`reservarFolioOc`). Si la
// generación truena después, el folio queda con su fila en estado 'fallida' en
// vez de desaparecer. Un folio quemado en silencio es exactamente lo que dejó
// esos 16 huecos.
//
// Lo que este ledger NO es: un índice de qué archivos existen. La verdad de eso
// sigue siendo Monday + R2 (portal y Monday son 1-1; una tabla que afirme que
// un archivo existe cuando Monday ya no lo tiene es la falla del 2026-08-19
// otra vez). Aquí se registra el ACTO de emitir, no el inventario.
import type { Env } from '../env';

/** 'reservada' = tomó folio y todavía no termina. 'emitida' = quedó el PDF.
 * 'fallida' = tronó después de tomar folio (el folio NO se reusa: la numeración
 * nunca decrece). 'sin-rastro' = la sembró el backfill porque el folio existe
 * en la secuencia pero nadie encontró su archivo. */
export type OcEstado = 'reservada' | 'emitida' | 'fallida' | 'sin-rastro';

/** Qué motor la generó: 'portal' (motor propio, sin firmas), 'nativo-d1' (Zona
 * Efrain), 'eledo' (cmp-tallas + DocuSeal) o 'backfill' (reconstruida). */
export type OcMotor = 'portal' | 'nativo-d1' | 'eledo' | 'backfill';

export interface OcReserva {
  proyectoId: number;
  proveedorId?: string | null;
  proveedor: string;
  oportunidadId?: number | null;
  motor: OcMotor;
  porEmail?: string | null;
}

export interface OcCierre {
  archivo?: string;
  archivoSinCostos?: string;
  monto?: number;
  moneda?: string;
  conImagenes?: boolean;
}

export interface OcEmitidaRow {
  folio: string;
  proyecto_id: number;
  proveedor_id: string | null;
  proveedor: string;
  oportunidad_id: number | null;
  monto: number | null;
  moneda: string | null;
  archivo: string | null;
  archivo_sin_costos: string | null;
  con_imagenes: number;
  motor: string;
  estado: string;
  error: string | null;
  emitida_por: string | null;
  emitida_at: string;
}

let tablaLista = false;

export async function ensureOcLedger(env: Env): Promise<void> {
  if (tablaLista) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_emitida (
    folio              TEXT PRIMARY KEY,
    proyecto_id        INTEGER NOT NULL,
    proveedor_id       TEXT,
    proveedor          TEXT NOT NULL,
    oportunidad_id     INTEGER,
    monto              REAL,
    moneda             TEXT,
    archivo            TEXT,
    archivo_sin_costos TEXT,
    con_imagenes       INTEGER NOT NULL DEFAULT 0,
    motor              TEXT NOT NULL,
    estado             TEXT NOT NULL,
    error              TEXT,
    emitida_por        TEXT,
    emitida_at         TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_oc_emitida_proyecto ON oc_emitida (proyecto_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_oc_emitida_at ON oc_emitida (emitida_at DESC)`).run();
  tablaLista = true;
}

/** Número del folio ("OC-236" → 236). Pura: la usan el backfill y el orden. */
export function numeroDeFolio(folio: string): number {
  const m = /^OC-(\d+)$/i.exec(folio.trim());
  return m ? Number(m[1]) : 0;
}

/** Registra la orden con el folio que le tocó, ANTES de generar nada. El folio
 * lo asigna el llamador (`nextOcFolio`) para no partir en dos la secuencia. */
export async function registrarReserva(env: Env, folio: string, r: OcReserva): Promise<void> {
  await ensureOcLedger(env);
  await env.DB.prepare(
    `INSERT INTO oc_emitida (folio, proyecto_id, proveedor_id, proveedor, oportunidad_id, motor, estado, emitida_por, emitida_at)
     VALUES (?,?,?,?,?,?,'reservada',?,?)
     ON CONFLICT(folio) DO NOTHING`,
  ).bind(
    folio, r.proyectoId, r.proveedorId ?? null, r.proveedor, r.oportunidadId ?? null,
    r.motor, r.porEmail ?? null, new Date().toISOString(),
  ).run();
}

/** La orden quedó: PDF generado y guardado. */
export async function cerrarOc(env: Env, folio: string, c: OcCierre): Promise<void> {
  await ensureOcLedger(env);
  await env.DB.prepare(
    `UPDATE oc_emitida SET estado = 'emitida', archivo = ?, archivo_sin_costos = ?,
       monto = ?, moneda = ?, con_imagenes = ?, error = NULL
     WHERE folio = ?`,
  ).bind(
    c.archivo ?? null, c.archivoSinCostos ?? null,
    c.monto ?? null, c.moneda ?? null, c.conImagenes ? 1 : 0, folio,
  ).run();
}

/** Tronó después de tomar folio. El folio NO se recicla — queda documentado. */
export async function fallarOc(env: Env, folio: string, error: string): Promise<void> {
  await ensureOcLedger(env);
  await env.DB.prepare(
    `UPDATE oc_emitida SET estado = 'fallida', error = ? WHERE folio = ? AND estado != 'emitida'`,
  ).bind(error.slice(0, 500), folio).run();
}

export interface ListarOcOpts {
  proyectoId?: number;
  proveedorId?: string;
  estado?: OcEstado;
  limit?: number;
}

export async function listarOc(env: Env, opts: ListarOcOpts = {}): Promise<OcEmitidaRow[]> {
  await ensureOcLedger(env);
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (opts.proyectoId) { where.push('proyecto_id = ?'); binds.push(opts.proyectoId); }
  if (opts.proveedorId) { where.push('proveedor_id = ?'); binds.push(opts.proveedorId); }
  if (opts.estado) { where.push('estado = ?'); binds.push(opts.estado); }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const { results } = await env.DB.prepare(
    `SELECT * FROM oc_emitida ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     -- Desempate por número de folio: las 235 filas del backfill comparten
     -- fecha (nadie sabe cuándo se emitieron), y sin esto la lista sale en
     -- orden arbitrario.
     ORDER BY emitida_at DESC, CAST(SUBSTR(folio, 4) AS INTEGER) DESC LIMIT ?`,
  ).bind(...binds, limit).all<OcEmitidaRow>();
  return results ?? [];
}

/** Una OC del ledger por su folio. */
export async function getOc(env: Env, folio: string): Promise<OcEmitidaRow | null> {
  await ensureOcLedger(env);
  return env.DB.prepare('SELECT * FROM oc_emitida WHERE folio = ?').bind(folio).first<OcEmitidaRow>();
}

// ── Backfill ─────────────────────────────────────────────────────────────────
// El ledger nació el 2026-08-25, con 235 folios ya emitidos. 219 se pueden
// reconstruir del espejo: el nombre del archivo trae folio y razón social, y la
// fila del Proyecto da el resto. Los que no aparecen se siembran como
// 'sin-rastro' — saber que existen y que nadie sabe qué son es infinitamente
// mejor que no saber ni que existen.

/** `OC_<folio>_<razón social>.pdf`, con `_SIN-COSTOS` opcional (dos copias de
 * la misma orden desde 2026-08-24). Igual que el del front
 * (src/boards/oportunidades/proyecto/OrdenesSection.tsx). */
const OC_ARCHIVO_RE = /OC_(OC-\d+)_(.+?)(_SIN-COSTOS)?\.pdf/gi;

export interface ArchivoDeOc { folio: string; proveedor: string; archivo: string; sinCostos: boolean }

/** decodeURIComponent que no truena: un '%' suelto en un nombre de archivo
 * lanza URIError, y en el backfill eso abortaba la siembra COMPLETA de 235
 * órdenes por un solo nombre raro (visto en test, 2026-08-25). */
function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Saca las OC mencionadas en el texto de una columna de archivos. Pura. */
export function ocDeColumna(texto: string): ArchivoDeOc[] {
  const out: ArchivoDeOc[] = [];
  const re = new RegExp(OC_ARCHIVO_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    out.push({
      folio: m[1].toUpperCase(),
      proveedor: decode(m[2]).replace(/_/g, ' ').trim(),
      // El texto de la columna es una lista de URLs, así que el nombre viene
      // encodeado: sin decodificar, el ledger guardaría
      // "OC_OC-235_ATHLETIC%20FOOTWEAR.pdf" y dejaría de coincidir con el
      // archivo real.
      archivo: decode(m[0].split('/').pop() ?? m[0]),
      sinCostos: !!m[3],
    });
  }
  return out;
}

export interface BackfillResumen {
  proyectosRevisados: number;
  reconstruidas: number;
  sinRastro: number;
  yaEstaban: number;
  folioMax: number;
}

/** Siembra el ledger a partir del espejo. Idempotente: no pisa lo que ya está
 * (ON CONFLICT DO NOTHING), así que se puede correr las veces que haga falta. */
export async function backfillOcLedger(
  env: Env, proyectosBoardId: number, ocColId: string, seqActual: number,
): Promise<BackfillResumen> {
  await ensureOcLedger(env);

  const { results } = await env.DB.prepare(
    `SELECT item_id, name, columns FROM items WHERE board_id = ? AND columns LIKE ?`,
  ).bind(proyectosBoardId, '%OC_OC-%').all<{ item_id: number; name: string; columns: string }>();

  const encontradas = new Map<string, { proyectoId: number; proveedor: string; archivo: string; sinCostos?: string }>();
  for (const row of results ?? []) {
    let cols: { id: string; text?: string | null }[] = [];
    try { cols = JSON.parse(row.columns || '[]'); } catch { continue; }
    const texto = cols.find(c => c.id === ocColId)?.text ?? '';
    for (const oc of ocDeColumna(texto)) {
      const previo = encontradas.get(oc.folio);
      if (oc.sinCostos) {
        if (previo) previo.sinCostos = oc.archivo;
        else encontradas.set(oc.folio, { proyectoId: row.item_id, proveedor: oc.proveedor, archivo: '', sinCostos: oc.archivo });
      } else if (previo) {
        previo.archivo = oc.archivo;
        previo.proyectoId = row.item_id;
        previo.proveedor = oc.proveedor;
      } else {
        encontradas.set(oc.folio, { proyectoId: row.item_id, proveedor: oc.proveedor, archivo: oc.archivo });
      }
    }
  }

  const at = new Date().toISOString();
  let reconstruidas = 0, yaEstaban = 0;
  const inserts: D1PreparedStatement[] = [];
  for (const [folio, d] of encontradas) {
    inserts.push(env.DB.prepare(
      `INSERT INTO oc_emitida (folio, proyecto_id, proveedor_id, proveedor, monto, moneda, archivo, archivo_sin_costos, motor, estado, emitida_at)
       VALUES (?,?,NULL,?,NULL,NULL,?,?, 'backfill', 'emitida', ?) ON CONFLICT(folio) DO NOTHING`,
    ).bind(folio, d.proyectoId, d.proveedor || '—', d.archivo || null, d.sinCostos ?? null, at));
  }

  // Los huecos de la secuencia: existen como folio consumido y nadie sabe qué
  // fueron. Pueden ser generaciones que fallaron, archivos borrados, o del ledger
  // viejo en Sheets de cmp-tallas — el backfill NO los distingue y no inventa.
  const folioMax = Math.max(seqActual, ...[...encontradas.keys()].map(numeroDeFolio), 0);
  let sinRastro = 0;
  for (let n = 1; n <= folioMax; n++) {
    const folio = `OC-${n}`;
    if (encontradas.has(folio)) continue;
    sinRastro++;
    inserts.push(env.DB.prepare(
      `INSERT INTO oc_emitida (folio, proyecto_id, proveedor, motor, estado, emitida_at)
       VALUES (?, 0, '—', 'backfill', 'sin-rastro', ?) ON CONFLICT(folio) DO NOTHING`,
    ).bind(folio, at));
  }

  // Troceado: D1 topa alrededor de 100 binds por query y el batch completo
  // rondaría los 1500 (ver docs/dev-contracts.md).
  const antes = await contarLedger(env);
  for (let i = 0; i < inserts.length; i += 40) await env.DB.batch(inserts.slice(i, i + 40));
  const despues = await contarLedger(env);
  reconstruidas = despues - antes;
  yaEstaban = inserts.length - reconstruidas;

  return { proyectosRevisados: (results ?? []).length, reconstruidas, sinRastro, yaEstaban, folioMax };
}

async function contarLedger(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM oc_emitida').first<{ n: number }>();
  return row?.n ?? 0;
}
