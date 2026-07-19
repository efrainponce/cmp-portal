// Two-step confirm button for real-world actions (PDFs, firmas, imports):
// first click arms it ("¿Confirmar…?"), second click runs. Auto-disarms after
// 6s so a stray click never fires a DocuSeal email or destructive import.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, type ButtonVariant } from './Button';

interface Props {
  label: string;
  confirmLabel?: string;         // default: "¿Confirmar?"
  busyLabel?: string;            // default: "Procesando…"
  variant?: ButtonVariant;
  /** disabled + title explains why (tooltip). */
  disabled?: boolean;
  title?: string;
  onConfirm: () => Promise<void> | void;
  style?: CSSProperties;
}

export function ConfirmButton({ label, confirmLabel, busyLabel, variant = 'primary', disabled, title, onConfirm, style }: Props) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (disabled) return <Button variant="disabled" title={title} style={style}>{label}</Button>;
  if (busy) return <Button variant="disabled" style={style}>{busyLabel ?? 'Procesando…'}</Button>;

  if (!armed) {
    return (
      <Button
        variant={variant}
        title={title}
        style={style}
        onClick={() => {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 6000);
        }}
      >
        {label}
      </Button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <Button
        variant="danger"
        style={style}
        onClick={async () => {
          window.clearTimeout(timer.current);
          setArmed(false);
          setBusy(true);
          try { await onConfirm(); } finally { setBusy(false); }
        }}
      >
        {confirmLabel ?? '¿Confirmar?'}
      </Button>
      <Button variant="ghost" onClick={() => { window.clearTimeout(timer.current); setArmed(false); }}>Cancelar</Button>
    </span>
  );
}
