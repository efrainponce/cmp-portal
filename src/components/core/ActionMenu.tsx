// Menú "⋯" de acciones secundarias. Existe para descargar encabezados que
// llegaron a tener 7-8 botones en una fila (Efraín, 2026-09-02: "tenemos
// muchísimos botones"): el botón de flujo de la etapa se queda a la vista y
// lo que no urge (duplicar, copiar link, actualizar, perder/archivar/reabrir)
// vive aquí. NADA se quita: cada entrada hace exactamente lo que hacía el
// botón que reemplaza, incluida la confirmación en dos pasos de ConfirmButton
// (`confirmLabel`) — un clic perdido dentro del menú tampoco dispara nada.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from './Button';

export interface ActionMenuItem {
  key: string;
  label: string;
  /** Tooltip de la entrada (y el motivo cuando está deshabilitada). */
  title?: string;
  disabled?: boolean;
  /** Pinta la entrada en rojo (perder, archivar, borrar). */
  danger?: boolean;
  /** Si viene, la entrada pide confirmación DENTRO del menú antes de correr. */
  confirmLabel?: string;
  /** Texto del disparador mientras la acción corre ("Marcando…"). */
  busyLabel?: string;
  onSelect: () => Promise<void> | void;
}

interface Props {
  items: ActionMenuItem[];
  /** Texto del disparador. Default: "⋯" con tooltip "Más acciones". */
  label?: string;
  title?: string;
  style?: CSSProperties;
}

export function ActionMenu({ items, label = '⋯', title = 'Más acciones', style }: Props) {
  const [open, setOpen] = useState(false);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  // De qué lado cuelga el menú: pegado a la derecha del disparador cuando el
  // disparador está a la derecha de la pantalla (header de escritorio), y a
  // la izquierda cuando está a la izquierda (en cel el header se apila y el
  // botón queda al inicio del renglón — anclado a la derecha se salía por el
  // borde izquierdo).
  const [alinear, setAlinear] = useState<'left' | 'right'>('right');
  const root = useRef<HTMLDivElement>(null);
  const armTimer = useRef<number | undefined>(undefined);

  // Cierra al hacer clic fuera o con Escape — el patrón de cualquier menú.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  const close = () => { setOpen(false); setArmedKey(null); window.clearTimeout(armTimer.current); };

  const run = async (item: ActionMenuItem) => {
    close();
    setBusyLabel(item.busyLabel ?? null);
    try { await item.onSelect(); } finally { setBusyLabel(null); }
  };

  if (items.length === 0) return null;

  return (
    <div ref={root} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      <Button
        variant={busyLabel ? 'disabled' : 'secondary'}
        title={title}
        onClick={() => {
          if (open) { close(); return; }
          const rect = root.current?.getBoundingClientRect();
          setAlinear(rect && rect.left < window.innerWidth / 2 ? 'left' : 'right');
          setOpen(true);
        }}
        style={{ padding: busyLabel ? '9px 12px' : '9px 13px', letterSpacing: !busyLabel && label === '⋯' ? 1 : undefined }}
      >
        {busyLabel ?? label}
      </Button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', zIndex: 30,
            ...(alinear === 'right' ? { right: 0 } : { left: 0 }),
            minWidth: 220, maxWidth: 'calc(100vw - 28px)',
            background: 'var(--bg-raised)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          {items.map((item) => {
            const armed = armedKey === item.key;
            if (armed) {
              return (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}>
                  <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', flex: 1 }}>{item.confirmLabel}</span>
                  <Button variant="danger" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => { void run(item); }}>Sí</Button>
                  <Button variant="ghost" style={{ padding: '5px 8px', fontSize: 11 }} onClick={() => setArmedKey(null)}>No</Button>
                </div>
              );
            }
            return (
              <div
                key={item.key}
                role="menuitem"
                title={item.title}
                onClick={item.disabled ? undefined : () => {
                  if (item.confirmLabel) {
                    setArmedKey(item.key);
                    // Se desarma solo, como ConfirmButton: un menú abierto y
                    // olvidado no debe quedarse armado.
                    window.clearTimeout(armTimer.current);
                    armTimer.current = window.setTimeout(() => setArmedKey(null), 6000);
                  } else {
                    void run(item);
                  }
                }}
                className={item.disabled ? undefined : 'row-hover'}
                style={{
                  padding: '8px 10px', borderRadius: 'var(--radius-md, 6px)',
                  font: 'var(--text-label-strong)',
                  color: item.disabled ? 'var(--ink-quiet)' : item.danger ? 'var(--status-perdida)' : 'var(--ink)',
                  cursor: item.disabled ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
