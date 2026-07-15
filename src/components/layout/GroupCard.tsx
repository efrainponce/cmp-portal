import type { CSSProperties, ReactNode } from 'react';

interface GroupCardProps {
  label: string;
  color: string;
  tint: string;
  count: number | string;
  children: ReactNode;
  flat?: boolean;
}

/** Grouped list card: colored-eyebrow header (dot + label + count) over a list of flat white rows. Used for every board's pipeline columns. */
export function GroupCard({ label, color, tint, count, children, flat = false }: GroupCardProps) {
  const cardStyle: CSSProperties = flat
    ? { margin: '0 24px 0', borderBottom: '1px solid ' + color + '33' }
    : { margin: '0 24px 16px', borderRadius: 'var(--radius-2xl)', overflow: 'hidden', border: '1px solid ' + color + '33' };
  return (
    <div style={cardStyle}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: flat ? '8px 4px' : '10px 18px',
        background: tint, borderBottom: '1px solid ' + color + '33',
      }}>
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flex: 'none' }} />
        <div style={{ font: 'var(--text-eyebrow)', color, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
        <div style={{ font: 'var(--text-chip)', color: '#fff', background: color, padding: '1px 7px', borderRadius: 'var(--radius-pill)' }}>{count}</div>
      </div>
      {children}
    </div>
  );
}
