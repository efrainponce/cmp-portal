// worker/lib/drive.ts — cliente Drive REST delgado (Fase 5, plan "salir de
// Monday", 2026-08-13): crea la carpeta raíz de licitación de una Oportunidad +
// sus 12 subcarpetas (reemplaza el escenario 100 de Make + create_subfolders.py
// de cmp-tallas) y deposita ahí los PDFs que ya generan las Fases 2-4. Todo
// verificado EN VIVO de solo lectura antes de escribir esto: el service account
// puede leer OPORTUNIDADES_PARENT_FOLDER_ID (unidad compartida
// 0ALj_2-Dlrb72Uk9PVA, la misma que usa Make hoy), y las carpetas que ya creó
// Make ahí siguen el patrón "{FOLIO} - {nombre de la oportunidad}" con las 12
// subcarpetas exactas de abajo — ver docs/cmp-tallas-endpoint-map.md fila 100.
//
// 2026-09-15 (Efraín: "una carpeta por proyecto para drive, como en
// oportunidades, conectada al portal"): se agrega la carpeta del PROYECTO —
// "{PRO-nnnn} - {nombre}" bajo "Proyectos Portal" (PROYECTOS_PARENT_FOLDER_ID,
// unidad compartida 0ANaYG13_TI1wUk9PVA, compartida con la cuenta de servicio
// ese día) con las mismas 12 subcarpetas — más el listado de subcarpetas y
// archivos para el tab Documentación, y el depósito de los documentos del
// portal (OC/contrato, actas, cotizaciones, tallas, OC proveedor) en su
// subcarpeta. Hasta entonces el Proyecto heredaba el LINK de la carpeta de la
// Oportunidad (worker/lib/ganarOportunidad.ts copiaba link_mm468m26 →
// link_mm462saa), o sea que no tenía carpeta propia.
//
// Esto NO depende de DRIVE_NATIVE (la creación de la carpeta de la Oportunidad
// sigue en Make 100): la carpeta del Proyecto no la crea nadie más, así que no
// hay duplicado posible. Su flag es DRIVE_PROYECTOS (worker/env.ts) solo para
// la creación AUTOMÁTICA al ganar/crear; las acciones explícitas del portal
// (crear carpeta, sincronizar, listar) funcionan en cuanto hay credenciales.
import type { Env } from '../env';
import type { MirrorItem } from '../../shared/types';
import { getGoogleAccessToken, GoogleAuthError } from './googleAuth';
import { gql, fetchItem } from './monday';
import { BOARDS } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import { getItemTrusted, linkedItemId, PROYECTO_OPP_REL } from './dal';
import { folioDe } from './oportunidadLigada';
import { parseArchivos } from './archivoBorrado';
import { fetchAssetBytes } from './portalFiles';
import { refetchItem } from '../sync/refetch';
import { logSync } from '../sync/log';

// Oportunidades — ids verificados contra shared/column-meta.gen.ts.
const OPP_FOLIO = 'pulse_id_mm0qcq0m';       // "Folio" (item_id)
const OPP_LINK_CARPETA = 'link_mm468m26';    // "Carpeta Drive"
// Proyectos — ids verificados contra shared/column-meta.gen.ts.
const PROY_FOLIO = 'pulse_id_mm1a12gy';      // "Folio" (item_id) → "PRO-0202"
const PROY_LINK_CARPETA = 'link_mm462saa';   // "Carpeta Drive"

export class DriveError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const OPORTUNIDADES_PARENT_FOLDER_ID = '1UuhMjK1HrNaOyC_yhD9zB7FswisZpGff';
// "Proyectos Portal" — unidad compartida 0ANaYG13_TI1wUk9PVA (Efraín, 2026-09-15).
// Verificado en vivo: la cuenta de servicio la ve con canAddChildren.
export const PROYECTOS_PARENT_FOLDER_ID = '1CXvu__tcLCvb2H0_Wr10srGJbi4AW09I';

// 12 subcarpetas de licitación — mismos nombres EXACTOS que create_subfolders.py
// (cmp-tallas) y que las carpetas ya creadas por Make en producción. La carpeta
// del Proyecto usa la MISMA lista (Efraín: "como en oportunidades") — es la
// convención que el equipo ya conoce; cambiarla es editar esta constante.
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
export type Subcarpeta = typeof SUBFOLDERS[number];

export type CarpetaKind = 'oportunidad' | 'proyecto';

/** ¿Hay credenciales de Google en este ambiente? Sin ellas el tab muestra
 * "Drive no configurado" en vez de tronar. */
export function driveDisponible(env: Env): boolean {
  return !!(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY);
}

// Drive limita las ESCRITURAS por usuario (~3/s): crear las 12 subcarpetas de
// golpe respondió 403 userRateLimitExceeded en la prueba en vivo del
// 2026-09-15. Se reintenta con backoff en 403 de cuota, 429 y 5xx; el resto
// de errores sale a la primera.
const REINTENTOS_MS = [500, 1000, 2000, 4000];

function esLimiteDeCuota(status: number, json: any): boolean {
  if (status === 429 || status >= 500) return true;
  const reason: string = json?.error?.errors?.[0]?.reason ?? '';
  return status === 403 && /rateLimitExceeded/i.test(reason);
}

async function driveFetch(env: Env, url: string, init: RequestInit = {}): Promise<any> {
  for (let intento = 0; ; intento++) {
    const token = await getGoogleAccessToken(env);
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    if (intento < REINTENTOS_MS.length && esLimiteDeCuota(res.status, json)) {
      await new Promise(r => setTimeout(r, REINTENTOS_MS[intento]));
      continue;
    }
    throw new DriveError(`Drive API ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
}

/** Valor de texto para la cláusula `q` de Drive: comillas simples y
 * diagonales invertidas escapadas. */
export function driveQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** id de carpeta a partir de la URL que Monday guarda en la columna link
 * (…/drive/folders/<id>, …/drive/u/0/folders/<id>?usp=…, …/open?id=<id>). */
export function folderIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /\/folders\/([A-Za-z0-9_-]+)/.exec(url) ?? /[?&]id=([A-Za-z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}

export function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

interface DriveFileRaw {
  id: string; name: string; mimeType: string; parents?: string[];
  modifiedTime?: string; size?: string; webViewLink?: string;
}

async function listFiles(env: Env, q: string, fields: string, maxPages = 5): Promise<DriveFileRaw[]> {
  const out: DriveFileRaw[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken, files(${fields})`,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageSize: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const json = await driveFetch(env, `${DRIVE_API}?${params}`);
    out.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
    pages++;
  } while (pageToken && pages < maxPages);
  return out;
}

/** Subcarpetas directas de `parentId` (solo directorios, no trashed) — nombre → id. */
async function listChildFolders(env: Env, parentId: string): Promise<Map<string, string>> {
  const files = await listFiles(env, `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, 'id,name');
  return new Map(files.map(f => [f.name, f.id]));
}

async function createFolder(env: Env, name: string, parentId: string): Promise<string> {
  const json = await driveFetch(env, `${DRIVE_API}?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return json.id;
}

export interface OportunidadFolder {
  rootFolderId: string;
  rootFolderUrl: string;
  subfolders: Record<string, string>; // nombre de subcarpeta -> id
}

/** Las 12 subcarpetas dentro de `rootFolderId`: lista las que ya hay y crea
 * las que falten, de 3 en 3 (una por una eran ~12 s por carpeta; las 12 a la
 * vez pegan en el límite de escrituras de Drive — ver driveFetch).
 * Idempotente: sirve igual para curar una carpeta a medias. */
const SUBCARPETAS_POR_LOTE = 3;
async function ensureSubfolders(env: Env, rootFolderId: string): Promise<Record<string, string>> {
  const existing = await listChildFolders(env, rootFolderId);
  const subfolders: Record<string, string> = {};
  const faltan = SUBFOLDERS.filter(name => {
    const id = existing.get(name);
    if (id) subfolders[name] = id;
    return !id;
  });
  for (let i = 0; i < faltan.length; i += SUBCARPETAS_POR_LOTE) {
    await Promise.all(faltan.slice(i, i + SUBCARPETAS_POR_LOTE).map(async name => {
      subfolders[name] = await createFolder(env, name, rootFolderId);
    }));
  }
  return subfolders;
}

/** Crea (o recupera, idempotente) una carpeta raíz bajo `parentId` + sus 12
 * subcarpetas. La raíz se busca por nombre exacto antes de crearla — evita
 * duplicados si el webhook de Monday reintenta la misma creación de item. */
async function ensureFolderTree(env: Env, parentId: string, rootFolderName: string): Promise<OportunidadFolder> {
  const existingRoots = await listChildFolders(env, parentId);
  const rootFolderId = existingRoots.get(rootFolderName)
    ?? await createFolder(env, rootFolderName, parentId);
  const subfolders = await ensureSubfolders(env, rootFolderId);
  return { rootFolderId, rootFolderUrl: folderUrl(rootFolderId), subfolders };
}

/** Carpeta raíz de una Oportunidad + 12 subcarpetas. `rootFolderName` debe
 * seguir el mismo patrón que ya usa Make ("{FOLIO} - {nombre}"). */
export async function ensureOportunidadFolder(env: Env, rootFolderName: string): Promise<OportunidadFolder> {
  return ensureFolderTree(env, OPORTUNIDADES_PARENT_FOLDER_ID, rootFolderName);
}

/** Sube un archivo a una carpeta ya existente: crea el archivo (metadata) y
 * luego sube el contenido con un PATCH de media — dos llamadas simples, sin
 * construir un body multipart/related a mano. Devuelve la URL para abrirlo. */
export async function uploadFileToDrive(
  env: Env,
  folderId: string,
  filename: string,
  bytes: Uint8Array,
  contentType = 'application/pdf',
): Promise<string> {
  const created = await driveFetch(env, `${DRIVE_API}?supportsAllDrives=true&fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: filename, parents: [folderId] }),
  });

  const token = await getGoogleAccessToken(env);
  const res = await fetch(`${DRIVE_UPLOAD_API}/${created.id}?uploadType=media&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new DriveError(`Drive upload PATCH ${res.status}: ${(await res.text()).slice(0, 500)}`);

  return created.webViewLink ?? `https://drive.google.com/file/d/${created.id}/view`;
}

/** Alias histórico (Fases 2-4 suben PDFs). */
export async function uploadPdfToDrive(env: Env, folderId: string, filename: string, bytes: Uint8Array): Promise<string> {
  return uploadFileToDrive(env, folderId, filename, bytes, 'application/pdf');
}

// ---------------------------------------------------------------------------
// Cache D1 de carpeta raíz + subcarpetas por item (Oportunidad o Proyecto) —
// evita relistar Drive en cada depósito o listado una vez que la carpeta ya
// existe. Lazy, mismo patrón que costeo_folios/cotizacion_folios
// (worker/lib/costeo.ts). Sustituye a `drive_folders` (2026-08-13), que nunca
// llegó a producción (DRIVE_NATIVE sigue apagada).
let driveCarpetasTableReady = false;
async function ensureDriveCarpetasTable(env: Env): Promise<void> {
  if (driveCarpetasTableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS drive_carpetas (
       kind            TEXT NOT NULL,
       item_id         INTEGER NOT NULL,
       root_folder_id  TEXT NOT NULL,
       root_name       TEXT NOT NULL DEFAULT '',
       subfolders_json TEXT NOT NULL,
       created_at      TEXT NOT NULL DEFAULT (datetime('now')),
       PRIMARY KEY (kind, item_id)
     )`,
  ).run();
  driveCarpetasTableReady = true;
}

async function carpetaCacheada(env: Env, kind: CarpetaKind, itemId: number): Promise<OportunidadFolder | null> {
  await ensureDriveCarpetasTable(env);
  const row = await env.DB.prepare(
    `SELECT root_folder_id, subfolders_json FROM drive_carpetas WHERE kind = ? AND item_id = ?`,
  ).bind(kind, itemId).first<{ root_folder_id: string; subfolders_json: string }>();
  if (!row) return null;
  return {
    rootFolderId: row.root_folder_id,
    rootFolderUrl: folderUrl(row.root_folder_id),
    subfolders: JSON.parse(row.subfolders_json),
  };
}

async function guardarCarpeta(env: Env, kind: CarpetaKind, itemId: number, rootName: string, folder: OportunidadFolder): Promise<void> {
  await ensureDriveCarpetasTable(env);
  await env.DB.prepare(
    `INSERT INTO drive_carpetas (kind, item_id, root_folder_id, root_name, subfolders_json) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind, item_id) DO UPDATE SET root_folder_id = excluded.root_folder_id, root_name = excluded.root_name, subfolders_json = excluded.subfolders_json`,
  ).bind(kind, itemId, folder.rootFolderId, rootName, JSON.stringify(folder.subfolders)).run();
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
  const cached = await carpetaCacheada(env, 'oportunidad', oportunidadId);
  if (cached) return cached;
  const folder = await ensureOportunidadFolder(env, rootFolderName);
  await guardarCarpeta(env, 'oportunidad', oportunidadId, rootFolderName, folder);
  return folder;
}

export function oportunidadRootFolderName(folio: string, nombre: string): string {
  return `${folio} - ${nombre}`;
}

/** "PRO-0202 - OPP-1015 - {nombre}" (Efraín, 2026-09-15: "incluye el folio de
 * la oportunidad directo en el nombre, tipo PRO-XXX - OPP-XXX"). El nombre del
 * Proyecto casi siempre ya trae el OPP ("OPP-1015 - UNIFORMES…", "CHALECOS… -
 * OPP-0236"): se le quita para no repetirlo. Sin oportunidad ligada queda
 * "PRO-0202 - {nombre}"; sin folio, el nombre tal cual. */
export function proyectoRootFolderName(folioPro: string, folioOpp: string, nombre: string): string {
  const pro = folioPro.trim();
  const opp = folioOpp.trim();
  let n = nombre.trim();
  if (opp) {
    // Quita el token del folio donde esté ("OPP-0112 BOTAS", "X - OPP-0236",
    // "OPP-1041 - OPP-0823 - …") y limpia los separadores que deja.
    const esc = opp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    n = n.replace(new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, 'ig'), ' ')
      .replace(/\s+-\s+-\s+/g, ' - ').replace(/^\s*-\s*|\s*-\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  return [pro, opp, n].filter(Boolean).join(' - ');
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

// ---------------------------------------------------------------------------
// Carpeta del PROYECTO (2026-09-15).

interface RawColLite { id: string; text?: string | null; value?: string | null }

/** La Oportunidad ligada al Proyecto (board_relation_mm0hf0y3), del mirror;
 * null si no tiene (proyecto hecho desde cero). */
async function oportunidadLigadaDe(env: Env, proyecto: MirrorItem): Promise<MirrorItem | null> {
  const oppId = linkedItemId(proyecto, PROYECTO_OPP_REL);
  return oppId != null ? getItemTrusted(env, 'oportunidades', oppId) : null;
}

function colsDe(row: MirrorItem): Map<string, RawColLite> {
  try {
    const raw: RawColLite[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

/** URL de una columna link del mirror ({url,text} en value; text a veces trae
 * la URL a secas). */
function linkUrlDe(cols: Map<string, RawColLite>, colId: string): string | null {
  const col = cols.get(colId);
  if (!col) return null;
  try {
    const v = col.value ? JSON.parse(col.value) as { url?: string } : null;
    if (v?.url) return v.url;
  } catch { /* text abajo */ }
  const m = /https?:\/\/\S+/.exec(col.text ?? '');
  return m ? m[0] : null;
}

/** Crea la carpeta de Drive de un Proyecto ("{PRO-nnnn} - {nombre}" bajo
 * "Proyectos Portal" + 12 subcarpetas), la cachea en D1 y escribe su URL en
 * link_mm462saa del Proyecto (antes ahí vivía el link HEREDADO de la carpeta
 * de la Oportunidad — a partir de aquí la columna apunta a la carpeta propia,
 * que es lo que "Carpeta Drive" significa en el board de Proyectos). Un
 * Proyecto nativo (Zona Efrain) no existe en Monday: solo D1. Idempotente. */
export async function crearCarpetaProyecto(env: Env, proyectoId: number): Promise<OportunidadFolder> {
  const cached = await carpetaCacheada(env, 'proyecto', proyectoId);
  if (cached) return cached;

  const row = await getItemTrusted(env, 'proyectos', proyectoId);
  if (!row) throw new DriveError(`proyecto ${proyectoId} no está en el mirror`);
  const cols = colsDe(row);
  const folio = cols.get(PROY_FOLIO)?.text?.trim() || `PRO-${proyectoId}`;
  const opp = await oportunidadLigadaDe(env, row);
  const rootName = proyectoRootFolderName(folio, opp ? folioDe(opp) : '', row.name);

  const folder = await ensureFolderTree(env, PROYECTOS_PARENT_FOLDER_ID, rootName);
  await guardarCarpeta(env, 'proyecto', proyectoId, rootName, folder);

  if (!isNativeId(proyectoId)) {
    await gql(
      env,
      `mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
      {
        b: String(BOARDS.proyectos.id),
        i: String(proyectoId),
        cv: JSON.stringify({ [PROY_LINK_CARPETA]: { url: folder.rootFolderUrl, text: rootName } }),
      },
    );
    await refetchItem(env, BOARDS.proyectos.id, proyectoId);
  }
  return folder;
}

/** Creación AUTOMÁTICA (al ganar la oportunidad o crear un proyecto desde
 * cero) — gateada por DRIVE_PROYECTOS y best-effort: nunca tumba el flujo que
 * la llama; el error queda en sync_log para `scripts/salud.mjs`. */
export async function crearCarpetaProyectoAuto(env: Env, proyectoId: number): Promise<void> {
  if (env.DRIVE_PROYECTOS !== '1' || !driveDisponible(env)) return;
  try {
    await crearCarpetaProyecto(env, proyectoId);
  } catch (err) {
    await logSync(env, 'http', BOARDS.proyectos.id, proyectoId, false, `Drive carpeta de proyecto falló: ${String(err)}`);
  }
}

/** Carpeta de un Proyecto u Oportunidad ya existente, SIN crear nada nuevo:
 * cache D1 primero; si no, la columna link del mirror. Para el Proyecto, un
 * link heredado de la Oportunidad (carpeta fuera de "Proyectos Portal") NO
 * cuenta como carpeta propia — devuelve null y el tab ofrece crearla. Con
 * `ensure` se crean las subcarpetas que falten (solo en caminos de escritura:
 * un GET no debe mutar Drive). */
export async function resolverCarpeta(
  env: Env, kind: CarpetaKind, row: MirrorItem, opts: { ensure: boolean },
): Promise<OportunidadFolder | null> {
  const itemId = Number(row.item_id);
  const cached = await carpetaCacheada(env, kind, itemId);
  if (cached) return cached;

  const cols = colsDe(row);
  const rootFolderId = folderIdFromUrl(linkUrlDe(cols, kind === 'proyecto' ? PROY_LINK_CARPETA : OPP_LINK_CARPETA));
  if (!rootFolderId) return null;

  if (kind === 'proyecto') {
    const meta = await driveFetch(env, `${DRIVE_API}/${rootFolderId}?supportsAllDrives=true&fields=id,parents,trashed`)
      .catch(() => null) as { parents?: string[]; trashed?: boolean } | null;
    if (!meta || meta.trashed || !(meta.parents ?? []).includes(PROYECTOS_PARENT_FOLDER_ID)) return null;
  }

  const subfolders = opts.ensure
    ? await ensureSubfolders(env, rootFolderId)
    : Object.fromEntries(await listChildFolders(env, rootFolderId));
  const folder: OportunidadFolder = { rootFolderId, rootFolderUrl: folderUrl(rootFolderId), subfolders };
  // Solo se cachea completa: con `ensure` las 12 están garantizadas; sin él
  // podría faltar alguna y el depósito la necesitaría después.
  if (opts.ensure) await guardarCarpeta(env, kind, itemId, row.name, folder);
  return folder;
}

// ---------------------------------------------------------------------------
// Listado para el tab Documentación: subcarpetas + archivos en 2 llamadas
// (hijos de la raíz; luego hijos de TODAS las subcarpetas en una sola `q` con
// OR de parents). Se pide solo al abrir el tab, nunca en polling.

export interface DriveArchivo {
  id: string; nombre: string; url: string; mimeType: string;
  modificado: string | null; tamano: number | null;
}
export interface DriveSubcarpeta { id: string; nombre: string; url: string; archivos: DriveArchivo[] }
export interface DriveListado { subcarpetas: DriveSubcarpeta[]; archivos: DriveArchivo[] }

const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,size,webViewLink';

function toArchivo(f: DriveFileRaw): DriveArchivo {
  return {
    id: f.id,
    nombre: f.name,
    url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
    mimeType: f.mimeType,
    modificado: f.modifiedTime ?? null,
    tamano: f.size != null ? Number(f.size) : null,
  };
}

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true });

export async function listarCarpeta(env: Env, rootFolderId: string): Promise<DriveListado> {
  const hijos = await listFiles(env, `'${rootFolderId}' in parents and trashed=false`, FILE_FIELDS);
  const carpetas = hijos.filter(f => f.mimeType === FOLDER_MIME);
  const sueltos = hijos.filter(f => f.mimeType !== FOLDER_MIME).map(toArchivo).sort(porNombre);

  const porCarpeta = new Map<string, DriveArchivo[]>(carpetas.map(c => [c.id, []]));
  if (carpetas.length > 0) {
    const parents = carpetas.map(c => `'${c.id}' in parents`).join(' or ');
    const archivos = await listFiles(env, `(${parents}) and trashed=false and mimeType != '${FOLDER_MIME}'`, FILE_FIELDS);
    for (const f of archivos) {
      for (const p of f.parents ?? []) porCarpeta.get(p)?.push(toArchivo(f));
    }
  }

  const subcarpetas: DriveSubcarpeta[] = carpetas.map(c => ({
    id: c.id, nombre: c.name, url: folderUrl(c.id),
    archivos: (porCarpeta.get(c.id) ?? []).sort(porNombre),
  })).sort(porNombre);
  return { subcarpetas, archivos: sueltos };
}

// ---------------------------------------------------------------------------
// Depósito de documentos del portal en su subcarpeta.

/** Categoría de archivo del portal (worker/lib/portalFiles.ts) → subcarpeta.
 * Lo que no está aquí no se deposita a propósito: la solicitud de costeo es
 * interna (Efraín, 2026-08-13) y las imágenes de inventario no son documentos. */
export const CATEGORIA_SUBCARPETA: Record<string, Subcarpeta> = {
  'documento': '05. CONTRATO FIRMADO',        // OC / contrato / cotización firmada por el cliente
  'acta-entrega': '06. ACTA DE ENTREGA',
  'cotizacion-firmada': '10. COT FINAL',
  'cotizacion-no-firmada': '10. COT FINAL',
  'cotizaciones-proyecto': '10. COT FINAL',   // file_mm0hwapr, copia que deja "Ganar"
  'tallas': '09. RELACION DE TALLAS',
  'oc': '08. ODC PROVEEDOR',
};

/** Columnas file de cada item cuyo contenido se espeja a Drive al
 * "Sincronizar documentos" — ids verificados contra shared/column-meta.gen.ts
 * (los mismos de worker/lib/portalFiles.ts / ganarOportunidad.ts). */
export const COLUMNAS_SINCRONIZABLES: Record<CarpetaKind, ReadonlyArray<{ colId: string; categoria: keyof typeof CATEGORIA_SUBCARPETA }>> = {
  oportunidad: [
    { colId: 'file_mm0zjras', categoria: 'cotizacion-firmada' },
    { colId: 'file_mm0fgrzq', categoria: 'cotizacion-no-firmada' },
  ],
  proyecto: [
    { colId: 'file_mm33yv4p', categoria: 'documento' },
    { colId: 'file_mm0hayh4', categoria: 'documento' },       // columna legado, solo lectura
    { colId: 'file_mm4pa2h8', categoria: 'acta-entrega' },
    { colId: 'file_mm0hcrtz', categoria: 'tallas' },
    { colId: 'file_mm0hj9pn', categoria: 'oc' },
    { colId: 'file_mm0hwapr', categoria: 'cotizaciones-proyecto' },
  ],
};

/** Tope de archivos por sincronización — un proyecto real trae 3-8; el tope
 * es para que un click nunca se convierta en minutos de subidas. */
export const SINCRONIZAR_MAX = 25;

async function existeEnCarpeta(env: Env, folderId: string, nombre: string): Promise<boolean> {
  const files = await listFiles(env, `'${folderId}' in parents and name = ${driveQuote(nombre)} and trashed=false`, 'id', 1);
  return files.length > 0;
}

/** Sube `bytes` a la subcarpeta de su categoría si no hay ya un archivo con
 * ese nombre ahí. Devuelve qué pasó. */
export async function depositarArchivo(
  env: Env, folder: OportunidadFolder, categoria: string, nombre: string, bytes: Uint8Array, contentType: string,
): Promise<'subido' | 'existente' | 'sin-subcarpeta'> {
  const sub = CATEGORIA_SUBCARPETA[categoria];
  const folderId = sub ? folder.subfolders[sub] : undefined;
  if (!folderId) return 'sin-subcarpeta';
  if (await existeEnCarpeta(env, folderId, nombre)) return 'existente';
  await uploadFileToDrive(env, folderId, nombre, bytes, contentType);
  return 'subido';
}

/** Tras una subida desde el portal (OC/contrato, acta): copia el archivo a la
 * carpeta del Proyecto si ya existe. Best-effort, pensado para `waitUntil` —
 * nunca crea la carpeta (eso es una acción explícita) ni tumba la subida. */
export async function depositarSubidaProyecto(
  env: Env, proyectoId: number, categoria: string, nombre: string, bytes: Uint8Array, contentType: string,
): Promise<void> {
  if (!driveDisponible(env)) return;
  try {
    const row = await getItemTrusted(env, 'proyectos', proyectoId);
    if (!row) return;
    const folder = await resolverCarpeta(env, 'proyecto', row, { ensure: true });
    if (!folder) return;
    await depositarArchivo(env, folder, categoria, nombre, bytes, contentType);
  } catch (err) {
    await logSync(env, 'http', BOARDS.proyectos.id, proyectoId, false, `Drive depósito de ${categoria} falló: ${String(err)}`);
  }
}

export interface SincronizarResultado { subidos: string[]; existentes: number; errores: string[] }

/** Espeja a Drive los archivos que el item tiene en Monday (columnas file de
 * COLUMNAS_SINCRONIZABLES): cada uno a la subcarpeta de su categoría, saltando
 * los que ya están (por nombre). Los bytes salen del link firmado de Monday.
 * Un item nativo no tiene assets de Monday: no hay nada que espejar. */
export async function sincronizarDocumentos(
  env: Env, kind: CarpetaKind, row: MirrorItem, folder: OportunidadFolder,
): Promise<SincronizarResultado> {
  const resultado: SincronizarResultado = { subidos: [], existentes: 0, errores: [] };
  if (isNativeId(Number(row.item_id))) return resultado;
  const pendientes: { assetId: number; nombre: string; categoria: string }[] = [];
  const vistos = new Set<string>();
  const agregar = (item: MirrorItem, columnas: ReadonlyArray<{ colId: string; categoria: string }>) => {
    const cols = colsDe(item);
    for (const { colId, categoria } of columnas) {
      for (const a of parseArchivos(cols.get(colId)?.value ?? null)) {
        if (!a.assetId || !a.nombre) continue;
        const llave = `${categoria}/${a.nombre}`;
        if (vistos.has(llave)) continue;
        vistos.add(llave);
        pendientes.push({ assetId: a.assetId, nombre: a.nombre, categoria });
      }
    }
  };
  agregar(row, COLUMNAS_SINCRONIZABLES[kind]);
  // La carpeta del Proyecto también recibe las cotizaciones de SU Oportunidad
  // (10. COT FINAL): en los proyectos anteriores a "Ganar" desde el portal la
  // firmada solo vive en la Oportunidad (Efraín, 2026-09-15: "con documentos").
  if (kind === 'proyecto') {
    const opp = await oportunidadLigadaDe(env, row);
    if (opp) agregar(opp, COLUMNAS_SINCRONIZABLES.oportunidad);
  }
  const lote = pendientes.slice(0, SINCRONIZAR_MAX);
  if (pendientes.length > SINCRONIZAR_MAX) {
    resultado.errores.push(`Solo se sincronizan ${SINCRONIZAR_MAX} archivos por vez (hay ${pendientes.length}); vuelve a dar Sincronizar para el resto.`);
  }

  // De 3 en 3: cada archivo son 2-3 llamadas (¿existe?, metadata, media).
  for (let i = 0; i < lote.length; i += 3) {
    await Promise.all(lote.slice(i, i + 3).map(async p => {
      try {
        const sub = CATEGORIA_SUBCARPETA[p.categoria];
        const folderId = folder.subfolders[sub];
        if (!folderId) throw new DriveError(`sin subcarpeta "${sub}"`);
        if (await existeEnCarpeta(env, folderId, p.nombre)) { resultado.existentes++; return; }
        const asset = await fetchAssetBytes(env, p.assetId);
        if (!asset) throw new DriveError('Monday no devolvió el archivo');
        await uploadFileToDrive(env, folderId, p.nombre, asset.bytes, asset.contentType);
        resultado.subidos.push(p.nombre);
      } catch (err) {
        resultado.errores.push(`${p.nombre}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }));
  }
  return resultado;
}

export function esErrorDeDrive(err: unknown): err is DriveError | GoogleAuthError {
  return err instanceof DriveError || err instanceof GoogleAuthError;
}
