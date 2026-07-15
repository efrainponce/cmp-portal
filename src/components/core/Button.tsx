import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

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
  onClick?: MouseEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  title?: string;
}

export function Button({ variant = 'primary', children, onClick, style, title }: ButtonProps) {
  const v = VARIANT_STYLES[variant] || VARIANT_STYLES.primary;
  return (
    <div
      onClick={variant === 'disabled' ? undefined : onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '9px 16px',
        borderRadius: 'var(--radius-lg)',
        font: 'var(--text-label-strong)',
        cursor: variant === 'disabled' ? 'default' : 'pointer',
        userSelect: 'none',
        boxSizing: 'border-box',
        ...v,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
