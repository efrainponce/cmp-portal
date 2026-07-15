import type { CSSProperties, ReactNode } from 'react';

interface StatusBadgeProps {
  label: string;
  color: string;
  tint: string;
  style?: CSSProperties;
}

/** Rounded chip pairing a status color with its pale tint background — the board's core semantic-status indicator. */
export function StatusBadge({ label, color, tint, style }: StatusBadgeProps) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      font: 'var(--text-chip)', color, background: tint,
      padding: '3px 9px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap', ...style,
    }}>
      {label}
    </div>
  );
}

interface CountBadgeProps {
  count: number | string;
  color: string;
  style?: CSSProperties;
}

/** Solid pill with white text — used for item counts on group headers. */
export function CountBadge({ count, color, style }: CountBadgeProps) {
  return (
    <div style={{
      font: 'var(--text-chip)', color: '#fff', background: color,
      padding: '1px 7px', borderRadius: 'var(--radius-pill)', ...style,
    }}>
      {count}
    </div>
  );
}

interface MonoTagProps {
  children: ReactNode;
  style?: CSSProperties;
}

/** Monospace tag for identifiers — folios, SKUs — on a flat sunken chip. */
export function MonoTag({ children, style }: MonoTagProps) {
  return (
    <div style={{
      font: 'var(--text-mono)', color: 'var(--ink-quiet)', background: 'var(--bg-sunken)',
      padding: '3px 8px', borderRadius: 'var(--radius-sm)', ...style,
    }}>
      {children}
    </div>
  );
}
