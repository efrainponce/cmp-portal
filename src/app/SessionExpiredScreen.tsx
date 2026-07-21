// Pantalla de bloqueo total cuando apiFetch ya agotó su único auto-retry de
// Access (ver src/lib/sessionState.ts) — reemplaza el "Invitado" silencioso
// por un login explícito con un solo botón claro.
import { logout } from '../lib/apiClient';

export function SessionExpiredScreen() {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: 16, background: 'var(--bg)', textAlign: 'center', padding: 24,
      }}
    >
      <div style={{ font: '700 16px var(--font-ui)', color: 'var(--ink)' }}>Tu sesión terminó</div>
      <div style={{ font: '400 12.5px var(--font-ui)', color: 'var(--ink-quiet)', maxWidth: 320 }}>
        Vuelve a iniciar sesión con tu cuenta de Google para continuar.
      </div>
      <button
        onClick={logout}
        style={{
          border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-lg)',
          padding: '10px 20px', font: '700 12.5px var(--font-ui)', cursor: 'pointer',
        }}
      >
        Iniciar sesión
      </button>
    </div>
  );
}
