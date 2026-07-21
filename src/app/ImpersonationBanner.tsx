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
      flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
      padding: '12px 24px', background: '#d32f2f', color: '#fff', font: 'var(--text-label-strong)', borderBottom: '3px solid #b71c1c',
    }}>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <strong style={{ fontSize: 14 }}>⚠️ MODO IMPERSONACIÓN</strong>
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.95 }}>
          {me.impersonatedBy.nombre || me.impersonatedBy.email} viendo como {me.nombre || me.email}
        </div>
      </div>
      <button
        onClick={stopImpersonation}
        style={{
          background: '#fff', color: '#d32f2f', border: 'none',
          borderRadius: 'var(--radius-lg)', padding: '8px 16px', font: '600 13px \'Inter\', sans-serif',
          cursor: 'pointer', flex: 'none', fontWeight: 'bold',
        }}
      >
        ← SALIR
      </button>
    </div>
  );
}
