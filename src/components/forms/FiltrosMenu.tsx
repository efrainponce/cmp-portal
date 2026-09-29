// Botón "Filtros" + panel con un select (o checkboxes, `multi`) por filtro, para listas que ya no caben
// con un select suelto por filtro en la barra (Reporte de Proyectos, Efraín
// 2026-09-29: Zona, Estado, Proveedor, Vendedor, Compras). Los filtros activos
// se quedan A LA VISTA como chips junto al botón, cada uno con su ×: un filtro
// escondido deja la lista en 0 sin que nadie sepa por qué (docs: triage de
// "no me aparece"). Mismo alto y look que ColumnPicker (36 px).
import { useEffect, useRef, useState } from 'react';

interface FiltroBase {
  key: string;
  label: string;
  /** Texto de la opción vacía ("Zona: todas"). */
  todos: string;
  options: { value: string; label: string }[];
}

/** Un valor a la vez (select). */
export interface FiltroSimple extends FiltroBase {
  multi?: false;
  value: string;
  onChange: (v: string) => void;
}

/** Varios valores a la vez (checkboxes; Estado del Reporte, Efraín 2026-09-29).
 * `values` = los MARCADOS; todos marcados = sin filtro. */
export interface FiltroMulti extends FiltroBase {
  multi: true;
  values: string[];
  onChange: (v: string[]) => void;
}

export type FiltroDef = FiltroSimple | FiltroMulti;

/** ¿El filtro está recortando algo? */
function activo(f: FiltroDef): boolean {
  return f.multi ? f.options.some((o) => !f.values.includes(o.value)) : f.value !== TODOS;
}

/** Texto del chip: los marcados si son pocos, si no los que se quitaron. */
function resumen(f: FiltroDef): string {
  if (!f.multi) return f.options.find((o) => o.value === f.value)?.label ?? f.value;
  const si = f.options.filter((o) => f.values.includes(o.value));
  const no = f.options.filter((o) => !f.values.includes(o.value));
  if (si.length === 0) return 'ninguno';
  if (si.length <= 2) return si.map((o) => o.label).join(', ');
  if (no.length <= 2) return `sin ${no.map((o) => o.label).join(', ')}`;
  return `${si.length} de ${f.options.length}`;
}

/** Deja el filtro en "sin filtro". */
function limpiar(f: FiltroDef) {
  if (f.multi) f.onChange(f.options.map((o) => o.value));
  else f.onChange(TODOS);
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
  const visibles = filtros.filter((f) => f.options.length > 0 || (!f.multi && f.value !== TODOS));
  const activos = visibles.filter(activo);
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
            {visibles.map((f) => f.multi ? (
              <fieldset key={f.key} style={{ margin: 0, padding: 0, border: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <legend style={{ padding: 0, marginBottom: 4, font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
                  {f.label}
                  <button
                    type="button" onClick={() => limpiar(f)} disabled={!activo(f)}
                    style={{ marginLeft: 8, padding: 0, background: 'none', border: 'none', font: 'var(--text-caption)', color: activo(f) ? 'var(--accent)' : 'var(--ink-tertiary)', cursor: activo(f) ? 'pointer' : 'default' }}
                  >
                    {f.todos}
                  </button>
                </legend>
                {f.options.map((o) => (
                  <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-label)', color: 'var(--ink)', cursor: 'pointer' }}>
                    <input
                      type="checkbox" checked={f.values.includes(o.value)}
                      onChange={(e) => f.onChange(e.target.checked ? [...f.values, o.value] : f.values.filter((v) => v !== o.value))}
                    />
                    {o.label}
                  </label>
                ))}
              </fieldset>
            ) : (
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
            {f.label}: {resumen(f)}
          </span>
          <button
            type="button" onClick={() => limpiar(f)} aria-label={`Quitar filtro ${f.label}`}
            style={{ width: 22, height: 22, flex: 'none', border: 'none', background: 'none', color: 'var(--ink-secondary)', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
    </>
  );
}
