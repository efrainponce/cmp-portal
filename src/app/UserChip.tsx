// Signed-in user chip: initial avatar + nombre + role badge, from GET /api/me.
import { useEffect, useState } from 'react';
import { getMe, logout, type MeDTO } from '../lib/api';

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
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 9.5px var(--font-ui)', flex: 'none' }}>
        {nombre.slice(0, 1).toUpperCase()}
      </div>
      {!collapsed && (
        <>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ font: '600 9.5px var(--font-ui)', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</div>
            <div style={{ font: '700 8.5px var(--font-ui)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{roleLabel}</div>
          </div>
          <button
            onClick={logout}
            title="Cerrar sesión"
            style={{
              flex: 'none', border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink-tertiary)',
              borderRadius: 'var(--radius-lg)', padding: '3px 7px', font: '700 8.5px var(--font-ui)', cursor: 'pointer',
            }}
          >
            Salir
          </button>
        </>
      )}
    </div>
  );
}
