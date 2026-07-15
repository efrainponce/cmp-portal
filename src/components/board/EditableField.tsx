// One writable field: label + input/textarea + save button. Used for the
// per-role writable columns (w:true) on Oportunidades' detail panel.
import type { ColMeta } from '../../lib/api';

interface EditableFieldProps {
  col: ColMeta;
  value: string;
  saving: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
}

export function EditableField({ col, value, saving, onChange, onSave }: EditableFieldProps) {
  const isLong = col.type === 'long_text';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ width: 160, flex: 'none', font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', paddingTop: 8 }}>
        {col.title}
      </div>
      {isLong ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={fieldStyle}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...fieldStyle, resize: undefined }}
        />
      )}
      <button
        onClick={onSave}
        disabled={saving}
        style={{
          font: 'var(--text-label-strong)', padding: '8px 12px', borderRadius: 'var(--radius-lg)',
          border: 'none', background: 'var(--accent)', color: '#fff',
          cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1, flex: 'none',
        }}
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  flex: 1, font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', resize: 'vertical', boxSizing: 'border-box',
};
