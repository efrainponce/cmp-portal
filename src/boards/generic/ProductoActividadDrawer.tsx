// Productos no tiene detalle de renglón (GenericBoardView es una tabla plana) —
// este es el primer drawer que abre desde ahí, mínimo a propósito: solo la
// pestaña Actividad (worker/lib/activityLog.ts). Mismo mecanismo de overlay que
// Modal.tsx, pero panel lateral en vez de diálogo centrado (Efraín, 2026-08-14).
// Reusado también para actividad por renglón de cotización (`oportunidades_sub`,
// Efraín 2026-08-17): la pestaña Actividad de la oportunidad ya mezcla item +
// líneas, pero un icono aparte por renglón deja ver solo lo de ESE producto.
import { useEffect } from 'react';
import type { ItemDTO } from '../../lib/api';
import type { BoardSlug } from '../../lib/apiClient';
import { ActividadTab } from '../oportunidades/tabs/ActividadTab';

interface Props {
  producto: ItemDTO;
  slug?: BoardSlug;
  /** Nombre a mostrar en el encabezado — por defecto `producto.name`, que para
   * una línea de cotización (`oportunidades_sub`) es solo el índice de Monday
   * ("1", "2"…), no el producto elegido (vive en otra columna, ver
   * `displayProducto` en gridMeta.tsx). Los llamadores de líneas deben pasarlo. */
  title?: string;
  onClose: () => void;
}

export function ProductoActividadDrawer({ producto, slug = 'productos', title, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--overlay-scrim)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, maxWidth: '100vw', height: '100%', background: 'var(--bg-raised)',
          boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
          <div style={{ font: 'var(--text-subtitle)', color: 'var(--ink)' }}>{title || producto.name}</div>
          <div onClick={onClose} style={{ cursor: 'pointer', color: 'var(--ink-tertiary)', font: 'var(--text-label-strong)', padding: 4 }}>✕</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ActividadTab slug={slug} itemId={producto.id} />
        </div>
      </div>
    </div>
  );
}
