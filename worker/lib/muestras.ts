// worker/lib/muestras.ts — Solicitudes de MUESTRAS (Efraín, 2026-09-21). El
// contrato y la validación pura viven en shared/muestras.ts; aquí solo D1.
//
// 100 % nativo: nada de esto toca Monday. Cada solicitud cuelga de UNA
// Oportunidad o de UN Proyecto (CHECK en la tabla: exactamente uno), por su
// item id del espejo — igual que las OC, una muestra suelta no existe.
//
// Permisos = los del item ligado (dal.ts): leer = scope 'read' del padre,
// escribir = scope 'own'. Lo revisan las RUTAS (worker/routes/muestras.ts) con
// getItem antes de llamar aquí; la lista general (`listarMuestras`) hace el
// mismo recorte con JOIN a `items` + scopeFor, así que nadie ve muestras de
// una oportunidad que no puede abrir.
//
// El borrado es un DELETE de D1 con respaldo del renglón completo (con sus
// líneas) en `muestra_borrado` ANTES de borrar — mismo espíritu que
// `item_borrado`, sin pasar por itemBorrado.ts porque no es un item de Monday.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { canReadBoard } from '../../shared/visibility';
import { scopeFor } from './dal';
import {
  fechaRetorno, muestraFolio, esMuestraEstado,
  type MuestraEstado, type MuestraLineaDTO, type MuestraPadre, type MuestraSolicitudDTO, type validarSolicitud,
} from '../../shared/muestras';

export class MuestraError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type SolicitudValida = Extract<ReturnType<typeof validarSolicitud>, { ok: true }>['valor'];

let tablesReady = false;

export async function ensureMuestraTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS muestra_solicitud (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      oportunidad_id     INTEGER,
      proyecto_id        INTEGER,
      estado             TEXT NOT NULL DEFAULT 'solicitada',
      fecha_entrega      TEXT,
      dias_retorno       INTEGER,
      notas              TEXT,
      solicitante_email  TEXT NOT NULL,
      solicitante_nombre TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      updated_by         TEXT,
      CHECK ((oportunidad_id IS NULL) <> (proyecto_id IS NULL))
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_muestra_oportunidad ON muestra_solicitud(oportunidad_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_muestra_proyecto ON muestra_solicitud(proyecto_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS muestra_linea (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id INTEGER NOT NULL,
      orden        INTEGER NOT NULL,
      producto     TEXT NOT NULL,
      producto_id  INTEGER,
      sku          TEXT,
      marca        TEXT,
      color        TEXT,
      talla        TEXT,
      cantidad     REAL NOT NULL,
      comentarios  TEXT
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_muestra_linea_solicitud ON muestra_linea(solicitud_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS muestra_borrado (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id INTEGER NOT NULL,
      fila         TEXT NOT NULL,
      borrado_por  TEXT NOT NULL,
      borrado_en   TEXT NOT NULL
    )`),
  ]);
  tablesReady = true;
}

interface SolicitudRow {
  id: number; oportunidad_id: number | null; proyecto_id: number | null; estado: string;
  fecha_entrega: string | null; dias_retorno: number | null; notas: string | null;
  solicitante_email: string; solicitante_nombre: string | null;
  created_at: string; updated_at: string; updated_by: string | null;
}
interface LineaRow {
  id: number; solicitud_id: number; orden: number; producto: string; producto_id: number | null;
  sku: string | null; marca: string | null; color: string | null; talla: string | null;
  cantidad: number; comentarios: string | null;
}

// Columnas del item ligado que se muestran junto a la solicitud (ids de
// docs/monday-column-map.md). Todas son visibles para Ventas.
const COLS: Record<MuestraPadre, { folio: string; institucion: string; vendedor: string }> = {
  oportunidades: { folio: 'pulse_id_mm0qcq0m', institucion: 'lookup_mm1bs976', vendedor: 'deal_owner' },
  proyectos: { folio: 'pulse_id_mm1a12gy', institucion: 'lookup_mm1dwn6', vendedor: 'multiple_person_mm0hrnqq' },
};

type Col = { id: string; text?: string | null };
type Padre = Pick<MirrorItem, 'item_id' | 'name' | 'columns'>;

function datosDelPadre(padre: MuestraPadre, row: Padre) {
  let cols: Col[] = [];
  try { cols = JSON.parse(row.columns || '[]'); } catch { /* sin columnas */ }
  const texto = (id: string) => cols.find(c => c.id === id)?.text?.trim() || null;
  const c = COLS[padre];
  return { itemNombre: row.name, itemFolio: texto(c.folio), institucion: texto(c.institucion), vendedor: texto(c.vendedor) };
}

function lineaDTO(r: LineaRow): MuestraLineaDTO {
  return {
    id: String(r.id), producto: r.producto, productoId: r.producto_id != null ? String(r.producto_id) : null,
    sku: r.sku ?? '', marca: r.marca ?? '', color: r.color ?? '', talla: r.talla ?? '',
    cantidad: r.cantidad, comentarios: r.comentarios ?? '',
  };
}

function solicitudDTO(r: SolicitudRow, padreRow: Padre, lineas: LineaRow[], editable: boolean): MuestraSolicitudDTO {
  const padre: MuestraPadre = r.oportunidad_id != null ? 'oportunidades' : 'proyectos';
  return {
    id: String(r.id), folio: muestraFolio(r.id), padre, itemId: String(r.oportunidad_id ?? r.proyecto_id),
    ...datosDelPadre(padre, padreRow),
    estado: esMuestraEstado(r.estado) ? r.estado : 'solicitada',
    fechaEntrega: r.fecha_entrega, diasRetorno: r.dias_retorno, fechaRetorno: fechaRetorno(r.fecha_entrega, r.dias_retorno),
    notas: r.notas, solicitante: r.solicitante_nombre || r.solicitante_email, solicitanteEmail: r.solicitante_email,
    createdAt: r.created_at, updatedAt: r.updated_at,
    lineas: lineas.sort((a, b) => a.orden - b.orden).map(lineaDTO), editable,
  };
}

const padreCol = (padre: MuestraPadre) => (padre === 'oportunidades' ? 'oportunidad_id' : 'proyecto_id');

async function lineasDe(env: Env, ids: number[]): Promise<Map<number, LineaRow[]>> {
  const out = new Map<number, LineaRow[]>();
  // De a 90: D1 topa en ~100 binds por consulta.
  for (let i = 0; i < ids.length; i += 90) {
    const lote = ids.slice(i, i + 90);
    const res = await env.DB.prepare(`SELECT * FROM muestra_linea WHERE solicitud_id IN (${lote.map(() => '?').join(',')})`)
      .bind(...lote).all<LineaRow>();
    for (const l of res.results ?? []) {
      const arr = out.get(l.solicitud_id) ?? [];
      arr.push(l);
      out.set(l.solicitud_id, arr);
    }
  }
  return out;
}

function insertLineas(env: Env, solicitudId: number, lineas: MuestraLineaDTO[]) {
  return lineas.map((l, i) => env.DB.prepare(
    `INSERT INTO muestra_linea (solicitud_id, orden, producto, producto_id, sku, marca, color, talla, cantidad, comentarios)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(solicitudId, i, l.producto, l.productoId ? Number(l.productoId) : null,
    l.sku || null, l.marca || null, l.color || null, l.talla || null, l.cantidad, l.comentarios || null));
}

/** Solicitudes de UN item (el tab del drawer). El llamador ya revisó que el
 * viewer puede leer el item y le dice si puede escribirlo. */
export async function muestrasDeItem(env: Env, padre: MuestraPadre, padreRow: Padre, editable: boolean): Promise<MuestraSolicitudDTO[]> {
  await ensureMuestraTables(env);
  const res = await env.DB.prepare(`SELECT * FROM muestra_solicitud WHERE ${padreCol(padre)} = ? ORDER BY id DESC`)
    .bind(padreRow.item_id).all<SolicitudRow>();
  const filas = res.results ?? [];
  const lineas = await lineasDe(env, filas.map(f => f.id));
  return filas.map(f => solicitudDTO(f, padreRow, lineas.get(f.id) ?? [], editable));
}

/** Todas las solicitudes que el viewer puede ver (board "Solicitudes de
 * muestra"): mismo recorte por renglón que Oportunidades/Proyectos. */
export async function listarMuestras(env: Env, viewer: Identity): Promise<MuestraSolicitudDTO[]> {
  await ensureMuestraTables(env);
  const out: MuestraSolicitudDTO[] = [];
  for (const padre of ['oportunidades', 'proyectos'] as const) {
    if (!canReadBoard(padre, viewer.role)) continue;
    const col = padreCol(padre);
    const read = scopeFor(padre, viewer, 'read');
    const own = scopeFor(padre, viewer, 'own');
    // Sin alias en `items`: el WHERE de scopeFor la nombra así.
    const [filas, propias] = await Promise.all([
      env.DB.prepare(
        `SELECT m.*, items.item_id AS p_item_id, items.name AS p_name, items.columns AS p_columns
         FROM muestra_solicitud m JOIN items ON items.board_id = ? AND items.item_id = m.${col}
         WHERE (${read.where})`,
      ).bind(BOARDS[padre].id, ...read.binds).all<SolicitudRow & { p_item_id: number; p_name: string; p_columns: string }>(),
      env.DB.prepare(
        `SELECT m.id FROM muestra_solicitud m JOIN items ON items.board_id = ? AND items.item_id = m.${col}
         WHERE (${own.where})`,
      ).bind(BOARDS[padre].id, ...own.binds).all<{ id: number }>(),
    ]);
    const editables = new Set((propias.results ?? []).map(r => r.id));
    const rows = filas.results ?? [];
    const lineas = await lineasDe(env, rows.map(r => r.id));
    for (const r of rows) {
      out.push(solicitudDTO(r, { item_id: r.p_item_id, name: r.p_name, columns: r.p_columns }, lineas.get(r.id) ?? [], editables.has(r.id)));
    }
  }
  return out.sort((a, b) => Number(b.id) - Number(a.id));
}

export async function crearMuestra(env: Env, padre: MuestraPadre, itemId: number, input: SolicitudValida, viewer: Identity): Promise<number> {
  await ensureMuestraTables(env);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO muestra_solicitud (${padreCol(padre)}, estado, fecha_entrega, dias_retorno, notas,
       solicitante_email, solicitante_nombre, created_at, updated_at, updated_by)
     VALUES (?, 'solicitada', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(itemId, input.fechaEntrega, input.diasRetorno, input.notas,
    viewer.email, viewer.nombre ?? null, now, now, viewer.email).first<{ id: number }>();
  if (!row) throw new MuestraError('no se pudo crear la solicitud', 500);
  try {
    await env.DB.batch(insertLineas(env, row.id, input.lineas));
  } catch (err) {
    // Sin renglones no se deja una solicitud vacía a medias.
    await env.DB.prepare('DELETE FROM muestra_solicitud WHERE id = ?').bind(row.id).run().catch(() => {});
    throw err;
  }
  return row.id;
}

/** La solicitud y a qué item cuelga — para que la ruta revise el permiso
 * sobre ESE item antes de tocarla. */
export async function padreDeMuestra(env: Env, id: number): Promise<{ padre: MuestraPadre; itemId: number } | null> {
  await ensureMuestraTables(env);
  const r = await env.DB.prepare('SELECT oportunidad_id, proyecto_id FROM muestra_solicitud WHERE id = ?').bind(id)
    .first<{ oportunidad_id: number | null; proyecto_id: number | null }>();
  if (!r) return null;
  return r.oportunidad_id != null ? { padre: 'oportunidades', itemId: r.oportunidad_id } : { padre: 'proyectos', itemId: r.proyecto_id! };
}

/** Reemplaza encabezado y renglones completos (el modal manda todo). Los
 * renglones viejos se respaldan antes, por si alguien borra de más. */
export async function editarMuestra(env: Env, id: number, input: SolicitudValida, viewer: Identity): Promise<void> {
  await respaldar(env, id, viewer, 'edicion');
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE muestra_solicitud SET fecha_entrega = ?, dias_retorno = ?, notas = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .bind(input.fechaEntrega, input.diasRetorno, input.notas, now, viewer.email, id),
    env.DB.prepare('DELETE FROM muestra_linea WHERE solicitud_id = ?').bind(id),
    ...insertLineas(env, id, input.lineas),
  ]);
}

export async function cambiarEstadoMuestra(env: Env, id: number, estado: MuestraEstado, viewer: Identity): Promise<void> {
  await env.DB.prepare('UPDATE muestra_solicitud SET estado = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(estado, new Date().toISOString(), viewer.email, id).run();
}

async function respaldar(env: Env, id: number, viewer: Identity, motivo: 'edicion' | 'borrado'): Promise<void> {
  const fila = await env.DB.prepare('SELECT * FROM muestra_solicitud WHERE id = ?').bind(id).first<SolicitudRow>();
  if (!fila) throw new MuestraError('solicitud no encontrada', 404);
  const lineas = await env.DB.prepare('SELECT * FROM muestra_linea WHERE solicitud_id = ? ORDER BY orden').bind(id).all<LineaRow>();
  await env.DB.prepare('INSERT INTO muestra_borrado (solicitud_id, fila, borrado_por, borrado_en) VALUES (?,?,?,?)')
    .bind(id, JSON.stringify({ motivo, solicitud: fila, lineas: lineas.results ?? [] }), viewer.email, new Date().toISOString()).run();
}

export async function borrarMuestra(env: Env, id: number, viewer: Identity): Promise<void> {
  await respaldar(env, id, viewer, 'borrado');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM muestra_linea WHERE solicitud_id = ?').bind(id),
    env.DB.prepare('DELETE FROM muestra_solicitud WHERE id = ?').bind(id),
  ]);
}
