#!/usr/bin/env node
// scripts/backfill-r2-files.mjs — copia a R2 los archivos ya subidos por el
// portal (documento en Proyectos, imágenes de embellecimiento en
// oportunidades_sub) ANTES de esta migración, usando el mismo esquema de key
// que worker/lib/r2.ts + worker/lib/embellecimientoImagenes.ts. No es un
// prerequisito estricto (GET /api/files/... cae de vuelta a Monday si el key
// no existe), es un pre-warm para que lo viejo también quede servido desde R2.
//
// Usage: node --env-file=.env scripts/backfill-r2-files.mjs [--exec]
//   (no flag) solo reporta qué se subiría, no toca R2.
//   --exec    sube de verdad con `wrangler r2 object put ... --remote`.
//
// A diferencia de hydrate.mjs (que siembra el D1 LOCAL de dev), este script
// opera contra el bucket R2 de PRODUCCIÓN — está migrando archivos reales que
// vendedores/compras ya subieron, no hay equivalente "local" que migrar.
//
// Reusa fetchItems/fetchAssetPublicUrls de worker/lib/monday.ts (Node 25 carga
// .ts sin imports cruzados de valor directo, sin bundler). El parseo de
// columnas de archivo y el key builder se duplican aquí a propósito (mismo
// motivo que hydrate.mjs con extractVendedorIds): embellecimientoImagenes.ts
// arrastra imports de dal/sync/visibility pensados para el runtime del Worker.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BOARDS } from '../shared/boards.ts';
import { fetchItems, fetchAssetPublicUrls } from '../worker/lib/monday.ts';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
if (!MONDAY_API_KEY) {
  console.error('MONDAY_API_KEY missing — run with: node --env-file=.env scripts/backfill-r2-files.mjs');
  process.exit(1);
}
const env = { MONDAY_API_KEY };
const EXEC = process.argv.includes('--exec');
const BUCKET = 'mexicanadeproteccion';

const PROYECTO_DOCUMENTO_COL = 'file_mm0hayh4';
const PROYECTO_OPP_REL = 'board_relation_mm0hf0y3';
const EMBELL_FILE_COL = 'file_mm5akjy5';
const EMBELL_SEP = '__';

function parseFileEntries(columnValues, colId) {
  const col = columnValues.find(c => c.id === colId);
  if (!col?.value) return [];
  try {
    return (JSON.parse(col.value).files ?? []);
  } catch {
    return [];
  }
}

function firstLinkedId(columnValues, colId) {
  const col = columnValues.find(c => c.id === colId);
  if (!col?.value) return null;
  try {
    const ids = (JSON.parse(col.value).linked_item_ids ?? []).map(Number).filter(Number.isFinite);
    return ids[0] ?? null;
  } catch {
    return null;
  }
}

function splitZone(name) {
  const idx = name.indexOf(EMBELL_SEP);
  if (idx === -1) return null;
  return { zone: name.slice(0, idx), original: name.slice(idx + EMBELL_SEP.length) };
}

async function fetchAllItems(boardId) {
  const items = [];
  let cursor;
  do {
    const page = await fetchItems(env, boardId, cursor);
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}

async function collectTasks() {
  const tasks = []; // { key, assetId, name }

  const proyectos = await fetchAllItems(BOARDS.proyectos.id);
  for (const item of proyectos) {
    const oppId = firstLinkedId(item.column_values, PROYECTO_OPP_REL);
    if (oppId == null) continue;
    for (const f of parseFileEntries(item.column_values, PROYECTO_DOCUMENTO_COL)) {
      tasks.push({ key: `oportunidades/${oppId}/documento/${f.name}`, assetId: f.assetId, name: f.name });
    }
  }
  console.log(`proyectos: ${proyectos.length} items revisados`);

  const lineas = await fetchAllItems(BOARDS.oportunidades_sub.id);
  for (const item of lineas) {
    const oppId = item.parent_item?.id ? Number(item.parent_item.id) : null;
    if (oppId == null) continue;
    for (const f of parseFileEntries(item.column_values, EMBELL_FILE_COL)) {
      const split = splitZone(f.name);
      if (!split) continue;
      tasks.push({
        key: `oportunidades/${oppId}/embellecimiento/${item.id}/${split.zone}/${split.original}`,
        assetId: f.assetId, name: f.name,
      });
    }
  }
  console.log(`oportunidades_sub: ${lineas.length} items revisados`);

  return tasks;
}

async function main() {
  const tasks = await collectTasks();
  console.log(`\n${tasks.length} archivo(s) a migrar a R2.`);
  if (tasks.length === 0) return;

  const urls = await fetchAssetPublicUrls(env, tasks.map(t => String(t.assetId)));
  const tmpDir = mkdtempSync(join(tmpdir(), 'r2-backfill-'));
  let ok = 0, fail = 0;

  try {
    for (const task of tasks) {
      const url = urls.get(String(task.assetId));
      if (!url) { console.error(`  [sin url] ${task.key}`); fail++; continue; }

      if (!EXEC) { console.log(`  [dry-run] ${task.key}`); ok++; continue; }

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`descarga falló: ${res.status}`);
        const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
        const bytes = new Uint8Array(await res.arrayBuffer());
        const tmpFile = join(tmpDir, String(task.assetId));
        writeFileSync(tmpFile, bytes);
        execFileSync('npx', [
          'wrangler', 'r2', 'object', 'put', `${BUCKET}/${task.key}`,
          `--file=${tmpFile}`, `--content-type=${contentType}`, '--remote',
        ], { stdio: 'inherit' });
        rmSync(tmpFile);
        ok++;
      } catch (err) {
        console.error(`  [error] ${task.key}: ${err.message}`);
        fail++;
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n${ok} ok, ${fail} fallidos.`);
  if (!EXEC) console.log('Corrida en dry-run — repetir con --exec para subir de verdad.');
}

main().catch(e => { console.error(e); process.exit(1); });
