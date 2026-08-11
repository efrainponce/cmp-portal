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
      padding: '3px 9px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
      maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', ...style,
    }}>
      {label}
    </div>
  );
}

/** Label al final de una línea de cotización tocada por "Ajustar línea"
 * (worker/lib/lineaAjustes.ts / proyectoCotizacionVirtual.ts, Efraín
 * 2026-08-11) — 'Dividida' para la línea origen y su hermana nueva, 'Editada'
 * para un retoque en el sitio sin versión. */
export function AjusteLabelBadge({ label }: { label: 'Dividida' | 'Editada' }) {
  const dividida = label === 'Dividida';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', marginLeft: 6, flexShrink: 0,
      font: 'var(--text-caption)', fontWeight: 600, whiteSpace: 'nowrap',
      color: dividida ? '#8a5cf6' : '#b5860b',
      background: dividida ? '#efe7fe' : '#fdf1d6',
      padding: '2px 7px', borderRadius: 999,
    }}>
      {label}
    </span>
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
      padding: '3px 8px', borderRadius: 'var(--radius-sm)', maxWidth: '100%', boxSizing: 'border-box',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...style,
    }}>
      {children}
    </div>
  );
}
