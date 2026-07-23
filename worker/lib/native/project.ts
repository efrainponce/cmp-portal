// worker/lib/native/project.ts — Proyección mirror → modelo nativo (plan 3).
// DORMIDO: solo corre cuando NATIVE_SHADOW=1 (lo llama upsertItem tras escribir el
// mirror, y el backfill admin). Best-effort: traga sus propios errores, NUNCA rompe
// el sync/write que lo dispara — mismo contrato que maybeEmitStageChange.
import type { Env } from '../../env';
import type { BoardSlug } from '../../../shared/boards';
import { BOARDS, boardById } from '../../../shared/boards';
import {
  ENTITY_FOR_SLUG, FIELD_MAP, HOT, RELATION_MAP, isNumericType,
  nativeFieldName, type NativeEntity, type NativeValue,
} from '../../../shared/native';
import { ensureNativeSchema } from './schema';

interface RawCol { id: string; type?: string; text?: string | null; value?: string | null }

export interface ProjectInput {
  slug: BoardSlug;
  mondayItemId: number;
  parentItemId: number | null;
  name: string;
  vendedorIds: number[];
  columns: RawCol[];
}

/** "$1,234.50" | "1234.5" → 1234.5 ; vacío/no-numérico → null. */
function parseNum(text: string | null | undefined): number | null {
  if (text == null || text === '') return null;
  const n = Number(String(text).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** linked_item_ids de una columna board_relation del mirror ({linked_item_ids:[...]}). */
function linkedIds(col: RawCol | undefined): number[] {
  if (!col?.value) return [];
  try {
    const ids = (JSON.parse(col.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
    return ids.map(Number).filter(Number.isFinite);
  } catch { return []; }
}

/** Construye la forma nativa (fields + calientes + relaciones) de un item del mirror. */
export function buildNativeRecord(input: ProjectInput) {
  const entity: NativeEntity = ENTITY_FOR_SLUG[input.slug];
  const map = FIELD_MAP[entity];
  const byId = new Map(input.columns.map(c => [c.id, c]));

  const fields: Record<string, NativeValue> = {};
  for (const col of input.columns) {
    const def = map[col.id];
    const type = def?.type;
    const t = col.text ?? null;
    const entry: NativeValue = { t };
    if (type && isNumericType(type)) entry.n = parseNum(t);
    fields[nativeFieldName(entity, col.id)] = entry;
  }

  const hot = HOT[entity];
  const stage = hot.stageCol ? (byId.get(hot.stageCol)?.text ?? null) : null;
  const folio = hot.folioCol ? (byId.get(hot.folioCol)?.text ?? null) : null;
  const amount = hot.amountCol ? parseNum(byId.get(hot.amountCol)?.text) : null;

  const relations: { rel: string; toEntity: NativeEntity; toId: number }[] = [];
  const relMap = RELATION_MAP[entity];
  for (const [colId, def] of Object.entries(relMap)) {
    for (const toId of linkedIds(byId.get(colId))) {
      relations.push({ rel: def.rel, toEntity: def.to, toId });
    }
  }

  return { entity, stage, folio, amount, fields, relations };
}

/** Proyecta un item del mirror al modelo nativo (upsert de records + relaciones +
 *  actividad de cambio de etapa). Best-effort. */
export async function projectToNative(env: Env, input: ProjectInput): Promise<void> {
  try {
    await ensureNativeSchema(env);
    const entity = ENTITY_FOR_SLUG[input.slug];
    const boardId = BOARDS[input.slug].id;
    const id = input.mondayItemId;
    const { stage, folio, amount, fields, relations } = buildNativeRecord(input);
    const now = new Date().toISOString();

    // Etapa previa (para actividad) — solo lectura barata, solo con el flag encendido.
    const prev = await env.DB
      .prepare(`SELECT stage FROM records WHERE entity = ? AND id = ?`)
      .bind(entity, id)
      .first<{ stage: string | null }>();

    await env.DB
      .prepare(
        `INSERT INTO records
          (entity, id, monday_board_id, monday_item_id, parent_id, title, stage, folio, amount, owner_ids, fields, source, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'monday',?,?)
         ON CONFLICT(entity, id) DO UPDATE SET
           monday_board_id=excluded.monday_board_id, monday_item_id=excluded.monday_item_id,
           parent_id=excluded.parent_id, title=excluded.title, stage=excluded.stage,
           folio=excluded.folio, amount=excluded.amount, owner_ids=excluded.owner_ids,
           fields=excluded.fields, updated_at=excluded.updated_at`,
      )
      .bind(
        entity, id, boardId, id, input.parentItemId, input.name,
        stage, folio, amount, JSON.stringify(input.vendedorIds), JSON.stringify(fields), now, now,
      )
      .run();

    // Relaciones: reemplazo total de las salientes de este registro (así un desenlace
    // en Monday se refleja). Solo si la entidad declara relaciones.
    if (Object.keys(RELATION_MAP[entity]).length > 0) {
      await env.DB.prepare(`DELETE FROM record_relations WHERE from_entity = ? AND from_id = ?`)
        .bind(entity, id).run();
      for (const r of relations) {
        await env.DB
          .prepare(`INSERT OR IGNORE INTO record_relations (from_entity, from_id, rel, to_entity, to_id) VALUES (?,?,?,?,?)`)
          .bind(entity, id, r.rel, r.toEntity, r.toId)
          .run();
      }
    }

    // Actividad: alta o cambio de etapa.
    if (!prev) {
      await logActivity(env, entity, id, 'create', null, `Registro proyectado (${input.name})`);
    } else if (stage && prev.stage !== stage) {
      await logActivity(env, entity, id, 'stage_change', null, `Etapa: ${prev.stage ?? '—'} → ${stage}`);
    }
  } catch (err) {
    // Best-effort: se traga y se loguea. Nunca rompe el sync que lo disparó.
    const detail = err instanceof Error ? err.message : String(err);
    try {
      await env.DB
        .prepare(`INSERT INTO sync_log (kind, board_id, item_id, ok, detail, at) VALUES ('native', ?, ?, 0, ?, ?)`)
        .bind(BOARDS[input.slug].id, input.mondayItemId, `project: ${detail}`, new Date().toISOString())
        .run();
    } catch { /* ni el log debe romper */ }
  }
}

interface MirrorRow {
  board_id: number; item_id: number; parent_item_id: number | null;
  name: string; vendedor_ids: string; columns: string;
}

/** Backfill: proyecta TODO el mirror `items` al modelo nativo. Idempotente (upsert).
 *  Lo dispara el admin vía /api/native/admin/backfill. Devuelve conteos por board. */
export async function backfillAll(env: Env): Promise<{ slug: BoardSlug; projected: number }[]> {
  await ensureNativeSchema(env);
  const out: { slug: BoardSlug; projected: number }[] = [];
  for (const slug of Object.keys(BOARDS) as BoardSlug[]) {
    const boardId = BOARDS[slug].id;
    const res = await env.DB
      .prepare(`SELECT board_id, item_id, parent_item_id, name, vendedor_ids, columns FROM items WHERE board_id = ?`)
      .bind(boardId)
      .all<MirrorRow>();
    let projected = 0;
    for (const row of res.results ?? []) {
      const def = boardById(row.board_id);
      if (!def) continue;
      let columns: RawCol[] = [];
      try { columns = JSON.parse(row.columns) as RawCol[]; } catch { /* fila corrupta — se salta */ }
      let vendedorIds: number[] = [];
      try { vendedorIds = JSON.parse(row.vendedor_ids) as number[]; } catch { /* default [] */ }
      await projectToNative(env, {
        slug: def.slug, mondayItemId: row.item_id, parentItemId: row.parent_item_id,
        name: row.name, vendedorIds, columns,
      });
      projected++;
    }
    out.push({ slug, projected });
  }
  return out;
}

/** Escribe una fila de actividad nativa. Best-effort (no relanza). */
export async function logActivity(
  env: Env, entity: NativeEntity, recordId: number,
  kind: string, author: string | null, body: string | null, meta?: unknown,
): Promise<void> {
  try {
    await env.DB
      .prepare(`INSERT INTO record_activity (entity, record_id, kind, author, body, meta, created_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(entity, recordId, kind, author, body, meta != null ? JSON.stringify(meta) : null, new Date().toISOString())
      .run();
  } catch { /* best-effort */ }
}
