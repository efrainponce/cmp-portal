// Botón "Columnas" + menú de casillas para mostrar/ocultar columnas de una
// lista. Pareja de src/lib/useColumnasVisibles.ts. Mismo alto y look que los
// selects de la barra de filtros (36 px).
import { useEffect, useRef, useState } from 'react';
import type { ColumnaDef } from '../../lib/useColumnasVisibles';

interface Props {
  columnas: readonly ColumnaDef[];
  visible: (key: string) => boolean;
  onToggle: (key: string) => void;
  onRestablecer: () => void;
  personalizado: boolean;
}

export function ColumnPicker({ columnas, visible, onToggle, onRestablecer, personalizado }: Props) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);

  const opcionales = columnas.filter(c => !c.fija);
  const ocultas = opcionales.filter(c => !visible(c.key)).length;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setAbierto(v => !v)} aria-haspopup="menu" aria-expanded={abierto} title="Mostrar u ocultar columnas"
        style={{
          height: 36, font: 'var(--text-label)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          padding: '0 12px', boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" />
        </svg>
        Columnas{ocultas > 0 ? ` · ${ocultas} ocultas` : ''}
      </button>
      {abierto && (
        <div role="menu" style={{
          position: 'absolute', top: 40, right: 0, zIndex: 20, minWidth: 190, padding: 8, background: 'var(--bg-raised)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(0,0,0,.12)',
        }}>
          {opcionales.map(c => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px', font: 'var(--text-label)', color: 'var(--ink)', cursor: 'pointer' }}>
              <input type="checkbox" checked={visible(c.key)} onChange={() => onToggle(c.key)} style={{ cursor: 'pointer' }} />
              {c.label}
            </label>
          ))}
          {personalizado && (
            <button
              onClick={onRestablecer}
              style={{ marginTop: 4, padding: '6px 6px', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--border)', font: 'var(--text-label)', color: 'var(--accent)', cursor: 'pointer' }}
            >
              Restablecer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
