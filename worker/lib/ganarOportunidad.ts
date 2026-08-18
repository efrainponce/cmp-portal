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
import { isNativeId } from '../../shared/nativeId';
import { getItem, proyectoForOportunidad, PROYECTO_OPP_REL } from './dal';
import { createItem, moveItemToGroup, addFileToColumn, fetchAssetPublicUrls } from './monday';
import { upsertItem, refetchItem } from '../sync';
import { submitWrite, boardRelationValue } from './outbox';
import { reserveNativeId } from './nativeSeq';
import { rawHash, type RawColumn } from './canon';
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

// Estado inicial del Proyecto — el mismo default que aplica el board de Monday
// al crear un Proyecto real (shared/column-meta.gen.ts project_status).
const PROYECTO_STATUS = 'project_status';
const PROYECTO_STATUS_INICIAL = 'Desglose de tallas';
const PROYECTO_STATUS_INICIAL_INDEX = 5;

/** Primer person id de un value ya parseado ({personsAndTeams:[{id}]}) —
 * mismo shape que passthroughValue produce, para derivar vendedor_ids del
 * Proyecto nativo (authzCols de shared/boards.ts). */
function firstId(value: unknown): number | undefined {
  const ids = (value as { personsAndTeams?: { id: number }[] } | undefined)?.personsAndTeams;
  const n = ids?.[0]?.id;
  return Number.isFinite(n) ? n : undefined;
}

/** "Ganar" para una oportunidad nativa (Zona Efrain, "salir de Monday"): crea
 * el Proyecto como una fila más de D1 (mismo espacio de ids sintéticos), sin
 * create_item ni move_to_group en Monday. Copia compras/vendedor/zona
 * VERBATIM del RawCol de la oportunidad — ya vienen en el shape real de
 * Monday desde que se creó (submitCreateNative usa encodeColumnValue), así
 * que no hace falta reconstruirlos. Sin copyFiles (no hay cotización firmada
 * vía DocuSeal que copiar en este flujo). */
async function ganarOportunidadNativeD1(
  env: Env, ctx: ExecutionContext, itemId: number, source: MirrorItem, srcCols: Map<string, RawCol>, viewer: Identity,
): Promise<{ proyectoId: number }> {
  const proyectoId = await reserveNativeId(env);
  const columns: RawColumn[] = [
    { id: PROYECTO_OPP_REL, type: 'board_relation', text: source.name, value: JSON.stringify(boardRelationValue(String(itemId))) },
    // Etapa inicial del post-venta. En un Proyecto REAL la estampa Monday sola
    // (default del board al crear el item); un Proyecto nativo nacía sin ella y
    // eso lo dejaba INVISIBLE en todos los accesos de Proyectos del sidebar —
    // todos filtran por project_status (src/lib/projectStages.ts) y un item sin
    // valor no cae en ningún grupo (Efraín, 2026-08-17: hallazgo al probar el
    // tab de Zona Efrain del lado de Proyectos).
    {
      id: PROYECTO_STATUS, type: 'status', text: PROYECTO_STATUS_INICIAL,
      value: JSON.stringify({ index: PROYECTO_STATUS_INICIAL_INDEX, changed_at: new Date().toISOString() }),
    },
  ];
  const compras = srcCols.get(OPP_COMPRAS);
  if (compras?.value) {
    columns.push({ ...compras, id: PROYECTO_OWNER });
    columns.push({ ...compras, id: PROYECTO_ELABORADO_POR });
  }
  const vendedorCol = srcCols.get(OPP_VENDEDOR);
  if (vendedorCol?.value) columns.push({ ...vendedorCol, id: PROYECTO_VENDEDOR });
  const zonaCol = srcCols.get(OPP_ZONA);
  if (zonaCol?.value) columns.push({ ...zonaCol, id: PROYECTO_ZONA });

  const vendedorIds: number[] = [];
  const vId = firstId(vendedorCol?.value ? JSON.parse(vendedorCol.value) : undefined);
  if (vId !== undefined) vendedorIds.push(vId);

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO items (board_id, item_id, parent_item_id, name, group_id, vendedor_ids, monday_updated_at, synced_at, content_hash, columns)
       VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      BOARDS.proyectos.id, proyectoId, source.name, JSON.stringify(vendedorIds),
      now, now, rawHash(columns), JSON.stringify(columns),
    )
    .run();

  await submitWrite(env, ctx, 'oportunidades', itemId, { deal_stage: 'Ganada' }, viewer, { trusted: true });
  await submitWrite(env, ctx, 'oportunidades', itemId, { [OPP_PROYECTO_REL]: String(proyectoId) }, viewer, { trusted: true });

  return { proyectoId };
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

  if (isNativeId(itemId)) return ganarOportunidadNativeD1(env, ctx, itemId, source, srcCols, viewer);

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
  // Zona por LABEL, nunca el value crudo: los ids de label son propios de cada
  // columna y NO coinciden entre boards (Oportunidades 3="Centro", Proyectos
  // 3="Sur"), así que copiar {ids:[...]} traducía la zona a otra en silencio —
  // bug real visto en la prueba en vivo del 2026-08-14, donde "Centro" aterrizó
  // como "Sur". Solo "Norte" coincidía por casualidad, y "Sur" (id 7) ni existe
  // en Proyectos. Mismo shape que columnEncode.ts para dropdown.
  const zonaLabel = srcCols.get(OPP_ZONA)?.text?.trim();
  if (zonaLabel) proyectoCols[PROYECTO_ZONA] = { labels: [zonaLabel] };
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
