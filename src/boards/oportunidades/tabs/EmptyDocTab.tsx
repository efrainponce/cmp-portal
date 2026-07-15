// Shared "próximamente" empty state for tabs with no backing data source at
// the Oportunidades level yet (Órdenes de compra a proveedores, Logística) —
// per the design system's disabled-affordance convention.
import type { BoardSlug } from '../../../lib/api';
import { PaymentRequestButton } from '../../../components/board/PaymentRequestButton';

interface Props {
  title: string;
  subtitle: string;
  uploadLabel: string;
  /** Órdenes de compra only — lets the buyer request/comment payment status
   * straight to the provider's PO thread, per Efraín's request. */
  paymentRequest?: { slug: BoardSlug; itemId: string };
}

export function EmptyDocTab({ title, subtitle, uploadLabel, paymentRequest }: Props) {
  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 4 }}>{title}</div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>{subtitle}</div>
      {paymentRequest && (
        <div style={{ marginBottom: 14 }}>
          <PaymentRequestButton slug={paymentRequest.slug} itemId={paymentRequest.itemId} kind="proveedor" />
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, border: '1px dashed var(--ink-faint)', borderRadius: 'var(--radius-lg)',
        padding: '10px 12px', marginBottom: 10, background: 'var(--bg)', opacity: .6,
      }}>
        <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{uploadLabel} (próximamente)</span>
      </div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>Sin documentos.</div>
    </div>
  );
}
