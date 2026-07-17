import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

interface GroupCardProps {
  label: string;
  color: string;
  tint: string;
  count: number | string;
  children: ReactNode;
  flat?: boolean;
  /** Colapsada de entrada — útil cuando hay muchas etapas y se quiere ver solo una. */
  defaultCollapsed?: boolean;
  /** Colapso controlado por el padre (p.ej. persistido por viewer) — cuando
   * se pasa junto con onToggleCollapsed, GroupCard deja de llevar su propio
   * estado interno. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

function ChevronIcon({ collapsed, color }: { collapsed: boolean; color: string }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none', transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform .12s ease' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Grouped list card: colored-eyebrow header (dot + label + count) over a list
 * of flat white rows. Used for every board's pipeline columns. The header
 * doubles as a collapse toggle (">" que rota a "v") — con varias etapas a la
 * vista, colapsar las que no importan ahora mismo agiliza llegar a la que sí
 * (Efraín, 2026-07-16). */
export function GroupCard({
  label, color, tint, count, children, flat = false, defaultCollapsed = false,
  collapsed: collapsedProp, onToggleCollapsed,
}: GroupCardProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const isControlled = collapsedProp !== undefined;
  const collapsed = isControlled ? collapsedProp : internalCollapsed;
  const toggle = isControlled ? onToggleCollapsed! : () => setInternalCollapsed((c) => !c);
  const cardStyle: CSSProperties = flat
    ? { margin: '0 24px 0', borderBottom: '1px solid ' + color + '33' }
    : { margin: '0 24px 16px', borderRadius: 'var(--radius-2xl)', overflow: 'hidden', border: '1px solid ' + color + '33' };
  return (
    <div style={cardStyle}>
      <div
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', userSelect: 'none',
          padding: flat ? '8px 4px' : '10px 18px',
          background: tint, borderBottom: collapsed ? 'none' : '1px solid ' + color + '33',
        }}
      >
        <ChevronIcon collapsed={collapsed} color={color} />
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flex: 'none' }} />
        <div style={{ font: 'var(--text-eyebrow)', color, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
        <div style={{ font: 'var(--text-chip)', color: '#fff', background: color, padding: '1px 7px', borderRadius: 'var(--radius-pill)' }}>{count}</div>
      </div>
      {!collapsed && children}
    </div>
  );
}
