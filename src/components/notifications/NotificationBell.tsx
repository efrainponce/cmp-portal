// Campana del centro de notificaciones — vive en el header del Sidebar
// (desktop) y en la barra superior móvil. Popover anclado en desktop,
// hoja de pantalla completa en móvil (mismo patrón que ChatBubble/menú móvil).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '../../lib/useIsMobile';
import { useNotifications } from '../../lib/notificationsApi';
import { NotificationCenter } from './NotificationCenter';

interface NotificationBellProps {
  onNavigate: (boardKey: string, itemId: string | null) => void;
  collapsed?: boolean;
}

function IconBell() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 13 6 8Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

const PANEL_WIDTH = 360;

export function NotificationBell({ onNavigate }: NotificationBellProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // El popover se renderiza en un portal: la campana vive dentro del contenedor
  // con scroll del sidebar (overflow hidden), que recortaba un panel absoluto.
  const [rect, setRect] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { notifications, unread, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    if (!open || isMobile) return;
    const updateRect = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = r.bottom + 6;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8));
      setRect({ top, left, maxHeight: Math.max(200, window.innerHeight - top - 12) });
    };
    updateRect();
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, isMobile]);

  const badgeCount = unread.importante > 0 ? (unread.importante > 9 ? '9+' : String(unread.importante)) : null;
  const showQuietDot = !badgeCount && unread.actualizacion > 0;

  const handleNavigate = (boardKey: string, itemId: string | null) => {
    onNavigate(boardKey, itemId);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notificaciones"
        title="Notificaciones"
        style={{
          width: 32, height: 32, border: 'none', background: 'transparent', color: 'var(--ink-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative',
          flex: 'none', padding: 0, borderRadius: 'var(--radius-md)',
        }}
      >
        <IconBell />
        {badgeCount && (
          <span style={{
            position: 'absolute', top: 1, right: 1, minWidth: 14, height: 14, padding: '0 3px',
            borderRadius: 'var(--radius-pill)', background: 'var(--status-perdida)', color: '#fff',
            font: '700 8.5px \'Inter\', sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, boxSizing: 'border-box',
          }}>
            {badgeCount}
          </span>
        )}
        {showQuietDot && (
          <span style={{
            position: 'absolute', top: 4, right: 4, width: 7, height: 7,
            borderRadius: 'var(--radius-full)', background: 'var(--accent)', border: '1.5px solid var(--surface-sidebar)',
          }} />
        )}
      </button>

      {open && !isMobile && rect && createPortal(
        <div ref={panelRef} style={{
          // La campana vive en el sidebar angosto (220px); anclar a la derecha
          // empujaba el panel fuera del borde izquierdo. Abre hacia la derecha,
          // hacia el área de contenido.
          position: 'fixed', top: rect.top, left: rect.left, width: PANEL_WIDTH,
          maxHeight: Math.min(rect.maxHeight, window.innerHeight * 0.7),
          background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1000,
        }}>
          <NotificationCenter
            notifications={notifications}
            unread={unread}
            onNavigate={handleNavigate}
            onClose={() => setOpen(false)}
            markRead={markRead}
            markAllRead={markAllRead}
          />
        </div>,
        document.body,
      )}

      {open && isMobile && (
        <div style={{
          position: 'fixed', inset: 0, background: 'var(--bg-raised)', zIndex: 1000,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <NotificationCenter
            notifications={notifications}
            unread={unread}
            onNavigate={handleNavigate}
            onClose={() => setOpen(false)}
            markRead={markRead}
            markAllRead={markAllRead}
            mobileHeader
          />
        </div>
      )}
    </div>
  );
}
