// Herramienta "Columnas" para Costeo/Validación de Costeo — deja mostrar/ocultar
// columnas de la grid (preferencia personal, no un permiso: eso ya lo filtra el
// server vía ColMeta.w). La columna Producto (siempre primera) no se ofrece
// porque sostiene el chevron/eliminar de línea y romper su ancho fijo rompe el
// grid template (Efraín, 2026-07-21).
import { useEffect, useRef, useState } from 'react';
import type { GridCol } from './gridMeta';

export function ColumnVisibilityPicker({
  columns, hidden, onToggle,
}: {
  columns: GridCol[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Mostrar/ocultar columnas"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)',
          background: 'var(--bg-raised)', borderRadius: 'var(--radius-lg)', padding: '7px 12px',
          font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', cursor: 'pointer',
        }}
      >
        ⚙ Columnas
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-modal)', minWidth: 240, maxHeight: 360, overflowY: 'auto', padding: 6,
        }}>
          {columns.map((c) => {
            const visible = !hidden.has(c.id);
            return (
              <label
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '8px 10px', cursor: 'pointer', borderRadius: 'var(--radius-md)',
                }}
              >
                <span style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>{c.label}</span>
                <ColumnToggle checked={visible} onChange={() => onToggle(c.id)} />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ColumnToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: checked ? '#00b461' : '#d8d3c8', position: 'relative', flex: 'none', padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left .15s',
      }} />
    </button>
  );
}
