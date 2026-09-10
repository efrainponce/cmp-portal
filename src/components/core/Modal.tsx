// Centered dialog — distinct from OpportunityDrawer's full-screen overlay, this is
// for compact forms (create record, etc). Uses the --overlay-scrim/--shadow-modal
// tokens already reserved in tokens/colors.css for exactly this.
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

// Modales abiertos, del de hasta abajo al de hasta arriba. Escape cierra SOLO
// el de hasta arriba: "Nueva oportunidad" → «+ Nuevo» contacto → «+ Nueva»
// institución apila tres, y un Escape los cerraba todos de un jalón — con la
// oportunidad a medio capturar (2026-09-10).
const abiertos: object[] = [];

export function Modal({ title, onClose, children, footer, width = 480 }: ModalProps) {
  // Por ref: `onClose` suele ser una flecha nueva en cada render, y volver a
  // suscribir en cada render movería este modal al tope de la pila.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const yo = {};
    abiertos.push(yo);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && abiertos[abiertos.length - 1] === yo) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abiertos.splice(abiertos.indexOf(yo), 1);
    };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--overlay-scrim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100vh - 64px)',
          background: 'var(--bg-raised)', borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
          <div style={{ font: 'var(--text-subtitle)', color: 'var(--ink)' }}>{title}</div>
          <div onClick={onClose} style={{ cursor: 'pointer', color: 'var(--ink-tertiary)', font: 'var(--text-label-strong)', padding: 4 }}>✕</div>
        </div>
        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--border)', flex: 'none' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
