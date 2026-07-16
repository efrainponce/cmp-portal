// worker/lib/assistantTools.ts — tool surface shared by every Claude-agent channel
// (WhatsApp bot, portal chat bubble). Searches/queries hit the D1 mirror (never
// Monday directly); creates go through the same guarded paths the portal uses.
// Column ids from column-meta.gen.ts — never fabricate.
//
// ROLE GATING (2026-07-15): every tool declares which roles may call it
// (TOOL_ROLES). `toolsFor(role)` builds the per-agent tool list, and runTool
// re-checks the role before executing (defense in depth — the model never gets
// to run a tool its role wasn't offered). Row-level scoping rides on the DAL:
// vendedor only ever sees his own oportunidades/proyectos; column-level
// visibility rides on shared/visibility.ts (costs stay compras/admin).
import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity, MirrorItem, Role } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { COLUMN_META } from '../../shared/column-meta.gen';
import { readableCols } from '../../shared/visibility';
import { DEAL_STAGE_LABELS, DEAL_STAGE_ORDER, CLOSED_STAGES, stageKeyForLabel } from '../../shared/dealStages';
import { listItems, getItem, childrenOf } from './dal';
import { listStock, listMovements, listWarehouses } from './inventory';
import { submitCreate, CreateError } from './createRecord';
import { createOportunidad, OportunidadError, type LineaInput } from './createOportunidad';

// Display columns per board (seller-visible only — cost columns stay out).
const PRODUCTO_COLS = {
  sku: 'product_and_service_sku',
  marca: 'product_and_service_description',
  unidad: 'text_mkzp9428',
  colores: 'dropdown_mkztty4b',
};
const CONTACTO_COLS = {
  email: 'contact_email',
  telefono: 'contact_phone',
  cargo: 'text_mm0dz8yj',
};
const INSTITUCION_COLS = {
  tipo: 'dropdown_mm1bajsm',
  estado: 'dropdown_mm1b46m9',
  municipio: 'text_mm1bvz12',
};

// Oportunidades summary columns (ids from column-meta.gen.ts).
// NOTE: the money mirrors (Total/Subtotal/Costo/Utilidad) mirror FORMULA
// columns, which Monday's API does not materialize — their `text` is always
// empty in the D1 mirror (verified live 2026-07-15). Pipeline amounts are
// therefore computed from the subitem lines: Precio de Venta C/U × Cantidad.
const OPP = {
  folio: 'pulse_id_mm0qcq0m',
  etapa: 'deal_stage',
  vendedor: 'deal_owner',
  institucion: 'lookup_mm1bs976',
  fechaLimite: 'deal_expected_close_date',
};

const SUB = {
  precioVenta: 'numeric_mkzneg3d',   // Precio de Venta C/U (seller-visible)
  cantidad: 'numeric_mkzm6399',      // Cantidad
};

const PROYECTO = {
  folio: 'pulse_id_mm1a12gy',
  estado: 'project_status',
  estadoPago: 'color_mm0mcrjq',
  fechaEntrega: 'date_mm0m1vfv',
  institucion: 'lookup_mm1dwn6',
  vendedor: 'multiple_person_mm0hrnqq',
};

// ── Tool registry ─────────────────────────────────────────────────────────────

const ALL: Role[] = ['vendedor', 'compras', 'admin'];
const PRIVILEGED: Role[] = ['compras', 'admin'];
const CREATORS: Role[] = ['vendedor', 'admin'];

/** Which roles may call each tool. Fail-closed: unknown tool = nobody. */
export const TOOL_ROLES: Record<string, Role[]> = {
  buscar_productos: ALL,
  buscar_contactos: ALL,
  buscar_instituciones: ALL,
  crear_contacto: CREATORS,
  crear_oportunidad: CREATORS,
  consultar_pipeline: ALL,
  listar_oportunidades: ALL,
  detalle_oportunidad: ALL,
  listar_proyectos: ALL,
  consultar_inventario: PRIVILEGED,
  movimientos_inventario: PRIVILEGED,
};

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'buscar_productos',
    description: 'Busca productos en el catálogo CMP por nombre o SKU. Úsala SIEMPRE antes de agregar una línea de producto a una oportunidad, para vincular el producto correcto del catálogo.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Texto a buscar (nombre parcial o SKU)' } },
      required: ['q'],
    },
  },
  {
    name: 'buscar_contactos',
    description: 'Busca contactos (personas) existentes en el CRM por nombre.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Nombre parcial del contacto' } },
      required: ['q'],
    },
  },
  {
    name: 'buscar_instituciones',
    description: 'Busca instituciones (clientes/organizaciones) existentes en el CRM por nombre.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Nombre parcial de la institución' } },
      required: ['q'],
    },
  },
  {
    name: 'crear_contacto',
    description: 'Crea un contacto nuevo en el CRM. Solo llamar después de que el usuario confirmó explícitamente el resumen de los datos.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre completo del contacto' },
        email: { type: 'string', description: 'Correo electrónico' },
        telefono: { type: 'string', description: 'Teléfono (10 dígitos MX)' },
        cargo: { type: 'string', description: 'Cargo o puesto' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'crear_oportunidad',
    description: 'Crea una oportunidad de venta con sus líneas de producto. Solo llamar después de que el usuario confirmó explícitamente el resumen. Cada línea debe traer producto_item_id si el producto se encontró en el catálogo con buscar_productos.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la oportunidad (ej. "Uniformes Hospital General León")' },
        contacto_item_id: { type: 'number', description: 'item_id del contacto en el CRM (de buscar_contactos), si aplica' },
        fecha_limite: { type: 'string', description: 'Fecha límite YYYY-MM-DD, si el usuario la dio' },
        zona: { type: 'string', description: 'Zona de venta, solo si el usuario la indicó' },
        lineas: {
          type: 'array',
          description: 'Líneas de producto (mínimo 1)',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'Nombre del producto tal como lo pidió el cliente' },
              producto_item_id: { type: 'number', description: 'item_id del producto en catálogo (de buscar_productos). Omitir SOLO si el producto no existe en catálogo y el usuario confirmó que va fuera de catálogo.' },
              cantidad: { type: 'number', description: 'Cantidad de piezas' },
              color: { type: 'string', description: 'Color solicitado' },
              comentarios: { type: 'string', description: 'Detalles: tallas, embellecimientos, notas del cliente' },
            },
            required: ['nombre', 'cantidad'],
          },
        },
      },
      required: ['nombre', 'lineas'],
    },
  },
  {
    name: 'consultar_pipeline',
    description: 'Resumen del pipeline de ventas: número de oportunidades y monto total por etapa, más totales de abiertas/ganadas/perdidas. Llámala cuando pregunten "¿cómo va mi pipeline?", "¿cuántas oportunidades abiertas hay?", montos por etapa, etc.',
    input_schema: {
      type: 'object',
      properties: {
        incluir_cerradas: { type: 'boolean', description: 'Incluir también Ganada/Perdida/Cancelada en el desglose por etapa (default: solo el resumen las menciona)' },
        vendedor: { type: 'string', description: 'Filtrar por nombre del vendedor (solo roles compras/admin; los vendedores siempre ven solo lo suyo)' },
      },
    },
  },
  {
    name: 'listar_oportunidades',
    description: 'Lista oportunidades con folio, etapa, institución, monto y fecha límite. Filtra por etapa, texto (nombre/institución/folio) o vendedor. Úsala para preguntas tipo "¿qué oportunidades tengo en costeo?", "¿qué hay de Hospital X?".',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Texto a buscar en nombre, institución, folio o vendedor' },
        etapa: { type: 'string', description: 'Nombre de la etapa exacta, ej. "Nueva oportunidad", "En costeo", "Ganada"' },
        solo_abiertas: { type: 'boolean', description: 'true = excluir Ganada/Perdida/Cancelada' },
        vendedor: { type: 'string', description: 'Filtrar por nombre del vendedor (solo compras/admin)' },
        limite: { type: 'number', description: 'Máximo de filas (default 15, máx 40)' },
      },
    },
  },
  {
    name: 'detalle_oportunidad',
    description: 'Detalle completo de UNA oportunidad (todos los campos visibles para tu rol) incluyendo sus líneas de producto. Identifícala por item_id (de listar_oportunidades) o por folio.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'number', description: 'item_id de la oportunidad' },
        folio: { type: 'string', description: 'Folio de la oportunidad (si no tienes el item_id)' },
      },
    },
  },
  {
    name: 'listar_proyectos',
    description: 'Lista proyectos post-venta (oportunidades ganadas en ejecución) con estado, estado de pago y fecha de entrega. Filtra por texto.',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Texto a buscar (nombre, institución, folio)' },
        limite: { type: 'number', description: 'Máximo de filas (default 15, máx 40)' },
      },
    },
  },
  {
    name: 'consultar_inventario',
    description: 'Existencias actuales de inventario por producto y almacén (bodegas y vendedores). Opcionalmente filtra por producto o almacén.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Nombre parcial del producto' },
        almacen: { type: 'string', description: 'Nombre parcial del almacén o vendedor' },
      },
    },
  },
  {
    name: 'movimientos_inventario',
    description: 'Últimos movimientos de inventario (Entrada/Salida/Transferencia/Consolidación), opcionalmente filtrados por producto.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Nombre parcial del producto' },
        limite: { type: 'number', description: 'Máximo de movimientos (default 10, máx 30)' },
      },
    },
  },
];

/** The tool list offered to an agent of the given role. */
export function toolsFor(role: Role): Anthropic.Tool[] {
  return TOOLS.filter(t => TOOL_ROLES[t.name]?.includes(role));
}

// ── Column helpers over mirror rows ───────────────────────────────────────────

interface MirrorRow { item_id: number; name: string; columns: string }
interface ColEntry { id: string; type?: string; text: string | null; value: string | null }

function colEntries(columnsJson: string): Map<string, ColEntry> {
  try {
    const cols = JSON.parse(columnsJson) as ColEntry[];
    return new Map(cols.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

function colText(columnsJson: string, ids: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const byId = colEntries(columnsJson);
  for (const [key, id] of Object.entries(ids)) {
    const t = byId.get(id)?.text;
    if (t) out[key] = t;
  }
  return out;
}

/** Mirror columns fan in one value per subitem, joined with ", ". Collapse to
 * the distinct values for display ("Listo, Listo" -> "Listo"). */
function dedupeMirror(text: string): string {
  const parts = Array.from(new Set(text.split(/,\s+/).map(s => s.trim()).filter(Boolean)));
  return parts.length <= 3 ? parts.join(', ') : `${parts[0]} +${parts.length - 1}`;
}

/** Venta total por oportunidad, computada de sus líneas en el mirror:
 * Σ (Precio de Venta C/U × Cantidad). One aggregate query over the subitem
 * board; keys are parent item_ids. Unscoped on purpose — results are only ever
 * joined to opps the viewer already passed the DAL scope for. */
async function ventaPorOportunidad(env: Env): Promise<Map<number, number>> {
  const numCol = (id: string) =>
    `COALESCE((SELECT CAST(json_extract(je.value,'$.text') AS REAL)
       FROM json_each(items.columns) je
       WHERE json_extract(je.value,'$.id') = '${id}'), 0)`;
  const sql = `
    SELECT parent_item_id AS opp, SUM(${numCol(SUB.precioVenta)} * ${numCol(SUB.cantidad)}) AS venta
    FROM items WHERE board_id = ? AND parent_item_id IS NOT NULL
    GROUP BY parent_item_id`;
  const res = await env.DB.prepare(sql).bind(BOARDS.oportunidades_sub.id).all<{ opp: number; venta: number }>();
  return new Map((res.results ?? []).map(r => [r.opp, Math.round((r.venta ?? 0) * 100) / 100]));
}

/** deal_stage key ("4", "15", ...) of an oportunidad row; null if unknown. */
function stageKeyOf(cols: Map<string, ColEntry>): string | null {
  const c = cols.get(OPP.etapa);
  if (!c) return null;
  try {
    const v = JSON.parse(c.value ?? 'null') as { index?: number } | null;
    if (v && typeof v.index === 'number') return String(v.index);
  } catch { /* fall through to label lookup */ }
  return c.text ? (stageKeyForLabel(c.text) ?? null) : null;
}

const like = (haystack: string | undefined | null, needle: string) =>
  (haystack ?? '').toLowerCase().includes(needle.trim().toLowerCase());

/** One oportunidad row -> compact summary object for lists/aggregates. */
function oppSummary(row: MirrorItem, venta: Map<number, number>) {
  const cols = colEntries(row.columns);
  const t = (id: string) => cols.get(id)?.text ?? null;
  const key = stageKeyOf(cols);
  const out: Record<string, unknown> = {
    item_id: row.item_id,
    folio: t(OPP.folio),
    nombre: row.name,
    etapa: key ? DEAL_STAGE_LABELS[key] ?? key : t(OPP.etapa),
    institucion: t(OPP.institucion) ? dedupeMirror(t(OPP.institucion)!) : null,
    vendedor: t(OPP.vendedor),
    monto_venta: venta.get(row.item_id) ?? 0,
    fecha_limite: t(OPP.fechaLimite),
  };
  return { out, key };
}

// Column types that never make sense in a chat answer.
const SKIP_TYPES = new Set([
  'button', 'file', 'subtasks', 'unsupported', 'creation_log', 'last_updated', 'direct_doc',
]);

/** All non-empty, role-readable columns of a row as {Título: texto}. */
function readableRecord(slug: keyof typeof COLUMN_META, row: MirrorItem, role: Role): Record<string, string> {
  const cols = colEntries(row.columns);
  const out: Record<string, string> = { nombre: row.name };
  for (const id of readableCols(slug, role)) {
    const meta = COLUMN_META[slug][id];
    if (!meta || SKIP_TYPES.has(meta.type)) continue;
    const text = cols.get(id)?.text?.trim();
    if (!text) continue;
    out[meta.title] = meta.type === 'mirror' ? dedupeMirror(text) : text;
  }
  return out;
}

// ── Mirror search (catalog/contacts/institutions quick lookups) ───────────────

/** Mirror search: item name LIKE, plus optional extra text columns (e.g. SKU). */
async function searchMirror(
  env: Env,
  boardId: number,
  q: string,
  extraColIds: string[] = [],
): Promise<MirrorRow[]> {
  const likeQ = `%${q.trim()}%`;
  let sql = `SELECT item_id, name, columns FROM items WHERE board_id = ? AND (name LIKE ? COLLATE NOCASE`;
  const binds: unknown[] = [boardId, likeQ];
  if (extraColIds.length > 0) {
    const ph = extraColIds.map(() => '?').join(',');
    sql += ` OR EXISTS (SELECT 1 FROM json_each(items.columns) je
             WHERE json_extract(je.value,'$.id') IN (${ph})
             AND json_extract(je.value,'$.text') LIKE ? COLLATE NOCASE)`;
    binds.push(...extraColIds, likeQ);
  }
  sql += `) ORDER BY name LIMIT 8`;
  const res = await env.DB.prepare(sql).bind(...binds).all<MirrorRow>();
  return res.results ?? [];
}

function fmtResults(rows: MirrorRow[], cols: Record<string, string>): string {
  if (rows.length === 0) return 'Sin resultados.';
  const list = rows.map(r => ({ item_id: r.item_id, nombre: r.name, ...colText(r.columns, cols) }));
  const suffix = rows.length === 8 ? '\n(Puede haber más resultados; afina la búsqueda.)' : '';
  return JSON.stringify(list) + suffix;
}

// ── Query tool implementations ────────────────────────────────────────────────

async function scopedOportunidades(env: Env, viewer: Identity, q?: string): Promise<MirrorItem[]> {
  // listItems applies the row-level vendedor scope (worker/lib/dal.ts) and the
  // shared searchable-columns LIKE — same predicate the portal boards use.
  return listItems(env, 'oportunidades', viewer, q);
}

async function toolConsultarPipeline(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const [rows, venta] = await Promise.all([scopedOportunidades(env, viewer), ventaPorOportunidad(env)]);
  const vendedorFilter = viewer.role !== 'vendedor' && typeof input.vendedor === 'string' && input.vendedor.trim()
    ? input.vendedor : null;
  const incluirCerradas = input.incluir_cerradas === true;

  const perStage = new Map<string, { n: number; monto: number }>();
  const resumen = { abiertas: { n: 0, monto: 0 }, ganadas: { n: 0, monto: 0 }, perdidas_canceladas: { n: 0, monto: 0 } };

  for (const row of rows) {
    const { out, key } = oppSummary(row, venta);
    if (vendedorFilter && !like(out.vendedor as string | null, vendedorFilter)) continue;
    const k = key ?? '?';
    const monto = typeof out.monto_venta === 'number' ? out.monto_venta : 0;
    const slot = perStage.get(k) ?? { n: 0, monto: 0 };
    slot.n += 1; slot.monto += monto;
    perStage.set(k, slot);
    if (key && CLOSED_STAGES.has(key)) {
      const bucket = key === '1' ? resumen.ganadas : resumen.perdidas_canceladas;
      bucket.n += 1; bucket.monto += monto;
    } else {
      resumen.abiertas.n += 1; resumen.abiertas.monto += monto;
    }
  }

  const orden = incluirCerradas ? DEAL_STAGE_ORDER : DEAL_STAGE_ORDER.filter(k => !CLOSED_STAGES.has(k));
  const etapas = orden
    .filter(k => perStage.has(k))
    .map(k => ({ etapa: DEAL_STAGE_LABELS[k] ?? k, oportunidades: perStage.get(k)!.n, monto_total: Math.round(perStage.get(k)!.monto * 100) / 100 }));
  if (perStage.has('?')) etapas.push({ etapa: 'Sin etapa', oportunidades: perStage.get('?')!.n, monto_total: perStage.get('?')!.monto });

  return JSON.stringify({
    alcance: viewer.role === 'vendedor' ? 'solo tus oportunidades' : (vendedorFilter ? `vendedor ~ "${vendedorFilter}"` : 'todas las oportunidades'),
    nota: 'monto_total (MXN) = suma por oportunidad de Precio de Venta C/U × Cantidad de sus líneas; 0 = sin precios capturados aún',
    resumen,
    por_etapa: etapas,
  });
}

async function toolListarOportunidades(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const q = typeof input.q === 'string' && input.q.trim() ? input.q.trim() : undefined;
  const [rows, venta] = await Promise.all([scopedOportunidades(env, viewer, q), ventaPorOportunidad(env)]);

  let etapaKey: string | undefined;
  if (typeof input.etapa === 'string' && input.etapa.trim()) {
    etapaKey = stageKeyForLabel(input.etapa);
    if (!etapaKey) {
      return JSON.stringify({ error: `Etapa desconocida: "${input.etapa}". Etapas válidas: ${Object.values(DEAL_STAGE_LABELS).join(', ')}` });
    }
  }
  const soloAbiertas = input.solo_abiertas === true;
  const vendedorFilter = viewer.role !== 'vendedor' && typeof input.vendedor === 'string' && input.vendedor.trim()
    ? input.vendedor : null;
  const limite = Math.min(Math.max(Number(input.limite) || 15, 1), 40);

  const matches: Record<string, unknown>[] = [];
  for (const row of rows) {
    const { out, key } = oppSummary(row, venta);
    if (etapaKey && key !== etapaKey) continue;
    if (soloAbiertas && key && CLOSED_STAGES.has(key)) continue;
    if (vendedorFilter && !like(out.vendedor as string | null, vendedorFilter)) continue;
    matches.push(out);
  }

  const page = matches.slice(0, limite);
  return JSON.stringify({
    total_encontradas: matches.length,
    mostrando: page.length,
    oportunidades: page,
    ...(matches.length > page.length ? { nota: 'Hay más resultados; afina el filtro o sube el límite.' } : {}),
  });
}

async function toolDetalleOportunidad(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
  let item: MirrorItem | null = null;

  if (typeof input.item_id === 'number') {
    item = await getItem(env, 'oportunidades', input.item_id, viewer);
  } else if (typeof input.folio === 'string' && input.folio.trim()) {
    const folio = input.folio.trim();
    const rows = await scopedOportunidades(env, viewer, folio);
    item = rows.find(r => (colEntries(r.columns).get(OPP.folio)?.text ?? '').trim() === folio)
      ?? rows.find(r => like(colEntries(r.columns).get(OPP.folio)?.text, folio))
      ?? null;
  } else {
    return { content: 'Indica item_id o folio.', isError: true };
  }

  if (!item) return { content: 'No encontré esa oportunidad (o no está dentro de tu alcance).', isError: true };

  const [lineas, venta] = await Promise.all([
    childrenOf(env, 'oportunidades', item.item_id, viewer),
    ventaPorOportunidad(env),
  ]);
  return {
    content: JSON.stringify({
      oportunidad: { item_id: item.item_id, ...readableRecord('oportunidades', item, viewer.role) },
      monto_venta: venta.get(item.item_id) ?? 0,
      nota_monto: 'monto_venta (MXN) = Σ Precio de Venta C/U × Cantidad de las líneas; 0 = sin precios capturados',
      lineas: lineas.slice(0, 30).map(l => readableRecord('oportunidades_sub', l, viewer.role)),
      ...(lineas.length > 30 ? { nota: `Mostrando 30 de ${lineas.length} líneas.` } : {}),
    }),
    isError: false,
  };
}

async function toolListarProyectos(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const q = typeof input.q === 'string' && input.q.trim() ? input.q.trim() : undefined;
  const limite = Math.min(Math.max(Number(input.limite) || 15, 1), 40);
  const rows = await listItems(env, 'proyectos', viewer, q);

  const list = rows.slice(0, limite).map(row => {
    const t = (id: string) => colEntries(row.columns).get(id)?.text ?? null;
    return {
      item_id: row.item_id,
      folio: t(PROYECTO.folio),
      nombre: row.name,
      estado: t(PROYECTO.estado),
      estado_pago: t(PROYECTO.estadoPago),
      fecha_entrega: t(PROYECTO.fechaEntrega),
      institucion: t(PROYECTO.institucion) ? dedupeMirror(t(PROYECTO.institucion)!) : null,
      vendedor: t(PROYECTO.vendedor),
    };
  });
  return JSON.stringify({
    total_encontrados: rows.length,
    mostrando: list.length,
    proyectos: list,
    ...(rows.length > list.length ? { nota: 'Hay más resultados; afina el filtro o sube el límite.' } : {}),
  });
}

async function toolConsultarInventario(env: Env, input: Record<string, unknown>): Promise<string> {
  const producto = typeof input.producto === 'string' ? input.producto.trim() : '';
  const almacen = typeof input.almacen === 'string' ? input.almacen.trim() : '';
  const stock = await listStock(env);
  const rows = stock.filter(r =>
    (!producto || like(r.productName, producto)) &&
    (!almacen || like(r.warehouseName, almacen)));
  const page = rows.slice(0, 60).map(r => ({
    producto: r.productName,
    almacen: r.warehouseName,
    tipo: r.warehouseType === 'person' ? 'vendedor' : 'bodega',
    existencia: r.stock,
  }));
  return JSON.stringify({
    filas: page.length,
    stock: page,
    ...(rows.length > page.length ? { nota: `Mostrando 60 de ${rows.length} filas; filtra por producto o almacén.` } : {}),
    ...(rows.length === 0 ? { nota: 'Sin existencias que coincidan.' } : {}),
  });
}

async function toolMovimientosInventario(env: Env, input: Record<string, unknown>): Promise<string> {
  const producto = typeof input.producto === 'string' ? input.producto.trim() : '';
  const limite = Math.min(Math.max(Number(input.limite) || 10, 1), 30);
  const [movs, warehouses] = await Promise.all([listMovements(env), listWarehouses(env)]);
  const wName = new Map(warehouses.map(w => [w.id, w.name]));
  const rows = movs.filter(m => !producto || like(m.productName, producto)).slice(0, limite).map(m => ({
    fecha: m.createdAt,
    tipo: m.type,
    producto: m.productName,
    cantidad: m.quantity,
    origen: m.originId ? wName.get(m.originId) ?? String(m.originId) : null,
    destino: m.destinationId ? wName.get(m.destinationId) ?? String(m.destinationId) : null,
    capturado_por: m.capturedBy,
    folio: m.folio,
  }));
  return JSON.stringify({ movimientos: rows });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/** Execute one tool call; always returns a string for the tool_result. */
export async function runTool(
  env: Env,
  viewer: Identity,
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  // Defense in depth: even if the model hallucinates a tool it wasn't offered,
  // the role gate here refuses to run it.
  if (!TOOL_ROLES[name]?.includes(viewer.role)) {
    return { content: `La herramienta "${name}" no está disponible para tu rol.`, isError: true };
  }
  try {
    switch (name) {
      case 'buscar_productos': {
        const rows = await searchMirror(env, BOARDS.productos.id, String(input.q ?? ''), [PRODUCTO_COLS.sku]);
        return { content: fmtResults(rows, PRODUCTO_COLS), isError: false };
      }
      case 'buscar_contactos': {
        const rows = await searchMirror(env, BOARDS.contactos.id, String(input.q ?? ''));
        return { content: fmtResults(rows, CONTACTO_COLS), isError: false };
      }
      case 'buscar_instituciones': {
        const rows = await searchMirror(env, BOARDS.instituciones.id, String(input.q ?? ''));
        return { content: fmtResults(rows, INSTITUCION_COLS), isError: false };
      }
      case 'crear_contacto': {
        const cols: Record<string, string> = {};
        if (typeof input.email === 'string' && input.email.trim()) cols[CONTACTO_COLS.email] = input.email.trim();
        if (typeof input.telefono === 'string' && input.telefono.trim()) cols[CONTACTO_COLS.telefono] = input.telefono.trim();
        if (typeof input.cargo === 'string' && input.cargo.trim()) cols[CONTACTO_COLS.cargo] = input.cargo.trim();
        const result = await submitCreate(env, 'contactos', String(input.nombre ?? ''), cols, viewer);
        return { content: JSON.stringify({ ok: true, item_id: result.id, nota: 'Contacto creado. La institución se liga manualmente en Monday (limitación conocida).' }), isError: false };
      }
      case 'crear_oportunidad': {
        const rawLineas = Array.isArray(input.lineas) ? input.lineas as Array<Record<string, unknown>> : [];
        const lineas: LineaInput[] = rawLineas.map(l => ({
          nombre: String(l.nombre ?? ''),
          productoItemId: typeof l.producto_item_id === 'number' ? l.producto_item_id : undefined,
          cantidad: Number(l.cantidad),
          color: typeof l.color === 'string' ? l.color : undefined,
          comentarios: typeof l.comentarios === 'string' ? l.comentarios : undefined,
        }));
        const result = await createOportunidad(env, {
          nombre: String(input.nombre ?? ''),
          contactoItemId: typeof input.contacto_item_id === 'number' ? input.contacto_item_id : undefined,
          fechaLimite: typeof input.fecha_limite === 'string' ? input.fecha_limite : undefined,
          zona: typeof input.zona === 'string' ? input.zona : undefined,
          lineas,
        }, viewer);
        return { content: JSON.stringify(result), isError: false };
      }
      case 'consultar_pipeline':
        return { content: await toolConsultarPipeline(env, viewer, input), isError: false };
      case 'listar_oportunidades':
        return { content: await toolListarOportunidades(env, viewer, input), isError: false };
      case 'detalle_oportunidad':
        return toolDetalleOportunidad(env, viewer, input);
      case 'listar_proyectos':
        return { content: await toolListarProyectos(env, viewer, input), isError: false };
      case 'consultar_inventario':
        return { content: await toolConsultarInventario(env, input), isError: false };
      case 'movimientos_inventario':
        return { content: await toolMovimientosInventario(env, input), isError: false };
      default:
        return { content: `Herramienta desconocida: ${name}`, isError: true };
    }
  } catch (err) {
    if (err instanceof CreateError || err instanceof OportunidadError) {
      return { content: `Error (${err.status}): ${err.message}`, isError: true };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { content: `Error interno: ${detail}`, isError: true };
  }
}
