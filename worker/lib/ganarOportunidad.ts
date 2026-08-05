// worker/lib/ganarOportunidad.ts — "Ganar" (Efraín, 2026-08-05): antes el botón
// del portal solo escribía deal_stage="Ganada" vía PATCH genérico. El Proyecto
// (donde viven tallas y OC — worker/lib/proyectoTallas.ts, ProyectoSection.tsx)
// lo creaba una automatización NATIVA de Monday enganchada a un BOTÓN de esa
// columna (no al valor de Etapa), así que ganar desde el portal nunca lo
// disparaba — hallazgo real haciendo la prueba end-to-end pedida por Efraín.
// Esta función replica esa automatización (inspeccionada vía Monday MCP,
// recipe 531581433 del board Oportunidades): mismo mapeo de campos hacia el
// Proyecto nuevo, mismos grupos, mismo link bidireccional.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { getItem, proyectoForOportunidad, PROYECTO_OPP_REL } from './dal';
import { createItem, moveItemToGroup, addFileToColumn, fetchAssetPublicUrls } from './monday';
import { upsertItem, refetchItem } from '../sync';
import { submitWrite } from './outbox';
import type { RawCol } from './serialize';

export class GanarOportunidadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Oportunidades (18395657596)
const OPP_COMPRAS = 'multiple_person_mm03qyw9';
const OPP_VENDEDOR = 'deal_owner';
const OPP_ZONA = 'dropdown_mm03g067';
const OPP_COTIZACION_FIRMADA = 'file_mm0zjras';
const OPP_CARPETA_DRIVE = 'link_mm468m26';
const OPP_PROYECTO_REL = 'board_relation_mm0hw8ew';
const OPORTUNIDADES_GANADAS_GROUP = 'closed';

// Proyectos (18395657594)
const PROYECTO_OWNER = 'project_owner';           // Compras
const PROYECTO_VENDEDOR = 'multiple_person_mm0hrnqq'; // también el authzCol de zonas.ts
const PROYECTO_ELABORADO_POR = 'multiple_person_mm164em1';
const PROYECTO_ZONA = 'dropdown_mm0hnyv';
const PROYECTO_COTIZACIONES = 'file_mm0hwapr';
const PROYECTO_CARPETA_DRIVE = 'link_mm462saa';
const PROYECTOS_NUEVO_GROUP = 'new_group29179';

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

// people/dropdown columns guardan la forma exacta que Monday espera de vuelta
// ({personsAndTeams:[...]} / {ids:[...]}) — mismo patrón que
// worker/lib/duplicateOportunidad.ts's peopleValue().
function passthroughValue(col?: RawCol): unknown | undefined {
  if (!col?.value) return undefined;
  try {
    return JSON.parse(col.value);
  } catch {
    return undefined;
  }
}

interface FileEntry { name: string; assetId: number }
function parseFiles(col?: RawCol): FileEntry[] {
  if (!col?.value) return [];
  try {
    return (JSON.parse(col.value) as { files?: FileEntry[] }).files ?? [];
  } catch {
    return [];
  }
}

async function copyFiles(env: Env, sourceCols: Map<string, RawCol>, sourceColId: string, targetItemId: number, targetColId: string): Promise<void> {
  const files = parseFiles(sourceCols.get(sourceColId));
  if (files.length === 0) return;
  const urls = await fetchAssetPublicUrls(env, files.map(f => String(f.assetId)));
  for (const f of files) {
    const url = urls.get(String(f.assetId));
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      await addFileToColumn(env, targetItemId, targetColId, blob, f.name);
    } catch {
      // un archivo falla -> se omite, el resto sigue (mismo criterio que duplicateOportunidad.ts)
    }
  }
}

const GANAR_ROLES: Identity['role'][] = ['vendedor', 'compras', 'admin'];

/** "Ganar": marca Ganada y crea el Proyecto ligado si todavía no existe uno
 * (reintentos / doble click no duplican). Devuelve el id del Proyecto. */
export async function ganarOportunidad(
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity,
): Promise<{ proyectoId: number }> {
  if (!GANAR_ROLES.includes(viewer.role)) throw new GanarOportunidadError(403, 'cannot ganar');

  // scope 'own': gana y crea el Proyecto a partir de esta — mismo criterio
  // que duplicateOportunidad.ts (worker/lib/zonas.ts).
  const source = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!source) throw new GanarOportunidadError(404, 'not found');
  const srcCols = colsOf(source);

  // Idempotente: si ya hay un Proyecto ligado (reintento, doble click), no crea
  // otro — solo reafirma la Etapa.
  const existing = await proyectoForOportunidad(env, itemId, viewer);
  if (existing) {
    await submitWrite(env, ctx, 'oportunidades', itemId, { deal_stage: 'Ganada' }, viewer, { trusted: true });
    return { proyectoId: existing.item_id };
  }

  const proyectoCols: Record<string, unknown> = {
    [PROYECTO_OPP_REL]: { item_ids: [itemId] },
  };
  const compras = passthroughValue(srcCols.get(OPP_COMPRAS));
  if (compras) {
    proyectoCols[PROYECTO_OWNER] = compras;
    proyectoCols[PROYECTO_ELABORADO_POR] = compras;
  }
  const vendedor = passthroughValue(srcCols.get(OPP_VENDEDOR));
  if (vendedor) proyectoCols[PROYECTO_VENDEDOR] = vendedor;
  const zona = passthroughValue(srcCols.get(OPP_ZONA));
  if (zona) proyectoCols[PROYECTO_ZONA] = zona;
  const carpetaDrive = passthroughValue(srcCols.get(OPP_CARPETA_DRIVE));
  if (carpetaDrive) proyectoCols[PROYECTO_CARPETA_DRIVE] = carpetaDrive;

  let proyecto;
  try {
    proyecto = await createItem(env, BOARDS.proyectos.id, source.name, proyectoCols, { maxRetries: 1, groupId: PROYECTOS_NUEVO_GROUP });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new GanarOportunidadError(502, `monday create failed: ${detail}`);
  }
  await upsertItem(env, 'proyectos', proyecto);
  const proyectoId = Number(proyecto.id);

  await copyFiles(env, srcCols, OPP_COTIZACION_FIRMADA, proyectoId, PROYECTO_COTIZACIONES);

  // Dos submitWrite separados, NO uno combinado — probado en vivo dos veces
  // (dos oportunidades de prueba reales): mandar deal_stage junto con
  // cualquier otra columna en el mismo change_multiple_column_values deja el
  // outbox en 'conflict' y, la segunda vez, deal_stage NUNCA llegó a Monday
  // (solo bien el board_relation) — deal_stage aislado sí es 100% confiable.
  // Bug preexistente del outbox al combinar columnas tipo status con otras en
  // un solo batch (visto también con date_mm09wqah), no de este flujo — pero
  // "Ganar" no puede darse el lujo de fallar en silencio, así que aquí se
  // evita el batch en vez de arriesgarlo.
  await submitWrite(env, ctx, 'oportunidades', itemId, { deal_stage: 'Ganada' }, viewer, { trusted: true });
  await submitWrite(env, ctx, 'oportunidades', itemId, { [OPP_PROYECTO_REL]: String(proyectoId) }, viewer, { trusted: true });

  // Best-effort — mover de grupo es organización visual en Monday, nunca debe
  // tumbar "Ganar" si falla.
  try { await moveItemToGroup(env, itemId, OPORTUNIDADES_GANADAS_GROUP); } catch { /* best-effort */ }

  ctx.waitUntil(refetchItem(env, BOARDS.proyectos.id, proyectoId));
  return { proyectoId };
}
