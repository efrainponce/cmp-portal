// Avisos flotantes de confirmación/error ("Imagen guardada", "No se pudo
// agregar la línea"). Clarity (20–22 sep 2026) mostró gente recargando la
// página para ver si algo se guardó y clics repetidos sobre botones que no
// decían nada: el aviso inline de cada pantalla muchas veces queda fuera de la
// vista. `toast()` se llama desde cualquier lado, sin contexto ni props.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'ok' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(list: ToastItem[]) => void>();
const emit = () => { for (const l of listeners) l(items); };

export function toast(text: string, kind: ToastKind = 'ok', ms = kind === 'error' ? 7000 : 3500): void {
  // El mismo aviso dos veces seguidas (doble clic sobre un deshabilitado) no se apila.
  if (items.some((t) => t.text === text && t.kind === kind)) return;
  const id = nextId++;
  items = [...items.slice(-3), { id, kind, text }];
  emit();
  window.setTimeout(() => { items = items.filter((t) => t.id !== id); emit(); }, ms);
}

const COLORS: Record<ToastKind, string> = { ok: 'var(--status-ganada)', error: 'var(--status-perdida)', info: 'var(--ink-secondary)' };

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList); }; }, []);
  if (list.length === 0) return null;
  return createPortal(
    <div aria-live="polite" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none', width: 'min(460px, calc(100vw - 32px))' }}>
      {list.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} style={{
          pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, maxWidth: '100%', boxSizing: 'border-box',
          padding: '10px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)', color: 'var(--ink)',
          border: '1px solid var(--border)', borderLeft: `4px solid ${COLORS[t.kind]}`, boxShadow: '0 6px 24px rgba(0,0,0,.14)',
          font: 'var(--text-label)',
        }}>
          <span style={{ color: COLORS[t.kind], fontWeight: 700 }}>{t.kind === 'ok' ? '✓' : t.kind === 'error' ? '!' : 'i'}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
