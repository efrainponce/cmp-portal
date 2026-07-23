// worker/lib/native/repo.ts — Repositorio del modelo NATIVO (plan 3). Lecturas y
// escrituras contra las tablas `records`/`record_relations`/`record_activity`, con el
// MISMO scoping por viewer que dal.ts y la MISMA whitelist de visibilidad que serialize.ts
// (no es un bypass de seguridad). DORMIDO: solo lo llama /api/native/* con NATIVE_SHADOW=1.
import type { Env } from '../../env';
import type { Identity } from '../../../shared/types';
import { BOARDS } from '../../../shared/boards';
import { canRead, canWrite } from '../../../shared/visibility';
import {
  FIELD_MAP, HOT, SLUG_FOR_ENTITY, mondayColForField, isNumericType,
  type NativeEntity, type NativeRecordDTO, type NativeActivityDTO, type NativeValue,
} from '../../../shared/native';
import { ensureNativeSchema, nextNativeId } from './schema';
import { logActivity } from './project';

export class NativeError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

interface RecordRow {
  entity: string; id: number; parent_id: number | null; title: string;
  stage: string | null; folio: string | null; amount: number | null;
  owner_ids: string; fields: string; source: string; created_at: string; updated_at: string;
}

const CHILD_OF: Partial<Record<NativeEntity, NativeEntity>> = {
  opportunity: 'opportunity_line',
  project: 'project_line',
};
const PARENT_OF: Partial<Record<NativeEntity, NativeEntity>> = {
  opportunity_line: 'opportunity',
  project_line: 'project',
};

interface Scope { where: string; binds: unknown[] }

// Espeja dal.ts scopeFor pero sobre `records.owner_ids`. admin/compras ven todo.
// vendedor/almacen: entidades con authzCols del board filtran por owner; entidades hijas
// checan el owner del PADRE; catálogos (sin authzCols) abiertos a todos.
function scopeFor(entity: NativeEntity, viewer: Identity): Scope {
  if (viewer.role === 'admin' || viewer.role === 'compras') return { where: '1=1', binds: [] };

  const parent = PARENT_OF[entity];
  const owningEntity = parent ?? entity;
  const owningSlug = SLUG_FOR_ENTITY[owningEntity];
  const authz = BOARDS[owningSlug].authzCols;
  if (!authz || authz.length === 0) return { where: '1=1', binds: [] };

  if (parent) {
    return {
      where: `EXISTS (SELECT 1 FROM records p, json_each(p.owner_ids) je
                WHERE p.entity = ? AND p.id = records.parent_id AND je.value = ?)`,
      binds: [parent, viewer.monday_user_id],
    };
  }
  return {
    where: `EXISTS (SELECT 1 FROM json_each(records.owner_ids) je WHERE je.value = ?)`,
    binds: [viewer.monday_user_id],
  };
}

// ── Serialización (respeta visibilidad por rol, como serialize.ts) ──────────
function toDTO(row: RecordRow, viewer: Identity): NativeRecordDTO {
  const entity = row.entity as NativeEntity;
  const slug = SLUG_FOR_ENTITY[entity];
  const rawFields = safeParse<Record<string, NativeValue>>(row.fields, {});
  const fields: Record<string, NativeValue> = {};
  for (const [name, val] of Object.entries(rawFields)) {
    const colId = mondayColForField(entity, name);
    // Solo se filtra por columnas que EXISTEN en la whitelist; los campos nativos
    // sin equivalente en Monday (o no listados) se dejan pasar para roles internos
    // y se ocultan al vendedor por defecto (fail-closed sobre lo desconocido).
    if (colId && !canRead(slug, colId, viewer.role)) continue;
    if (!colId && viewer.role !== 'admin' && viewer.role !== 'compras') continue;
    fields[name] = val;
  }
  return {
    entity, id: row.id, parentId: row.parent_id, title: row.title,
    stage: row.stage, folio: row.folio, amount: row.amount,
    ownerIds: safeParse<number[]>(row.owner_ids, []),
    source: row.source === 'native' ? 'native' : 'monday',
    fields, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// ── Lecturas ────────────────────────────────────────────────────────────────
export async function nativeList(
  env: Env, entity: NativeEntity, viewer: Identity, q?: string,
): Promise<NativeRecordDTO[]> {
  await ensureNativeSchema(env);
  const scope = scopeFor(entity, viewer);
  const binds: unknown[] = [entity, ...scope.binds];
  let sql = `SELECT * FROM records WHERE entity = ? AND (${scope.where})`;
  if (q) {
    sql += ` AND (title LIKE ? COLLATE NOCASE OR IFNULL(folio,'') LIKE ? COLLATE NOCASE
              OR EXISTS (SELECT 1 FROM json_each(records.fields) je
                         WHERE json_extract(je.value, '$.t') LIKE ? COLLATE NOCASE))`;
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY updated_at DESC LIMIT 4000`;
  const res = await env.DB.prepare(sql).bind(...binds).all<RecordRow>();
  return (res.results ?? []).map(r => toDTO(r, viewer));
}

async function getRow(
  env: Env, entity: NativeEntity, id: number, viewer: Identity,
): Promise<RecordRow | null> {
  const scope = scopeFor(entity, viewer);
  const sql = `SELECT * FROM records WHERE entity = ? AND id = ? AND (${scope.where})`;
  return (await env.DB.prepare(sql).bind(entity, id, ...scope.binds).first<RecordRow>()) ?? null;
}

export async function nativeGet(
  env: Env, entity: NativeEntity, id: number, viewer: Identity,
): Promise<NativeRecordDTO | null> {
  await ensureNativeSchema(env);
  const row = await getRow(env, entity, id, viewer);
  if (!row) return null;
  const dto = toDTO(row, viewer);

  const childEntity = CHILD_OF[entity];
  if (childEntity) {
    const cScope = scopeFor(childEntity, viewer);
    const res = await env.DB
      .prepare(`SELECT * FROM records WHERE entity = ? AND parent_id = ? AND (${cScope.where}) ORDER BY id`)
      .bind(childEntity, id, ...cScope.binds)
      .all<RecordRow>();
    dto.children = (res.results ?? []).map(r => toDTO(r, viewer));
  }

  const rels = await env.DB
    .prepare(`SELECT rel, to_entity, to_id FROM record_relations WHERE from_entity = ? AND from_id = ?`)
    .bind(entity, id)
    .all<{ rel: string; to_entity: string; to_id: number }>();
  dto.relations = (rels.results ?? []).map(r => ({ rel: r.rel, toEntity: r.to_entity as NativeEntity, toId: r.to_id }));
  return dto;
}

export async function nativeActivity(
  env: Env, entity: NativeEntity, id: number, viewer: Identity,
): Promise<NativeActivityDTO[]> {
  await ensureNativeSchema(env);
  const row = await getRow(env, entity, id, viewer); // scoping: 404 si no es del viewer
  if (!row) throw new NativeError(404, 'not found');
  const res = await env.DB
    .prepare(`SELECT id, kind, author, body, created_at FROM record_activity
              WHERE entity = ? AND record_id = ? ORDER BY id DESC LIMIT 200`)
    .bind(entity, id)
    .all<{ id: number; kind: string; author: string | null; body: string | null; created_at: string }>();
  return (res.results ?? []).map(r => ({
    id: r.id, kind: r.kind, author: r.author, body: r.body, createdAt: r.created_at,
  }));
}

// ── Escrituras (camino nativo dormido — NO toca Monday) ─────────────────────
/** Traduce un patch de campos nativos a hot-cols + fields JSON y valida escritura por rol. */
function applyFieldPatch(
  entity: NativeEntity, viewer: Identity,
  current: Record<string, NativeValue>, patch: Record<string, string>,
): { fields: Record<string, NativeValue>; changed: string[] } {
  const slug = SLUG_FOR_ENTITY[entity];
  const fields = { ...current };
  const changed: string[] = [];
  for (const [name, text] of Object.entries(patch)) {
    const colId = mondayColForField(entity, name);
    // Fail-closed: solo se permite escribir campos con columna Monday whitelisteada
    // como writable para el rol (misma regla que outbox.ts) — o admin.
    if (viewer.role !== 'admin') {
      if (!colId || !canWrite(slug, colId, viewer.role)) {
        throw new NativeError(403, `cannot write ${name}`);
      }
    }
    const def = colId ? FIELD_MAP[entity][colId] : undefined;
    const entry: NativeValue = { t: text };
    if (def && isNumericType(def.type)) {
      const n = Number(String(text).replace(/[^0-9.-]/g, ''));
      entry.n = Number.isFinite(n) ? n : null;
    }
    fields[name] = entry;
    changed.push(name);
  }
  return { fields, changed };
}

/** Recalcula columnas calientes desde los fields nativos. */
function hotFrom(entity: NativeEntity, fields: Record<string, NativeValue>) {
  const hot = HOT[entity];
  const nameOf = (colId?: string) => {
    if (!colId) return undefined;
    return FIELD_MAP[entity][colId]?.name ?? `x_${colId}`;
  };
  const stageName = nameOf(hot.stageCol);
  const folioName = nameOf(hot.folioCol);
  const amountName = nameOf(hot.amountCol);
  return {
    stage: stageName ? (fields[stageName]?.t ?? null) : null,
    folio: folioName ? (fields[folioName]?.t ?? null) : null,
    amount: amountName ? (fields[amountName]?.n ?? null) : null,
  };
}

export async function nativePatch(
  env: Env, entity: NativeEntity, id: number, viewer: Identity, patch: Record<string, string>,
): Promise<NativeRecordDTO> {
  await ensureNativeSchema(env);
  const row = await getRow(env, entity, id, viewer);
  if (!row) throw new NativeError(404, 'not found');
  if (Object.keys(patch).length === 0) throw new NativeError(400, 'no fields');

  const current = safeParse<Record<string, NativeValue>>(row.fields, {});
  const { fields, changed } = applyFieldPatch(entity, viewer, current, patch);
  const hot = hotFrom(entity, fields);
  const now = new Date().toISOString();

  await env.DB
    .prepare(`UPDATE records SET fields = ?, stage = ?, folio = ?, amount = ?, updated_at = ?
              WHERE entity = ? AND id = ?`)
    .bind(JSON.stringify(fields), hot.stage, hot.folio, hot.amount, now, entity, id)
    .run();
  await logActivity(env, entity, id, 'field_change', viewer.nombre ?? viewer.email,
    `Editó: ${changed.join(', ')}`);

  const updated = await getRow(env, entity, id, viewer);
  return toDTO(updated!, viewer);
}

export async function nativeCreate(
  env: Env, entity: NativeEntity, viewer: Identity,
  input: { title: string; parentId?: number | null; fields?: Record<string, string> },
): Promise<NativeRecordDTO> {
  await ensureNativeSchema(env);
  const title = (input.title ?? '').trim();
  if (!title) throw new NativeError(400, 'title required');

  const { fields } = applyFieldPatch(entity, viewer, {}, input.fields ?? {});
  const hot = hotFrom(entity, fields);
  const id = await nextNativeId(env);
  const now = new Date().toISOString();
  // El creador queda como owner (para que su propio scoping lo vea de inmediato).
  const ownerIds = PARENT_OF[entity] ? [] : [viewer.monday_user_id];

  await env.DB
    .prepare(`INSERT INTO records
        (entity, id, monday_board_id, monday_item_id, parent_id, title, stage, folio, amount, owner_ids, fields, source, created_at, updated_at)
        VALUES (?,?,NULL,NULL,?,?,?,?,?,?,?, 'native', ?, ?)`)
    .bind(entity, id, input.parentId ?? null, title, hot.stage, hot.folio, hot.amount,
      JSON.stringify(ownerIds), JSON.stringify(fields), now, now)
    .run();
  await logActivity(env, entity, id, 'create', viewer.nombre ?? viewer.email, `Creó ${title}`);

  const row = await env.DB
    .prepare(`SELECT * FROM records WHERE entity = ? AND id = ?`).bind(entity, id).first<RecordRow>();
  return toDTO(row!, viewer);
}

export async function nativeAddComment(
  env: Env, entity: NativeEntity, id: number, viewer: Identity, body: string,
): Promise<NativeActivityDTO> {
  await ensureNativeSchema(env);
  const row = await getRow(env, entity, id, viewer);
  if (!row) throw new NativeError(404, 'not found');
  const text = (body ?? '').trim();
  if (!text) throw new NativeError(400, 'body required');
  await logActivity(env, entity, id, 'update', viewer.nombre ?? viewer.email, text);
  const created = await env.DB
    .prepare(`SELECT id, kind, author, body, created_at FROM record_activity
              WHERE entity = ? AND record_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(entity, id)
    .first<{ id: number; kind: string; author: string | null; body: string | null; created_at: string }>();
  return { id: created!.id, kind: created!.kind, author: created!.author, body: created!.body, createdAt: created!.created_at };
}

// ── Admin: estado (paridad nativo vs mirror por entidad) ────────────────────
export async function nativeStatus(env: Env): Promise<{ entity: NativeEntity; native: number; mirror: number }[]> {
  await ensureNativeSchema(env);
  const out: { entity: NativeEntity; native: number; mirror: number }[] = [];
  for (const [entity, slug] of Object.entries(SLUG_FOR_ENTITY) as [NativeEntity, keyof typeof BOARDS][]) {
    const nat = await env.DB.prepare(`SELECT COUNT(*) c FROM records WHERE entity = ?`).bind(entity).first<{ c: number }>();
    const mir = await env.DB.prepare(`SELECT COUNT(*) c FROM items WHERE board_id = ?`).bind(BOARDS[slug].id).first<{ c: number }>();
    out.push({ entity, native: nat?.c ?? 0, mirror: mir?.c ?? 0 });
  }
  return out;
}
