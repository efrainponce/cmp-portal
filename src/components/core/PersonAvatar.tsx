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
  /** Viewer ve esta oportunidad porque lo marcaron "Vendedor secundario" ahí —
   * no es su dueño ni de su zona (Efraín, 2026-08-05: que quede clarísimo por
   * qué aparece alguien fuera de lo suyo en la lista). */
  secondary?: boolean;
}

export function PersonAvatar({ name, color, style, secondary }: PersonAvatarProps) {
  return (
    <div
      title={secondary ? `${name} (vendedor secundario)` : name}
      style={{
        position: 'relative',
        width: 24, height: 24, borderRadius: '50%', flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: color, color: '#fff', font: '700 10px \'Inter\', sans-serif',
        border: '2px solid var(--bg-raised)', boxShadow: '0 0 0 1px var(--border)',
        ...style,
      }}
    >
      {initials(name)}
      {secondary && (
        <div
          // top-left: el avatar de Compras se traslapa desde la derecha
          // (PersonPair, marginLeft: -8) y taparía el badge si fuera bottom-right.
          style={{
            position: 'absolute', top: -3, left: -3,
            width: 13, height: 13, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--ink-tertiary)', color: '#fff',
            font: '700 8px \'Inter\', sans-serif', lineHeight: 1,
            border: '1.5px solid var(--bg-raised)',
          }}
        >
          S
        </div>
      )}
    </div>
  );
}

interface PersonPairProps {
  vendedor?: string;
  compras?: string;
  /** Ver PersonAvatarProps.secondary — aplica solo al avatar de Vendedor. */
  vendedorSecondary?: boolean;
}

/** Overlapping Vendedor + Compras avatar pair — the row's owner cluster. */
export function PersonPair({ vendedor, compras, vendedorSecondary }: PersonPairProps) {
  if (!vendedor && !compras) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
      {vendedor && <PersonAvatar name={vendedor} color="var(--accent)" secondary={vendedorSecondary} />}
      {compras && <PersonAvatar name={compras} color="var(--accent-blue)" style={vendedor ? { marginLeft: -8 } : undefined} />}
    </div>
  );
}
