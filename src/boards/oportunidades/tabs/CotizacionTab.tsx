// Cotización / línea de producto grid — mirrors the design's fixed-column
// table. Each column is keyed to its real Monday column id; columns the
// viewer's role can't see simply aren't in `cols` and are skipped (server
// already strips them — see docs/dev-contracts.md).
//
// In the `costeo` variant, columns the server marked writable for the
// viewer's role (`ColMeta.w`, from shared/visibility.ts) render as inputs.
// Editing one recomputes the row's formula columns locally (src/lib/costeoCalc.ts,
// verified 1:1 against Monday's own formulas) for an instant preview, then
// PATCHes only the raw input on blur — formula columns are never written
// back, Monday recomputes those itself and the mirror catches up on refetch.
import { useState } from 'react';
import type { ColMeta, ColVal, ItemDTO, QuoteVersionDTO } from '../../../lib/api';
import { patchItem } from '../../../lib/apiClient';
import { fmtMoney } from '../../../lib/format';
import { MonoTag, StatusBadge } from '../../../components/core/Badges';
import { previewRow, COL } from '../../../lib/costeoCalc';

const COSTO_DISTR_COL = 'numeric_mm0bph99';
const ETAPA_COSTEO_COL = 'color_mm084gvf';

// Solo estas columnas son editables inline en el grid — captura de costos
// (compras/admin) y precio de venta (vendedor/admin). Cantidad/Producto/Color/
// Embellecimiento también son `col.w` para el vendedor (los necesita
// NuevaVersionForm), pero deben editarse SOLO vía "Nueva versión" para que
// quede archivada y dispare el reenvío a costeo — nunca inline sin versionar.
const INLINE_EDITABLE_COLS = new Set<string>([
  COL.costoDistr, COL.descuentoPct, COL.conversion, COL.gastosPct, COL.embellecimiento,
  COL.precio,
]);

// Colores reales de la columna status "Etapa Costeo" en Monday (settings_str),
// no inventados — docs/monday-column-map.md.
const ETAPA_COSTEO_COLORS: Record<string, { color: string; tint: string }> = {
  'No iniciado': { color: '#68737d', tint: '#e6e9eb' },
  'En curso': { color: '#e99729', tint: '#fdecd7' },
  'Listo': { color: '#00b461', tint: '#d6f5e6' },
  'Detenido': { color: '#ce3048', tint: '#fbdbdf' },
  'Modificado': { color: '#3db0df', tint: '#dbf0fa' },
};

/** Chips V1/V2… — vigente resaltada. Seleccionar una anterior muestra su
 * instantánea (solo lectura, sin fórmulas: esas solo existen para la vigente).
 * "Enviar a costeo" junto a la vigente abre el draft de nueva versión — crear
 * una versión ES la forma de mandar cambios de línea a costeo otra vez. */
function VersionChips({
  versions, selected, onSelect, onNuevaVersion,
}: {
  versions: QuoteVersionDTO[]; selected: number | null; onSelect: (id: number | null) => void;
  onNuevaVersion?: () => void;
}) {
  if (versions.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      {versions.map((v) => {
        const isSelected = selected === null ? v.status === 'vigente' : selected === v.id;
        return (
          <div
            key={v.id}
            onClick={() => onSelect(v.status === 'vigente' ? null : v.id)}
            title={v.status === 'vigente' ? 'Vigente' : `Superada — ${v.createdAt}`}
            style={{
              cursor: 'pointer', font: 'var(--text-label-strong)', padding: '4px 12px',
              borderRadius: 'var(--radius-pill)',
              background: isSelected ? '#2b2925' : 'var(--bg-sunken)',
              color: isSelected ? '#fff' : 'var(--ink-secondary)',
            }}
          >
            {v.label}{v.status === 'vigente' ? ' · vigente' : ''}
          </div>
        );
      })}
      {onNuevaVersion && (
        <div
          onClick={onNuevaVersion}
          title="Crea una nueva versión de la cotización y la manda a costeo"
          style={{
            cursor: 'pointer', font: 'var(--text-label-strong)', padding: '4px 12px',
            borderRadius: 'var(--radius-pill)', border: '1px dashed var(--border)',
            color: 'var(--accent)', background: 'transparent',
          }}
        >
          + Enviar a costeo
        </div>
      )}
    </div>
  );
}

function SnapshotTable({ version }: { version: QuoteVersionDTO }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1.6fr .5fr .7fr .7fr .85fr .85fr',
        padding: '9px 14px', background: 'var(--bg-sunken)', font: '700 9.5px \'Inter\', sans-serif',
        color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.3px',
      }}>
        <div>Producto</div><div>SKU</div><div>Color</div><div>Cant.</div>
        <div style={{ textAlign: 'right' }}>P. venta C/U</div><div style={{ textAlign: 'right' }}>Subtotal</div>
      </div>
      {version.products.map((p, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '1.6fr .5fr .7fr .7fr .85fr .85fr',
          alignItems: 'center', padding: '9px 14px', background: '#fff', borderTop: '1px solid var(--border-subtle)',
          font: 'var(--text-label)', color: 'var(--ink-secondary)',
        }}>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>
            {p.producto}{p.embellecimiento ? ' 🎨' : ''}
          </div>
          <div>{p.sku ? <MonoTag style={{ display: 'inline-block' }}>{p.sku}</MonoTag> : '—'}</div>
          <div>{p.color || '—'}</div>
          <div>{p.cantidad}</div>
          <div style={{ textAlign: 'right' }}>{p.precioUnitario ? fmtMoney(p.precioUnitario) : '—'}</div>
          <div style={{ textAlign: 'right' }}>{fmtMoney((p.precioUnitario ?? 0) * p.cantidad)}</div>
        </div>
      ))}
    </div>
  );
}

interface GridCol {
  id: string;
  label: string;
  align: 'left' | 'right';
  kind: 'text' | 'money' | 'percent';
}

const GRID_COLS_COSTEO: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text' },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text' },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text' },
  { id: ETAPA_COSTEO_COL, label: 'Etapa costeo', align: 'left', kind: 'text' },
  { id: 'lookup_mm11t8gj', label: 'Moneda', align: 'left', kind: 'text' },
  { id: 'numeric_mm0bph99', label: 'Costo distr. C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mkzn2q51', label: 'Desc. %', align: 'right', kind: 'percent' },
  { id: 'formula_mkzngnjm', label: 'Costo real C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mm0rvhgs', label: 'Conversión', align: 'right', kind: 'text' },
  { id: 'numeric_mkzngs9x', label: 'Gastos %', align: 'right', kind: 'percent' },
  { id: 'numeric_mm0gxvpa', label: 'Costo embell. C/U', align: 'right', kind: 'money' },
  { id: 'formula_mkznpfgg', label: 'Costo total C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mkzneg3d', label: 'P. venta', align: 'right', kind: 'money' },
  { id: 'formula_mkznpw5p', label: 'Margen', align: 'right', kind: 'percent' },
];

// Ventas-side view: no cost breakdown, just what the customer is quoted.
const GRID_COLS_VENTA: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text' },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text' },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text' },
  { id: 'numeric_mkzneg3d', label: 'P. venta C/U', align: 'right', kind: 'money' },
  { id: 'formula_mkznmjh6', label: 'Subtotal', align: 'right', kind: 'money' },
  { id: 'formula_mm0rtdqp', label: 'IVA', align: 'right', kind: 'money' },
  { id: 'formula_mm00xy0n', label: 'Total c/IVA', align: 'right', kind: 'money' },
];

function cellValue(col: GridCol, val?: ColVal): string {
  if (!val || val.text === '') return '—';
  if (col.kind === 'money') {
    const n = Number(val.value ?? val.text);
    return Number.isNaN(n) ? val.text : fmtMoney(n);
  }
  if (col.kind === 'percent') {
    const n = Number(val.value ?? val.text);
    return Number.isNaN(n) ? val.text : `${n}%`;
  }
  return val.text;
}

const inputStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px',
  textAlign: 'right', boxSizing: 'border-box',
};

interface RowEditState {
  editing: Record<string, string>;   // colId -> in-progress raw text
  preview: Record<string, ColVal>;   // colId -> locally recomputed formula preview
  saving: Record<string, boolean>;   // colId -> PATCH in flight
  error?: string;
}

const EMPTY_ROW: RowEditState = { editing: {}, preview: {}, saving: {} };

export function CotizacionTab({
  subCols, products, variant = 'venta', onSaved, versions = [], onNuevaVersion,
}: {
  subCols: ColMeta[]; products: ItemDTO[]; variant?: 'venta' | 'costeo'; onSaved?: () => void;
  versions?: QuoteVersionDTO[]; onNuevaVersion?: () => void;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const selectedVersion = selectedVersionId != null ? versions.find((v) => v.id === selectedVersionId) : undefined;

  const gridCols = variant === 'costeo' ? GRID_COLS_COSTEO : GRID_COLS_VENTA;
  const visibleCols = gridCols.filter((gc) => subCols.some((c) => c.id === gc.id));
  const writableIds = new Set(subCols.filter((c) => c.w).map((c) => c.id));

  const [rows, setRows] = useState<Record<string, RowEditState>>({});
  const rowState = (id: string): RowEditState => rows[id] ?? EMPTY_ROW;
  const patchRow = (id: string, patch: Partial<RowEditState>) =>
    setRows((r) => ({ ...r, [id]: { ...rowState(id), ...patch } }));

  const onEdit = (product: ItemDTO, colId: string, raw: string) => {
    const state = rowState(product.id);
    const editing = { ...state.editing, [colId]: raw };
    const edited: Record<string, number> = {};
    for (const [k, v] of Object.entries(editing)) {
      const n = parseFloat(v);
      if (Number.isFinite(n)) edited[k] = n;
    }
    const preview = Number.isFinite(parseFloat(raw)) ? previewRow(product, edited) : state.preview;
    patchRow(product.id, { editing, preview, error: undefined });
  };

  const onBlur = async (product: ItemDTO, colId: string) => {
    const state = rowState(product.id);
    const raw = state.editing[colId];
    if (raw === undefined) return;
    const current = product.cols[colId]?.text ?? '';
    if (raw.trim() === '' || raw === current) {
      const editing = { ...state.editing };
      delete editing[colId];
      patchRow(product.id, { editing });
      return;
    }
    if (!Number.isFinite(parseFloat(raw))) {
      patchRow(product.id, { error: 'Valor inválido.' });
      return;
    }
    patchRow(product.id, { saving: { ...state.saving, [colId]: true }, error: undefined });
    try {
      await patchItem('oportunidades_sub', product.id, { [colId]: raw });
    } catch (e) {
      const after = rowState(product.id);
      const saving = { ...after.saving };
      delete saving[colId];
      patchRow(product.id, { saving, error: e instanceof Error ? e.message : 'No se pudo guardar.' });
      return;
    }
    const after = rowState(product.id);
    const editing = { ...after.editing };
    delete editing[colId];
    const saving = { ...after.saving };
    delete saving[colId];
    patchRow(product.id, { editing, saving });
    onSaved?.();
  };

  if (selectedVersion) {
    return (
      <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} />
        <SnapshotTable version={selectedVersion} />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
        Sin líneas de producto registradas.
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
      <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
        <div style={variant === 'costeo' ? { minWidth: 900 } : undefined}>
          <div style={{
            display: 'grid', gridTemplateColumns: `1.6fr ${visibleCols.slice(1).map(() => '.85fr').join(' ')}`,
            padding: '9px 14px', background: 'var(--bg-sunken)', font: '700 9.5px \'Inter\', sans-serif',
            color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.3px',
          }}>
            {visibleCols.map((c) => (
              <div key={c.id} style={{ textAlign: c.align }}>{c.label}</div>
            ))}
          </div>
          {products.map((p) => {
            const state = rowState(p.id);
            return (
              <div key={p.id} style={{ borderTop: '1px solid var(--border-subtle)', background: '#fff' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: `1.6fr ${visibleCols.slice(1).map(() => '.85fr').join(' ')}`,
                  alignItems: 'center', padding: '9px 14px',
                }}>
                  {visibleCols.map((c, idx) => {
                    const writable = variant === 'costeo' && writableIds.has(c.id) && INLINE_EDITABLE_COLS.has(c.id);
                    const displayVal = state.preview[c.id] ?? p.cols[c.id];
                    if (writable) {
                      const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <input
                            type="number"
                            value={raw}
                            disabled={!!state.saving[c.id]}
                            onChange={(e) => onEdit(p, c.id, e.target.value)}
                            onBlur={() => onBlur(p, c.id)}
                            style={inputStyle}
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={c.id} style={{
                        textAlign: c.align,
                        font: idx === 0 ? 'var(--text-body-strong)' : 'var(--text-label)',
                        color: idx === 0 ? 'var(--ink)' : 'var(--ink-secondary)',
                      }}>
                        {idx === 0 && p.pendingWrite && <span title="guardado, sincronizando…" style={{ marginRight: 6, color: 'var(--accent)' }}>⏳</span>}
                        {idx === 0 && variant === 'costeo' && !p.cols[COSTO_DISTR_COL]?.text && (
                          <StatusBadge label="Pendiente de costeo" color="#9c4c3d" tint="#f3e5e1" style={{ marginRight: 6 }} />
                        )}
                        {c.id === 'lookup_mkzn7x9a' && (
                          <MonoTag style={{ display: 'inline-block' }}>{cellValue(c, displayVal)}</MonoTag>
                        )}
                        {c.id === ETAPA_COSTEO_COL && (() => {
                          const label = cellValue(c, displayVal);
                          const colors = ETAPA_COSTEO_COLORS[label] ?? ETAPA_COSTEO_COLORS['No iniciado'];
                          return label === '—'
                            ? '—'
                            : <StatusBadge label={label} color={colors.color} tint={colors.tint} />;
                        })()}
                        {c.id !== 'lookup_mkzn7x9a' && c.id !== ETAPA_COSTEO_COL && cellValue(c, displayVal)}
                      </div>
                    );
                  })}
                </div>
                {state.error && (
                  <div style={{ padding: '0 14px 8px', font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
                    {state.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
