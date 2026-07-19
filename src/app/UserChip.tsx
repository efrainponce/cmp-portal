// Signed-in user chip: initial avatar + nombre + role badge, from GET /api/me.
import { useEffect, useState } from 'react';
import { getMe, type MeDTO } from '../lib/api';

const ROLE_LABELS: Record<string, string> = {
  vendedor: 'Ventas', compras: 'Compras', admin: 'Admin', almacen: 'Almacén',
};

export function UserChip({ collapsed }: { collapsed: boolean }) {
  const [me, setMe] = useState<MeDTO | null>(null);

  useEffect(() => { getMe().then(setMe).catch(() => setMe(null)); }, []);

  const nombre = me?.nombre || me?.email || 'Invitado';
  const roleLabel = me ? (ROLE_LABELS[me.role] ?? me.role) : '—';

  return (
    <div
      title={me ? `${nombre} · ${roleLabel}` : 'Sin sesión'}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
    >
      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: 'var(--text-small-strong)', flex: 'none' }}>
        {nombre.slice(0, 1).toUpperCase()}
      </div>
      {!collapsed && (
        <div style={{ minWidth: 0 }}>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</div>
          <div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{roleLabel}</div>
        </div>
      )}
    </div>
  );
}
