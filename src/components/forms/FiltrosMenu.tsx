// Botón "Filtros" + panel con un select por filtro, para listas que ya no caben
// con un select suelto por filtro en la barra (Reporte de Proyectos, Efraín
// 2026-09-29: Zona, Estado, Proveedor, Vendedor, Compras). Los filtros activos
// se quedan A LA VISTA como chips junto al botón, cada uno con su ×: un filtro
// escondido deja la lista en 0 sin que nadie sepa por qué (docs: triage de
// "no me aparece"). Mismo alto y look que ColumnPicker (36 px).
import { useEffect, useRef, useState } from 'react';

export interface FiltroDef {
  key: string;
  label: string;
  /** Texto de la opción vacía ("Zona: todas"). */
  todos: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

/** Valor de "sin filtro" — el mismo `TODOS` que usan las listas. */
const TODOS = '';

const selectStyle: React.CSSProperties = {
  height: 36, width: '100%', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0 10px',
  boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer',
};

export function FiltrosMenu({ filtros, onQuitarTodos }: { filtros: FiltroDef[]; onQuitarTodos: () => void }) {
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

  // Un filtro sin opciones no se ofrece (a ventas no le llegan ni Compras ni
  // proveedores); uno activo sí, aunque se haya quedado sin opciones.
  const visibles = filtros.filter((f) => f.options.length > 0 || f.value !== TODOS);
  const activos = visibles.filter((f) => f.value !== TODOS);
  if (visibles.length === 0) return null;

  return (
    <>
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          type="button" onClick={() => setAbierto((v) => !v)} aria-haspopup="dialog" aria-expanded={abierto}
          style={{
            height: 36, font: 'var(--text-label)', color: 'var(--ink)', borderRadius: 'var(--radius-lg)',
            border: `1px solid ${activos.length ? 'var(--accent)' : 'var(--border)'}`,
            background: activos.length ? 'var(--accent-soft)' : 'var(--bg-raised)',
            padding: '0 12px', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18l-7 8v6l-4-2v-4z" />
          </svg>
          Filtros
          {activos.length > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18,
              borderRadius: 'var(--radius-pill)', background: 'var(--accent)', color: '#fff', font: 'var(--text-caption)', padding: '0 5px',
            }}>{activos.length}</span>
          )}
        </button>
        {abierto && (
          <div role="dialog" aria-label="Filtros" style={{
            position: 'absolute', top: 40, left: 0, zIndex: 20, width: 'min(300px, calc(100vw - 28px))', padding: 12,
            display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box', background: 'var(--bg-raised)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          }}>
            {visibles.map((f) => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
                {f.label}
                <select aria-label={f.label} value={f.value} onChange={(e) => f.onChange(e.target.value)} style={selectStyle}>
                  <option value={TODOS}>{f.todos}</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
            {activos.length > 0 && (
              <button
                type="button" onClick={onQuitarTodos}
                style={{ alignSelf: 'flex-start', padding: '2px 0', background: 'none', border: 'none', font: 'var(--text-label)', color: 'var(--accent)', cursor: 'pointer' }}
              >
                Quitar filtros
              </button>
            )}
          </div>
        )}
      </div>
      {activos.map((f) => (
        <span key={f.key} style={{
          height: 30, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 4px 0 10px', boxSizing: 'border-box',
          font: 'var(--text-label)', color: 'var(--ink)', background: 'var(--accent-soft)', borderRadius: 'var(--radius-pill)', maxWidth: 260,
        }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {f.label}: {f.options.find((o) => o.value === f.value)?.label ?? f.value}
          </span>
          <button
            type="button" onClick={() => f.onChange(TODOS)} aria-label={`Quitar filtro ${f.label}`}
            style={{ width: 22, height: 22, flex: 'none', border: 'none', background: 'none', color: 'var(--ink-secondary)', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
    </>
  );
}
