// Posts a payment request straight into the Monday item's updates feed — the
// channel Efraín asked for so project status can depend on payment status
// without a separate system: "considero que debería estar en Monday, para un
// mejor control de tiempos y actualizaciones."
import { useState } from 'react';
import type { BoardSlug } from '../../lib/api';
import { postUpdate } from '../../lib/api';
import { Button } from '../core/Button';

export type PaymentRequestKind = 'anticipo' | 'saldo' | 'proveedor';

const KIND_META: Record<PaymentRequestKind, { label: string; prefix: string }> = {
  anticipo: { label: 'Solicitar anticipo', prefix: '💰 Solicitud de pago — Anticipo' },
  saldo: { label: 'Solicitar saldo', prefix: '💰 Solicitud de pago — Saldo' },
  proveedor: { label: 'Solicitar/comentar pago a proveedor', prefix: '💰 Pago a proveedor' },
};

interface Props {
  slug: BoardSlug;
  itemId: string;
  kind: PaymentRequestKind;
}

export function PaymentRequestButton({ slug, itemId, kind }: Props) {
  const [open, setOpen] = useState(false);
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const meta = KIND_META[kind];

  const submit = async () => {
    const parts = [meta.prefix];
    if (monto.trim()) parts.push(`Monto: ${monto.trim()}`);
    if (nota.trim()) parts.push(nota.trim());
    setSending(true);
    try {
      await postUpdate(slug, itemId, parts.join('\n'));
      setSentAt(Date.now());
      setOpen(false);
      setMonto('');
      setNota('');
    } catch {
      /* the composer stays open with the draft so the user can retry */
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button variant="secondary" onClick={() => setOpen(true)}>{meta.label}</Button>
        {sentAt && Date.now() - sentAt < 8000 && (
          <span style={{ font: 'var(--text-caption)', color: 'var(--status-ganada)' }}>Enviado ✓</span>
        )}
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff', maxWidth: 420 }}>
      <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)', marginBottom: 10 }}>{meta.label}</div>
      <input
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        placeholder="Monto (opcional)"
        style={{
          width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '9px 12px', marginBottom: 8,
        }}
      />
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota para el equipo (opcional)"
        rows={2}
        style={{
          width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '9px 12px', resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button variant="primary" onClick={submit}>{sending ? 'Enviando…' : 'Enviar a Monday'}</Button>
      </div>
    </div>
  );
}
