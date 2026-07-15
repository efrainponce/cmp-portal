// Row of "Todos"-first selects for narrowing a list client-side (Vendedor /
// Compras / Estado on StageBoardList). Sized taller than the create-form
// Select so it's a comfortable click target in a filter toolbar.
export interface FilterOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
}

const ALL_VALUE = 'all';

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 36, font: 'var(--text-label)', color: value === ALL_VALUE ? 'var(--ink-tertiary)' : 'var(--ink)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0 10px',
        boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer',
      }}
    >
      <option value={ALL_VALUE}>{label}: Todos</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

interface FilterBarProps {
  vendedor: string;
  onVendedorChange: (v: string) => void;
  vendedorOptions: FilterOption[];
  compras: string;
  onComprasChange: (v: string) => void;
  comprasOptions: FilterOption[];
  etapa?: string;
  onEtapaChange?: (v: string) => void;
  etapaOptions?: FilterOption[];
  active: boolean;
  onClear: () => void;
}

export function FilterBar({
  vendedor, onVendedorChange, vendedorOptions,
  compras, onComprasChange, comprasOptions,
  etapa, onEtapaChange, etapaOptions,
  active, onClear,
}: FilterBarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
      <FilterSelect label="Vendedor" value={vendedor} onChange={onVendedorChange} options={vendedorOptions} />
      <FilterSelect label="Compras" value={compras} onChange={onComprasChange} options={comprasOptions} />
      {etapaOptions && onEtapaChange && (
        <FilterSelect label="Estado" value={etapa ?? ALL_VALUE} onChange={onEtapaChange} options={etapaOptions} />
      )}
      {active && (
        <button
          onClick={onClear}
          style={{
            height: 36, font: 'var(--text-label)', color: 'var(--ink-secondary)', background: 'var(--bg-sunken)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '0 14px', cursor: 'pointer',
          }}
        >
          Limpiar
        </button>
      )}
    </div>
  );
}

export { ALL_VALUE };
