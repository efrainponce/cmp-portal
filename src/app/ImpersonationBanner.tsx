// Fixed strip shown while an admin is impersonating another identity — stays
// visible even when the impersonated role can't see Configuración, since it's
// the only way back for the admin.
import { useMe } from '../lib/useMe';
import { stopImpersonation } from '../lib/impersonation';

export function ImpersonationBanner() {
  const me = useMe();
  if (!me?.impersonatedBy) return null;

  return (
    <div style={{
      flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '7px 16px', background: 'var(--status-seguimiento)', color: '#fff', font: 'var(--text-label-strong)',
    }}>
      <span>
        {me.impersonatedBy.nombre || me.impersonatedBy.email} está viendo el portal como {me.nombre || me.email} ({me.role})
      </span>
      <button
        onClick={stopImpersonation}
        style={{
          background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.5)', color: '#fff',
          borderRadius: 'var(--radius-lg)', padding: '3px 10px', font: 'var(--text-label-strong)', cursor: 'pointer',
        }}
      >
        Salir
      </button>
    </div>
  );
}
