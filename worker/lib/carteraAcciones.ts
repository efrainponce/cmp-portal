// worker/lib/carteraAcciones.ts — Las dos ESCRITURAS que el bot de cartera
// puede hacer (plan docs/plan-wa-cartera.md §3 y §4), compartidas por el
// router de comandos (sin modelo) y por las tools del agente:
//  - registrarSeguimiento: el mensaje de la persona queda como Update REAL en
//    Monday + fila en `seguimientos` — el mismo camino que el composer de
//    Inicio (worker/routes/oportunidades.ts POST .../seguimiento). Firma
//    "— {nombre}, vía WhatsApp" porque en Monday el autor es el token de
//    servicio.
//  - cerrarOportunidad: mueve deal_stage a Cancelada ("archivar", como el
//    botón del drawer) o Perdida por el outbox, con el permiso normal de la
//    whitelist (deal_stage `w: V`) y scope 'own'. NUNCA archive_item de
//    Monday (mutación destructiva: el item saldría del espejo y de la
//    analítica; monday.destructivo.test.ts lo tumbaría). Deja un Update con el
//    motivo. La confirmación NO vive aquí: la pide el router (wa_pendiente) o
//    la regla del prompt, según el canal.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { DEAL_STAGE_LABELS } from '../../shared/dealStages';
import { getItem } from './dal';
import { postUpdate } from './nativeUpdates';
import { insertSeguimiento } from './home';
import { submitWrite, OutboxError } from './outbox';
import { statusIndex } from './notify';

export class CarteraError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** ExecutionContext para llamar submitWrite fuera de una ruta HTTP (el bot
 * corre en un waitUntil del webhook o en una tool): junta las promesas que el
 * outbox cuelga y `done()` las espera antes de contestar. */
export function ctxLocal(): ExecutionContext & { done(): Promise<void> } {
  const ps: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) { ps.push(p.catch(() => undefined)); },
    passThroughOnException() { /* no aplica */ },
    props: {},
    async done() { await Promise.all(ps); },
  };
  return ctx as unknown as ExecutionContext & { done(): Promise<void> };
}

export const ETAPAS_CIERRE = { cancelada: '5', perdida: '2' } as const;
export type Cierre = keyof typeof ETAPAS_CIERRE;

const nombreDe = (v: Identity) => v.nombre?.trim() || v.email;

export interface SeguimientoResult { updateId: number; folio: string | null; nombre: string; etiqueta: string }

export async function registrarSeguimiento(env: Env, viewer: Identity, itemId: number, texto: string): Promise<SeguimientoResult> {
  const mensaje = texto.trim();
  if (!mensaje) throw new CarteraError(422, 'El seguimiento no puede ir vacío.');
  if (mensaje.length > 2000) throw new CarteraError(422, 'El seguimiento es muy largo (máximo 2000 caracteres).');
  const item = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!item) throw new CarteraError(404, 'No encontré esa oportunidad entre las tuyas.');
  const update = await postUpdate(env, BOARDS.oportunidades.id, itemId, `${nombreDe(viewer)}: ${mensaje} — vía WhatsApp`, [], { email: viewer.email, nombre: viewer.nombre });
  await insertSeguimiento(env, { itemId, mondayUpdateId: Number(update.id), autorEmail: viewer.email, mensaje });
  const folio = folioDe(item.columns);
  return { updateId: Number(update.id), folio, nombre: item.name, etiqueta: etiquetaDe(folio, item.name) };
}

/** "PRO-812 Nombre", sin repetir el folio si el nombre ya lo trae (igual que cartera.etiqueta). */
function etiquetaDe(folio: string | null, nombre: string): string {
  if (!folio || nombre.toLowerCase().includes(folio.toLowerCase())) return nombre.trim();
  return `${folio} ${nombre}`.trim();
}

function folioDe(columnsJson: string): string | null {
  try {
    const cols = JSON.parse(columnsJson || '[]') as Array<{ id: string; text: string | null }>;
    return cols.find(c => c.id === 'pulse_id_mm0qcq0m')?.text ?? null;
  } catch {
    return null;
  }
}

export interface CierreResult { etapa: string; folio: string | null; nombre: string; etiqueta: string }

export async function cerrarOportunidad(env: Env, viewer: Identity, itemId: number, cierre: Cierre, motivo: string): Promise<CierreResult> {
  const item = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!item) throw new CarteraError(404, 'No encontré esa oportunidad entre las tuyas.');
  const actual = statusIndex(item.columns, 'deal_stage');
  if (actual === '1') throw new CarteraError(409, 'Esa oportunidad ya está Ganada; no se cierra desde aquí.');
  if (actual === ETAPAS_CIERRE[cierre]) throw new CarteraError(409, `Esa oportunidad ya está ${DEAL_STAGE_LABELS[actual]}.`);
  const etapa = DEAL_STAGE_LABELS[ETAPAS_CIERRE[cierre]];
  const ctx = ctxLocal();
  try {
    await submitWrite(env, ctx, 'oportunidades', itemId, { deal_stage: etapa }, viewer);
  } catch (err) {
    if (err instanceof OutboxError) throw new CarteraError(err.status, err.message);
    throw err;
  }
  await ctx.done();
  const nota = motivo.trim() ? `: ${motivo.trim()}` : '';
  try {
    await postUpdate(env, BOARDS.oportunidades.id, itemId, `${nombreDe(viewer)} la marcó como ${etapa} desde WhatsApp${nota}`, [], { email: viewer.email, nombre: viewer.nombre });
  } catch { /* la etapa ya cambió; el Update es el rastro secundario (queda en outbox/activity_log) */ }
  const folio = folioDe(item.columns);
  return { etapa, folio, nombre: item.name, etiqueta: etiquetaDe(folio, item.name) };
}
