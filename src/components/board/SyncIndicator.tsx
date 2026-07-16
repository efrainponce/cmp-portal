// "sincronizado hace X min" (or "actualizado hace X min" via `label`) computed
// from a caller-supplied timestamp, plus a pending-write hint. Used on every
// board header — list headers pass Monday's own updated_at (label="actualizado"),
// the opportunity drawer keeps the mirror's own syncedAt (default label).
import { fmtSyncAgo } from '../../lib/format';

interface SyncIndicatorProps {
  syncedAt: string | null;
  pending?: number;
  label?: string;
  style?: React.CSSProperties;
}

export function SyncIndicator({ syncedAt, pending = 0, label = 'sincronizado', style }: SyncIndicatorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-caption)', color: 'var(--ink-faint)', ...style }}>
      <span>{syncedAt ? `${label} ${fmtSyncAgo(syncedAt)}` : `sin datos de ${label === 'sincronizado' ? 'sincronización' : 'actualización'}`}</span>
      {pending > 0 && <span style={{ color: 'var(--accent)' }}>⏳ guardado, sincronizando…</span>}
    </div>
  );
}
