// worker/lib/dal.ts — all reads scoped by viewer. Handlers cannot bypass these predicates.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { BoardDef, BoardSlug } from '../../shared/boards';
import { BOARDS } from '../../shared/boards';
import { ZONA_PRIVADA_BOARDS } from './zonas';
import { ensureItemOrderTable } from './itemOrder';
import { ensureItemOcultoTable, NOT_OCULTO } from './itemOculto';

interface Scope {
  where: string;
  binds: unknown[];
}

/** 'read': lo propio + lo de la zona que el viewer lidera (worker/lib/zonas.ts).
 * 'own': estrictamente lo propio, ignorando la zona — lo que exige TODO camino de
 * escritura, para que un líder pueda ver el trabajo de su equipo sin poder pisarlo. */
export type ScopeMode = 'read' | 'own';

/** Los ids que cuentan como "dueño" para este viewer bajo este modo. Puro: la
 * resolución de la zona ya ocurrió en worker/mw/identity.ts (viewer.scope_user_ids). */
export function ownerIdsFor(viewer: Identity, mode: ScopeMode): number[] {
  if (mode === 'own') return [viewer.monday_user_id];
  return [...new Set([viewer.monday_user_id, ...(viewer.scope_user_ids ?? [])])];
}

// admin: everything, always — EXCEPTO la zona privada 'Efrain' (worker/lib/zonas.ts):
// un admin fuera de su whitelist no ve las filas de sus miembros en
// Oportunidades/Proyectos, vía viewer.hidden_owner_ids (resuelto en
// mw/identity.ts). compras: everything on boards without comprasCol (catálogos
// como productos/instituciones); en Oportunidades/Proyectos, solo lo propio
// (comprasScopeFor) — Efraín, 2026-08-10: "el de compras SOLO puede ver sus
// productos". vendedor/almacen (and any other non-privileged role): rows whose
// owning board's authzCols include the viewer; subitem boards check the
// PARENT's owners. Boards without authzCols (productos/instituciones) are open
// to all (the serializer still strips columns per-role — shared/visibility.ts).
export function scopeFor(slug: BoardSlug, viewer: Identity, mode: ScopeMode = 'read'): Scope {
  const board = BOARDS[slug];
  const owningBoard = board.parent ? BOARDS[board.parent] : board;

  if (viewer.role === 'admin') {
    const hiddenOwners = viewer.hidden_owner_ids ?? [];
    if (hiddenOwners.length === 0 || !ZONA_PRIVADA_BOARDS.has(slug)) return { where: '1=1', binds: [] };
    const placeholders = hiddenOwners.map(() => '?').join(',');
    if (board.parent) {
      return {
        where: `NOT EXISTS (
          SELECT 1 FROM items p, json_each(p.vendedor_ids) je
          WHERE p.board_id = ? AND p.item_id = items.parent_item_id AND je.value IN (${placeholders})
        )`,
        binds: [owningBoard.id, ...hiddenOwners],
      };
    }
    return {
      where: `NOT EXISTS (SELECT 1 FROM json_each(items.vendedor_ids) je WHERE je.value IN (${placeholders}))`,
      binds: [...hiddenOwners],
    };
  }

  if (viewer.role === 'compras') return comprasScopeFor(board, owningBoard, viewer, mode);

  if (!owningBoard.authzCols || owningBoard.authzCols.length === 0) return { where: '1=1', binds: [] };

  // IN (…) con un placeholder por id: casi siempre es uno solo (nadie lidera zona)
  // y un líder trae un puñado, así que no cambia el plan de la consulta.
  const ids = ownerIdsFor(viewer, mode);
  const placeholders = ids.map(() => '?').join(',');

  if (board.parent) {
    return {
      where: `EXISTS (
        SELECT 1 FROM items p, json_each(p.vendedor_ids) je
        WHERE p.board_id = ? AND p.item_id = items.parent_item_id AND je.value IN (${placeholders})
      )`,
      binds: [owningBoard.id, ...ids],
    };
  }
  return {
    where: `EXISTS (SELECT 1 FROM json_each(items.vendedor_ids) je WHERE je.value IN (${placeholders}))`,
    binds: [...ids],
  };
}

// Compras no tiene una columna `vendedor_ids` precalculada — esa solo indexa
// los authzCols de Vendedor (worker/sync/upsert.ts extractVendedorIds), y
// agregarle una segunda columna a `items` pediría una migración ALTER TABLE
// que el pipeline de deploy no corre (worker/schema.sql: todo lo nuevo se crea
// LAZY en runtime, nunca se altera la tabla ya desplegada). En vez de eso se
// lee directo el JSON crudo de `columns` — mismo patrón de json_each anidado
// que ya usa SEARCHABLE_COLS más abajo, solo que aquí además se abre
// `value` (un JSON *encodeado como string* dentro de cada columna, tal cual
// lo manda Monday) para leer `personsAndTeams`.
function comprasScopeFor(board: BoardDef, owningBoard: BoardDef, viewer: Identity, mode: ScopeMode): Scope {
  if (!owningBoard.comprasCol) return { where: '1=1', binds: [] };

  const ids = ownerIdsFor(viewer, mode);
  const placeholders = ids.map(() => '?').join(',');
  const personsMatch = (alias: string) => `EXISTS (
    SELECT 1 FROM json_each(${alias}.columns) jc
    WHERE json_extract(jc.value, '$.id') = ?
      AND EXISTS (
        SELECT 1 FROM json_each(json_extract(jc.value, '$.value'), '$.personsAndTeams') jp
        WHERE json_extract(jp.value, '$.id') IN (${placeholders})
      )
  )`;

  if (board.parent) {
    return {
      where: `EXISTS (
        SELECT 1 FROM items p
        WHERE p.board_id = ? AND p.item_id = items.parent_item_id AND ${personsMatch('p')}
      )`,
      binds: [owningBoard.id, owningBoard.comprasCol, ...ids],
    };
  }
  return { where: personsMatch('items'), binds: [owningBoard.comprasCol, ...ids] };
}

/** ¿El viewer ve filas de alguien más que él? Solo cierto para un líder con zona
 * poblada. Sirve para no pagar la consulta extra de propiedad (ownsItem) en el
 * 99% de los requests, donde "lo veo" y "es mío" son lo mismo. */
export function leadsOthers(viewer: Identity): boolean {
  return ownerIdsFor(viewer, 'read').length > 1;
}

export function childSlugOf(slug: BoardSlug): BoardSlug | undefined {
  return (Object.keys(BOARDS) as BoardSlug[]).find(k => BOARDS[k].parent === slug);
}

// Columns whose `text` participates in search beyond the item name (JSON, so
// json_each over `columns` finds them regardless of board — other boards simply
// have no matching id). Vendedor/Compras + Institución/Folio/Contacto: users
// search by client or institution name ("zeus"), not just the item name.
const SEARCHABLE_COLS = [
  'deal_owner', 'multiple_person_mm03qyw9',        // Vendedor / Compras
  'lookup_mm1bs976', 'pulse_id_mm0qcq0m', 'deal_contact', // Institución / Folio / Contacto
  // Productos: SKU / Nombre Producto / Marca — el catálogo se busca por SKU
  // tanto como por nombre (Efraín, 2026-07-30).
  'product_and_service_sku', 'text_mm0wvga2', 'product_and_service_description',
];

/** Palabras del query. Todas deben aparecer (AND) pero cada una puede caer en
 * un campo distinto y en cualquier orden — "5.11 bota" o "bota 5.11" llegan al
 * mismo producto, cosa que un solo LIKE del query completo nunca lograba. Tope
 * de 6 palabras: cada una agrega un EXISTS al query. */
export function searchTokens(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

export async function listItems(env: Env, slug: BoardSlug, viewer: Identity, q?: string, mode: ScopeMode = 'read'): Promise<MirrorItem[]> {
  const board = BOARDS[slug];
  const scope = scopeFor(slug, viewer, mode);
  const binds: unknown[] = [board.id, ...scope.binds];
  // Lo "quitado" desde el portal no se ve, aunque el item siga vivo en Monday
  // (el portal nunca borra allá — ver worker/lib/itemOculto.ts).
  await ensureItemOcultoTable(env);
  let sql = `SELECT * FROM items WHERE board_id = ? AND (${scope.where}) AND ${NOT_OCULTO}`;
  if (q) {
    const placeholders = SEARCHABLE_COLS.map(() => '?').join(',');
    // Una cláusula por palabra (AND entre ellas, OR entre campos dentro de
    // cada una): antes el query entero iba en un solo LIKE, así que "5.11
    // bota" no encontraba nada aunque las dos palabras estuvieran en el item.
    for (const token of searchTokens(q)) {
      sql += ` AND (
        name LIKE ? COLLATE NOCASE
        OR EXISTS (
          SELECT 1 FROM json_each(items.columns) je
          WHERE json_extract(je.value, '$.id') IN (${placeholders})
            AND json_extract(je.value, '$.text') LIKE ? COLLATE NOCASE
        )
      )`;
      binds.push(`%${token}%`, ...SEARCHABLE_COLS, `%${token}%`);
    }
  }
  sql += ' ORDER BY monday_updated_at DESC LIMIT 4000';
  const res = await env.DB.prepare(sql).bind(...binds).all<MirrorItem>();
  return res.results ?? [];
}

// Returns null (never throws) when the item doesn't exist OR isn't owned by viewer —
// callers must answer 404, not 403, so ownership never leaks.
//
// mode 'own' (todo camino de ESCRITURA) ignora la zona del viewer: un líder ve la
// oportunidad de su vendedor pero al escribirla recibe el mismo 404 que un extraño.
export async function getItem(
  env: Env, slug: BoardSlug, itemId: number, viewer: Identity, mode: ScopeMode = 'read',
): Promise<MirrorItem | null> {
  const board = BOARDS[slug];
  const scope = scopeFor(slug, viewer, mode);
  await ensureItemOcultoTable(env);
  const sql = `SELECT * FROM items WHERE board_id = ? AND item_id = ? AND (${scope.where}) AND ${NOT_OCULTO}`;
  const row = await env.DB.prepare(sql).bind(board.id, itemId, ...scope.binds).first<MirrorItem>();
  return row ?? null;
}

/** Guard de los endpoints que MUTAN pero no necesitan la fila (o la leen por otro
 * lado): false cuando el item no existe o no es del viewer mismo — el llamador
 * responde 404, nunca 403. Un líder de zona da false sobre lo de su equipo. */
export async function ownsItem(env: Env, slug: BoardSlug, itemId: number, viewer: Identity): Promise<boolean> {
  return (await getItem(env, slug, itemId, viewer, 'own')) !== null;
}

/** Sin scope de viewer — SOLO para un llamador que ya autorizó al viewer por
 * otra vía (ej. worker/lib/proyectoCotizacionVirtual.ts: el dueño del
 * Proyecto, no de la Oportunidad ligada) y necesita la fila cruda para armar
 * un write compuesto. Nunca la llames directo desde un handler sin haber
 * autorizado antes — no hay chequeo de propiedad aquí. */
export async function getItemTrusted(env: Env, slug: BoardSlug, itemId: number): Promise<MirrorItem | null> {
  const board = BOARDS[slug];
  await ensureItemOcultoTable(env);
  const row = await env.DB.prepare(`SELECT * FROM items WHERE board_id = ? AND item_id = ? AND ${NOT_OCULTO}`)
    .bind(board.id, itemId).first<MirrorItem>();
  return row ?? null;
}

// Orden: manual (Fase 2, futura) > el que Monday muestra > alfabético como
// último respaldo para líneas que aún no tuvieron una relectura de árbol
// completo (worker/sync/refetch.ts refetchItemTree — ver worker/lib/itemOrder.ts).
export async function childrenOf(env: Env, parentSlug: BoardSlug, itemId: number, viewer: Identity): Promise<MirrorItem[]> {
  const childSlug = childSlugOf(parentSlug);
  if (!childSlug) return [];
  const childBoard = BOARDS[childSlug];
  const scope = scopeFor(childSlug, viewer);
  await ensureItemOrderTable(env);
  await ensureItemOcultoTable(env);
  const sql = `SELECT items.* FROM items
    LEFT JOIN item_order io ON io.board_id = items.board_id AND io.item_id = items.item_id
    WHERE items.board_id = ? AND items.parent_item_id = ? AND (${scope.where}) AND ${NOT_OCULTO}
    ORDER BY COALESCE(io.manual_order, io.monday_order, 999999), items.name`;
  const res = await env.DB.prepare(sql).bind(childBoard.id, itemId, ...scope.binds).all<MirrorItem>();
  return res.results ?? [];
}

// El Proyecto ligado a una Oportunidad (Proyectos board_relation_mm0hf0y3 →
// Oportunidad). Filtra por LIKE sobre el JSON de columnas y verifica en JS que
// linked_item_ids realmente contenga el id (el LIKE solo es el índice barato).
// El scoping del viewer aplica igual que en getItem: si el vendedor no está en
// los authzCols del Proyecto, para él no existe (null, nunca 403).
export const PROYECTO_OPP_REL = 'board_relation_mm0hf0y3';

/** Primer id ligado de una columna board_relation en un row ya cargado del
 * mirror ({linked_item_ids:[...]} — ver worker/lib/monday.ts normalizeCols).
 * null si la columna viene vacía o el mirror aún no la capturó (stale). */
export function linkedItemId(row: MirrorItem, colId: string): number | null {
  try {
    const cols: { id: string; value?: string | null }[] = JSON.parse(row.columns || '[]');
    const rel = cols.find(c => c.id === colId);
    if (!rel?.value) return null;
    const ids: unknown[] = (JSON.parse(rel.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
    const first = ids.map(Number).find(Number.isFinite);
    return first ?? null;
  } catch {
    return null;
  }
}

export async function proyectoForOportunidad(env: Env, oppItemId: number, viewer: Identity): Promise<MirrorItem | null> {
  const scope = scopeFor('proyectos', viewer);
  const sql = `SELECT * FROM items WHERE board_id = ? AND columns LIKE ? AND (${scope.where}) LIMIT 20`;
  const res = await env.DB
    .prepare(sql)
    .bind(BOARDS.proyectos.id, `%${oppItemId}%`, ...scope.binds)
    .all<MirrorItem>();

  for (const row of res.results ?? []) {
    try {
      const cols: { id: string; value?: string | null }[] = JSON.parse(row.columns || '[]');
      const rel = cols.find(c => c.id === PROYECTO_OPP_REL);
      if (!rel?.value) continue;
      const ids: unknown[] = (JSON.parse(rel.value) as { linked_item_ids?: unknown[] }).linked_item_ids ?? [];
      if (ids.some(id => Number(id) === oppItemId)) return row;
    } catch { /* fila con columns corruptas — se ignora */ }
  }
  return null;
}

// Must fold in the viewer's scope: scopeFor() returns a different row set per
// viewer, so an ETag keyed only on the board (count + max synced_at) collides
// across viewers whenever the board itself hasn't changed — a 304 then makes
// the requester (or their browser's own HTTP cache) reuse another viewer's
// response body. Concretely: any two vendedores with different visible rows
// would get the same board-only ETag and could 304 off each other's cached
// list. 'admin' always shares one scope key (unrestricted everywhere); 'compras'
// shares it too, but only on boards without comprasCol — on Oportunidades/
// Proyectos it's scoped same as vendedor, so it needs the per-viewer key too.
/** Hash corto y estable (FNV-1a) para meter la forma de la respuesta en el
 * ETag sin alargarlo con la lista completa de columnas. No es criptográfico:
 * solo tiene que distinguir proyecciones distintas, y una colisión aquí sería
 * entre dos listas de columnas que el mismo cliente ni siquiera mezcla. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** `variant` distingue respuestas con distinta FORMA para el mismo board+viewer
 * (hoy: la proyección ?cols=). Sin él, dos clientes que piden columnas
 * distintas comparten llave y el 304 le entrega a uno la forma del otro. */
export async function etagFor(env: Env, slug: BoardSlug, viewer: Identity, variant?: string): Promise<string> {
  const board = BOARDS[slug];
  const owningBoard = board.parent ? BOARDS[board.parent] : board;
  const row = await env.DB
    .prepare('SELECT COUNT(*) as c, MAX(synced_at) as m FROM items WHERE board_id = ?')
    .bind(board.id)
    .first<{ c: number; m: string | null }>();
  // La llave lleva el CONJUNTO de ids visibles, no solo el propio: si lleva nada
  // más el del viewer, mover a alguien de zona no invalida el ETag y el líder se
  // queda con la lista vieja (304) hasta que el board cambie por otra razón.
  // Mismo motivo aplica a un admin fuera de la whitelist de la zona privada
  // 'Efrain' (worker/lib/zonas.ts): su scope YA no es "todo", así que no puede
  // compartir la llave 'all' con un admin sin restricción — colisionarían y uno
  // de los dos vería (por 304) la respuesta cacheada del otro.
  const hiddenOwners = viewer.role === 'admin' ? (viewer.hidden_owner_ids ?? []) : [];
  const zonaPrivadaRestringe = hiddenOwners.length > 0 && ZONA_PRIVADA_BOARDS.has(slug);
  const unrestricted = !zonaPrivadaRestringe && (viewer.role === 'admin' || (viewer.role === 'compras' && !owningBoard.comprasCol));
  const scopeKey = unrestricted
    ? 'all'
    : zonaPrivadaRestringe
      ? `h${hiddenOwners.sort((a, b) => a - b).join('.')}`
      : `u${ownerIdsFor(viewer, 'read').sort((a, b) => a - b).join('.')}`;
  // `variant !== undefined`, no `variant ?`: la cadena vacía es una proyección
  // legítima ("ninguna columna", los selectores de catálogo) y tiene que tener
  // llave propia — si cayera en el mismo ETag que la respuesta completa, un
  // 304 le entregaría al selector la forma con TODAS las columnas.
  const shape = variant !== undefined ? `:${fnv1a(variant)}` : '';
  return `"${slug}:${scopeKey}:${row?.c ?? 0}:${row?.m ?? ''}${shape}"`;
}

// role: 'vendedor' (default) o 'compras' — alimenta los selects de personas del
// form de nueva oportunidad. Cualquier otro valor cae a 'vendedor'. Los admins
// siempre se incluyen en ambas listas (pueden ser dueños de una oportunidad o
// responsables de compras aunque su fila de identity sea role='admin' — pedido
// de Efraín, 2026-07-20).
export async function listVendedores(env: Env, role: string = 'vendedor'): Promise<{ monday_user_id: number; nombre: string; email: string }[]> {
  const safeRole = role === 'compras' ? 'compras' : 'vendedor';
  // GROUP BY monday_user_id, nombre: una misma persona puede tener más de una
  // fila de identity con el MISMO nombre (ej. login de trabajo + gmail personal)
  // — esas sí se colapsan, evitando duplicados en los selects (stress test
  // 2026-07-21). Pero "Actuar en Monday como" (createNativeIdentity con
  // mondayUserId explícito) también puede dejar a dos personas DISTINTAS
  // compartiendo un monday_user_id a propósito (un vendedor sin asiento propio
  // que escribe bajo la cuenta de otro) — agrupar solo por id las fusionaba en
  // una sola fila y el nombre que sobrevivía era arbitrario, así que la persona
  // sin asiento propio nunca aparecía seleccionable (Efraín, 2026-08-12, caso
  // Rodrigo). Agrupar también por nombre las mantiene separadas.
  // monday_user_id > 0: saca a los usuarios dados de alta desde el portal (sin
  // asiento real en Monday, ver createNativeIdentity) — asignarlos aquí
  // terminaría escribiendo un id inventado en la columna de personas de Monday.
  const res = await env.DB
    .prepare(`SELECT monday_user_id, nombre, MIN(email) AS email FROM identity WHERE (role = ? OR role = 'admin') AND active = 1 AND monday_user_id > 0 GROUP BY monday_user_id, nombre ORDER BY nombre`)
    .bind(safeRole)
    .all<{ monday_user_id: number; nombre: string; email: string }>();
  return res.results ?? [];
}

// Admin-only (route guards): full identity roster, active or not.
export async function listIdentities(env: Env): Promise<Identity[]> {
  const res = await env.DB.prepare('SELECT * FROM identity ORDER BY nombre, email').all<Identity>();
  return res.results ?? [];
}

// Admin-only (route guards): una fila puntual, para mergear un PUT parcial
// (ej. solo `phone`) sobre lo que ya había en vez de exigir el registro completo.
export async function getIdentityByEmail(env: Env, email: string): Promise<Identity | null> {
  return env.DB.prepare('SELECT * FROM identity WHERE email = ?').bind(email).first<Identity>();
}

export async function upsertIdentity(
  env: Env,
  row: { email: string; phone: string | null; nombre: string | null; monday_user_id: number; role: string; active: number },
): Promise<void> {
  await env.DB
    .prepare(`INSERT INTO identity (email, phone, nombre, monday_user_id, role, active) VALUES (?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET phone=excluded.phone, nombre=excluded.nombre,
        monday_user_id=excluded.monday_user_id, role=excluded.role, active=excluded.active`)
    .bind(row.email, row.phone, row.nombre, row.monday_user_id, row.role, row.active)
    .run();
}

// Usuario dado de alta a mano en Configuración, sin pasar por el directorio de
// Monday (pedido de Efraín, 2026-08-06: soltar la dependencia de Monday para
// alta de usuarios). Como monday_user_id es NOT NULL y se usa en todo el
// codebase para leer/escribir contra Monday, por default se le asigna un id
// sintético NEGATIVO (los ids reales de Monday siempre son positivos) —
// listVendedores y la mención de compras en proyectoTallas.ts ya filtran
// monday_user_id > 0 para no tratar a estos usuarios como personas reales de
// Monday. Si el admin manda `mondayUserId` (mismo día, "Actuar en Monday
// como": un vendedor real sin cuenta propia en Monday necesita poder crear
// oportunidades YA), se usa ese id real en vez del sintético — el admin.ts
// route ya validó que pertenece a alguien del roster.
export async function createNativeIdentity(
  env: Env,
  row: { email: string; nombre: string; phone: string | null; role: string; active: number; mondayUserId?: number },
): Promise<Identity> {
  let syntheticId = row.mondayUserId;
  if (!syntheticId) {
    const min = await env.DB.prepare('SELECT MIN(monday_user_id) AS m FROM identity').first<{ m: number | null }>();
    syntheticId = Math.min(0, min?.m ?? 0) - 1;
  }
  await upsertIdentity(env, { ...row, monday_user_id: syntheticId });
  return { email: row.email, nombre: row.nombre, phone: row.phone ?? undefined, monday_user_id: syntheticId, role: row.role as Identity['role'], active: !!row.active };
}

// Para validar un `mondayUserId` de proxy ("Actuar en Monday como") contra el
// roster real antes de aceptarlo — evita que el admin escriba cualquier id
// arbitrario a mano.
export async function mondayUserIdExists(env: Env, id: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM identity WHERE monday_user_id = ?').bind(id).first<{ ok: number }>();
  return !!row;
}

export async function pendingItemIds(env: Env, boardId: number): Promise<Set<number>> {
  const res = await env.DB
    .prepare(`SELECT DISTINCT item_id FROM outbox WHERE board_id = ? AND status IN ('pending','sent')`)
    .bind(boardId)
    .all<{ item_id: number }>();
  return new Set((res.results ?? []).map(r => r.item_id));
}

/** ¿Hay algún write local todavía en vuelo (outbox 'pending'/'sent') para este
 * item, o para alguna de sus líneas (childBoardId)? submitWrite ya aplicó el
 * cambio al mirror D1 de forma sincrónica antes de encolarlo — si un pull
 * "fresh" a Monday corre mientras el outbox sigue reintentando, puede leer el
 * valor VIEJO de Monday y pisar la edición reciente en el mirror (reporte de
 * Efraín, 2026-07-30: "guardo un cambio y se regresa"). Este check deja que
 * pullFromMonday se salte el pull hasta que el outbox confirme por su cuenta. */
export async function hasPendingWrites(
  env: Env, boardId: number, itemId: number, childBoardId?: number,
): Promise<boolean> {
  const own = await env.DB
    .prepare(`SELECT 1 FROM outbox WHERE board_id = ? AND item_id = ? AND status IN ('pending','sent') LIMIT 1`)
    .bind(boardId, itemId)
    .first();
  if (own) return true;
  if (!childBoardId) return false;
  const child = await env.DB
    .prepare(
      `SELECT 1 FROM outbox WHERE board_id = ? AND status IN ('pending','sent')
       AND item_id IN (SELECT item_id FROM items WHERE board_id = ? AND parent_item_id = ?) LIMIT 1`,
    )
    .bind(childBoardId, childBoardId, itemId)
    .first();
  return !!child;
}
