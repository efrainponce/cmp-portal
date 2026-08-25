// Quitar UN archivo de una columna file — en el portal y en Monday, 1-1.
//
// Efraín, 2026-08-19: "vendedor puede borrar documentos que el SUBIO" (Ricardo
// subió dos veces la misma OC en OPP-0506 y no tenía cómo quitar la copia).
//
// Por qué borra de verdad y no oculta: la regla de esa misma tarde
// (worker/lib/itemBorrado.ts) — lo que el portal esconde reaparece en Monday
// como error, porque costeo/cotización/tallas/OC leen Monday directo.
//
// Cómo, sin la palabra `delete`: `update_assets_on_item` reescribe la lista de
// archivos de la columna a partir de assets que YA existen. Se manda la lista
// sin el archivo a quitar y los demás quedan intactos. Verificado en vivo
// (2026-08-19, OPP-0506): el asset detached desaparece de Monday —
// `assets(ids:)` ya no lo devuelve— o sea que ESTO SÍ DESTRUYE. Por eso lleva
// las mismas guardas que itemBorrado.ts:
//
//   1. RESPALDO ANTES: los bytes se copian a R2 bajo un key propio
//      (`…/documento-borrado/<assetId>-<nombre>`, que nada más sobrescribe) y el
//      renglón queda en `archivo_borrado`. Un archivo quitado por error se
//      vuelve a subir desde ahí.
//   2. De a UN archivo, siempre por assetId, nunca a partir de una lista.
//   3. Tope por persona (TOPE_POR_HORA): un humano limpiando duplicados no lo
//      alcanza; un bucle sí, y se corta ahí.
//   4. La lista de sobrevivientes se arma leyendo la columna EN VIVO de Monday,
//      no del mirror: con el espejo atrasado, un archivo subido hace un minuto
//      no estaría en la lista y esta mutación lo borraría sin que nadie lo pida.
//
// Items NATIVOS (Zona Efrain, ids >= 900000000000): no existen en Monday, así
// que solo se reescribe el marcador de D1 (worker/lib/nativeItems.ts).
import type { Env } from '../env';
import { registrarArchivo, autorDeArchivo } from './archivoLog';
import type { Identity, Role } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';
import { BOARDS } from '../../shared/boards';
import { gql } from './monday';
import { isNativeId } from '../../shared/nativeId';
import { fetchAssetBytes } from './portalFiles';
import { putFile } from './r2';
import type { RawCol } from './serialize';

export class ArchivoBorradoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Un archivo dentro de una columna file. `assetId` 0 = archivo de item nativo
 * (solo vive en R2, no tiene asset de Monday) — ahí manda el nombre. */
export interface ArchivoRef {
  assetId: number;
  nombre: string;
}

/** Dimensionado sobre el uso real: limpiar los duplicados de un proyecto son
 * uno o dos archivos. Un bucle se come esto en segundos y ahí se detiene. */
const TOPE_POR_HORA = 30;

let tablesReady = false;

export async function ensureArchivoTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.batch([
    // Respaldo de lo borrado: `r2_key` apunta a la copia de los bytes.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS archivo_borrado (
      board_id   INTEGER NOT NULL,
      item_id    INTEGER NOT NULL,
      col_id     TEXT    NOT NULL,
      asset_id   INTEGER NOT NULL,
      nombre     TEXT    NOT NULL,
      r2_key     TEXT,
      deleted_at TEXT    NOT NULL,
      by_email   TEXT,
      PRIMARY KEY (board_id, item_id, col_id, asset_id, nombre)
    )`),
    // Quién subió cada archivo DESDE EL PORTAL. Monday no lo sabe decir: todo
    // sube con el token de servicio, así que `assets.uploaded_by` es siempre la
    // misma persona (verificado en vivo). Sin este registro no se puede cumplir
    // "solo el que lo subió lo puede borrar".
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS archivo_subido (
      board_id INTEGER NOT NULL,
      item_id  INTEGER NOT NULL,
      col_id   TEXT    NOT NULL,
      asset_id INTEGER NOT NULL,
      nombre   TEXT    NOT NULL,
      by_email TEXT,
      at       TEXT    NOT NULL,
      PRIMARY KEY (board_id, item_id, col_id, asset_id, nombre)
    )`),
    env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_archivo_borrado_email_fecha ON archivo_borrado (by_email, deleted_at)',
    ),
  ]);
  tablesReady = true;
}

/** Deja constancia de quién subió el archivo (en el momento del POST, con el
 * assetId que acaba de devolver Monday). Best-effort: si esto falla, la subida
 * ya ocurrió y no se debe tumbar — el costo es que el archivo queda "sin dueño"
 * (ver `puedeBorrarArchivo`). */
export async function registrarSubida(
  env: Env, boardId: number, itemId: number, colId: string, ref: ArchivoRef,
  byEmail?: string, categoria = 'documento',
): Promise<void> {
  // Desde 2026-08-25 escribe en la bitácora general (worker/lib/archivoLog.ts)
  // en vez de en `archivo_subido`, que queda como legado de solo lectura: esa
  // tabla junta 3 filas de toda la historia porque solo 2 de ~30 rutas que
  // escriben archivos la llamaban.
  await registrarArchivo(env, {
    acto: 'sube', categoria, nombre: ref.nombre,
    boardId, itemId, colId, assetId: ref.assetId || null, porEmail: byEmail ?? null,
  });
}

/** Correo de quien subió el archivo, o null si no hay registro (archivo previo
 * a esta tabla, o subido directo en Monday.com sin pasar por el portal). */
export async function subidoPor(
  env: Env, boardId: number, itemId: number, colId: string, ref: ArchivoRef,
): Promise<string | null> {
  // Primero la bitácora nueva; si no sabe, las 3 filas de `archivo_subido` que
  // quedaron de antes (no se migraron: son 3, y perderlas cambiaría quién puede
  // borrar ESOS archivos).
  const enBitacora = await autorDeArchivo(env, boardId, itemId, colId, ref);
  if (enBitacora) return enBitacora;

  await ensureArchivoTables(env);
  const row = await env.DB.prepare(
    `SELECT by_email FROM archivo_subido
      WHERE board_id = ? AND item_id = ? AND col_id = ?
        AND (asset_id = ? OR (? = 0 AND nombre = ?))
      ORDER BY at DESC LIMIT 1`,
  ).bind(boardId, itemId, colId, ref.assetId, ref.assetId, ref.nombre).first<{ by_email: string | null }>();
  return row?.by_email ?? null;
}

/** Quién puede borrar un archivo. Pura a propósito: es la decisión que pidió
 * Efraín y tiene su test.
 *
 *  · admin: siempre (es quien limpia lo que nadie más puede).
 *  · con registro de subida: SOLO quien lo subió.
 *  · sin registro (archivos de antes de 2026-08-19, o subidos dentro de
 *    Monday.com): lo puede borrar quien escriba en ESE item, que ya es su dueño
 *    — el llamador lo garantiza con canWrite + getItem(..., 'own'). Se eligió
 *    permitir en vez de bloquear porque el caso que originó esto (la OC
 *    duplicada de OPP-0506) es justo un archivo sin registro. */
export function puedeBorrarArchivo(viewer: { role: Role; email: string }, uploaderEmail: string | null): boolean {
  if (viewer.role === 'admin') return true;
  if (!uploaderEmail) return true;
  return uploaderEmail.trim().toLowerCase() === viewer.email.trim().toLowerCase();
}

async function borradosRecientes(env: Env, byEmail?: string): Promise<number> {
  if (!byEmail) return 0;
  const desde = new Date(Date.now() - 3600_000).toISOString();
  const row = await env.DB
    .prepare('SELECT count(*) AS n FROM archivo_borrado WHERE by_email = ? AND deleted_at > ?')
    .bind(byEmail, desde)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Archivos de una columna file, leídos EN VIVO de Monday (no del mirror): es
 * la lista que se va a reescribir, y escribirla con datos viejos borra lo que
 * no aparezca. */
export async function archivosEnColumna(env: Env, itemId: number, colId: string): Promise<ArchivoRef[]> {
  const data = await gql(env,
    `query($id:[ID!],$col:[String!]){ items(ids:$id){ column_values(ids:$col){ value } } }`,
    { id: [String(itemId)], col: [colId] });
  const raw = data?.items?.[0]?.column_values?.[0]?.value as string | null | undefined;
  return parseArchivos(raw ?? null);
}

/** `{files:[{name,assetId}]}` — el shape real de una columna file de Monday. */
export function parseArchivos(value: string | null): ArchivoRef[] {
  if (!value) return [];
  try {
    const files = (JSON.parse(value) as { files?: { name?: string; assetId?: number }[] }).files ?? [];
    return files.map(f => ({ assetId: Number(f.assetId) || 0, nombre: f.name ?? '' }));
  } catch {
    return [];
  }
}

/** Empata por assetId cuando lo hay (dos archivos se pueden llamar IGUAL — es
 * justo el caso que originó esto) y por nombre solo en items nativos. */
export function mismoArchivo(a: ArchivoRef, b: ArchivoRef): boolean {
  return a.assetId > 0 && b.assetId > 0 ? a.assetId === b.assetId : a.nombre === b.nombre;
}

/** Los que se quedan: todos menos el pedido. Devuelve null si el pedido no está
 * en la lista (ya lo borró alguien más) — el llamador no debe escribir nada. */
export function sobrevivientes(actuales: readonly ArchivoRef[], quitar: ArchivoRef): ArchivoRef[] | null {
  if (!actuales.some(f => mismoArchivo(f, quitar))) return null;
  let quitado = false;
  // Solo la PRIMERA coincidencia: con dos archivos idénticos sin assetId
  // (nativos) se quita uno, no los dos.
  return actuales.filter(f => {
    if (!quitado && mismoArchivo(f, quitar)) { quitado = true; return false; }
    return true;
  });
}

/** Key de R2 del respaldo. Lleva el assetId adelante porque el key "normal" del
 * archivo (por nombre) lo comparten los duplicados: sin esto, respaldar una
 * copia pisaría la copia buena. */
export function respaldoKey(oppId: number, categoria: string, ref: ArchivoRef): string {
  return `oportunidades/${oppId}/${categoria}-borrado/${ref.assetId || 'nativo'}-${ref.nombre}`;
}

/** Borra un archivo de la columna: respaldo → Monday → mirror. El orden importa
 * igual que en itemBorrado.ts: si Monday falla no se perdió nada. */
export async function borrarArchivoDeColumna(env: Env, opts: {
  slug: BoardSlug;
  itemId: number;
  colId: string;
  /** Oportunidad dueña del archivo — define el prefijo del key de respaldo. */
  oppId: number | null;
  categoria: string;
  ref: ArchivoRef;
  viewer: Identity;
}): Promise<{ nombre: string; respaldo: string | null }> {
  const { slug, itemId, colId, oppId, categoria, ref, viewer } = opts;
  await ensureArchivoTables(env);

  if (await borradosRecientes(env, viewer.email) >= TOPE_POR_HORA) {
    throw new ArchivoBorradoError(429,
      `Se alcanzó el tope de ${TOPE_POR_HORA} documentos borrados por hora. Si de verdad hay que quitar más, avísale a Efraín.`);
  }

  const boardId = BOARDS[slug].id;
  const nativo = isNativeId(itemId);
  const actuales = nativo ? await archivosNativos(env, boardId, itemId, colId) : await archivosEnColumna(env, itemId, colId);
  const quedan = sobrevivientes(actuales, ref);
  if (quedan === null) throw new ArchivoBorradoError(404, 'ese documento ya no está en el proyecto');
  const archivo = actuales.find(f => mismoArchivo(f, ref))!;

  // Respaldo de los bytes. Los archivos subidos por el portal ya están en R2
  // con su key normal, pero uno subido dentro de Monday.com no — y el key
  // normal lo comparten los duplicados, así que igual se copia aparte.
  let respaldo: string | null = null;
  if (oppId != null && archivo.assetId > 0) {
    try {
      const bytes = await fetchAssetBytes(env, archivo.assetId);
      if (bytes) {
        respaldo = respaldoKey(oppId, categoria, archivo);
        await putFile(env, respaldo, new Blob([bytes.bytes], { type: bytes.contentType }));
      }
    } catch { /* sin respaldo se sigue: la copia normal en R2 casi siempre existe */ }
  }

  await env.DB.prepare(
    `INSERT INTO archivo_borrado (board_id, item_id, col_id, asset_id, nombre, r2_key, deleted_at, by_email)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(board_id, item_id, col_id, asset_id, nombre)
     DO UPDATE SET r2_key = excluded.r2_key, deleted_at = excluded.deleted_at, by_email = excluded.by_email`,
  ).bind(boardId, itemId, colId, archivo.assetId, archivo.nombre, respaldo, new Date().toISOString(), viewer.email).run();

  if (nativo) {
    await escribirArchivosNativos(env, boardId, itemId, colId, quedan);
  } else {
    await gql(env,
      `mutation($b:ID!,$i:ID!,$c:String!,$f:[FileInput!]!){ update_assets_on_item(board_id:$b,item_id:$i,column_id:$c,files:$f){ id } }`,
      {
        b: String(boardId), i: String(itemId), c: colId,
        f: quedan.map(f => ({ assetId: String(f.assetId), name: f.nombre, fileType: 'asset' })),
      });
  }

  await registrarArchivo(env, {
    acto: 'borra', categoria, nombre: archivo.nombre,
    boardId, itemId, colId, assetId: archivo.assetId || null,
    r2Key: respaldo, porEmail: viewer.email,
  });

  return { nombre: archivo.nombre, respaldo };
}

/** Marcador de archivos de un item NATIVO — vive solo en `items.columns`
 * (worker/lib/nativeItems.ts lo escribe al subir). */
async function archivosNativos(env: Env, boardId: number, itemId: number, colId: string): Promise<ArchivoRef[]> {
  const row = await env.DB
    .prepare('SELECT columns FROM items WHERE board_id = ? AND item_id = ?')
    .bind(boardId, itemId).first<{ columns: string }>();
  if (!row) return [];
  const cols = safeCols(row.columns);
  return parseArchivos(cols.find(c => c.id === colId)?.value ?? null);
}

async function escribirArchivosNativos(
  env: Env, boardId: number, itemId: number, colId: string, files: readonly ArchivoRef[],
): Promise<void> {
  const row = await env.DB
    .prepare('SELECT columns FROM items WHERE board_id = ? AND item_id = ?')
    .bind(boardId, itemId).first<{ columns: string }>();
  if (!row) return;
  const cols = safeCols(row.columns).filter(c => c.id !== colId);
  cols.push({
    id: colId, type: 'file',
    text: files.map(f => f.nombre).join(', '),
    value: JSON.stringify({ files: files.map(f => ({ name: f.nombre })) }),
  });
  await env.DB
    .prepare('UPDATE items SET columns = ?, synced_at = ? WHERE board_id = ? AND item_id = ?')
    .bind(JSON.stringify(cols), new Date().toISOString(), boardId, itemId)
    .run();
}

function safeCols(columnsJson: string): RawCol[] {
  try { return JSON.parse(columnsJson || '[]') as RawCol[]; } catch { return []; }
}

/** Encuentra el archivo pedido para decidir permisos ANTES de borrar. Lee la
 * columna EN VIVO (no el mirror) por lo mismo que el borrado: el espejo tarda
 * en enterarse de una subida, y validar contra él contestaba "ese documento ya
 * no está en el proyecto" a quien acababa de subirlo (encontrado en la prueba
 * de producción del 2026-08-19). null = no está. */
export async function buscarArchivo(
  env: Env, boardId: number, itemId: number, colId: string, pedido: { assetId: number; nombre: string },
): Promise<ArchivoRef | null> {
  const actuales = isNativeId(itemId)
    ? await archivosNativos(env, boardId, itemId, colId)
    : await archivosEnColumna(env, itemId, colId);
  return actuales.find(f => (pedido.assetId ? f.assetId === pedido.assetId : f.nombre === pedido.nombre)) ?? null;
}
