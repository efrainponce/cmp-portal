// worker/lib/home.ts — pantalla "Inicio": pendientes accionables por rol, en
// tarjetas (no una tabla de Monday). Reutiliza los mismos checks que ya
// bloquean botones del flujo (checkValidacion) en vez de reinventar "¿ya se
// puede pasar a validación?". "Stale" = sin ningún cambio en Monday hace
// ≥14 días (monday_updated_at del mirror), pedido por Efraín (2026-08-10).
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { HomePendienteDTO, HomeResponse, HomeSectionDTO } from '../../shared/dto';
import type { RawCol } from './serialize';
import { BOARDS } from '../../shared/boards';
import { CLOSED_STAGES } from '../../shared/dealStages';
import { listItems } from './dal';
import { checkValidacionMany } from './costeo';
import { statusIndex } from './notify';

const OPP_INSTITUCION = 'lookup_mm1bs976';   // mismo id que worker/lib/costeo.ts
const STALE_DAYS = 14;
const MAX_ITEMS = 30;

function colsOf(row: MirrorItem): Map<string, RawCol> {
  try {
    const raw: RawCol[] = JSON.parse(row.columns || '[]');
    return new Map(raw.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

function stageIndexOf(item: MirrorItem): string | null {
  return statusIndex(item.columns, 'deal_stage');
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function institucionOf(item: MirrorItem): string {
  return (colsOf(item).get(OPP_INSTITUCION)?.text ?? '').trim() || 'Sin institución';
}

const byOldestFirst = (a: MirrorItem, b: MirrorItem) =>
  (a.monday_updated_at ?? '').localeCompare(b.monday_updated_at ?? '');

/** Las oportunidades que el viewer ESCRIBE ('own'): compras ya LEE lo de todo
 * el equipo (dal.ts, 2026-09-21), pero sus pendientes siguen siendo solo donde
 * es Responsable compras. Es el board entero con sus columnas (~8.5 MB en
 * producción para un admin), así que quien arma varias secciones lo lee UNA
 * vez y se lo pasa a las dos. */
function propias(env: Env, viewer: Identity): Promise<MirrorItem[]> {
  return listItems(env, 'oportunidades', viewer, undefined, 'own');
}

/** Compras: oportunidades en "En costeo" (15) que aún no pasan el chequeo de
 * validación (worker/lib/costeo.ts checkValidacion — el mismo que bloquea el
 * botón "Enviar a validación"), más viejas primero.
 *
 * El chequeo va en lote (checkValidacionMany). Antes era uno por oportunidad
 * y en serie — líneas + un producto por línea, cada uno su viaje a D1 — y
 * como el ETag de /api/home sale del resultado, hasta el 304 del poll de 30 s
 * lo pagaba: medido en producción 2026-09-30, 1.6 s por petición. */
export async function comprasPendientes(env: Env, viewer: Identity, filas?: MirrorItem[]): Promise<HomePendienteDTO[]> {
  const items = (filas ?? await propias(env, viewer))
    .filter(it => stageIndexOf(it) === '15')
    .sort(byOldestFirst);
  const checks = await checkValidacionMany(env, items.map(it => it.item_id), viewer);

  const out: HomePendienteDTO[] = [];
  for (const item of items) {
    if (out.length >= MAX_ITEMS) break;
    const result = checks.get(item.item_id);
    if (!result || result.ok) continue;
    out.push({
      itemId: String(item.item_id),
      boardKey: 'costeo',
      title: item.name,
      subtitle: result.errors?.[0] ?? 'Costeo incompleto',
      daysStale: daysSince(item.monday_updated_at),
    });
  }
  return out;
}

/** Vendedor: sus propias oportunidades abiertas (no Ganada/Perdida/Cancelada)
 * sin movimiento hace ≥14 días, más viejas primero. Para el admin (que ve
 * "todos los vendedores") se llama con el mismo viewer admin — scopeFor ya
 * regresa todo para su rol sin importar el modo, así que sale org-wide gratis. */
export async function vendedorPendientes(env: Env, viewer: Identity, filas?: MirrorItem[]): Promise<HomePendienteDTO[]> {
  const items = (filas ?? await propias(env, viewer))
    .filter(it => {
      const stage = stageIndexOf(it);
      if (stage && CLOSED_STAGES.has(stage)) return false;
      return daysSince(it.monday_updated_at) >= STALE_DAYS;
    })
    .sort(byOldestFirst)
    .slice(0, MAX_ITEMS);

  return items.map(item => ({
    itemId: String(item.item_id),
    boardKey: 'oportunidades',
    title: item.name,
    subtitle: institucionOf(item),
    daysStale: daysSince(item.monday_updated_at),
  }));
}

/** Admin: supervisión — vendedores stale org-wide + costeo incompleto que
 * además lleva ≥14 días sin moverse (separa backlog normal de compras de lo
 * que realmente se atoró). */
async function adminPendientes(env: Env, viewer: Identity): Promise<HomeSectionDTO[]> {
  const filas = await propias(env, viewer);
  const [vendedores, costeo] = await Promise.all([
    vendedorPendientes(env, viewer, filas),
    comprasPendientes(env, viewer, filas),
  ]);
  return [
    { key: 'vendedores', label: 'Vendedores — sin movimiento', items: vendedores },
    { key: 'costeo', label: 'Costeo atorado', items: costeo.filter(i => i.daysStale >= STALE_DAYS) },
  ];
}

export async function buildHomeResponse(env: Env, viewer: Identity): Promise<HomeResponse> {
  const greetingName = viewer.nombre?.trim() || viewer.email;
  let sections: HomeSectionDTO[] = [];

  if (viewer.role === 'compras') {
    sections = [{ key: 'costeo', label: 'Pendientes de costeo', items: await comprasPendientes(env, viewer) }];
  } else if (viewer.role === 'vendedor') {
    sections = [{ key: 'seguimiento', label: 'Dales seguimiento', items: await vendedorPendientes(env, viewer) }];
  } else if (viewer.role === 'admin') {
    sections = await adminPendientes(env, viewer);
  }
  // almacén: sin secciones — su Home no se monta en la UI (rol reactivo).

  return { greetingName, sections };
}

// --- Seguimiento (worker/routes/oportunidades.ts POST .../seguimiento) ---
// Mismo patrón "lazy CREATE + documentado en worker/schema.sql" que
// worker/lib/estadoProducto.ts ensureHistorialTable.
let seguimientosTableReady = false;

async function ensureSeguimientosTable(env: Env): Promise<void> {
  if (seguimientosTableReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS seguimientos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id           INTEGER NOT NULL,
    board_id          INTEGER NOT NULL,
    monday_update_id  INTEGER NOT NULL,
    autor_email       TEXT NOT NULL,
    mensaje           TEXT NOT NULL,
    created_at        TEXT NOT NULL
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_seguimientos_item ON seguimientos(item_id)').run();
  seguimientosTableReady = true;
}

export async function insertSeguimiento(env: Env, args: {
  itemId: number; mondayUpdateId: number; autorEmail: string; mensaje: string;
}): Promise<void> {
  await ensureSeguimientosTable(env);
  await env.DB.prepare(
    `INSERT INTO seguimientos (item_id, board_id, monday_update_id, autor_email, mensaje, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).bind(args.itemId, BOARDS.oportunidades.id, args.mondayUpdateId, args.autorEmail, args.mensaje, new Date().toISOString()).run();
}
