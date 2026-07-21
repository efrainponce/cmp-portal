import type { MouseEventHandler, ReactNode } from 'react';

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
  activeColor?: string;
}

/** Sidebar navigation row: icon + label, active state via accent-tinted background/text. */
export function NavItem({ icon, label, active, collapsed, onClick, activeColor = 'var(--accent)' }: NavItemProps) {
  return (
    <div
      className="nav-item"
      onClick={onClick}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px',
        borderRadius: 'var(--radius-lg)', cursor: 'pointer',
        background: active ? activeColor + '1a' : 'transparent',
      }}
    >
      <div style={{ width: 16, height: 16, flex: 'none', color: active ? activeColor : '#877f6f' }}>{icon}</div>
      {!collapsed && (
        <div style={{ font: '600 10.5px var(--font-ui)', color: active ? activeColor : '#726d61', whiteSpace: 'nowrap' }}>
          {label}
        </div>
      )}
    </div>
  );
}
