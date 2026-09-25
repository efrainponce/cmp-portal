// worker/lib/productosPropuestos.ts — "Proponer nuevo producto" (tab Nuevos
// productos del drawer de Oportunidad). Nativo en D1, sin board de Monday detrás
// (mismo patrón que documents.ts/inventory.ts): nombre+descripción+imagen no
// encajan en ninguna columna existente y CLAUDE.md prohíbe inventar ids de
// columna. Tabla lazy (mismo patrón que ensureDocumentTables).
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import { registrarArchivo } from './archivoLog';
import type { Identity } from '../../shared/types';
import type { ProposedProductDTO } from '../../shared/productosPropuestos';
import { isNativeId } from '../../shared/nativeId';
import { postUpdate } from './nativeUpdates';
import { getItem } from './dal';
import { putFile, oportunidadFileKey } from './r2';
import { type MentionInput } from './monday';
import { emitNotification } from './notify';
import { logSync } from '../sync/log';
import { BOARDS } from '../../shared/boards';
import type { RawCol } from './serialize';

// Columna "Compras" de oportunidades (people, docs/monday-column-map.md) — el/los
// comprador(es) asignado(s) a ESTA oportunidad, no todo el rol 'compras'
// (Efraín, 2026-07-30: "cuando se crea el producto, se manda una actualización
// que taggea al comprador").
const COMPRAS_COL = 'multiple_person_mm03qyw9';

export class ProposedProductError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

let tableReady = false;

export async function ensureProposedProductsTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS producto_propuesto (
      id             TEXT PRIMARY KEY,
      oportunidad_id INTEGER NOT NULL,
      nombre         TEXT NOT NULL,
      descripcion    TEXT NOT NULL DEFAULT '',
      image_key      TEXT,
      created_by     TEXT NOT NULL,
      created_at     TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_producto_propuesto_opp ON producto_propuesto(oportunidad_id)'),
  ]);
  // Editar/eliminar (2026-09-25, pedido de un vendedor): borrar es LÓGICO
  // (`deleted_at`) y la imagen vieja se queda en R2 — es D1 nativo, sin Monday,
  // así que un error se arregla con un UPDATE. Tablas previas se migran con el
  // ALTER; si la columna ya existe D1 tira error y se ignora.
  for (const col of ['deleted_at TEXT', 'deleted_by TEXT', 'updated_at TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE producto_propuesto ADD COLUMN ${col}`).run();
    } catch { /* ya existe */ }
  }
  tableReady = true;
}

interface Row {
  id: string;
  nombre: string;
  descripcion: string;
  image_key: string | null;
  created_by: string;
  created_at: string;
}

function toDTO(row: Row): ProposedProductDTO {
  return {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    imageUrl: row.image_key ? `/api/files/${row.image_key}` : undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listProposedProducts(env: Env, itemId: number, viewer: Identity): Promise<ProposedProductDTO[]> {
  const opp = await getItem(env, 'oportunidades', itemId, viewer);
  if (!opp) throw new ProposedProductError(404, 'not found');

  await ensureProposedProductsTable(env);
  const { results } = await env.DB.prepare(
    'SELECT id, nombre, descripcion, image_key, created_by, created_at FROM producto_propuesto WHERE oportunidad_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
  ).bind(itemId).all<Row>();
  return (results ?? []).map(toDTO);
}

/** monday_user_ids asignados en la columna "Compras" de esta oportunidad. */
function compradorIds(columnsJson: string): number[] {
  try {
    const cols: RawCol[] = JSON.parse(columnsJson || '[]');
    const col = cols.find((c) => c.id === COMPRAS_COL);
    if (!col?.value) return [];
    const parsed = JSON.parse(col.value) as { personsAndTeams?: Array<{ id: number | string; kind?: string }> };
    return (parsed.personsAndTeams ?? [])
      .filter((p) => (p.kind ?? 'person') === 'person')
      .map((p) => Number(p.id))
      .filter((n) => !Number.isNaN(n));
  } catch {
    return [];
  }
}

async function identitiesByMondayUserIds(env: Env, ids: number[]): Promise<{ id: number; nombre: string | null; email: string }[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT monday_user_id, nombre, email FROM identity WHERE active = 1 AND monday_user_id IN (${placeholders})`,
  ).bind(...ids).all<{ monday_user_id: number; nombre: string | null; email: string }>();
  return (results ?? []).map((r) => ({ id: r.monday_user_id, nombre: r.nombre, email: r.email }));
}

/** Best-effort: avisa al comprador asignado (columna "Compras" de la oportunidad)
 * de la propuesta — update en el feed de Monday @mencionándolo, más una
 * notificación del portal (bandeja "Importantes", igual que una mención) para
 * que sepa que Ventas está esperando seguimiento (Efraín, 2026-07-30). Sin
 * comprador asignado, no hay a quién avisar. Nunca debe tirar el guardado si
 * Monday o la notificación fallan. */
async function notifyComprador(env: Env, itemId: number, oppColumnsJson: string, oppName: string, actor: Identity, producto: ProposedProductDTO): Promise<void> {
  try {
    const ids = compradorIds(oppColumnsJson);
    if (ids.length === 0) return;
    const compradores = await identitiesByMondayUserIds(env, ids);
    if (compradores.length === 0) return;
    const actorName = actor.nombre || actor.email;

    const mentions: MentionInput[] = compradores
      .filter((c) => c.nombre)
      .map((c) => ({ id: c.id, nombre: c.nombre as string }));
    const body = `${actorName} propuso un nuevo producto: "${producto.nombre}"`
      + (producto.descripcion ? ` — ${producto.descripcion}` : '');
    // Ver el comentario gemelo en proyectoTallas.reportarTallasIncorrectas.
    if (mentions.length > 0 || isNativeId(itemId)) {
      await postUpdate(env, BOARDS.oportunidades.id, itemId, body, mentions);
    }

    for (const c of compradores) {
      if (c.email === actor.email) continue;
      await emitNotification(env, {
        recipientEmail: c.email,
        severity: 'importante',
        kind: 'producto_propuesto',
        title: `${actorName} propuso un producto nuevo en ${oppName}`,
        body: producto.nombre,
        boardKey: 'oportunidades',
        boardId: BOARDS.oportunidades.id,
        itemId,
        actor: actorName,
        dedupeKey: `producto_propuesto:${producto.id}:${c.email}`,
      });
    }
  } catch (err) {
    await logSync(env, 'manual', BOARDS.oportunidades.id, itemId, false, 'productosPropuestos: notifyComprador ' + err);
  }
}

export async function addProposedProduct(
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity, nombre: string, descripcion: string, file?: File,
): Promise<ProposedProductDTO> {
  const cleanNombre = nombre.trim();
  if (!cleanNombre) throw new ProposedProductError(400, 'nombre requerido');
  if (file && file.size > MAX_IMAGE_BYTES) throw new ProposedProductError(400, 'la imagen supera 8MB');

  // scope 'own': solo sobre las propias oportunidades (un líder de zona lee la
  // de su equipo pero no escribe, worker/lib/zonas.ts).
  const opp = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!opp) throw new ProposedProductError(404, 'not found');

  await ensureProposedProductsTable(env);
  const id = crypto.randomUUID();
  const imageKey = file ? await subirImagen(env, itemId, id, viewer, file) : null;
  const cleanDescripcion = descripcion.trim();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO producto_propuesto (id, oportunidad_id, nombre, descripcion, image_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, itemId, cleanNombre, cleanDescripcion, imageKey, viewer.email, createdAt).run();

  const dto = toDTO({ id, nombre: cleanNombre, descripcion: cleanDescripcion, image_key: imageKey, created_by: viewer.email, created_at: createdAt });
  // En `waitUntil`: el aviso es un update a Monday (una ida de 1-3 s) más el
  // WhatsApp de cada comprador, y el guardado no depende de nada de eso —
  // notifyComprador ya es best-effort (se traga y loguea a sync_log).
  ctx.waitUntil(notifyComprador(env, itemId, opp.columns, opp.name, viewer, dto));
  return dto;
}

async function subirImagen(env: Env, itemId: number, productoId: string, viewer: Identity, file: File): Promise<string> {
  // Prefijo con timestamp: al CAMBIAR la imagen el key es nuevo (la anterior se
  // queda en R2 de respaldo y el navegador no sirve la vieja de su caché).
  const imageKey = oportunidadFileKey(itemId, 'productos-propuestos', `${productoId}-${Date.now()}-${file.name}`);
  await putFile(env, imageKey, file);
  await registrarArchivo(env, {
    acto: 'sube', categoria: 'producto-propuesto', nombre: file.name,
    boardId: BOARDS.oportunidades.id, itemId, r2Key: imageKey,
    bytes: file.size, porEmail: viewer.email,
  });
  return imageKey;
}

/** La propuesta viva de ESTA oportunidad, con el mismo scope que proponer
 * ('own': propias + zona que lidera/auxilia). 404 si no existe o ya se borró. */
async function propuestaEditable(env: Env, itemId: number, productoId: string, viewer: Identity): Promise<Row> {
  const opp = await getItem(env, 'oportunidades', itemId, viewer, 'own');
  if (!opp) throw new ProposedProductError(404, 'not found');
  await ensureProposedProductsTable(env);
  const row = await env.DB.prepare(
    'SELECT id, nombre, descripcion, image_key, created_by, created_at FROM producto_propuesto WHERE id = ? AND oportunidad_id = ? AND deleted_at IS NULL',
  ).bind(productoId, itemId).first<Row>();
  if (!row) throw new ProposedProductError(404, 'producto no encontrado');
  return row;
}

export interface ProposedProductPatch {
  nombre: string;
  descripcion: string;
  /** Imagen nueva (reemplaza la anterior). */
  file?: File;
  /** Quitar la imagen sin poner otra. Se ignora si viene `file`. */
  quitarImagen?: boolean;
}

export async function updateProposedProduct(
  env: Env, itemId: number, productoId: string, viewer: Identity, patch: ProposedProductPatch,
): Promise<ProposedProductDTO> {
  const cleanNombre = patch.nombre.trim();
  if (!cleanNombre) throw new ProposedProductError(400, 'nombre requerido');
  if (patch.file && patch.file.size > MAX_IMAGE_BYTES) throw new ProposedProductError(400, 'la imagen supera 8MB');

  const row = await propuestaEditable(env, itemId, productoId, viewer);
  let imageKey = row.image_key;
  if (patch.file) imageKey = await subirImagen(env, itemId, productoId, viewer, patch.file);
  else if (patch.quitarImagen) imageKey = null;
  if (row.image_key && imageKey !== row.image_key) {
    await registrarArchivo(env, {
      acto: 'borra', categoria: 'producto-propuesto', nombre: row.image_key.split('/').pop() ?? row.image_key,
      boardId: BOARDS.oportunidades.id, itemId, r2Key: row.image_key, porEmail: viewer.email,
    });
  }

  const cleanDescripcion = patch.descripcion.trim();
  await env.DB.prepare(
    'UPDATE producto_propuesto SET nombre = ?, descripcion = ?, image_key = ?, updated_at = ? WHERE id = ?',
  ).bind(cleanNombre, cleanDescripcion, imageKey, new Date().toISOString(), productoId).run();
  return toDTO({ ...row, nombre: cleanNombre, descripcion: cleanDescripcion, image_key: imageKey });
}

export async function deleteProposedProduct(env: Env, itemId: number, productoId: string, viewer: Identity): Promise<void> {
  await propuestaEditable(env, itemId, productoId, viewer);
  await env.DB.prepare(
    'UPDATE producto_propuesto SET deleted_at = ?, deleted_by = ? WHERE id = ?',
  ).bind(new Date().toISOString(), viewer.email, productoId).run();
}
