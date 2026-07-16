// Offline-only fallback so the Oportunidades board still demos when the
// worker isn't running. Reuses the design-prototype mock (src/data/oportunidades.ts).
// Column ids reused here are real ids from shared/visibility.ts — never fabricated —
// but the Producto/SKU/Subtotal/IVA/Total mapping onto them is a placeholder for this
// offline demo path only; it is never used once /api answers.
import type { BoardSlug } from '../../shared/boards';
import type { ColMeta, ItemDTO, ItemDetailDTO, ListResponse } from '../../shared/dto';
import { opportunities, statuses, fmtMoney, type Opportunity } from '../data/oportunidades';
import type { BoardMeta } from './apiClient';
import { textIncludes } from './textMatch';

const OPP_COLS: ColMeta[] = [
  { id: 'name', title: 'Cliente', type: 'text' },
  { id: 'pulse_id_mm0qcq0m', title: 'Folio', type: 'text' },
  { id: 'lookup_mm1bs976', title: 'Institución', type: 'text' },
  { id: 'deal_owner', title: 'Vendedor', type: 'text' },
  {
    id: 'deal_stage', title: 'Etapa', type: 'color',
    labels: Object.fromEntries(statuses.map((s) => [s.key, { label: s.label, color: s.color }])),
  },
  { id: 'lookup_mm0xf2r5', title: 'Valor estimado', type: 'text' },
  { id: 'date_mm09mv5b', title: 'Actualizado', type: 'text' },
  { id: 'text_mm0gje0', title: 'Vigencia', type: 'text', w: true },
  { id: 'text_mm0gjrrd', title: 'Tiempo de entrega', type: 'text', w: true },
  { id: 'long_text_mm1m416j', title: 'Comentarios', type: 'long_text', w: true },
];

const SUB_COLS: ColMeta[] = [
  { id: 'name', title: 'Producto', type: 'text' },
  { id: 'text_mm0bxy39', title: 'SKU', type: 'text' },
  { id: 'numeric_mkzm6399', title: 'Cantidad', type: 'numeric' },
  { id: 'numeric_mkzneg3d', title: 'Precio de Venta C/U', type: 'numeric' },
  { id: 'formula_mkznmjh6', title: 'Subtotal', type: 'formula' },
  { id: 'formula_mm0rtdqp', title: 'IVA', type: 'formula' },
  { id: 'formula_mm00xy0n', title: 'Total', type: 'formula' },
];

export function mockBoardMeta(): BoardMeta[] {
  return [
    { slug: 'oportunidades', title: 'Oportunidades', cols: OPP_COLS },
    { slug: 'oportunidades_sub', title: 'Líneas de Oportunidad', cols: SUB_COLS },
  ];
}

// Local-only drafts so inline edits "stick" for the rest of the offline demo session.
const editableDrafts: Record<string, Record<string, string>> = {};

export function mockPatch(id: string, cols: Record<string, string>): void {
  editableDrafts[id] = { ...editableDrafts[id], ...cols };
}

function oppToItem(o: Opportunity): ItemDTO {
  const draft = editableDrafts[o.id] ?? {};
  return {
    id: o.id,
    name: o.cliente,
    group: o.statusKey,
    syncedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    mondayUpdatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    cols: {
      name: { text: o.cliente, type: 'text' },
      pulse_id_mm0qcq0m: { text: o.folio, type: 'text' },
      lookup_mm1bs976: { text: o.institucion, type: 'text' },
      deal_owner: { text: o.vendedor, type: 'text' },
      deal_stage: { text: statuses.find((s) => s.key === o.statusKey)?.label ?? o.statusKey, value: o.statusKey, type: 'color' },
      lookup_mm0xf2r5: { text: o.valor, type: 'text' },
      date_mm09mv5b: { text: o.updated, type: 'text' },
      text_mm0gje0: { text: draft.text_mm0gje0 ?? '', type: 'text' },
      text_mm0gjrrd: { text: draft.text_mm0gjrrd ?? '', type: 'text' },
      long_text_mm1m416j: { text: draft.long_text_mm1m416j ?? '', type: 'long_text' },
    },
  };
}

export function mockList(slug: BoardSlug, q: string): ListResponse | null {
  if (slug !== 'oportunidades') return null;
  // Accent/case-insensitive, same fields + normalization as the client-side
  // filter in StageBoardList, so offline demo search behaves like the real one.
  const items = opportunities
    .filter((o) => textIncludes([o.cliente, o.institucion, o.folio, o.vendedor].join(' '), q))
    .map(oppToItem);
  return { board: slug, items, total: items.length, etag: 'offline-' + items.length };
}

export function mockItemDetail(slug: BoardSlug, id: string): ItemDetailDTO | null {
  if (slug !== 'oportunidades') return null;
  const o = opportunities.find((opp) => opp.id === id);
  if (!o) return null;
  const item = oppToItem(o);
  const children: ItemDTO[] = o.products.map((p, i) => {
    const subtotal = p.precioUnitario * p.cantidad;
    return {
      id: `${o.id}-line-${i}`,
      name: p.producto,
      parentId: o.id,
      syncedAt: item.syncedAt,
      mondayUpdatedAt: item.mondayUpdatedAt,
      cols: {
        name: { text: p.producto, type: 'text' },
        text_mm0bxy39: { text: p.sku, type: 'text' },
        numeric_mkzm6399: { text: String(p.cantidad), value: p.cantidad, type: 'numeric' },
        numeric_mkzneg3d: { text: fmtMoney(p.precioUnitario), value: p.precioUnitario, type: 'numeric' },
        formula_mkznmjh6: { text: fmtMoney(subtotal), type: 'formula' },
        formula_mm0rtdqp: { text: fmtMoney(subtotal * 0.16), type: 'formula' },
        formula_mm00xy0n: { text: fmtMoney(subtotal * 1.16), type: 'formula' },
      },
    };
  });
  return { ...item, children };
}
