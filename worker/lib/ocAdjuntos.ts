// worker/lib/ocAdjuntos.ts — archivos PDF adjuntos a la Orden de Compra de UN
// proveedor dentro de UN proyecto (Efraín, 2026-09-22: "poder agregar archivos
// adjuntos tipo PDF a las órdenes de compra"): la ficha técnica del
// proveedor, el plano del bordado, la cotización que respalda el costo, el
// contrato de maquila.
//
// Viven por (proyecto, proveedor), igual que la nota al proveedor
// (worker/lib/ocNotas.ts): la OC ES la tarjeta del proveedor, y un anexo del
// proveedor A no tiene por qué salir en la orden del proveedor B. No se
// pegan al PDF de la OC — el escritor de PDF del portal solo escribe, no
// parsea (docs/documentos-firma.md), así que "anexar" sería reimplementar un
// parser de PDF; los adjuntos viajan al lado de la OC, no dentro.
//
// Bytes en R2 y registro en D1; nada de esto toca Monday (mismo criterio que
// las imágenes extra de proyectoImagenes.ts). Solo PDF, decidido por la FIRMA
// de los bytes y no por el nombre: un .docx renombrado se abriría en blanco en
// el visor sin ninguna explicación.
import type { Env } from '../env';
import type { OcAdjuntoDTO } from '../../shared/dto';

export class OcAdjuntoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Tope por OC (proyecto + proveedor). Diez fichas técnicas ya son todo el
 * respaldo que una orden necesita; más que eso es un expediente, y para eso
 * está la Documentación del Proyecto. */
export const MAX_POR_OC = 10;
/** Una ficha técnica escaneada pesa 2-4 MB; 10 MB deja holgura sin abrir la
 * puerta a un catálogo completo. */
export const ADJUNTO_MAX_BYTES = 10 * 1024 * 1024;

let tableReady = false;

export async function ensureOcAdjuntoTable(env: Env): Promise<void> {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS oc_adjunto (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id  INTEGER NOT NULL,
      proveedor_id TEXT NOT NULL,
      r2_key       TEXT NOT NULL,
      nombre       TEXT NOT NULL,
      sha256       TEXT NOT NULL,
      bytes        INTEGER NOT NULL,
      created_at   TEXT NOT NULL,
      created_by   TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ocadj_proyecto ON oc_adjunto (proyecto_id, proveedor_id, id)'),
  ]);
  tableReady = true;
}

interface Row {
  id: number; proyecto_id: number; proveedor_id: string; r2_key: string;
  nombre: string; sha256: string; bytes: number; created_at: string; created_by: string;
}

function toDTO(r: Row): OcAdjuntoDTO {
  return {
    id: String(r.id),
    proveedorId: r.proveedor_id,
    nombre: r.nombre,
    bytes: r.bytes,
    subidoPor: r.created_by,
    subidoEn: r.created_at,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** `%PDF-` al inicio. Los PDF reales empiezan ahí (la especificación permite
 * hasta 1 KB de basura antes, pero ningún generador de uso común la mete). */
export function esPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** Nombre con el que se lista y se descarga: sin ruta, sin caracteres de
 * control ni comillas (viaja en Content-Disposition), siempre con `.pdf`,
 * acotado. Pura — anclada en ocAdjuntos.test.ts. */
export function limpiarNombrePdf(nombre: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  let base = (nombre.split(/[\\/]/).pop() ?? '').replace(/[\x00-\x1f"<>]/g, '').replace(/\s+/g, ' ').trim();
  base = base.replace(/\.pdf$/i, '').trim();
  base = (base || fallback).slice(0, 100);
  return `${base}.pdf`;
}

/** Valida proveedorId: id de item de Monday (dígitos) — la misma llave que la
 * nota al proveedor y que `onlyProveedor` al generar la OC. */
export function esProveedorIdUsable(id: string): boolean {
  return /^\d{1,20}$/.test(id);
}

/** Sube un PDF a la OC de un proveedor de ESTE proyecto. */
export async function agregarAdjunto(
  env: Env, proyectoId: number, proveedorId: string, bytes: Uint8Array, nombre: string, email: string,
): Promise<OcAdjuntoDTO> {
  if (!esProveedorIdUsable(proveedorId)) throw new OcAdjuntoError(400, 'proveedor inválido');
  if (bytes.length === 0) throw new OcAdjuntoError(400, 'archivo vacío');
  if (bytes.length > ADJUNTO_MAX_BYTES) throw new OcAdjuntoError(413, 'el archivo pasa de 10 MB');
  if (!esPdf(bytes)) throw new OcAdjuntoError(400, 'solo PDF');

  await ensureOcAdjuntoTable(env);
  const cuantos = await env.DB
    .prepare('SELECT count(*) AS n FROM oc_adjunto WHERE proyecto_id = ? AND proveedor_id = ?')
    .bind(proyectoId, proveedorId).first<{ n: number }>();
  if ((cuantos?.n ?? 0) >= MAX_POR_OC) {
    throw new OcAdjuntoError(400,
      `Ya hay ${MAX_POR_OC} adjuntos en la OC de este proveedor — quita alguno antes de subir otro.`);
  }

  const sha = await sha256Hex(bytes);
  // Key único por fila (sufijo aleatorio), NO solo el sha: el mismo PDF subido
  // dos veces compartiría objeto y quitar uno dejaría al otro sin bytes
  // (lección de proyectoImagenes.ts, 2026-08-25).
  const r2Key = `oc-adjuntos/${proyectoId}/${proveedorId}/${sha}-${crypto.randomUUID()}.pdf`;
  await env.FILES.put(r2Key, bytes as BufferSource, { httpMetadata: { contentType: 'application/pdf' } });

  const ahora = new Date().toISOString();
  const limpio = limpiarNombrePdf(nombre, `Adjunto ${ahora.slice(0, 10)}`);
  const res = await env.DB.prepare(
    `INSERT INTO oc_adjunto (proyecto_id, proveedor_id, r2_key, nombre, sha256, bytes, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?) RETURNING *`,
  ).bind(proyectoId, proveedorId, r2Key, limpio, sha, bytes.length, ahora, email).first<Row>();
  if (!res) throw new OcAdjuntoError(500, 'no se pudo guardar el adjunto');
  return toDTO(res);
}

/** Todos los adjuntos del proyecto, en orden de subida — una llamada para las
 * N tarjetas del tab; cada una filtra por su proveedor. */
export async function listarAdjuntosProyecto(env: Env, proyectoId: number): Promise<OcAdjuntoDTO[]> {
  await ensureOcAdjuntoTable(env);
  const { results } = await env.DB
    .prepare('SELECT * FROM oc_adjunto WHERE proyecto_id = ? ORDER BY proveedor_id, id')
    .bind(proyectoId).all<Row>();
  return (results ?? []).map(toDTO);
}

export async function leerAdjunto(
  env: Env, proyectoId: number, adjuntoId: number,
): Promise<{ bytes: Uint8Array; nombre: string } | null> {
  await ensureOcAdjuntoTable(env);
  const row = await env.DB
    .prepare('SELECT * FROM oc_adjunto WHERE proyecto_id = ? AND id = ?')
    .bind(proyectoId, adjuntoId).first<Row>();
  if (!row) return null;
  const obj = await env.FILES.get(row.r2_key);
  if (!obj) return null;
  return { bytes: new Uint8Array(await obj.arrayBuffer()), nombre: row.nombre };
}

/** Quita un adjunto. Solo quien lo subió o un admin (mismo criterio que
 * archivoBorrado.ts y proyectoImagenes.ts). Nada 1-1 con Monday que
 * respaldar: los bytes solo viven en R2 y se van con la fila. */
export async function borrarAdjunto(
  env: Env, proyectoId: number, adjuntoId: number, email: string, esAdmin: boolean,
): Promise<void> {
  await ensureOcAdjuntoTable(env);
  const row = await env.DB
    .prepare('SELECT * FROM oc_adjunto WHERE proyecto_id = ? AND id = ?')
    .bind(proyectoId, adjuntoId).first<Row>();
  if (!row) throw new OcAdjuntoError(404, 'not found');
  if (!esAdmin && row.created_by !== email) {
    throw new OcAdjuntoError(403, `Ese archivo lo subió ${row.created_by} — solo esa persona o un admin puede quitarlo.`);
  }
  await env.DB.prepare('DELETE FROM oc_adjunto WHERE proyecto_id = ? AND id = ?').bind(proyectoId, adjuntoId).run();
  const otras = await env.DB
    .prepare('SELECT count(*) AS n FROM oc_adjunto WHERE r2_key = ?')
    .bind(row.r2_key).first<{ n: number }>();
  if ((otras?.n ?? 0) === 0) {
    // El objeto se va DESPUÉS de la fila: si falla, queda un huérfano barato
    // en R2 y no un registro apuntando a bytes que ya no están.
    try { await env.FILES.delete(row.r2_key); } catch { /* huérfano tolerable */ }
  }
}
