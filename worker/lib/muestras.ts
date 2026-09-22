// worker/lib/muestras.ts — Solicitudes de MUESTRAS (Efraín, 2026-09-21). El
// contrato y la validación pura viven en shared/muestras.ts; aquí solo D1.
//
// 100 % nativo: nada de esto toca Monday. Cada solicitud cuelga de UNA
// Oportunidad o de UN Proyecto (CHECK en la tabla: exactamente uno), por su
// item id del espejo — igual que las OC, una muestra suelta no existe.
//
// Permisos: quien puede VER el item ligado (dal.ts, scope 'read') crea, edita,
// envía y versiona sus muestras — vendedor, líder/auxiliar de zona y Compras
// por igual (Efraín, 2026-09-22: "todos pueden escribir incluyendo compras").
// Como los comentarios del item, que también van con scope de lectura: nada de
// esto escribe columnas de Monday. Mover el estado sigue siendo de Compras/admin.
// Lo revisan las RUTAS (worker/routes/muestras.ts) con getItem; la lista
// general (`listarMuestras`) recorta igual con JOIN a `items` + scopeFor.
//
// El borrado es un DELETE de D1 con respaldo del renglón completo (con sus
// líneas) en `muestra_borrado` ANTES de borrar — mismo espíritu que
// `item_borrado`, sin pasar por itemBorrado.ts porque no es un item de Monday.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { canReadBoard } from '../../shared/visibility';
import { scopeFor } from './dal';
import { postUpdate } from './nativeUpdates';
import { emitNotification, personIdsFromColumns, resolveRecipients } from './notify';
import { PORTAL_SIGNATURE } from './updateNotify';
import {
  fechaRetorno, muestraFolio, esMuestraEstado, puedeGestionarMuestras, versionVisiblePorGrupo, MUESTRA_ESTADO_LABEL,
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
      estado             TEXT NOT NULL DEFAULT 'borrador',
      fecha_entrega      TEXT,
      dias_retorno       INTEGER,
      notas              TEXT,
      solicitante_email  TEXT NOT NULL,
      solicitante_nombre TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      updated_by         TEXT,
      enviada_at         TEXT,
      enviada_por        TEXT,
      grupo_id           INTEGER,
      version            INTEGER NOT NULL DEFAULT 1,
      CHECK ((oportunidad_id IS NULL) <> (proyecto_id IS NULL))
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_muestra_oportunidad ON muestra_solicitud(oportunidad_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_muestra_proyecto ON muestra_solicitud(proyecto_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_muestra_grupo ON muestra_solicitud(grupo_id)'),
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
  enviada_at: string | null; enviada_por: string | null;
  grupo_id: number | null; version: number;
}

const grupoDe = (r: Pick<SolicitudRow, 'id' | 'grupo_id'>) => r.grupo_id ?? r.id;

/** Por grupo: la versión más nueva, la más nueva YA ENVIADA (la que gestiona
 * Compras) y cuántas hay. Sale de las filas ya leídas: todas las versiones de
 * un grupo cuelgan del mismo item, así que vienen juntas. */
interface InfoGrupo { max: number; maxEnviada: number | null; total: number }
function infoGrupos(rows: SolicitudRow[]): Map<number, InfoGrupo> {
  const out = new Map<number, InfoGrupo>();
  for (const r of rows) {
    const g = out.get(grupoDe(r)) ?? { max: 0, maxEnviada: null, total: 0 };
    g.max = Math.max(g.max, r.version);
    if (r.estado !== 'borrador') g.maxEnviada = Math.max(g.maxEnviada ?? 0, r.version);
    g.total++;
    out.set(grupoDe(r), g);
  }
  return out;
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

/** `escribe` = el viewer puede ver el item ligado. Editar, borrar y enviar
 * solo mientras es borrador; ya enviada, la mueve Compras. */
function solicitudDTO(r: SolicitudRow, padreRow: Padre, lineas: LineaRow[], escribe: boolean, viewer: Identity, grupo: InfoGrupo): MuestraSolicitudDTO {
  const padre: MuestraPadre = r.oportunidad_id != null ? 'oportunidades' : 'proyectos';
  const estado: MuestraEstado = esMuestraEstado(r.estado) ? r.estado : 'borrador';
  const ultima = r.version === grupo.max;
  return {
    id: String(r.id), folio: muestraFolio(grupoDe(r)), grupoId: String(grupoDe(r)), version: r.version,
    ultima, versiones: grupo.total, padre, itemId: String(r.oportunidad_id ?? r.proyecto_id),
    ...datosDelPadre(padre, padreRow),
    estado,
    fechaEntrega: r.fecha_entrega, diasRetorno: r.dias_retorno, fechaRetorno: fechaRetorno(r.fecha_entrega, r.dias_retorno),
    notas: r.notas, solicitante: r.solicitante_nombre || r.solicitante_email, solicitanteEmail: r.solicitante_email,
    createdAt: r.created_at, updatedAt: r.updated_at, enviadaAt: r.enviada_at, enviadaPor: r.enviada_por,
    lineas: lineas.sort((a, b) => a.orden - b.orden).map(lineaDTO),
    editable: escribe && estado === 'borrador',
    gestionable: puedeGestionarMuestras(viewer.role) && estado !== 'borrador' && r.version === grupo.maxEnviada,
    puedeNuevaVersion: escribe && estado !== 'borrador' && ultima,
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
export async function muestrasDeItem(env: Env, padre: MuestraPadre, padreRow: Padre, escribe: boolean, viewer: Identity): Promise<MuestraSolicitudDTO[]> {
  await ensureMuestraTables(env);
  const res = await env.DB.prepare(`SELECT * FROM muestra_solicitud WHERE ${padreCol(padre)} = ? ORDER BY id DESC`)
    .bind(padreRow.item_id).all<SolicitudRow>();
  const filas = res.results ?? [];
  const [lineas, grupos] = [await lineasDe(env, filas.map(f => f.id)), infoGrupos(filas)];
  return filas.map(f => solicitudDTO(f, padreRow, lineas.get(f.id) ?? [], escribe, viewer, grupos.get(grupoDe(f))!));
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
    // Sin alias en `items`: el WHERE de scopeFor la nombra así.
    const filas = await env.DB.prepare(
      `SELECT m.*, items.item_id AS p_item_id, items.name AS p_name, items.columns AS p_columns
       FROM muestra_solicitud m JOIN items ON items.board_id = ? AND items.item_id = m.${col}
       WHERE (${read.where})`,
    ).bind(BOARDS[padre].id, ...read.binds).all<SolicitudRow & { p_item_id: number; p_name: string; p_columns: string }>();
    const rows = filas.results ?? [];
    const grupos = infoGrupos(rows);
    const lineas = await lineasDe(env, rows.map(r => r.id));
    const dtos = rows.map(r => solicitudDTO(r, { item_id: r.p_item_id, name: r.p_name, columns: r.p_columns }, lineas.get(r.id) ?? [], true, viewer, grupos.get(grupoDe(r))!));
    // Un renglón por grupo: la versión más nueva que le toca ver. Un borrador
    // solo aparece en el board de quien lo armó — Compras sigue viendo la
    // enviada anterior hasta que la nueva se envíe.
    out.push(...versionVisiblePorGrupo(dtos, viewer.email));
  }
  return out.sort((a, b) => Number(b.grupoId) - Number(a.grupoId));
}

export async function crearMuestra(env: Env, padre: MuestraPadre, itemId: number, input: SolicitudValida, viewer: Identity): Promise<number> {
  await ensureMuestraTables(env);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO muestra_solicitud (${padreCol(padre)}, estado, fecha_entrega, dias_retorno, notas,
       solicitante_email, solicitante_nombre, created_at, updated_at, updated_by)
     VALUES (?, 'borrador', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(itemId, input.fechaEntrega, input.diasRetorno, input.notas,
    viewer.email, viewer.nombre ?? null, now, now, viewer.email).first<{ id: number }>();
  if (!row) throw new MuestraError('no se pudo crear la solicitud', 500);
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE muestra_solicitud SET grupo_id = id WHERE id = ?').bind(row.id),
      ...insertLineas(env, row.id, input.lineas),
    ]);
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
async function estadoDe(env: Env, id: number): Promise<MuestraEstado> {
  const r = await env.DB.prepare('SELECT estado FROM muestra_solicitud WHERE id = ?').bind(id).first<{ estado: string }>();
  if (!r) throw new MuestraError('solicitud no encontrada', 404);
  return esMuestraEstado(r.estado) ? r.estado : 'borrador';
}

async function soloBorrador(env: Env, id: number, que: string): Promise<void> {
  if ((await estadoDe(env, id)) !== 'borrador') throw new MuestraError(`ya se envió a Compras: no se puede ${que}`, 409);
}

export async function editarMuestra(env: Env, id: number, input: SolicitudValida, viewer: Identity): Promise<void> {
  await soloBorrador(env, id, 'editar');
  await respaldar(env, id, viewer, 'edicion');
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE muestra_solicitud SET fecha_entrega = ?, dias_retorno = ?, notas = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .bind(input.fechaEntrega, input.diasRetorno, input.notas, now, viewer.email, id),
    env.DB.prepare('DELETE FROM muestra_linea WHERE solicitud_id = ?').bind(id),
    ...insertLineas(env, id, input.lineas),
  ]);
}

const nombreDe = (v: Identity) => v.nombre || v.email;

/** "MUE-3" o "MUE-3 V2" para avisos y actualizaciones. */
async function etiquetaDe(env: Env, id: number): Promise<string> {
  const r = await env.DB.prepare('SELECT grupo_id, version FROM muestra_solicitud WHERE id = ?').bind(id)
    .first<{ grupo_id: number | null; version: number }>();
  const folio = muestraFolio(r?.grupo_id ?? id);
  return r && r.version > 1 ? `${folio} V${r.version}` : folio;
}

/** "+ Nueva versión" (como en la cotización, Efraín 2026-09-22): duplica TAL
 * CUAL una solicitud ya enviada —la más nueva de su grupo— como V{n+1} en
 * borrador. La anterior queda archivada con su estado; Compras la sigue viendo
 * hasta que la nueva se envíe. Solicitante de la nueva = quien la saca. */
export async function nuevaVersionMuestra(env: Env, id: number, viewer: Identity): Promise<number> {
  await ensureMuestraTables(env);
  const fila = await env.DB.prepare('SELECT * FROM muestra_solicitud WHERE id = ?').bind(id).first<SolicitudRow>();
  if (!fila) throw new MuestraError('solicitud no encontrada', 404);
  if (fila.estado === 'borrador') throw new MuestraError('todavía es borrador: edítala y envíala', 409);
  const grupo = grupoDe(fila);
  const max = await env.DB.prepare('SELECT MAX(version) AS v FROM muestra_solicitud WHERE COALESCE(grupo_id, id) = ?').bind(grupo).first<{ v: number }>();
  if ((max?.v ?? fila.version) !== fila.version) throw new MuestraError('ya hay una versión más nueva de esta solicitud', 409);
  const now = new Date().toISOString();
  const nueva = await env.DB.prepare(
    `INSERT INTO muestra_solicitud (oportunidad_id, proyecto_id, estado, fecha_entrega, dias_retorno, notas,
       solicitante_email, solicitante_nombre, created_at, updated_at, updated_by, grupo_id, version)
     VALUES (?, ?, 'borrador', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(fila.oportunidad_id, fila.proyecto_id, fila.fecha_entrega, fila.dias_retorno, fila.notas,
    viewer.email, viewer.nombre ?? null, now, now, viewer.email, grupo, fila.version + 1).first<{ id: number }>();
  if (!nueva) throw new MuestraError('no se pudo crear la versión', 500);
  const lineas = await env.DB.prepare('SELECT * FROM muestra_linea WHERE solicitud_id = ? ORDER BY orden').bind(id).all<LineaRow>();
  try {
    const copia = (lineas.results ?? []).map(lineaDTO);
    if (copia.length) await env.DB.batch(insertLineas(env, nueva.id, copia));
  } catch (err) {
    await env.DB.prepare('DELETE FROM muestra_solicitud WHERE id = ?').bind(nueva.id).run().catch(() => {});
    throw err;
  }
  return nueva.id;
}

/** Compras la mueve entre enviada/validada/entregada desde el board. Al
 * solicitante le llega un aviso en Actualizaciones (sin WhatsApp). */
export async function cambiarEstadoMuestra(env: Env, id: number, estado: MuestraEstado, viewer: Identity): Promise<void> {
  const previo = await estadoDe(env, id);
  if (previo === 'borrador') throw new MuestraError('todavía no se envía a Compras', 409);
  const r = await env.DB.prepare(
    `SELECT m.version, (SELECT MAX(o.version) FROM muestra_solicitud o
       WHERE COALESCE(o.grupo_id, o.id) = COALESCE(m.grupo_id, m.id) AND o.estado <> 'borrador') AS max_enviada
     FROM muestra_solicitud m WHERE m.id = ?`,
  ).bind(id).first<{ version: number; max_enviada: number }>();
  if (r && r.version !== r.max_enviada) throw new MuestraError('hay una versión más nueva de esta solicitud: cambia el estado en esa', 409);
  if (previo === estado) return;
  await env.DB.prepare('UPDATE muestra_solicitud SET estado = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(estado, new Date().toISOString(), viewer.email, id).run();
  const s = await env.DB.prepare('SELECT solicitante_email FROM muestra_solicitud WHERE id = ?').bind(id).first<{ solicitante_email: string }>();
  if (s && s.solicitante_email !== viewer.email) {
    await emitNotification(env, {
      recipientEmail: s.solicitante_email, severity: 'actualizacion', kind: 'muestra_estado',
      title: `${await etiquetaDe(env, id)}: ${MUESTRA_ESTADO_LABEL[estado]}`,
      body: `${nombreDe(viewer)} cambió tu solicitud de muestras a «${MUESTRA_ESTADO_LABEL[estado]}».`,
      boardKey: 'muestras', itemId: id, actor: viewer.email,
      dedupeKey: `muestra_estado:${id}:${estado}:${s.solicitante_email}`,
    });
  }
}

/** Texto de la actualización que se publica en el item al enviar. Pura. */
export function textoEnvio(folio: string, quien: string, s: Pick<MuestraSolicitudDTO, 'fechaEntrega' | 'diasRetorno' | 'notas'>, lineas: MuestraLineaDTO[]): string {
  const renglones = lineas.map(l => {
    const detalle = [l.sku, l.marca, l.color, l.talla && `talla ${l.talla}`].filter(Boolean).join(' · ');
    return `• ${l.cantidad} × ${l.producto}${detalle ? ` (${detalle})` : ''}${l.comentarios ? ` — ${l.comentarios}` : ''}`;
  });
  const fechas = [s.fechaEntrega && `entrega ${s.fechaEntrega}`, s.diasRetorno != null && `retorno ${s.diasRetorno} días`].filter(Boolean).join(' · ');
  return [
    `📦 Solicitud de muestras ${folio} enviada a Compras por ${quien}:`,
    ...renglones,
    ...(fechas ? [`Fechas: ${fechas}`] : []),
    ...(s.notas ? [`Notas: ${s.notas}`] : []),
    PORTAL_SIGNATURE,
  ].join('\n');
}

/** El botón "Enviar a Compras" del tab: borrador → enviada, publica la
 * actualización en el item y avisa a Compras (notificación IMPORTANTE, que
 * también sale por WhatsApp — worker/wa/notify.ts). A quién: el Responsable
 * compras del item; si no tiene, a todo Compras. */
export async function enviarMuestra(env: Env, id: number, padre: MuestraPadre, padreRow: Padre & { vendedor_ids?: string }, viewer: Identity): Promise<void> {
  await soloBorrador(env, id, 'enviar otra vez');
  const now = new Date().toISOString();
  // Condicionado a 'borrador': dos clics seguidos no mandan dos avisos.
  const res = await env.DB.prepare(
    `UPDATE muestra_solicitud SET estado = 'enviada', enviada_at = ?, enviada_por = ?, updated_at = ?, updated_by = ?
     WHERE id = ? AND estado = 'borrador'`,
  ).bind(now, viewer.email, now, viewer.email, id).run();
  if (!res.meta.changes) throw new MuestraError('ya se envió a Compras', 409);

  const folio = await etiquetaDe(env, id);
  const [fila, lineasRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM muestra_solicitud WHERE id = ?').bind(id).first<SolicitudRow>(),
    env.DB.prepare('SELECT * FROM muestra_linea WHERE solicitud_id = ? ORDER BY orden').bind(id).all<LineaRow>(),
  ]);
  const lineas = (lineasRes.results ?? []).map(lineaDTO);
  const quien = nombreDe(viewer);

  // Best-effort las dos: la solicitud ya quedó enviada; un fallo de Monday o
  // de WhatsApp no la regresa a borrador.
  try {
    await postUpdate(env, BOARDS[padre].id, padreRow.item_id,
      textoEnvio(folio, quien, { fechaEntrega: fila?.fecha_entrega ?? null, diasRetorno: fila?.dias_retorno ?? null, notas: fila?.notas ?? null }, lineas),
      [], { email: viewer.email, nombre: viewer.nombre });
  } catch (err) {
    console.log('[muestras] actualización no publicada: ' + String(err));
  }

  const comprasCol = BOARDS[padre].comprasCol;
  let vendedorIds: number[] = [];
  try { vendedorIds = JSON.parse(padreRow.vendedor_ids || '[]'); } catch { /* sin vendedor */ }
  const ctx = { actorEmail: viewer.email, vendedorIds, itemId: padreRow.item_id };
  let destinatarios = comprasCol
    ? await resolveRecipients(env, ['comprador'], { ...ctx, compradorIds: personIdsFromColumns(padreRow.columns, comprasCol) })
    : [];
  if (destinatarios.length === 0) destinatarios = await resolveRecipients(env, ['role:compras'], ctx);
  const piezas = lineas.reduce((n, l) => n + l.cantidad, 0);
  for (const email of destinatarios) {
    await emitNotification(env, {
      recipientEmail: email, severity: 'importante', kind: 'muestra_enviada',
      title: `Solicitud de muestras ${folio} — ${padreRow.name}`,
      body: `${quien} pide ${lineas.length} ${lineas.length === 1 ? 'producto' : 'productos'} (${piezas} ${piezas === 1 ? 'pieza' : 'piezas'}).`,
      boardKey: 'muestras', itemId: id, actor: viewer.email,
      dedupeKey: `muestra_enviada:${id}:${email}`,
    });
  }
}

async function respaldar(env: Env, id: number, viewer: Identity, motivo: 'edicion' | 'borrado'): Promise<void> {
  const fila = await env.DB.prepare('SELECT * FROM muestra_solicitud WHERE id = ?').bind(id).first<SolicitudRow>();
  if (!fila) throw new MuestraError('solicitud no encontrada', 404);
  const lineas = await env.DB.prepare('SELECT * FROM muestra_linea WHERE solicitud_id = ? ORDER BY orden').bind(id).all<LineaRow>();
  await env.DB.prepare('INSERT INTO muestra_borrado (solicitud_id, fila, borrado_por, borrado_en) VALUES (?,?,?,?)')
    .bind(id, JSON.stringify({ motivo, solicitud: fila, lineas: lineas.results ?? [] }), viewer.email, new Date().toISOString()).run();
}

export async function borrarMuestra(env: Env, id: number, viewer: Identity): Promise<void> {
  await soloBorrador(env, id, 'borrar');
  await respaldar(env, id, viewer, 'borrado');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM muestra_linea WHERE solicitud_id = ?').bind(id),
    env.DB.prepare('DELETE FROM muestra_solicitud WHERE id = ?').bind(id),
  ]);
}
