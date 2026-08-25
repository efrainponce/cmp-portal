// worker/lib/archivoLog.ts — bitácora de los archivos que el portal produce o
// recibe (Efraín, 2026-08-25: "de hecho de todos los archivos???").
//
// Qué NO es, y es la parte importante: **no es un índice de qué archivos
// existen**. La verdad de eso sigue siendo Monday + R2. El portal y Monday son
// 1-1, y una tabla que afirme que un archivo existe cuando Monday ya no lo
// tiene es exactamente la falla del 2026-08-19 otra vez (algo escondido del
// portal seguía vivo del otro lado y rompió costeo). Esto es HISTORIA: quién
// hizo qué, cuándo, y dónde quedó. Append-only, nunca se consulta para decidir
// si un archivo existe.
//
// Por qué hacía falta: había ~30 puntos del código que escriben archivos y
// exactamente 2 registraban algo (`registrarSubida`, el documento del
// Proyecto). Con 3 filas en toda la base, la regla "un archivo lo borra solo
// quien lo subió" era letra muerta: `puedeBorrarArchivo` deja pasar a
// cualquiera cuando no hay registro de quién subió —un fallback deliberado para
// los archivos viejos y los subidos directo en Monday— y sin registros ESE era
// el caso normal, no la excepción.
import type { Env } from '../env';

/** 'genera' = lo produjo el portal (un PDF). 'sube' = lo trajo una persona.
 * 'copia' = se replicó desde otro item (duplicar oportunidad, ganar, dividir
 * línea). 'borra' = se quitó de una columna (el respaldo vive en
 * `archivo_borrado`, aquí solo queda la línea de tiempo). */
export type ArchivoActo = 'genera' | 'sube' | 'copia' | 'borra';

export interface ArchivoEventoInput {
  acto: ArchivoActo;
  /** Para qué es el archivo: 'oc', 'oc-sin-costos', 'cotizacion',
   * 'solicitud-costeo', 'tallas', 'costeo', 'embellecimiento', 'documento',
   * 'inventario', 'producto-propuesto', 'update', 'linea'… Texto libre a
   * propósito: sirve para agrupar, no para validar. */
  categoria: string;
  nombre: string;
  boardId?: number | null;
  itemId?: number | null;
  colId?: string | null;
  assetId?: number | null;
  r2Key?: string | null;
  bytes?: number | null;
  porEmail?: string | null;
  /** Quién lo produjo: el portal, cmp-tallas o Monday. Default 'portal'. */
  origen?: 'portal' | 'cmp-tallas' | 'monday';
}

export interface ArchivoEventoRow {
  id: number;
  acto: string;
  categoria: string;
  nombre: string;
  board_id: number | null;
  item_id: number | null;
  col_id: string | null;
  asset_id: number | null;
  r2_key: string | null;
  bytes: number | null;
  por_email: string | null;
  origen: string;
  at: string;
}

let tablaLista = false;

export async function ensureArchivoLog(env: Env): Promise<void> {
  if (tablaLista) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS archivo_evento (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    acto      TEXT NOT NULL,
    categoria TEXT NOT NULL,
    nombre    TEXT NOT NULL,
    board_id  INTEGER,
    item_id   INTEGER,
    col_id    TEXT,
    asset_id  INTEGER,
    r2_key    TEXT,
    bytes     INTEGER,
    por_email TEXT,
    origen    TEXT NOT NULL DEFAULT 'portal',
    at        TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_archivo_evento_item ON archivo_evento (item_id, at DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_archivo_evento_at ON archivo_evento (at DESC)`).run();
  tablaLista = true;
}

/** Anota un acto sobre un archivo. **Nunca lanza**: la bitácora no puede ser el
 * motivo por el que falle generar una cotización o subir una evidencia. Un
 * evento perdido es una molestia; una OC que no se emite por no poder loggear
 * es un problema de verdad. */
export async function registrarArchivo(env: Env, ev: ArchivoEventoInput): Promise<void> {
  try {
    await ensureArchivoLog(env);
    await env.DB.prepare(
      `INSERT INTO archivo_evento (acto, categoria, nombre, board_id, item_id, col_id, asset_id, r2_key, bytes, por_email, origen, at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      ev.acto, ev.categoria, ev.nombre.slice(0, 300),
      ev.boardId ?? null, ev.itemId ?? null, ev.colId ?? null, ev.assetId ?? null,
      ev.r2Key ?? null, ev.bytes ?? null, ev.porEmail ?? null,
      ev.origen ?? 'portal', new Date().toISOString(),
    ).run();
  } catch { /* best-effort a propósito — ver el comentario de arriba */ }
}

/** Correo de quien subió/generó un archivo, buscándolo por su referencia en
 * Monday. Null si no hay registro — quien pregunta decide qué hacer con eso
 * (`puedeBorrarArchivo` lo trata como "archivo sin dueño conocido"). */
export async function autorDeArchivo(
  env: Env, boardId: number, itemId: number, colId: string, ref: { assetId: number; nombre: string },
): Promise<string | null> {
  await ensureArchivoLog(env);
  const row = await env.DB.prepare(
    `SELECT por_email FROM archivo_evento
      WHERE board_id = ? AND item_id = ? AND col_id = ? AND acto != 'borra'
        AND (asset_id = ? OR nombre = ?)
        AND por_email IS NOT NULL
      ORDER BY at DESC LIMIT 1`,
  ).bind(boardId, itemId, colId, ref.assetId, ref.nombre).first<{ por_email: string }>();
  return row?.por_email ?? null;
}

/** Historial de un item, lo más reciente primero. */
export async function historialArchivos(
  env: Env, itemId: number, limit = 100,
): Promise<ArchivoEventoRow[]> {
  await ensureArchivoLog(env);
  const { results } = await env.DB.prepare(
    `SELECT * FROM archivo_evento WHERE item_id = ? ORDER BY at DESC LIMIT ?`,
  ).bind(itemId, Math.min(Math.max(limit, 1), 500)).all<ArchivoEventoRow>();
  return results ?? [];
}
