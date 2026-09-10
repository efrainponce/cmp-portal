// worker/lib/oportunidadLigada.ts — La Oportunidad ligada de cada Proyecto con su
// folio ("OPP-0085"), para pintarla junto al folio del proyecto en todos los
// boards de Proyectos y en el link del drawer (Efraín, 2026-09-10: "en todos los
// boards de proyectos necesito que se vea la oportunidad ligada así OPP-XXX").
//
// La liga vive en el Proyecto (`board_relation_mm0hf0y3`) y el folio en la
// Oportunidad (`pulse_id_mm0qcq0m`); Monday no espeja uno en el otro, así que se
// cruzan aquí contra el mirror. Dos filtros, igual que totalesPorProyecto
// (worker/lib/totales.ts):
//  - Por COLUMNA (shared/visibility.ts): el rol tiene que leer la relación en
//    Proyectos Y el folio en Oportunidades.
//  - Por RENGLÓN: solo las oportunidades que el viewer podría leer por su
//    cuenta. Un proyecto visible puede apuntar a una oportunidad de la zona
//    privada (worker/lib/zonas.ts) — esa no aparece, igual que el link "Ver
//    Oportunidad" del drawer (GET /api/proyectos/:id/oportunidad).
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { OportunidadLigadaDTO } from '../../shared/dto';
import { BOARDS } from '../../shared/boards';
import { canRead } from '../../shared/visibility';
import { linkedItemId, scopeFor, PROYECTO_OPP_REL } from './dal';

/** Folio de la Oportunidad — columna item_id con prefijo "OPP-" en Monday. */
export const OPP_FOLIO_COL = 'pulse_id_mm0qcq0m';

export function puedeVerOportunidadLigada(viewer: Pick<Identity, 'role' | 'email'>): boolean {
  return canRead('proyectos', PROYECTO_OPP_REL, viewer.role, viewer.email)
    && canRead('oportunidades', OPP_FOLIO_COL, viewer.role, viewer.email);
}

/** Folio de una fila de Oportunidad ya cargada del mirror; '' si no lo trae. */
export function folioDe(row: MirrorItem): string {
  try {
    const cols: { id: string; text?: string | null }[] = JSON.parse(row.columns || '[]');
    return cols.find(c => c.id === OPP_FOLIO_COL)?.text?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * proyecto (item id) -> su Oportunidad ligada con folio. Un proyecto hecho
 * desde cero (CrearProyectoModal) no tiene relación y no aparece.
 *
 * UNA consulta, con los ids como UN solo bind (arreglo JSON abierto con
 * json_each): ~600 ids no caben en los ~100 binds que aguanta D1. El folio se
 * extrae en SQL, así que de cada oportunidad viaja su folio y no sus ~3.5 KB
 * de columnas.
 */
export async function oportunidadesLigadas(
  env: Env, viewer: Identity, proyectos: MirrorItem[],
): Promise<Map<number, OportunidadLigadaDTO>> {
  const out = new Map<number, OportunidadLigadaDTO>();
  if (!puedeVerOportunidadLigada(viewer)) return out;

  const oppDe = new Map<number, number>();
  for (const row of proyectos) {
    const oppId = linkedItemId(row, PROYECTO_OPP_REL);
    if (oppId != null) oppDe.set(row.item_id, oppId);
  }
  if (oppDe.size === 0) return out;

  const scope = scopeFor('oportunidades', viewer);
  const res = await env.DB.prepare(
    `SELECT item_id,
            (SELECT json_extract(jc.value, '$.text') FROM json_each(items.columns) jc
              WHERE json_extract(jc.value, '$.id') = ?) AS folio
       FROM items
      WHERE board_id = ? AND item_id IN (SELECT value FROM json_each(?)) AND (${scope.where})`,
  ).bind(OPP_FOLIO_COL, BOARDS.oportunidades.id, JSON.stringify([...new Set(oppDe.values())]), ...scope.binds)
    .all<{ item_id: number; folio: string | null }>();

  const folios = new Map<number, string>();
  for (const r of res.results ?? []) folios.set(Number(r.item_id), (r.folio ?? '').trim());

  for (const [proyectoId, oppId] of oppDe) {
    const folio = folios.get(oppId);
    if (folio !== undefined) out.set(proyectoId, { id: String(oppId), folio });
  }
  return out;
}
