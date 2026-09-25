// Grupo del sidebar colapsado (Jorge, 2026-09-24, "como HubSpot"): una sección
// entera (Ventas, Proyectos, Catálogos) se vuelve UN ícono, y al pasar el mouse
// sale un panel flotante con sus opciones. Sin esto, el sidebar colapsado
// apilaba ~20 íconos sueltos que no se distinguían entre sí.
//
// El panel va por portal a document.body, igual que la campana
// (NotificationBell): el contenedor del sidebar tiene overflow hidden y
// recortaría un panel absoluto.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavItem } from './NavItem';

export interface NavGroupItem<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
}

interface NavGroupProps<K extends string> {
  label: string;
  icon: ReactNode;
  items: NavGroupItem<K>[];
  activeKey: K;
  onSelect: (key: K) => void;
}

// Margen para cruzar del ícono al panel sin que se cierre: al salir del ícono
// se agenda el cierre, y entrar al panel lo cancela.
const CLOSE_DELAY_MS = 180;
const GAP = 10;
const EDGE = 8;

export function NavGroup<K extends string>({ label, icon, items, activeKey, onSelect }: NavGroupProps<K>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const active = items.some((i) => i.key === activeKey);

  const cancelClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top - 6, left: r.right + GAP });
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const closeNow = () => {
    cancelClose();
    setOpen(false);
  };

  useEffect(() => cancelClose, []);

  // Catálogos vive abajo: si el panel no cabe hacia abajo, se sube lo necesario
  // en vez de salirse de la ventana. Se mide ya pintado, antes de que se vea.
  useLayoutEffect(() => {
    if (!open || !pos || !panelRef.current) return;
    const h = panelRef.current.offsetHeight;
    const maxTop = window.innerHeight - EDGE - h;
    if (pos.top > maxTop) setPos({ ...pos, top: Math.max(EDGE, maxTop) });
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNow(); };
    // Abierto con tap/clic (touch, teclado), no hay mouseleave que lo cierre.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      closeNow();
    };
    // Más simple que reposicionar: al hacer scroll o cambiar el tamaño, se cierra.
    // Salvo el scroll del propio panel (pantallas bajas), que es para usarlo.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      closeNow();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  return (
    <>
      <div
        ref={anchorRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        // Clic ABRE, no alterna: con mouse el panel ya se abrió al pasar por
        // encima, y un clic que lo cerrara se sentiría roto.
        onClick={openNow}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (open) closeNow(); else openNow();
          }
        }}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        // Sin `title`: el tooltip nativo se encimaba con el panel y salía recortado.
        className={active || open ? 'nav-item is-active' : 'nav-item'}
        style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }}
      >
        <div style={{ width: 16, height: 16, flex: 'none', color: active ? 'var(--accent)' : 'var(--ink-quiet)' }}>
          {icon}
        </div>
      </div>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
          // Hereda los tokens verdes del sidebar: panel oscuro, como el de HubSpot.
          className="sidebar-verde"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000,
            minWidth: 220, maxHeight: `calc(100vh - ${EDGE * 2}px)`, overflowY: 'auto',
            background: 'var(--surface-sidebar)', border: '1px solid var(--border)',
            // Sombra más marcada que --shadow-modal: un panel verde sobre el
            // contenido claro necesita despegarse más que uno blanco.
            borderRadius: 'var(--radius-xl)', boxShadow: '0 14px 36px -10px rgba(0, 0, 0, .38)',
            padding: '12px 8px 8px', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          <div style={{ font: '600 12px var(--font-ui)', color: 'var(--ink)', padding: '0 10px 8px' }}>
            {label}
          </div>
          {items.map((item) => (
            <NavItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={item.key === activeKey}
              onClick={() => { onSelect(item.key); closeNow(); }}
            />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
