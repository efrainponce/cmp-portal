// Styled <select>, matching EditableField's input look. Used for dropdown/status/
// people/relation fields in create forms.
interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function Select({ value, onChange, options, placeholder = 'Seleccionar…' }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%', font: 'var(--text-body)', color: value ? 'var(--ink)' : 'var(--ink-quiet)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 10px',
        boxSizing: 'border-box', background: 'var(--bg-raised)',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
