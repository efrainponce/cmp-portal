// worker/lib/drive.ts — cliente Drive REST delgado (Fase 5, plan "salir de
// Monday", 2026-08-13): crea la carpeta raíz de licitación de una Oportunidad +
// sus 12 subcarpetas (reemplaza el escenario 100 de Make + create_subfolders.py
// de cmp-tallas) y deposita ahí los PDFs que ya generan las Fases 2-4. Todo
// verificado EN VIVO de solo lectura antes de escribir esto: el service account
// puede leer OPORTUNIDADES_PARENT_FOLDER_ID (unidad compartida
// 0ALj_2-Dlrb72Uk9PVA, la misma que usa Make hoy), y las carpetas que ya creó
// Make ahí siguen el patrón "{FOLIO} - {nombre de la oportunidad}" con las 12
// subcarpetas exactas de abajo — ver docs/cmp-tallas-endpoint-map.md fila 100.
import type { Env } from '../env';
import { getGoogleAccessToken } from './googleAuth';
import { gql, fetchItem } from './monday';
import { BOARDS } from '../../shared/boards';

// Oportunidades — ids verificados contra shared/column-meta.gen.ts.
const OPP_FOLIO = 'pulse_id_mm0qcq0m';       // "Folio" (item_id)
const OPP_LINK_CARPETA = 'link_mm468m26';    // "Carpeta Drive"

export class DriveError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

export const OPORTUNIDADES_PARENT_FOLDER_ID = '1UuhMjK1HrNaOyC_yhD9zB7FswisZpGff';

// 12 subcarpetas de licitación — mismos nombres EXACTOS que create_subfolders.py
// (cmp-tallas) y que las carpetas ya creadas por Make en producción.
export const SUBFOLDERS = [
  '01. BASES',
  '02. JA',
  '03. ACTA DE APERTURA',
  '04. FALLO',
  '05. CONTRATO FIRMADO',
  '06. ACTA DE ENTREGA',
  '07. CARPETA COMPLETA',
  '08. ODC PROVEEDOR',
  '09. RELACION DE TALLAS',
  '10. COT FINAL',
  '11. FIANZA',
  '12. FACTURA',
] as const;

async function driveFetch(env: Env, url: string, init: RequestInit = {}): Promise<any> {
  const token = await getGoogleAccessToken(env);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new DriveError(`Drive API ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

/** Subcarpetas directas de `parentId` (solo directorios, no trashed) — nombre → id. */
async function listChildFolders(env: Env, parentId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken, files(id,name)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageSize: '100',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const json = await driveFetch(env, `${DRIVE_API}?${params}`);
    for (const f of json.files ?? []) names.set(f.name, f.id);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return names;
}

async function createFolder(env: Env, name: string, parentId: string): Promise<string> {
  const json = await driveFetch(env, `${DRIVE_API}?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  return json.id;
}

export interface OportunidadFolder {
  rootFolderId: string;
  rootFolderUrl: string;
  subfolders: Record<string, string>; // nombre de subcarpeta -> id
}

/** Crea (o recupera, idempotente) la carpeta raíz de una Oportunidad + sus 12
 * subcarpetas de licitación. `rootFolderName` debe seguir el mismo patrón que
 * ya usa Make ("{FOLIO} - {nombre}") para no romper la convención existente. La
 * carpeta raíz se busca por nombre exacto antes de crearla — evita duplicados
 * si el webhook de Monday reintenta la misma creación de item. */
export async function ensureOportunidadFolder(env: Env, rootFolderName: string): Promise<OportunidadFolder> {
  const existingRoots = await listChildFolders(env, OPORTUNIDADES_PARENT_FOLDER_ID);
  const rootFolderId = existingRoots.get(rootFolderName)
    ?? await createFolder(env, rootFolderName, OPORTUNIDADES_PARENT_FOLDER_ID);

  const existingSubs = await listChildFolders(env, rootFolderId);
  const subfolders: Record<string, string> = {};
  for (const name of SUBFOLDERS) {
    subfolders[name] = existingSubs.get(name) ?? await createFolder(env, name, rootFolderId);
  }

  return {
    rootFolderId,
    rootFolderUrl: `https://drive.google.com/drive/folders/${rootFolderId}`,
    subfolders,
  };
}

/** Sube un PDF a una subcarpeta ya existente: crea el archivo (metadata) y
 * luego sube el contenido con un PATCH de media — dos llamadas simples, sin
 * construir un body multipart/related a mano. */
export async function uploadPdfToDrive(
  env: Env,
  folderId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  const created = await driveFetch(env, `${DRIVE_API}?supportsAllDrives=true&fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: filename, parents: [folderId] }),
  });

  const token = await getGoogleAccessToken(env);
  const res = await fetch(`${DRIVE_UPLOAD_API}/${created.id}?uploadType=media&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new DriveError(`Drive upload PATCH ${res.status}: ${(await res.text()).slice(0, 500)}`);

  return created.webViewLink ?? `https://drive.google.com/file/d/${created.id}/view`;
}

// Cache D1 de carpeta raíz + subcarpetas por Oportunidad — evita relistar Drive
// en cada depósito de PDF (Fases 2-4) una vez que la carpeta ya existe. Lazy,
// mismo patrón que costeo_folios/cotizacion_folios (worker/lib/costeo.ts).
let driveFoldersTableReady = false;
async function ensureDriveFoldersTable(env: Env): Promise<void> {
  if (driveFoldersTableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS drive_folders (
       item_id INTEGER PRIMARY KEY,
       root_folder_id TEXT NOT NULL,
       subfolders_json TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
  driveFoldersTableReady = true;
}

/** Carpeta de Drive de una Oportunidad, con cache en D1. Si ya se creó antes
 * (por el hook del webhook `create_item` o una llamada previa de esta misma
 * función), la recupera de D1 sin volver a listar Drive; si no, la crea/ubica
 * en Drive (`ensureOportunidadFolder`, idempotente) y la persiste. Así, un PDF
 * de Fase 2-4 encuentra su carpeta aunque la Oportunidad se haya creado antes
 * de encender DRIVE_NATIVE. */
export async function getOrCreateDriveFolder(
  env: Env,
  oportunidadId: number,
  rootFolderName: string,
): Promise<OportunidadFolder> {
  await ensureDriveFoldersTable(env);

  const row = await env.DB.prepare(
    `SELECT root_folder_id, subfolders_json FROM drive_folders WHERE item_id = ?`,
  ).bind(oportunidadId).first<{ root_folder_id: string; subfolders_json: string }>();

  if (row) {
    return {
      rootFolderId: row.root_folder_id,
      rootFolderUrl: `https://drive.google.com/drive/folders/${row.root_folder_id}`,
      subfolders: JSON.parse(row.subfolders_json),
    };
  }

  const folder = await ensureOportunidadFolder(env, rootFolderName);
  await env.DB.prepare(
    `INSERT INTO drive_folders (item_id, root_folder_id, subfolders_json) VALUES (?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET root_folder_id = excluded.root_folder_id, subfolders_json = excluded.subfolders_json`,
  ).bind(oportunidadId, folder.rootFolderId, JSON.stringify(folder.subfolders)).run();

  return folder;
}

export function oportunidadRootFolderName(folio: string, nombre: string): string {
  return `${folio} - ${nombre}`;
}

/** Carpeta de Drive de una Oportunidad, resolviendo folio+nombre desde Monday
 * directamente — para llamadores que solo tienen el id (p.ej. Fases 3/4, que
 * corren sobre el Proyecto y necesitan la carpeta de SU Oportunidad ligada). */
export async function getOrCreateDriveFolderForOportunidad(
  env: Env,
  oportunidadId: number,
): Promise<{ folder: OportunidadFolder; rootFolderName: string } | null> {
  const item = await fetchItem(env, oportunidadId);
  if (!item) return null;
  const folio = item.column_values.find(c => c.id === OPP_FOLIO)?.text?.trim() || String(oportunidadId);
  const rootFolderName = oportunidadRootFolderName(folio, item.name);
  const folder = await getOrCreateDriveFolder(env, oportunidadId, rootFolderName);
  return { folder, rootFolderName };
}

/** Reacciona al webhook `create_item` de Monday sobre Oportunidades (worker/
 * sync/webhook.ts) — reemplaza el escenario 100 de Make + create_subfolders.py
 * de cmp-tallas: crea la carpeta raíz + 12 subcarpetas y escribe la URL en
 * link_mm468m26 (mismo efecto visible que el flujo de siempre). Idempotente de
 * punta a punta (ensureOportunidadFolder + este mismo change_multiple_column_
 * values), así que un reintento del webhook no duplica nada. */
export async function createOportunidadFolderOnCreate(env: Env, itemId: number): Promise<void> {
  const resolved = await getOrCreateDriveFolderForOportunidad(env, itemId);
  if (!resolved) return;
  const { folder, rootFolderName } = resolved;

  await gql(
    env,
    `mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
    {
      b: String(BOARDS.oportunidades.id),
      i: String(itemId),
      cv: JSON.stringify({ [OPP_LINK_CARPETA]: { url: folder.rootFolderUrl, text: rootFolderName } }),
    },
  );
}
