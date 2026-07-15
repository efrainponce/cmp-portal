import type { ChangeEventHandler, CSSProperties } from 'react';

interface SearchInputProps {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  style?: CSSProperties;
}

/** Search box, as used on every board's header row. */
export function SearchInput({ value, onChange, placeholder = 'Buscar…', style }: SearchInputProps) {
  return (
    <div style={{
      flex: 1, maxWidth: 320, display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--bg-raised)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: '8px 12px', boxSizing: 'border-box', ...style,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-quiet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'var(--text-label)', color: 'var(--ink)' }}
      />
    </div>
  );
}
