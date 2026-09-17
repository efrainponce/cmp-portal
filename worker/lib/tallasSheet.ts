// worker/lib/tallasSheet.ts — Regenerar el Google Sheet de tallas del Proyecto
// SOLO cuando cambian las líneas de la cotización (PRO-0205 / OPP-0768,
// 2026-09-17: el vendedor dividió una línea en hombre/mujer el martes y el
// Sheet siguió con la línea de antes — nadie apretó "Regenerar Tallas" y el
// portal no lo hacía por su cuenta).
//
// El Sheet lo arma cmp-tallas (generate_sheet) leyendo los subitems de la
// Oportunidad DIRECTO de Monday: un bloque por subitem, y en regeneración
// conserva las cantidades ya capturadas por (subitem, género, talla). Por eso
// regenerar es seguro y por eso hay que hacerlo tras cada ajuste: dividir /
// editar / eliminar / restaurar una línea, y los cambios inline de color o
// cantidad. Un Proyecto sin Sheet (creado desde el portal, o "(copy)") no se
// toca: ahí la vía es la captura por boxes del portal o "Crear archivo".
//
// Dos tiempos, como la cola de limpieza (worker/lib/limpieza.ts):
//   1. En caliente: la ruta encola (D1) y dispara la regeneración con
//      waitUntil, para que el Sheet esté al día en segundos.
//   2. El cron de 10/15 min barre lo que quedó pendiente (la invocación se
//      cortó, cmp-tallas falló, Vercel tardó más de lo que aguanta waitUntil)
//      y reintenta hasta MAX_INTENTOS; después deja el error en sync_log.
// La fila se borra al lograrlo, así varios ajustes seguidos sobre la misma
// Oportunidad se cierran con una regeneración.
import type { Env } from '../env';
import { BOARDS } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import { PROYECTO_OPP_REL } from './dal';
import { generateSheet } from './automations';
import { registrarError } from './errores';
import { logSync } from '../sync/log';

/** Columna link "Tallas" del Proyecto (URL del Google Sheet); la escribe
 * generate_sheet al crearlo — misma constante que P_SHEET_LINK en el front. */
export const PROYECTO_SHEET_LINK = 'link_mm1amwz8';

const MAX_INTENTOS = 5;
/** Un intento en caliente que sigue corriendo no debe repetirse desde el
 * cron: se espera este tiempo desde la última solicitud antes de reintentar. */
const ESPERA_REINTENTO_MS = 2 * 60_000;
/** Presupuesto de pared por corrida del cron (mismo criterio que limpieza). */
const PRESUPUESTO_MS = 25_000;

let tablaLista = false;
export async function ensureSheetRegenTable(env: Env): Promise<void> {
  if (tablaLista) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sheet_regen_pendiente (
    proyecto_id    INTEGER PRIMARY KEY,
    oportunidad_id INTEGER NOT NULL,
    motivo         TEXT NOT NULL,
    solicitado_por TEXT NOT NULL,
    solicitado_at  TEXT NOT NULL,
    intentos       INTEGER NOT NULL DEFAULT 0,
    ultimo_error   TEXT
  )`).run();
  tablaLista = true;
}

interface ColRaw { id: string; value?: string | null; text?: string | null }

/** Proyectos ligados a la Oportunidad que SÍ tienen Sheet de tallas. Sin
 * scoping de viewer: la regeneración es del sistema, no del que edita (un
 * vendedor puede ajustar una línea de una Oportunidad cuyo Proyecto solo ve
 * Compras, y el Sheet igual tiene que cuadrar). */
export async function proyectosConSheet(env: Env, oppId: number): Promise<number[]> {
  const { results } = await env.DB
    .prepare('SELECT item_id, columns FROM items WHERE board_id = ? AND parent_item_id IS NULL AND columns LIKE ? LIMIT 20')
    .bind(BOARDS.proyectos.id, `%${oppId}%`)
    .all<{ item_id: number; columns: string }>();
  const out: number[] = [];
  for (const row of results ?? []) {
    if (isNativeId(row.item_id)) continue;
    try {
      const cols: ColRaw[] = JSON.parse(row.columns || '[]');
      const rel = cols.find(c => c.id === PROYECTO_OPP_REL);
      if (!rel?.value) continue;
      const ids: unknown[] = (JSON.parse(rel.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
      if (!ids.some(id => Number(id) === oppId)) continue;
      if (tieneSheet(cols)) out.push(row.item_id);
    } catch { /* columns corruptas — se ignora */ }
  }
  return out;
}

export function tieneSheet(cols: ColRaw[]): boolean {
  const link = cols.find(c => c.id === PROYECTO_SHEET_LINK);
  if (!link) return false;
  if (link.value) {
    try {
      const url = (JSON.parse(link.value) as { url?: string }).url ?? '';
      if (url.includes('docs.google.com')) return true;
    } catch { /* cae al texto */ }
  }
  return (link.text ?? '').includes('docs.google.com');
}

async function regenerarUno(env: Env, proyectoId: number): Promise<void> {
  const res = await generateSheet(env, proyectoId);
  if (res.skipped || (res.status as string | undefined) === 'skipped') {
    throw new Error(`generate_sheet omitido: ${res.reason ?? 'sin motivo'}`);
  }
  if (res.error) throw new Error(String(res.error));
}

async function intentar(env: Env, proyectoId: number, oppId: number, motivo: string): Promise<boolean> {
  try {
    await regenerarUno(env, proyectoId);
    await env.DB.prepare('DELETE FROM sheet_regen_pendiente WHERE proyecto_id = ?').bind(proyectoId).run();
    await logSync(env, 'http', BOARDS.proyectos.id, proyectoId, true, `Sheet de tallas regenerado (${motivo}, OPP ${oppId})`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const fila = await env.DB.prepare(
      `UPDATE sheet_regen_pendiente SET intentos = intentos + 1, ultimo_error = ? WHERE proyecto_id = ? RETURNING intentos`,
    ).bind(msg.slice(0, 500), proyectoId).first<{ intentos: number }>();
    if ((fila?.intentos ?? 0) >= MAX_INTENTOS) {
      await registrarError(env, 'regenerar Sheet de tallas tras ajuste', err, { boardId: BOARDS.proyectos.id, itemId: proyectoId, oportunidadId: oppId, motivo });
    }
    return false;
  }
}

/** Llamar tras cualquier cambio a las líneas de la Oportunidad `oppId` que ya
 * está en Monday. Encola y dispara en caliente; nunca lanza (la regeneración
 * del Sheet no debe convertir un ajuste ya aplicado en un error). */
export async function regenerarSheetTrasCambio(
  env: Env, ctx: Pick<ExecutionContext, 'waitUntil'> | undefined, oppId: number, motivo: string, quien: string,
): Promise<void> {
  try {
    if (!Number.isFinite(oppId) || isNativeId(oppId)) return;
    const proyectos = await proyectosConSheet(env, oppId);
    if (proyectos.length === 0) return;
    await ensureSheetRegenTable(env);
    const ahora = new Date().toISOString();
    for (const proyectoId of proyectos) {
      await env.DB.prepare(
        `INSERT INTO sheet_regen_pendiente (proyecto_id, oportunidad_id, motivo, solicitado_por, solicitado_at, intentos)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(proyecto_id) DO UPDATE SET motivo = excluded.motivo, solicitado_por = excluded.solicitado_por, solicitado_at = excluded.solicitado_at, intentos = 0, ultimo_error = NULL`,
      ).bind(proyectoId, oppId, motivo, quien, ahora).run();
      const tarea = intentar(env, proyectoId, oppId, motivo);
      if (ctx) ctx.waitUntil(tarea); else await tarea;
    }
  } catch (err) {
    await registrarError(env, 'encolar regeneración de Sheet de tallas', err, { boardId: BOARDS.oportunidades.id, itemId: oppId, motivo });
  }
}

/** Barrido del cron: reintenta lo que quedó pendiente (con espera desde la
 * última solicitud, para no pisar un intento en caliente que aún corre). */
export async function procesarSheetsPendientes(env: Env): Promise<{ ok: number; fallidos: number }> {
  const inicio = Date.now();
  let ok = 0, fallidos = 0;
  try {
    await ensureSheetRegenTable(env);
    const limite = new Date(Date.now() - ESPERA_REINTENTO_MS).toISOString();
    const { results } = await env.DB.prepare(
      `SELECT proyecto_id, oportunidad_id, motivo FROM sheet_regen_pendiente
       WHERE solicitado_at < ? AND intentos < ? ORDER BY solicitado_at LIMIT 5`,
    ).bind(limite, MAX_INTENTOS).all<{ proyecto_id: number; oportunidad_id: number; motivo: string }>();
    for (const fila of results ?? []) {
      if (Date.now() - inicio > PRESUPUESTO_MS) break;
      if (await intentar(env, fila.proyecto_id, fila.oportunidad_id, fila.motivo)) ok++; else fallidos++;
    }
  } catch (err) {
    await registrarError(env, 'barrido de Sheets de tallas pendientes', err);
  }
  return { ok, fallidos };
}
