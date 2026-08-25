// worker/lib/nativeUpdates.ts — el feed de Actualizaciones (comentarios) de un
// item NATIVO (Zona Efrain, "salir de Monday"). Un item con id sintético no
// existe del lado de Monday: `create_update` contra él truena y `updates`
// regresa vacío, así que TODO comentario —el que escribe una persona en el
// composer y el que postea solo el sistema (cotización, OC, costeo, tallas)—
// se perdía en silencio.
//
// La tabla vive en D1 (lazy-create, mismo patrón que documents/zonas/anuncios)
// y las funciones devuelven el MISMO shape que worker/lib/monday.ts
// (`MondayUpdate`), para que quien las llama no tenga que saber de qué lado
// está el item: `postUpdate`/`listUpdates` deciden por el id.
//
// Ids numéricos a propósito (no UUID): las rutas validan `/^\d+$/`, el "visto"
// de update_seen los guarda como texto libre y `seguimientos.monday_update_id`
// es INTEGER — con un UUID habría que tocar las cuatro cosas. Mismo piso que
// los items nativos (shared/nativeId.ts): 12 dígitos, sin patrón.
import type { Env } from '../env';
import { registrarArchivo } from './archivoLog';
import { createUpdate, fetchUpdates, type MentionInput, type MondayUpdate, type MondayUpdateAsset } from './monday';
import { isNativeId, NATIVE_ID_FLOOR } from '../../shared/nativeId';
import { putFile } from './r2';

interface NativeAttachment { id: string; name: string; ext: string; key: string }

interface NativeUpdateRow {
  id: string;
  item_id: number;
  author_name: string;
  body: string;
  created_at: string;
  attachments: string;
}

let tableReady = false;

async function ensureNativeUpdateTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS native_updates (
      id           TEXT PRIMARY KEY,
      board_id     INTEGER NOT NULL,
      item_id      INTEGER NOT NULL,
      author_email TEXT,
      author_name  TEXT NOT NULL,
      body         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      attachments  TEXT NOT NULL DEFAULT '[]'
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_native_updates_item ON native_updates(item_id, created_at DESC)'),
  ]);
  tableReady = true;
}

/** Id único de update nativo. Mismo criterio que worker/lib/nativeSeq.ts pero
 * contra su propia tabla: los updates son otro espacio de ids (Monday numera
 * updates aparte de items), así que chocar con un item_id nativo no importaría
 * — se checa contra native_updates, que es donde sí importa. */
async function reserveUpdateId(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = String(NATIVE_ID_FLOOR + crypto.getRandomValues(new Uint32Array(1))[0]);
    const taken = await env.DB.prepare(`SELECT 1 FROM native_updates WHERE id = ? LIMIT 1`).bind(candidate).first();
    if (!taken) return candidate;
  }
  throw new Error('no se pudo reservar un id de update nativo único tras varios intentos');
}

function parseAttachments(raw: string): NativeAttachment[] {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list as NativeAttachment[] : [];
  } catch {
    return [];
  }
}

function toMondayShape(row: NativeUpdateRow): MondayUpdate {
  const assets: MondayUpdateAsset[] = parseAttachments(row.attachments)
    .map(a => ({ id: a.id, name: a.name, file_extension: a.ext }));
  return {
    id: row.id,
    text_body: row.body,
    created_at: row.created_at,
    creator: { name: row.author_name },
    assets,
    // Sin hilos: el portal aplana replies en un solo feed y aquí nunca se creó
    // uno anidado (eso solo pasa dentro de Monday.com).
    replies: [],
    viewers: [],
  };
}

/** Comentarios de un item, del lado que le toque. Nativo: D1, más nuevo
 * primero, sin el límite de 50 de Monday (una fila local no cuesta una
 * llamada de API). */
export async function listUpdates(env: Env, itemId: number): Promise<MondayUpdate[]> {
  if (!isNativeId(itemId)) return fetchUpdates(env, itemId);
  await ensureNativeUpdateTable(env);
  const res = await env.DB
    .prepare(`SELECT id, item_id, author_name, body, created_at, attachments
              FROM native_updates WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`)
    .bind(itemId)
    .all<NativeUpdateRow>();
  return (res.results ?? []).map(toMondayShape);
}

/** Postea un comentario en el item, del lado que le toque. Reemplaza a
 * `createUpdate` en todo emisor que pueda recibir un id nativo (el composer y
 * los mensajes automáticos de cotización/OC/costeo/tallas).
 *
 * `mentions` solo aplica del lado de Monday: un item nativo no tiene una
 * @mención que notifique (no existe el update allá), así que el texto se queda
 * tal cual — quien avisa de verdad en ese caso es la notificación del portal
 * (worker/lib/notify.ts), que los emisores ya mandan por su cuenta. */
export async function postUpdate(
  env: Env,
  boardId: number,
  itemId: number,
  body: string,
  mentions: MentionInput[] = [],
  author?: { email?: string; nombre?: string },
): Promise<MondayUpdate> {
  if (!isNativeId(itemId)) return createUpdate(env, itemId, body, mentions);
  await ensureNativeUpdateTable(env);
  const id = await reserveUpdateId(env);
  const createdAt = new Date().toISOString();
  // Sin autor explícito el emisor es el sistema — mismo criterio que del lado
  // de Monday, donde estos updates salen a nombre de la cuenta de integración.
  const authorName = author?.nombre || author?.email || 'Portal CMP';
  await env.DB
    .prepare(`INSERT INTO native_updates (id, board_id, item_id, author_email, author_name, body, created_at, attachments)
              VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`)
    .bind(id, boardId, itemId, author?.email ?? null, authorName, body, createdAt)
    .run();
  return toMondayShape({ id, item_id: itemId, author_name: authorName, body, created_at: createdAt, attachments: '[]' });
}

/** Adjunta un archivo a un update nativo: los bytes van a R2 y el registro
 * queda en la fila del update (no hay asset de Monday que crear). El id del
 * asset también es numérico, por el `/^\d+$/` de la ruta que los sirve. */
export async function attachToNativeUpdate(
  env: Env, updateId: string, file: File,
): Promise<{ id: string; name: string; ext: string }> {
  await ensureNativeUpdateTable(env);
  const row = await env.DB
    .prepare(`SELECT attachments FROM native_updates WHERE id = ?`)
    .bind(updateId)
    .first<{ attachments: string }>();
  if (!row) throw new Error('update no encontrado');

  const assetId = String(NATIVE_ID_FLOOR + crypto.getRandomValues(new Uint32Array(1))[0]);
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const key = `native-updates/${updateId}/${assetId}/${file.name}`;
  await putFile(env, key, file);
  await registrarArchivo(env, {
    // Sin autor: esta función no recibe al viewer — el update al que se adjunta
    // sí guarda quién lo escribió (native_updates.author_email).
    acto: 'sube', categoria: 'update', nombre: file.name,
    r2Key: key, bytes: file.size,
  });

  const list = parseAttachments(row.attachments);
  list.push({ id: assetId, name: file.name, ext, key });
  await env.DB
    .prepare(`UPDATE native_updates SET attachments = ? WHERE id = ?`)
    .bind(JSON.stringify(list), updateId)
    .run();
  return { id: assetId, name: file.name, ext };
}

/** Adjunto nativo por su assetId, acotado al item que el caller ya validó —
 * sin ese filtro, un assetId adivinado serviría el archivo de cualquier item.
 * null = no existe (o no es de ese item). */
export async function nativeUpdateAsset(
  env: Env, itemId: number, assetId: string,
): Promise<{ key: string; name: string } | null> {
  await ensureNativeUpdateTable(env);
  const res = await env.DB
    .prepare(`SELECT attachments FROM native_updates WHERE item_id = ? AND attachments LIKE ?`)
    .bind(itemId, `%"${assetId}"%`)
    .all<{ attachments: string }>();
  for (const row of res.results ?? []) {
    const match = parseAttachments(row.attachments).find(a => a.id === assetId);
    if (match) return { key: match.key, name: match.name };
  }
  return null;
}
