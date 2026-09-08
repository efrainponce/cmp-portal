// worker/lib/estadoCuenta.ts — Estado de cuenta del Proyecto: CONCEPTOS (la
// factura, el compromiso) con sus COBROS/PAGOS (abonos), que llegan en partes
// y cada uno con SU fecha. Portado de janing-portal (Efraín, 2026-09-08:
// "una nueva board en proyectos que se llama ESTADO DE CUENTA que retoma lo
// que hicimos en janing"). La aritmética compartida vive en
// shared/estadoCuenta.ts; aquí solo D1 + R2.
//
// 100 % nativo: nada de esto toca Monday. `proyecto_id` es el item id del
// Proyecto en el mirror (o el id ≥ 9e11 de un proyecto nativo de Zona
// Efrain) — la fila del proyecto sigue viviendo donde vivía, esto cuelga de
// ella por id. Por eso el borrado aquí NO pasa por itemBorrado.ts (eso es
// para items de Monday): es un DELETE de D1 con su respaldo en
// `estado_cuenta_borrado` ANTES de borrar, mismo espíritu que `item_borrado`.
//
// Quién puede: la whitelist por correo de shared/visibility.ts
// (puedeVerEstadoCuenta) — la revisan las RUTAS (worker/routes/estadoCuenta.ts),
// junto con el scoping del proyecto vía dal.getItem. Aquí se asume autorizado.
//
// Los archivos (la factura del concepto, el comprobante de cada abono) van a
// R2 con key único por fila y quedan referenciados en la misma fila: un
// archivo por concepto y uno por abono, que es lo que se necesita (la factura
// y su CFDI se suben como PDF; si hacen falta dos, el segundo va en el abono).
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { EstadoCuentaAbonoDTO, EstadoCuentaArchivoDTO, EstadoCuentaConceptoDTO, EstadoCuentaTipo } from '../../shared/dto';
import { hoyISO, resumenConcepto, resumenEstadoCuenta, type ResumenEstadoCuenta } from '../../shared/estadoCuenta';
import { scopeFor } from './dal';
import { BOARDS } from '../../shared/boards';
import { contentTypeFor } from './mime';

export class EstadoCuentaError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Tope del archivo adjunto. Una factura en PDF con su XML pesa cientos de
 * KB; 10 MB deja pasar un comprobante escaneado a alta resolución sin abrir
 * la puerta a subir cualquier cosa. */
export const ARCHIVO_MAX_BYTES = 10 * 1024 * 1024;

/** Lo que se acepta como factura/comprobante. XML por el CFDI; el resto son
 * PDFs y fotos/escaneos. Se decide por la EXTENSIÓN del nombre (no por el
 * Content-Type que mandó el navegador, que para un XML llega vacío o como
 * text/xml según el sistema). */
const EXTENSIONES_PERMITIDAS = new Set(['pdf', 'xml', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

let tablesReady = false;

export async function ensureEstadoCuentaTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS estado_cuenta (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id    INTEGER NOT NULL,
      tipo           TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
      total          REAL NOT NULL DEFAULT 0,
      fecha          TEXT,
      concepto       TEXT,
      archivo_key    TEXT,
      archivo_nombre TEXT,
      archivo_tipo   TEXT,
      archivo_bytes  INTEGER,
      created_by     TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_estado_cuenta_proyecto ON estado_cuenta(proyecto_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS estado_cuenta_abono (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      concepto_id    INTEGER NOT NULL,
      proyecto_id    INTEGER NOT NULL,
      monto          REAL NOT NULL DEFAULT 0,
      fecha          TEXT,
      fecha_estimada TEXT,
      nota           TEXT,
      archivo_key    TEXT,
      archivo_nombre TEXT,
      archivo_tipo   TEXT,
      archivo_bytes  INTEGER,
      created_by     TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_estado_cuenta_abono_concepto ON estado_cuenta_abono(concepto_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_estado_cuenta_abono_proyecto ON estado_cuenta_abono(proyecto_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS estado_cuenta_borrado (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tabla       TEXT NOT NULL,
      row_id      INTEGER NOT NULL,
      proyecto_id INTEGER NOT NULL,
      fila        TEXT NOT NULL,
      borrado_por TEXT NOT NULL,
      borrado_en  TEXT NOT NULL
    )`),
  ]);
  tablesReady = true;
}

interface ArchivoCols {
  archivo_key: string | null; archivo_nombre: string | null; archivo_tipo: string | null; archivo_bytes: number | null;
}
interface ConceptoRow extends ArchivoCols {
  id: number; proyecto_id: number; tipo: string; total: number; fecha: string | null;
  concepto: string | null; created_by: string; created_at: string; updated_at: string;
}
interface AbonoRow extends ArchivoCols {
  id: number; concepto_id: number; proyecto_id: number; monto: number; fecha: string | null; fecha_estimada: string | null;
  nota: string | null; created_by: string; created_at: string; updated_at: string;
}

function archivoDTO(r: ArchivoCols): EstadoCuentaArchivoDTO | null {
  if (!r.archivo_key) return null;
  return { nombre: r.archivo_nombre ?? 'archivo', contentType: r.archivo_tipo ?? 'application/octet-stream', bytes: r.archivo_bytes ?? 0 };
}

function validarMonto(n: number, que: string): void {
  if (!Number.isFinite(n) || n <= 0) throw new EstadoCuentaError(`${que} inválido`);
}

/** 'YYYY-MM-DD' o nada. Una fecha con otra forma se rechaza: la aritmética
 * compara strings ISO (shared/estadoCuenta.ts) y "8/9/2026" ordenaría mal. */
function validarFecha(v: string | null | undefined, que: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new EstadoCuentaError(`${que} inválida (se espera AAAA-MM-DD)`);
  return v;
}

// ── Conceptos ───────────────────────────────────────────────────────────────

export interface AddConceptoInput {
  tipo: EstadoCuentaTipo; total: number; fecha?: string; concepto?: string;
  /** Cobro ya recibido por el total (una sola exhibición). */
  abonoInicial?: number;
  /** Programa el total para esa fecha, si no se marcó como ya pagado. */
  fechaEstimada?: string;
}

export async function addConcepto(env: Env, proyectoId: number, input: AddConceptoInput, viewer: Identity): Promise<{ ok: true; id: string }> {
  if (input.tipo !== 'ingreso' && input.tipo !== 'egreso') throw new EstadoCuentaError('tipo inválido');
  validarMonto(input.total, 'monto');
  if (input.abonoInicial !== undefined) validarMonto(input.abonoInicial, 'abono');
  const fecha = validarFecha(input.fecha, 'fecha');
  const fechaEstimada = validarFecha(input.fechaEstimada, 'fecha estimada');
  await ensureEstadoCuentaTables(env);

  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO estado_cuenta (proyecto_id, tipo, total, fecha, concepto, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
  ).bind(proyectoId, input.tipo, input.total, fecha, (input.concepto ?? '').trim() || null, viewer.email, now, now)
    .first<{ id: number }>();
  if (!row) throw new EstadoCuentaError('no se pudo agregar el concepto', 500);

  // El cobro inicial va DESPUÉS del concepto y en su propio statement: si
  // fallara, queda el concepto en pendiente (recuperable capturando el cobro
  // a mano) y no un cobro huérfano.
  if (input.abonoInicial !== undefined) {
    await insertarAbono(env, proyectoId, row.id, { monto: input.abonoInicial, fecha: fecha ?? hoyISO() }, viewer, now);
  } else if (fechaEstimada) {
    // La factura queda capturada CON su provisión: un cobro programado por el
    // total. Si luego se cobra en partes, se parte ese renglón.
    await insertarAbono(env, proyectoId, row.id, { monto: input.total, fechaEstimada }, viewer, now);
  }
  return { ok: true, id: String(row.id) };
}

/** Respaldo del renglón (y de sus hijos) en `estado_cuenta_borrado` ANTES de
 * borrar — como `item_borrado`: lo que no puede perderse es el dato. Los
 * bytes en R2 no se tocan: el key queda en el respaldo por si hay que
 * recuperar el archivo. */
async function respaldar(env: Env, tabla: 'estado_cuenta' | 'estado_cuenta_abono', fila: ConceptoRow | AbonoRow, extra: unknown, viewer: Identity): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO estado_cuenta_borrado (tabla, row_id, proyecto_id, fila, borrado_por, borrado_en) VALUES (?,?,?,?,?,?)',
  ).bind(tabla, fila.id, fila.proyecto_id, JSON.stringify({ fila, extra }), viewer.email, new Date().toISOString()).run();
}

export async function removeConcepto(env: Env, proyectoId: number, conceptoId: number, viewer: Identity): Promise<void> {
  await ensureEstadoCuentaTables(env);
  const fila = await env.DB.prepare('SELECT * FROM estado_cuenta WHERE id = ? AND proyecto_id = ?')
    .bind(conceptoId, proyectoId).first<ConceptoRow>();
  if (!fila) throw new EstadoCuentaError('concepto no encontrado', 404);
  const abonos = await env.DB.prepare('SELECT * FROM estado_cuenta_abono WHERE concepto_id = ? AND proyecto_id = ?')
    .bind(conceptoId, proyectoId).all<AbonoRow>();
  await respaldar(env, 'estado_cuenta', fila, { abonos: abonos.results ?? [] }, viewer);
  // La guardia va por proyecto en los DOS deletes: de a un concepto, nunca a
  // partir de una lista.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM estado_cuenta_abono WHERE concepto_id = ? AND proyecto_id = ?').bind(conceptoId, proyectoId),
    env.DB.prepare('DELETE FROM estado_cuenta WHERE id = ? AND proyecto_id = ?').bind(conceptoId, proyectoId),
  ]);
}

// ── Abonos (cobros / pagos) ─────────────────────────────────────────────────

/** Un cobro/pago: con `fecha` ya entró; con `fechaEstimada` está programado. */
export interface AddAbonoInput { monto: number; fecha?: string | null; fechaEstimada?: string | null; nota?: string }

async function insertarAbono(env: Env, proyectoId: number, conceptoId: number, input: AddAbonoInput, viewer: Identity, now: string): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO estado_cuenta_abono (concepto_id, proyecto_id, monto, fecha, fecha_estimada, nota, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
  ).bind(conceptoId, proyectoId, input.monto, input.fecha ?? null, input.fechaEstimada ?? null, (input.nota ?? '').trim() || null, viewer.email, now, now)
    .first<{ id: number }>();
  if (!row) throw new EstadoCuentaError('no se pudo agregar el cobro', 500);
  return row.id;
}

/** Registra un cobro/pago (recibido o programado) contra un concepto. Uno que
 * se pasa del saldo NO se rechaza: pasa de verdad (un cliente que paga de más,
 * una nota de crédito que todavía no se captura) y bloquearlo dejaría al
 * usuario sin dónde asentar dinero que ya se movió — se marca como sobrepago
 * en la tarjeta y en el PDF (shared/estadoCuenta.ts). */
export async function addAbono(env: Env, proyectoId: number, conceptoId: number, input: AddAbonoInput, viewer: Identity): Promise<{ ok: true; id: string }> {
  validarMonto(input.monto, 'monto');
  const fecha = validarFecha(input.fecha, 'fecha');
  const fechaEstimada = validarFecha(input.fechaEstimada, 'fecha estimada');
  // Sin ninguna de las dos fechas el renglón no se puede ubicar en el tiempo:
  // no entraría a la gráfica mensual ni contaría como provisión.
  if (!fecha && !fechaEstimada) throw new EstadoCuentaError('falta la fecha del cobro');
  await ensureEstadoCuentaTables(env);
  const concepto = await env.DB.prepare('SELECT 1 FROM estado_cuenta WHERE id = ? AND proyecto_id = ?')
    .bind(conceptoId, proyectoId).first();
  if (!concepto) throw new EstadoCuentaError('concepto no encontrado', 404);
  const id = await insertarAbono(env, proyectoId, conceptoId, { ...input, fecha, fechaEstimada }, viewer, new Date().toISOString());
  return { ok: true, id: String(id) };
}

export interface UpdateAbonoInput { monto?: number; fecha?: string | null; fechaEstimada?: string | null; nota?: string }

/** Sobre todo, marcar un programado como ya cobrado: llega `fecha` (y el
 * monto, si entró distinto de lo acordado). */
export async function updateAbono(
  env: Env, proyectoId: number, conceptoId: number, abonoId: number, input: UpdateAbonoInput, viewer: Identity,
): Promise<{ ok: true }> {
  if (input.monto !== undefined) validarMonto(input.monto, 'monto');
  await ensureEstadoCuentaTables(env);
  const fila = await env.DB.prepare(
    'SELECT * FROM estado_cuenta_abono WHERE id = ? AND concepto_id = ? AND proyecto_id = ?',
  ).bind(abonoId, conceptoId, proyectoId).first<AbonoRow>();
  if (!fila) throw new EstadoCuentaError('cobro no encontrado', 404);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.monto !== undefined) { sets.push('monto = ?'); binds.push(input.monto); }
  if (input.fecha !== undefined) { sets.push('fecha = ?'); binds.push(validarFecha(input.fecha, 'fecha')); }
  if (input.fechaEstimada !== undefined) { sets.push('fecha_estimada = ?'); binds.push(validarFecha(input.fechaEstimada, 'fecha estimada')); }
  if (input.nota !== undefined) { sets.push('nota = ?'); binds.push(input.nota.trim() || null); }
  if (sets.length === 0) return { ok: true };

  const fechaFinal = input.fecha !== undefined ? input.fecha : fila.fecha;
  const estimadaFinal = input.fechaEstimada !== undefined ? input.fechaEstimada : fila.fecha_estimada;
  if (!fechaFinal && !estimadaFinal) throw new EstadoCuentaError('falta la fecha del cobro');

  // El "antes" queda en el respaldo aunque no sea un borrado: mover un cobro
  // de mes cambia la provisión de dos meses a la vez y conviene poder verlo.
  await respaldar(env, 'estado_cuenta_abono', fila, { edicion: input, viewer: viewer.email }, viewer);
  await env.DB.prepare(`UPDATE estado_cuenta_abono SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...(binds as never[]), new Date().toISOString(), abonoId).run();
  return { ok: true };
}

export async function removeAbono(env: Env, proyectoId: number, conceptoId: number, abonoId: number, viewer: Identity): Promise<void> {
  await ensureEstadoCuentaTables(env);
  // La guardia va por concepto Y proyecto: el abono 7 del concepto 3 no se
  // borra pasando el concepto 4, aunque ambos sean del mismo Proyecto.
  const fila = await env.DB.prepare('SELECT * FROM estado_cuenta_abono WHERE id = ? AND concepto_id = ? AND proyecto_id = ?')
    .bind(abonoId, conceptoId, proyectoId).first<AbonoRow>();
  if (!fila) throw new EstadoCuentaError('cobro no encontrado', 404);
  await respaldar(env, 'estado_cuenta_abono', fila, null, viewer);
  await env.DB.prepare('DELETE FROM estado_cuenta_abono WHERE id = ? AND concepto_id = ? AND proyecto_id = ?')
    .bind(abonoId, conceptoId, proyectoId).run();
}

// ── Lectura ─────────────────────────────────────────────────────────────────

export async function listEstadoCuenta(env: Env, proyectoId: number): Promise<EstadoCuentaConceptoDTO[]> {
  await ensureEstadoCuentaTables(env);
  // Dos consultas planas en vez de un JOIN: agrupar en JS evita repetir la
  // fila del concepto por cada abono y deja el orden de cada lista explícito.
  const [conceptos, abonos] = await env.DB.batch([
    env.DB.prepare(
      `SELECT * FROM estado_cuenta WHERE proyecto_id = ?
       ORDER BY COALESCE(fecha, created_at) DESC, id DESC`,
    ).bind(proyectoId),
    // Por fecha efectiva: los cobros ya recibidos y los programados van en una
    // sola línea de tiempo, que es como se leen en la tarjeta.
    env.DB.prepare(
      `SELECT * FROM estado_cuenta_abono WHERE proyecto_id = ?
       ORDER BY COALESCE(fecha, fecha_estimada, created_at) ASC, id ASC`,
    ).bind(proyectoId),
  ]) as [D1Result<ConceptoRow>, D1Result<AbonoRow>];
  return armarConceptos(conceptos.results ?? [], abonos.results ?? []);
}

/** Filas → DTOs con los derivados ya resueltos. Compartido por la lectura de
 * UN proyecto y por la de la cartera completa (Excel de todos los proyectos). */
function armarConceptos(conceptos: ConceptoRow[], abonos: AbonoRow[]): EstadoCuentaConceptoDTO[] {
  const porConcepto = new Map<number, EstadoCuentaAbonoDTO[]>();
  for (const a of abonos) {
    const lista = porConcepto.get(a.concepto_id) ?? [];
    lista.push({
      id: String(a.id), monto: a.monto, fecha: a.fecha, fechaEstimada: a.fecha_estimada, nota: a.nota,
      archivo: archivoDTO(a), createdBy: a.created_by, createdAt: a.created_at,
    });
    porConcepto.set(a.concepto_id, lista);
  }

  const hoy = hoyISO();
  return conceptos.map(r => {
    const lista = porConcepto.get(r.id) ?? [];
    const res = resumenConcepto(r.total, lista, hoy);
    return {
      id: String(r.id), tipo: r.tipo as EstadoCuentaTipo, concepto: r.concepto, total: r.total,
      fecha: r.fecha, archivo: archivoDTO(r),
      createdBy: r.created_by, createdAt: r.created_at,
      abonos: lista,
      abonado: res.abonado, programado: res.programado, vencido: res.vencido, saldo: res.saldo,
      sinProgramar: res.sinProgramar, proximaFecha: res.proximaFecha,
      liquidado: res.estado === 'liquidado' || res.estado === 'sobrepago',
    };
  });
}

/** TODOS los conceptos (con sus abonos) de los proyectos que el viewer puede
 * leer, agrupados por proyecto — para el Excel de la cartera completa. Dos
 * consultas planas con el scoping de siempre vía JOIN a `items` (sin alias,
 * como espera dal.scopeFor). */
export async function listEstadoCuentaCartera(env: Env, viewer: Identity): Promise<Map<number, EstadoCuentaConceptoDTO[]>> {
  await ensureEstadoCuentaTables(env);
  const scope = scopeFor('proyectos', viewer, 'read');
  const [conceptos, abonos] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ec.* FROM estado_cuenta ec
       JOIN items ON items.board_id = ? AND items.item_id = ec.proyecto_id
       WHERE (${scope.where})
       ORDER BY ec.proyecto_id, COALESCE(ec.fecha, ec.created_at) DESC, ec.id DESC`,
    ).bind(BOARDS.proyectos.id, ...scope.binds),
    env.DB.prepare(
      `SELECT a.* FROM estado_cuenta_abono a
       JOIN items ON items.board_id = ? AND items.item_id = a.proyecto_id
       WHERE (${scope.where})
       ORDER BY COALESCE(a.fecha, a.fecha_estimada, a.created_at) ASC, a.id ASC`,
    ).bind(BOARDS.proyectos.id, ...scope.binds),
  ]) as [D1Result<ConceptoRow>, D1Result<AbonoRow>];
  const proyectoDe = new Map((conceptos.results ?? []).map(r => [String(r.id), r.proyecto_id]));
  const out = new Map<number, EstadoCuentaConceptoDTO[]>();
  for (const dto of armarConceptos(conceptos.results ?? [], abonos.results ?? [])) {
    const pid = proyectoDe.get(dto.id)!;
    out.set(pid, [...(out.get(pid) ?? []), dto]);
  }
  return out;
}

interface ResumenRow {
  proyecto_id: number;
  tipo: EstadoCuentaTipo;
  total: number;
  abonado: number;
  programado: number;
  vencido: number;
}

/** El Estado de cuenta de TODOS los proyectos que el viewer puede leer,
 * resumido por proyecto — lo que la lista del board suma por grupo. Una sola
 * consulta agregada en vez de N llamadas a listEstadoCuenta.
 *
 * Los montos se agregan en SQL hasta el nivel de CONCEPTO y de ahí en
 * adelante los suma shared/estadoCuenta.ts, igual que el tab: así "Por
 * cobrar" no se puede volver otra aritmética distinta a la de la pantalla del
 * proyecto (un saldo negativo —sobrepago— no resta del pendiente de los
 * demás, por ejemplo). El JOIN contra `items` es el scoping de siempre
 * (dal.scopeFor sobre la tabla `items` sin alias, que es lo que su WHERE
 * espera): un admin fuera de la whitelist de Zona Efrain no suma esos
 * proyectos. */
export async function resumenPorProyecto(env: Env, viewer: Identity): Promise<Record<string, ResumenEstadoCuenta>> {
  await ensureEstadoCuentaTables(env);
  const scope = scopeFor('proyectos', viewer, 'read');
  const hoy = hoyISO();
  const rows = await env.DB.prepare(
    `SELECT ec.proyecto_id AS proyecto_id, ec.tipo AS tipo, ec.total AS total,
            COALESCE(SUM(CASE WHEN a.fecha IS NOT NULL THEN a.monto END), 0) AS abonado,
            COALESCE(SUM(CASE WHEN a.fecha IS NULL THEN a.monto END), 0) AS programado,
            COALESCE(SUM(CASE WHEN a.fecha IS NULL AND substr(a.fecha_estimada, 1, 10) < ? THEN a.monto END), 0) AS vencido
     FROM estado_cuenta ec
     JOIN items ON items.board_id = ? AND items.item_id = ec.proyecto_id
     LEFT JOIN estado_cuenta_abono a ON a.concepto_id = ec.id
     WHERE (${scope.where})
     GROUP BY ec.id`,
  ).bind(hoy, BOARDS.proyectos.id, ...scope.binds).all<ResumenRow>();

  const porProyecto = new Map<string, ResumenRow[]>();
  for (const r of rows.results ?? []) {
    const key = String(r.proyecto_id);
    const lista = porProyecto.get(key) ?? [];
    lista.push(r);
    porProyecto.set(key, lista);
  }

  const resumen: Record<string, ResumenEstadoCuenta> = {};
  for (const [proyectoId, conceptos] of porProyecto) {
    resumen[proyectoId] = resumenEstadoCuenta(conceptos.map(c => ({
      tipo: c.tipo, total: c.total, abonado: c.abonado, saldo: c.total - c.abonado,
      programado: c.programado, vencido: c.vencido,
    })));
  }
  return resumen;
}

// ── Archivos: la factura del concepto, el comprobante del abono ─────────────

export type ArchivoDestino =
  | { tabla: 'estado_cuenta'; proyectoId: number; rowId: number }
  | { tabla: 'estado_cuenta_abono'; proyectoId: number; conceptoId: number; rowId: number };

function whereDestino(d: ArchivoDestino): { sql: string; binds: number[] } {
  return d.tabla === 'estado_cuenta'
    ? { sql: 'id = ? AND proyecto_id = ?', binds: [d.rowId, d.proyectoId] }
    : { sql: 'id = ? AND concepto_id = ? AND proyecto_id = ?', binds: [d.rowId, d.conceptoId, d.proyectoId] };
}

/** Nombre legible y acotado, sin rutas ni caracteres raros: es lo que se
 * imprime en "Ver factura" y viaja en Content-Disposition al descargar. */
export function limpiarNombreAdjunto(nombre: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (nombre.split(/[\\/]/).pop() ?? '').replace(/[\x00-\x1f"<>]/g, '').replace(/\s+/g, ' ').trim();
  return (base || fallback).slice(0, 120);
}

/** Sube la factura (concepto) o el comprobante (abono) y la deja referenciada
 * en su fila. Un segundo archivo REEMPLAZA al primero en la fila; los bytes
 * del anterior se quedan en R2 (nadie los borra) y su key queda en el
 * respaldo, por si se subió el equivocado. */
export async function guardarArchivo(
  env: Env, destino: ArchivoDestino, bytes: Uint8Array, nombreOriginal: string, viewer: Identity,
): Promise<EstadoCuentaArchivoDTO> {
  if (bytes.length === 0) throw new EstadoCuentaError('el archivo está vacío');
  if (bytes.length > ARCHIVO_MAX_BYTES) throw new EstadoCuentaError('el archivo pasa de 10 MB', 413);
  const nombre = limpiarNombreAdjunto(nombreOriginal, destino.tabla === 'estado_cuenta' ? 'factura' : 'comprobante');
  const ext = (nombre.split('.').pop() ?? '').toLowerCase();
  if (!EXTENSIONES_PERMITIDAS.has(ext)) throw new EstadoCuentaError('solo PDF, XML o imagen (JPG/PNG/WEBP/HEIC)');
  // XML no está en mime.ts (allá es para lo que se muestra inline); el CFDI
  // se sirve como texto para que el navegador lo abra en vez de bajarlo.
  const tipo = ext === 'xml' ? 'application/xml' : contentTypeFor(nombre);

  await ensureEstadoCuentaTables(env);
  const w = whereDestino(destino);
  const fila = await env.DB.prepare(`SELECT * FROM ${destino.tabla} WHERE ${w.sql}`).bind(...w.binds).first<ConceptoRow | AbonoRow>();
  if (!fila) throw new EstadoCuentaError(destino.tabla === 'estado_cuenta' ? 'concepto no encontrado' : 'cobro no encontrado', 404);
  if (fila.archivo_key) await respaldar(env, destino.tabla, fila, { reemplazoArchivo: nombre }, viewer);

  // Key único por fila y por subida: dos subidas del mismo nombre no se pisan.
  const key = `estado-cuenta/${destino.proyectoId}/${destino.tabla === 'estado_cuenta' ? 'concepto' : 'abono'}-${destino.rowId}/${crypto.randomUUID()}-${nombre}`;
  await env.FILES.put(key, bytes as BufferSource, { httpMetadata: { contentType: tipo } });
  await env.DB.prepare(
    `UPDATE ${destino.tabla} SET archivo_key = ?, archivo_nombre = ?, archivo_tipo = ?, archivo_bytes = ?, updated_at = ? WHERE ${w.sql}`,
  ).bind(key, nombre, tipo, bytes.length, new Date().toISOString(), ...w.binds).run();
  return { nombre, contentType: tipo, bytes: bytes.length };
}

export async function leerArchivo(
  env: Env, destino: ArchivoDestino,
): Promise<{ body: ReadableStream; contentType: string; nombre: string; bytes: number } | null> {
  await ensureEstadoCuentaTables(env);
  const w = whereDestino(destino);
  const fila = await env.DB.prepare(`SELECT archivo_key, archivo_nombre, archivo_tipo, archivo_bytes FROM ${destino.tabla} WHERE ${w.sql}`)
    .bind(...w.binds).first<ArchivoCols>();
  if (!fila?.archivo_key) return null;
  const obj = await env.FILES.get(fila.archivo_key);
  if (!obj) return null;
  return {
    body: obj.body, contentType: fila.archivo_tipo ?? 'application/octet-stream',
    nombre: fila.archivo_nombre ?? 'archivo', bytes: fila.archivo_bytes ?? obj.size,
  };
}
