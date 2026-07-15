// "sincronizado hace X min" computed from the max syncedAt in a list, plus a
// pending-write hint. Used on every board header.
import { fmtSyncAgo } from '../../lib/format';

interface SyncIndicatorProps {
  syncedAt: string | null;
  pending?: number;
  style?: React.CSSProperties;
}

export function SyncIndicator({ syncedAt, pending = 0, style }: SyncIndicatorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-caption)', color: 'var(--ink-faint)', ...style }}>
      <span>{syncedAt ? `sincronizado ${fmtSyncAgo(syncedAt)}` : 'sin datos de sincronización'}</span>
      {pending > 0 && <span style={{ color: 'var(--accent)' }}>⏳ guardado, sincronizando…</span>}
    </div>
  );
}
