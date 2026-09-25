import type { MouseEventHandler, ReactNode } from 'react';

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
  activeColor?: string;
  /** Contador de pendientes (p.ej. anuncios sin leer); 0/undefined no pinta nada.
   * Colapsado se pinta como punto, que es lo único que cabe a 60px de ancho. */
  badge?: number;
}

/** Sidebar navigation row: icon + label, active state via accent-tinted background/text. */
export function NavItem({ icon, label, active, collapsed, onClick, activeColor = 'var(--accent)', badge }: NavItemProps) {
  return (
    <div
      // El fondo (reposo/hover/activo) vive en src/index.css: puesto aquí en
      // línea le ganaba al :hover y el recuadro de hover nunca se pintaba.
      className={active ? 'nav-item is-active' : 'nav-item'}
      onClick={onClick}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px',
        borderRadius: 'var(--radius-lg)', cursor: 'pointer',
      }}
    >
      <div style={{ width: 16, height: 16, flex: 'none', color: active ? activeColor : 'var(--ink-quiet)', position: 'relative' }}>
        {icon}
        {collapsed && !!badge && (
          <span style={{
            position: 'absolute', top: -3, right: -3, width: 7, height: 7,
            borderRadius: '50%', background: 'var(--accent)',
          }} />
        )}
      </div>
      {!collapsed && (
        <div style={{ font: (active ? '500' : '400') + ' 10.5px var(--font-ui)', color: active ? 'var(--ink)' : 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>
          {label}
        </div>
      )}
      {!collapsed && !!badge && (
        <span style={{
          marginLeft: 'auto', minWidth: 16, height: 16, padding: '0 5px', boxSizing: 'border-box',
          borderRadius: 'var(--radius-pill)', background: 'var(--fill-active)', color: 'var(--ink-secondary)',
          font: '600 9px var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </div>
  );
}
