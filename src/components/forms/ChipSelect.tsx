// One-click pill picker for small option sets (status columns with 2-3 labels) —
// same visual language as VersionChips, faster than opening a dropdown.
// Volver a hacer click en el chip elegido lo DESELECCIONA: antes, una vez
// tocado, el campo ya no se podía dejar vacío (Efraín, 2026-08-18).
export interface ChipOption { value: string; label: string }

interface ChipSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: ChipOption[];
}

export function ChipSelect({ value, onChange, options }: ChipSelectProps) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const isSelected = value === o.value;
        return (
          <div
            key={o.value}
            onClick={() => onChange(isSelected ? '' : o.value)}
            title={isSelected ? 'Click para quitar' : undefined}
            style={{
              cursor: 'pointer', font: 'var(--text-label-strong)', padding: '7px 14px',
              borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)',
              background: isSelected ? '#2b2925' : 'var(--bg-raised)',
              color: isSelected ? '#fff' : 'var(--ink-secondary)',
            }}
          >
            {o.label}
          </div>
        );
      })}
    </div>
  );
}
