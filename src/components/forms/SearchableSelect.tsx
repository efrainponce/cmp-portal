// Searchable combobox — same visual shell as Select.tsx but with a type-to-filter
// popover instead of the native (unsearchable) dropdown. Options list is rendered
// through a portal in fixed position so it isn't clipped by Modal's overflow:auto
// body when the field sits near the bottom of a tall form.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SearchableOption { value: string; label: string; sublabel?: string }

interface SearchableSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  disabledMessage?: string;
}

const DIACRITICS = /[̀-ͯ]/g;
function norm(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

const fieldStyle = {
  width: '100%', font: 'var(--text-body)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box',
  background: 'var(--bg-raised)',
} as const;

export function SearchableSelect({
  value, onChange, options, placeholder = 'Buscar…', emptyMessage = 'Sin resultados.',
  disabled, disabledMessage,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter((o) => norm(o.label).includes(q) || (o.sublabel && norm(o.sublabel).includes(q)));
  }, [options, query]);

  useEffect(() => { setActiveIndex(0); }, [query, open]);

  const updateRect = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  const openList = () => {
    if (disabled) return;
    updateRect();
    setQuery('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    updateRect();
    const onScroll = () => updateRect();
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open]);

  const choose = (opt: SearchableOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { openList(); return; } setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); const opt = filtered[activeIndex]; if (opt) choose(opt); return; }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={open ? query : (selected?.label ?? '')}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={disabled ? (disabledMessage ?? placeholder) : placeholder}
        disabled={disabled}
        style={{
          ...fieldStyle,
          color: disabled ? 'var(--ink-faint)' : (selected || open ? 'var(--ink)' : 'var(--ink-quiet)'),
          cursor: disabled ? 'not-allowed' : 'text',
          background: disabled ? 'var(--bg-sunken)' : 'var(--bg-raised)',
        }}
      />
      {open && rect && createPortal(
        <div
          style={{
            position: 'fixed', top: rect.top, left: rect.left, width: rect.width,
            maxHeight: 260, overflowY: 'auto', background: 'var(--bg-raised)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-modal)', zIndex: 300,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>{emptyMessage}</div>
          ) : filtered.map((o, i) => (
            <div
              key={o.value}
              className="row-hover"
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                padding: '8px 12px', cursor: 'pointer', font: 'var(--text-label)',
                color: 'var(--ink)', background: i === activeIndex ? 'var(--bg-sunken)' : 'transparent',
              }}
            >
              {o.label}
              {o.sublabel && <span style={{ color: 'var(--ink-quiet)' }}> · {o.sublabel}</span>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
