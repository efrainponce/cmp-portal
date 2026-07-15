// Small circular initials avatar for a Monday "people" column value — no
// photo sync exists yet, so identity renders as a colored initials bubble
// instead (same pattern as UserChip's own-user avatar).
import type { CSSProperties } from 'react';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface PersonAvatarProps {
  name: string;
  color: string;
  style?: CSSProperties;
}

export function PersonAvatar({ name, color, style }: PersonAvatarProps) {
  return (
    <div
      title={name}
      style={{
        width: 24, height: 24, borderRadius: '50%', flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: color, color: '#fff', font: '700 10px \'Inter\', sans-serif',
        border: '2px solid var(--bg-raised)', boxShadow: '0 0 0 1px var(--border)',
        ...style,
      }}
    >
      {initials(name)}
    </div>
  );
}

interface PersonPairProps {
  vendedor?: string;
  compras?: string;
}

/** Overlapping Vendedor + Compras avatar pair — the row's owner cluster. */
export function PersonPair({ vendedor, compras }: PersonPairProps) {
  if (!vendedor && !compras) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
      {vendedor && <PersonAvatar name={vendedor} color="var(--accent)" />}
      {compras && <PersonAvatar name={compras} color="var(--accent-blue)" style={vendedor ? { marginLeft: -8 } : undefined} />}
    </div>
  );
}
