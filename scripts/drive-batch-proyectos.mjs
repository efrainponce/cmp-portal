// scripts/drive-batch-proyectos.mjs — crea en batch la carpeta de Drive de los
// Proyectos ANTERIORES (Efraín, 2026-09-15: "los proyectos anteriores se creen
// ahora en batch y con documentos") y espeja ahí sus documentos de Monday.
// Misma regla que worker/lib/drive.ts (crearCarpetaProyecto +
// sincronizarDocumentos), escrita aparte para correr contra producción SIN
// esperar el deploy del Worker: Drive con la cuenta de servicio, Monday con el
// token de servicio y D1 de producción vía wrangler (lectura + cache
// `drive_carpetas` al final).
//
//   node scripts/drive-batch-proyectos.mjs --dry            # plan, sin escribir nada
//   node scripts/drive-batch-proyectos.mjs                  # corrida real
//   node scripts/drive-batch-proyectos.mjs --solo=13042201092,13010110340
//   node scripts/drive-batch-proyectos.mjs --limite=10
//
// Idempotente: la carpeta se busca por nombre en "Proyectos Portal" antes de
// crearla, cada subcarpeta por nombre, y cada archivo por nombre en su
// subcarpeta — se puede re-correr las veces que haga falta. Necesita `.env`
// (MONDAY_API_KEY, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY) y
// `.dev.vars` (wrangler) en la raíz del repo. Solo proyectos reales de Monday
// (ids < 900000000000): los nativos no tienen assets que espejar.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const SOLO = new Set((args.find(a => a.startsWith('--solo='))?.slice(7) ?? '').split(',').filter(Boolean).map(Number));
const LIMITE = Number(args.find(a => a.startsWith('--limite='))?.slice(9) ?? 0) || Infinity;

const BOARD_PROYECTOS = 18395657594;
const BOARD_OPORTUNIDADES = 18395657596;
const PROYECTOS_PARENT_FOLDER_ID = '1CXvu__tcLCvb2H0_Wr10srGJbi4AW09I'; // "Proyectos Portal"
const PROY_FOLIO = 'pulse_id_mm1a12gy';
const PROY_LINK = 'link_mm462saa';
const PROY_OPP_REL = 'board_relation_mm0hf0y3';
const OPP_FOLIO = 'pulse_id_mm0qcq0m';
const SUBFOLDERS = [
  '01. BASES', '02. JA', '03. ACTA DE APERTURA', '04. FALLO', '05. CONTRATO FIRMADO', '06. ACTA DE ENTREGA',
  '07. CARPETA COMPLETA', '08. ODC PROVEEDOR', '09. RELACION DE TALLAS', '10. COT FINAL', '11. FIANZA', '12. FACTURA',
];
// Columna → subcarpeta (= CATEGORIA_SUBCARPETA + COLUMNAS_SINCRONIZABLES del worker).
const COLS_PROYECTO = [
  ['file_mm33yv4p', '05. CONTRATO FIRMADO'], ['file_mm0hayh4', '05. CONTRATO FIRMADO'],
  ['file_mm4pa2h8', '06. ACTA DE ENTREGA'], ['file_mm0hcrtz', '09. RELACION DE TALLAS'],
  ['file_mm0hj9pn', '08. ODC PROVEEDOR'], ['file_mm0hwapr', '10. COT FINAL'],
];
const COLS_OPP = [['file_mm0zjras', '10. COT FINAL'], ['file_mm0fgrzq', '10. COT FINAL']];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// --- .env ------------------------------------------------------------------
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return [l.slice(0, i), v];
}));
for (const k of ['MONDAY_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']) if (!env[k]) { console.error(`falta ${k} en .env`); process.exit(1); }
const API_VERSION = /const API_VERSION = '([^']+)'/.exec(fs.readFileSync('worker/lib/monday.ts', 'utf8'))?.[1] ?? '2025-01';

// --- D1 de producción --------------------------------------------------------
function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--remote', '--env-file=.dev.vars', '--json', '--command', sql], {
    env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const json = JSON.parse(out.slice(out.indexOf('[')));
  return json.map(r => r.results);
}
const sqlStr = v => `'${String(v).replace(/'/g, "''")}'`;

// --- Google -----------------------------------------------------------------
let gToken = null, gTokenExp = 0;
async function googleToken() {
  if (gToken && Date.now() < gTokenExp) return gToken;
  const pem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), pem).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${sig}` }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('token Google: ' + JSON.stringify(j));
  gToken = j.access_token; gTokenExp = Date.now() + 50 * 60 * 1000;
  return gToken;
}
const REINTENTOS_MS = [500, 1000, 2000, 4000, 8000];
async function driveFetch(url, init = {}) {
  for (let intento = 0; ; intento++) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await googleToken()}` } });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    const reason = json?.error?.errors?.[0]?.reason ?? '';
    const cuota = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimitExceeded/i.test(reason));
    if (cuota && intento < REINTENTOS_MS.length) { await sleep(REINTENTOS_MS[intento]); continue; }
    throw new Error(`Drive ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
async function listFiles(query, fields = 'id,name,mimeType') {
  const out = []; let pageToken;
  do {
    const p = new URLSearchParams({ q: query, fields: `nextPageToken, files(${fields})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', pageSize: '200' });
    if (pageToken) p.set('pageToken', pageToken);
    const j = await driveFetch(`https://www.googleapis.com/drive/v3/files?${p}`);
    out.push(...(j.files ?? [])); pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}
async function childFolders(parentId) {
  return new Map((await listFiles(`'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`)).map(f => [f.name, f.id]));
}
async function createFolder(name, parentId) {
  return (await driveFetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })).id;
}
async function existe(folderId, nombre) {
  return (await listFiles(`'${folderId}' in parents and name = ${q(nombre)} and trashed=false`, 'id')).length > 0;
}
async function upload(folderId, nombre, bytes, contentType) {
  const created = await driveFetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nombre, parents: [folderId] }),
  });
  for (let intento = 0; ; intento++) {
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media&supportsAllDrives=true`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': contentType }, body: bytes,
    });
    if (r.ok) return;
    if ((r.status === 429 || r.status >= 500 || r.status === 403) && intento < REINTENTOS_MS.length) { await sleep(REINTENTOS_MS[intento]); continue; }
    throw new Error(`Drive upload ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

// --- Monday -----------------------------------------------------------------
async function gql(query, variables) {
  const r = await fetch('https://api.monday.com/v2', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: env.MONDAY_API_KEY, 'API-Version': API_VERSION },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('Monday: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}
async function assetUrls(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await gql(`query($ids:[ID!]!){ assets(ids:$ids){ id public_url } }`, { ids: ids.slice(i, i + 50).map(String) });
    for (const a of d?.assets ?? []) out.set(String(a.id), a.public_url);
  }
  return out;
}

// --- regla de nombre (= proyectoRootFolderName del worker) -----------------
function nombreCarpeta(folioPro, folioOpp, nombre) {
  const pro = folioPro.trim(), opp = folioOpp.trim(); let n = nombre.trim();
  if (opp) {
    const esc = opp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    n = n.replace(new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, 'ig'), ' ')
      .replace(/\s+-\s+-\s+/g, ' - ').replace(/^\s*-\s*|\s*-\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  return [pro, opp, n].filter(Boolean).join(' - ');
}
const colsDe = row => { try { return new Map(JSON.parse(row.columns || '[]').map(c => [c.id, c])); } catch { return new Map(); } };
const archivosDe = (cols, colId) => { try { return (JSON.parse(cols.get(colId)?.value || '{}').files ?? []).map(f => ({ assetId: Number(f.assetId) || 0, nombre: f.name ?? '' })).filter(f => f.assetId && f.nombre); } catch { return []; } };
const linkUrl = (cols, colId) => { try { return JSON.parse(cols.get(colId)?.value || 'null')?.url ?? null; } catch { return null; } };
const linkedId = (cols, colId) => { try { return Number((JSON.parse(cols.get(colId)?.value || '{}').linked_item_ids ?? [])[0]) || null; } catch { return null; } };

// --- main -------------------------------------------------------------------
console.log(`${DRY ? '[DRY] ' : ''}Leyendo proyectos de D1 de producción…`);
const [proyectos] = d1(`SELECT item_id, name, columns FROM items WHERE board_id=${BOARD_PROYECTOS} AND item_id < 900000000000 ORDER BY item_id`);
const oppIds = [...new Set(proyectos.map(p => linkedId(colsDe(p), PROY_OPP_REL)).filter(Boolean))];
const opps = new Map();
for (let i = 0; i < oppIds.length; i += 80) {
  const [rows] = d1(`SELECT item_id, name, columns FROM items WHERE board_id=${BOARD_OPORTUNIDADES} AND item_id IN (${oppIds.slice(i, i + 80).join(',')})`);
  for (const r of rows) opps.set(Number(r.item_id), r);
}
// Proyectos de prueba ("OC test", "OPP-E2E-TEST-…") no estrenan carpeta salvo
// que se pidan explícitamente con --solo.
const esPrueba = p => /\btest\b|e2e/i.test(p.name);
const saltados = SOLO.size === 0 ? proyectos.filter(esPrueba) : [];
if (saltados.length) console.log(`Saltando ${saltados.length} proyectos de prueba: ${saltados.map(p => p.name).join(' | ')}`);
let lista = proyectos.filter(p => SOLO.size ? SOLO.has(Number(p.item_id)) : !esPrueba(p)).slice(0, LIMITE);
console.log(`${proyectos.length} proyectos en el mirror, ${lista.length} a procesar, ${opps.size} oportunidades ligadas.`);

const existentes = await childFolders(PROYECTOS_PARENT_FOLDER_ID);
console.log(`"Proyectos Portal" ya tiene ${existentes.size} carpetas.`);

const resumen = { carpetasCreadas: 0, carpetasExistian: 0, subidos: 0, yaEstaban: 0, linksEscritos: 0, errores: [] };
const cacheRows = [];
let i = 0;
for (const p of lista) {
  i++;
  const cols = colsDe(p);
  const folioPro = cols.get(PROY_FOLIO)?.text?.trim() || `PRO-${p.item_id}`;
  const opp = opps.get(linkedId(cols, PROY_OPP_REL)) ?? null;
  const oppCols = opp ? colsDe(opp) : null;
  const folioOpp = oppCols?.get(OPP_FOLIO)?.text?.trim() ?? '';
  const rootName = nombreCarpeta(folioPro, folioOpp, p.name);

  const archivos = [];
  const vistos = new Set();
  const agregar = (c, defs) => { for (const [colId, sub] of defs) for (const a of archivosDe(c, colId)) { const k = `${sub}/${a.nombre}`; if (!vistos.has(k)) { vistos.add(k); archivos.push({ ...a, sub }); } } };
  agregar(cols, COLS_PROYECTO);
  if (oppCols) agregar(oppCols, COLS_OPP);

  const tag = `[${i}/${lista.length}] ${rootName}`;
  if (DRY) {
    console.log(`${tag} — ${existentes.has(rootName) ? 'carpeta ya existe' : 'carpeta NUEVA'}, ${archivos.length} archivos: ${archivos.map(a => `${a.sub.slice(0, 2)}:${a.nombre}`).join(', ') || '—'}`);
    continue;
  }

  try {
    let rootId = existentes.get(rootName);
    if (rootId) resumen.carpetasExistian++;
    else { rootId = await createFolder(rootName, PROYECTOS_PARENT_FOLDER_ID); existentes.set(rootName, rootId); resumen.carpetasCreadas++; }

    const subs = await childFolders(rootId);
    const faltan = SUBFOLDERS.filter(s => !subs.has(s));
    for (let j = 0; j < faltan.length; j += 3) {
      await Promise.all(faltan.slice(j, j + 3).map(async s => { subs.set(s, await createFolder(s, rootId)); }));
    }

    let subidos = 0, yaEstaban = 0;
    const urls = archivos.length ? await assetUrls(archivos.map(a => a.assetId)) : new Map();
    for (const a of archivos) {
      const folderId = subs.get(a.sub);
      try {
        if (await existe(folderId, a.nombre)) { yaEstaban++; continue; }
        const url = urls.get(String(a.assetId));
        if (!url) throw new Error('Monday no dio public_url');
        const r = await fetch(url);
        if (!r.ok) throw new Error(`descarga ${r.status}`);
        await upload(folderId, a.nombre, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') ?? 'application/octet-stream');
        subidos++;
        await sleep(300);
      } catch (err) {
        resumen.errores.push(`${rootName} · ${a.nombre}: ${err.message}`);
      }
    }
    resumen.subidos += subidos; resumen.yaEstaban += yaEstaban;

    const rootUrl = `https://drive.google.com/drive/folders/${rootId}`;
    if (linkUrl(cols, PROY_LINK) !== rootUrl) {
      await gql(`mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b,item_id:$i,column_values:$cv){ id } }`,
        { b: String(BOARD_PROYECTOS), i: String(p.item_id), cv: JSON.stringify({ [PROY_LINK]: { url: rootUrl, text: rootName } }) });
      resumen.linksEscritos++;
    }
    cacheRows.push({ item_id: p.item_id, rootId, rootName, subs: Object.fromEntries(SUBFOLDERS.map(s => [s, subs.get(s)])) });
    console.log(`${tag} — ${rootId ? 'ok' : '?'}: ${subidos} subidos, ${yaEstaban} ya estaban`);
  } catch (err) {
    resumen.errores.push(`${rootName}: ${err.message}`);
    console.log(`${tag} — ERROR ${err.message}`);
  }
}

if (!DRY && cacheRows.length) {
  console.log(`Guardando ${cacheRows.length} carpetas en drive_carpetas (D1 producción)…`);
  d1(`CREATE TABLE IF NOT EXISTS drive_carpetas (kind TEXT NOT NULL, item_id INTEGER NOT NULL, root_folder_id TEXT NOT NULL, root_name TEXT NOT NULL DEFAULT '', subfolders_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (kind, item_id))`);
  for (let j = 0; j < cacheRows.length; j += 15) {
    const stmts = cacheRows.slice(j, j + 15).map(r =>
      `INSERT INTO drive_carpetas (kind, item_id, root_folder_id, root_name, subfolders_json) VALUES ('proyecto', ${r.item_id}, ${sqlStr(r.rootId)}, ${sqlStr(r.rootName)}, ${sqlStr(JSON.stringify(r.subs))}) ON CONFLICT(kind, item_id) DO UPDATE SET root_folder_id = excluded.root_folder_id, root_name = excluded.root_name, subfolders_json = excluded.subfolders_json`);
    d1(stmts.join('; '));
  }
}
console.log('\nRESUMEN', JSON.stringify(resumen, null, 2));
