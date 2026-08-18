// worker/lib/productosPropuestos.ts — "Proponer nuevo producto" (tab Nuevos
// productos del drawer de Oportunidad). Nativo en D1, sin board de Monday detrás
// (mismo patrón que documents.ts/inventory.ts): nombre+descripción+imagen no
// encajan en ninguna columna existente y CLAUDE.md prohíbe inventar ids de
// columna. Tabla lazy (mismo patrón que ensureDocumentTables).
import type { Env } from '../env';
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
    'SELECT id, nombre, descripcion, image_key, created_by, created_at FROM producto_propuesto WHERE oportunidad_id = ? ORDER BY created_at ASC',
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
  env: Env, itemId: number, viewer: Identity, nombre: string, descripcion: string, file?: File,
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
  let imageKey: string | null = null;
  if (file) {
    imageKey = oportunidadFileKey(itemId, 'productos-propuestos', `${id}-${file.name}`);
    await putFile(env, imageKey, file);
  }
  const cleanDescripcion = descripcion.trim();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO producto_propuesto (id, oportunidad_id, nombre, descripcion, image_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, itemId, cleanNombre, cleanDescripcion, imageKey, viewer.email, createdAt).run();

  const dto = toDTO({ id, nombre: cleanNombre, descripcion: cleanDescripcion, image_key: imageKey, created_by: viewer.email, created_at: createdAt });
  await notifyComprador(env, itemId, opp.columns, opp.name, viewer, dto);
  return dto;
}
