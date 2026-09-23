import { useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { toast } from './Toaster';

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost' | 'disabled';

const VARIANT_STYLES: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--ink-on-accent)', border: 'none' },
  secondary: { background: 'var(--bg-raised)', color: 'var(--ink)', border: '1px solid var(--border)' },
  success: { background: 'var(--status-ganada)', color: '#fff', border: 'none' },
  danger: { background: 'transparent', color: 'var(--status-perdida)', border: '1px solid var(--status-perdida)' },
  ghost: { background: 'transparent', color: 'var(--ink-secondary)', border: 'none' },
  disabled: { background: 'var(--border)', color: 'var(--ink-quiet)', border: 'none' },
};

interface ButtonProps {
  variant?: ButtonVariant;
  children: ReactNode;
  /** Si devuelve una promesa, el botón queda ocupado (y sordo a más clics)
   * hasta que se resuelva — así ningún handler async se dispara dos veces. */
  onClick?: (e: MouseEvent<HTMLDivElement>) => unknown;
  style?: CSSProperties;
  /** En 'disabled', el POR QUÉ: además del tooltip, sale como aviso al hacer
   * clic (en celular no hay tooltip, y Clarity mostró clics repetidos sobre
   * botones deshabilitados sin ninguna respuesta, 2026-09-22). */
  title?: string;
}

export function Button({ variant = 'primary', children, onClick, style, title }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const [pressed, setPressed] = useState(false);
  const disabled = variant === 'disabled';
  const v = VARIANT_STYLES[variant] || VARIANT_STYLES.primary;

  const run = (e: MouseEvent<HTMLDivElement>) => {
    if (busy) return;
    if (disabled) { if (title) toast(title, 'info'); return; }
    const out = onClick?.(e);
    if (out instanceof Promise) {
      setBusy(true);
      out.catch(() => {}).finally(() => setBusy(false));
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    run(e as unknown as MouseEvent<HTMLDivElement>);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || busy || undefined}
      aria-busy={busy || undefined}
      onClick={run}
      onKeyDown={onKeyDown}
      onPointerDown={() => { if (!disabled && !busy) setPressed(true); }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '9px 16px',
        borderRadius: 'var(--radius-lg)',
        font: 'var(--text-label-strong)',
        cursor: busy ? 'progress' : disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
        boxSizing: 'border-box',
        transition: 'transform 80ms ease, filter 80ms ease',
        ...v,
        ...style,
        ...(pressed ? { transform: 'scale(0.97)', filter: 'brightness(0.94)' } : null),
        ...(busy ? { opacity: 0.6 } : null),
      }}
    >
      {children}
    </div>
  );
}
