// Row of "Todos"-first selects for narrowing a list client-side (Vendedor /
// Compras / Estado on StageBoardList). Sized taller than the create-form
// Select so it's a comfortable click target in a filter toolbar. On mobile
// the selects would eat more than half the screen stacked inline, so they
// collapse behind a "Filtros" button that opens them in a Modal instead.
import { useState } from 'react';
import { useIsMobile } from '../../lib/useIsMobile';
import { Modal } from '../core/Modal';

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  fullWidth?: boolean;
}

const ALL_VALUE = 'all';

function FilterSelect({ label, value, onChange, options, fullWidth }: FilterSelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 36, font: 'var(--text-label)', color: value === ALL_VALUE ? 'var(--ink-tertiary)' : 'var(--ink)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0 10px',
        boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer',
        width: fullWidth ? '100%' : undefined,
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
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const activeCount = [
    vendedor !== ALL_VALUE,
    compras !== ALL_VALUE,
    etapaOptions && onEtapaChange ? (etapa ?? ALL_VALUE) !== ALL_VALUE : false,
  ].filter(Boolean).length;

  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          style={{
            height: 36, font: 'var(--text-label)', color: active ? 'var(--ink)' : 'var(--ink-secondary)',
            background: active ? 'var(--accent)22' : 'var(--bg-sunken)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '0 14px',
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          }}
        >
          Filtros{activeCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18,
              borderRadius: 'var(--radius-pill)', background: 'var(--accent)', color: '#fff', font: 'var(--text-caption)',
              padding: '0 5px',
            }}>{activeCount}</span>
          )}
        </button>
        {open && (
          <Modal title="Filtros" onClose={() => setOpen(false)} footer={
            <>
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
              <button
                onClick={() => setOpen(false)}
                style={{
                  height: 36, font: 'var(--text-label-strong)', color: '#fff', background: 'var(--accent)',
                  border: 'none', borderRadius: 'var(--radius-pill)', padding: '0 16px', cursor: 'pointer',
                }}
              >
                Listo
              </button>
            </>
          }>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FilterSelect label="Vendedor" value={vendedor} onChange={onVendedorChange} options={vendedorOptions} fullWidth />
              <FilterSelect label="Compras" value={compras} onChange={onComprasChange} options={comprasOptions} fullWidth />
              {etapaOptions && onEtapaChange && (
                <FilterSelect label="Estado" value={etapa ?? ALL_VALUE} onChange={onEtapaChange} options={etapaOptions} fullWidth />
              )}
            </div>
          </Modal>
        )}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
