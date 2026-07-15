// worker/wa/tools.ts — tool surface for the WhatsApp agent. Searches hit the D1
// mirror (never Monday directly); creates go through the same guarded paths the
// portal uses. Column ids from column-meta.gen.ts — never fabricate.
import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { submitCreate, CreateError } from '../lib/createRecord';
import { createOportunidad, OportunidadError, type LineaInput } from '../lib/createOportunidad';

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
    description: 'Crea un contacto nuevo en el CRM. Solo llamar después de que el vendedor confirmó explícitamente el resumen de los datos.',
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
    description: 'Crea una oportunidad de venta con sus líneas de producto. Solo llamar después de que el vendedor confirmó explícitamente el resumen. Cada línea debe traer producto_item_id si el producto se encontró en el catálogo con buscar_productos.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la oportunidad (ej. "Uniformes Hospital General León")' },
        contacto_item_id: { type: 'number', description: 'item_id del contacto en el CRM (de buscar_contactos), si aplica' },
        fecha_limite: { type: 'string', description: 'Fecha límite YYYY-MM-DD, si el vendedor la dio' },
        zona: { type: 'string', description: 'Zona de venta, solo si el vendedor la indicó' },
        lineas: {
          type: 'array',
          description: 'Líneas de producto (mínimo 1)',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'Nombre del producto tal como lo pidió el cliente' },
              producto_item_id: { type: 'number', description: 'item_id del producto en catálogo (de buscar_productos). Omitir SOLO si el producto no existe en catálogo y el vendedor confirmó que va fuera de catálogo.' },
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
];

interface MirrorRow { item_id: number; name: string; columns: string }

function colText(columnsJson: string, ids: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const cols = JSON.parse(columnsJson) as Array<{ id: string; text: string | null }>;
    const byId = new Map(cols.map(c => [c.id, c.text ?? '']));
    for (const [key, id] of Object.entries(ids)) {
      const t = byId.get(id);
      if (t) out[key] = t;
    }
  } catch { /* ignore malformed mirror rows */ }
  return out;
}

/** Mirror search: item name LIKE, plus optional extra text columns (e.g. SKU). */
async function searchMirror(
  env: Env,
  boardId: number,
  q: string,
  extraColIds: string[] = [],
): Promise<MirrorRow[]> {
  const like = `%${q.trim()}%`;
  let sql = `SELECT item_id, name, columns FROM items WHERE board_id = ? AND (name LIKE ? COLLATE NOCASE`;
  const binds: unknown[] = [boardId, like];
  if (extraColIds.length > 0) {
    const ph = extraColIds.map(() => '?').join(',');
    sql += ` OR EXISTS (SELECT 1 FROM json_each(items.columns) je
             WHERE json_extract(je.value,'$.id') IN (${ph})
             AND json_extract(je.value,'$.text') LIKE ? COLLATE NOCASE)`;
    binds.push(...extraColIds, like);
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

/** Execute one tool call; always returns a string for the tool_result. */
export async function runTool(
  env: Env,
  viewer: Identity,
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
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
