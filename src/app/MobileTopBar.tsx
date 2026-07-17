// Barra superior del shell móvil: hamburguesa + nombre del board activo.
// El menú reutiliza el Sidebar completo (mismas secciones/permisos) como
// panel deslizante sobre un scrim; seleccionar un board lo cierra.
import { useState } from 'react';
import { Sidebar, BOARD_LABELS, type BoardKey } from './Sidebar';

interface MobileTopBarProps {
  activeBoard: BoardKey;
  onSelectBoard: (key: BoardKey) => void;
}

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function MobileTopBar({ activeBoard, onSelectBoard }: MobileTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px',
        paddingTop: 'env(safe-area-inset-top)', height: 'calc(50px + env(safe-area-inset-top))',
        background: 'var(--surface-sidebar)', borderBottom: '1px solid var(--border)', flex: 'none', boxSizing: 'border-box',
      }}>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menú"
          style={{
            width: 40, height: 40, border: 'none', background: 'transparent', color: 'var(--ink)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none',
          }}
        >
          <IconMenu />
        </button>
        <div style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--ink)', flex: 'none' }} />
        <div style={{ font: '700 15px \'Inter\', sans-serif', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {BOARD_LABELS[activeBoard] ?? 'CMP Portal'}
        </div>
      </div>

      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'var(--overlay-scrim)', zIndex: 200, display: 'flex' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ height: '100%', overflowY: 'auto', boxShadow: 'var(--shadow-modal)', display: 'flex' }}
          >
            <Sidebar
              activeBoard={activeBoard}
              onSelectBoard={(key) => { setMenuOpen(false); onSelectBoard(key); }}
              collapsed={false}
              onToggleCollapsed={() => {}}
              hideCollapse
            />
          </div>
        </div>
      )}
    </>
  );
}
