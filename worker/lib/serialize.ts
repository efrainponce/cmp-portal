// worker/lib/serialize.ts — mirror row -> role-scoped DTOs. Sole producer of ItemDTO/ColMeta.
import type { MirrorItem, Role } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';
import type { ItemDTO, ItemDetailDTO, ColVal, ColMeta } from '../../shared/dto';
import { VISIBILITY, readableCols, canWrite, puedeVerUtilidades } from '../../shared/visibility';
import { COLUMN_META } from '../../shared/column-meta.gen';

export interface RawCol {
  id: string;
  type: string;
  text: string | null;
  value: string | null;
}

// Only these types carry a meaningful parsed `value`; everything else is text-only.
// board_relation: value crudo es {linked_item_ids:[...]} (worker/lib/monday.ts) — se
// necesita el id, no solo el texto, para agrupar por proveedor (ProveedorGrid).
const PARSE_VALUE_TYPES = new Set(['numbers', 'status', 'people', 'board_relation']);

function buildColVal(col: RawCol): ColVal {
  const out: ColVal = { text: col.text ?? '', type: col.type };
  if (PARSE_VALUE_TYPES.has(col.type) && col.value) {
    try {
      out.value = JSON.parse(col.value);
    } catch {
      // malformed value from Monday — text-only is still useful
    }
  }
  return out;
}

// VISIBILITY es una const estática, así que (slug, role) -> columnas legibles es
// invariante durante toda la vida del isolate. toItemDTO corre una vez POR FILA
// (hasta 4000 en una lista, cada 5 s por usuario) y antes reconstruía el Set en
// cada llamada: readableCols recorre las ~40-100 columnas del board y arma un
// array nuevo. Memoizar deja ese trabajo en una sola vez por (board, rol).
const readableSetCache = new Map<string, Set<string>>();
function readableSet(slug: BoardSlug, role: Role, email?: string | null): Set<string> {
  // El correo NO entra en la llave: entra el booleano que decide. Son dos
  // variantes por (board, rol) —ve utilidades o no— en vez de una entrada por
  // persona, que con el poll de 5 s haría crecer el caché sin techo.
  const key = `${slug}:${role}:${puedeVerUtilidades(email) ? 'u' : '-'}`;
  let set = readableSetCache.get(key);
  if (!set) {
    set = new Set(readableCols(slug, role, email));
    readableSetCache.set(key, set);
  }
  return set;
}

/** `only` = proyección pedida por el cliente (?cols=). Se INTERSECTA con lo que
 * el rol puede leer, nunca lo amplía: `allowed` sigue mandando y `only` solo
 * puede quitar. Sirve para que una lista no arrastre las ~34 columnas del board
 * cuando pinta 8 (ver la ruta GET /items). */
export function toItemDTO(
  row: MirrorItem,
  slug: BoardSlug,
  role: Role,
  pendingWrite = false,
  only?: ReadonlySet<string>,
  /** Correo del viewer — decide si las cifras de utilidad/margen viajan
   * (shared/visibility.ts puedeVerUtilidades). Omitirlo las OCULTA: el default
   * es el seguro, ver la nota en utilidadTapada. */
  email?: string | null,
): ItemDTO {
  const allowed = readableSet(slug, role, email);
  let rawCols: RawCol[] = [];
  try {
    rawCols = JSON.parse(row.columns || '[]');
  } catch {
    rawCols = [];
  }
  const cols: Record<string, ColVal> = {};
  for (const col of rawCols) {
    if (!allowed.has(col.id)) continue;
    if (only && !only.has(col.id)) continue;
    cols[col.id] = buildColVal(col);
  }
  return {
    id: String(row.item_id),
    name: row.name,
    parentId: row.parent_item_id != null ? String(row.parent_item_id) : undefined,
    group: row.group_id ?? undefined,
    syncedAt: row.synced_at,
    mondayUpdatedAt: row.monday_updated_at,
    pendingWrite: pendingWrite || undefined,
    cols,
  };
}

/** ETag de CONTENIDO para el detalle de un item, ignorando `syncedAt`.
 *
 * `syncedAt` es la hora en que el espejo leyó a Monday, no un dato del
 * negocio: cambia en CADA relectura aunque la oportunidad sea idéntica. Si
 * entrara en la llave, el `?fresh=1` que dispara el drawer al abrir nunca
 * podría contestar 304 y siempre re-mandaría el cuerpo completo (~138 KB en
 * una oportunidad de 31 líneas) — que es justo lo que se quiere evitar. Se
 * ignora también en los `children` porque el replacer aplica a todo el árbol.
 *
 * El cliente recupera la hora real por el header `X-Synced-At`, así que un 304
 * sigue pudiendo actualizar el "sincronizado hace …" sin bajar el cuerpo. */
export async function itemDetailEtag(dto: ItemDetailDTO): Promise<string> {
  const canon = JSON.stringify(dto, (k, v) => (k === 'syncedAt' ? undefined : v));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  const hex = Array.from(new Uint8Array(digest).slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `"${hex}"`;
}

export function toColMeta(slug: BoardSlug, role: Role, email?: string | null): ColMeta[] {
  const boardVis = VISIBILITY[slug];
  const boardMeta = COLUMN_META[slug] ?? {};
  // Se parte de `readableSet`, la MISMA lista que filtra los valores, en vez de
  // releer `vis` por su cuenta: si no, el catálogo de columnas y los datos
  // pueden discrepar. Importa porque la grid arma `visibleCols` intersectando
  // contra este ColMeta (gridMeta.tsx) — quitar aquí Utilidad/Margen Gob es lo
  // que hace que desaparezcan del encabezado y de la fila de TOTAL, en vez de
  // quedarse como columnas vacías.
  const legibles = readableSet(slug, role, email);
  return Object.keys(boardVis)
    .filter(id => legibles.has(id))
    .map(id => {
      const meta = boardMeta[id];
      return {
        id,
        title: meta?.title ?? id,
        type: meta?.type ?? 'text',
        w: canWrite(slug, id, role) || undefined,
        labels: meta?.labels,
      };
    });
}
