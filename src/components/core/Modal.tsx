// Centered dialog — distinct from OpportunityDrawer's full-screen overlay, this is
// for compact forms (create record, etc). Uses the --overlay-scrim/--shadow-modal
// tokens already reserved in tokens/colors.css for exactly this.
import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ title, onClose, children, footer, width = 480 }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
