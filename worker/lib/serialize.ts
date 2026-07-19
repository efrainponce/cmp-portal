// worker/lib/serialize.ts — mirror row -> role-scoped DTOs. Sole producer of ItemDTO/ColMeta.
import type { MirrorItem, Role } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';
import type { ItemDTO, ColVal, ColMeta } from '../../shared/dto';
import { VISIBILITY, readableCols, canWrite } from '../../shared/visibility';
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

export function toItemDTO(row: MirrorItem, slug: BoardSlug, role: Role, pendingWrite = false): ItemDTO {
  const allowed = new Set(readableCols(slug, role));
  let rawCols: RawCol[] = [];
  try {
    rawCols = JSON.parse(row.columns || '[]');
  } catch {
    rawCols = [];
  }
  const cols: Record<string, ColVal> = {};
  for (const col of rawCols) {
    if (!allowed.has(col.id)) continue;
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

export function toColMeta(slug: BoardSlug, role: Role): ColMeta[] {
  const boardVis = VISIBILITY[slug];
  const boardMeta = COLUMN_META[slug] ?? {};
  return Object.keys(boardVis)
    .filter(id => boardVis[id].vis.includes(role))
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
