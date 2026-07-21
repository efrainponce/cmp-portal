// Pantalla de bloqueo total cuando apiFetch ya agotó su único auto-retry de
// Access (ver src/lib/sessionState.ts) — reemplaza el "Invitado" silencioso
// por un login explícito.
//
// El primer round-trip a /cdn-cgi/access/logout casi nunca alcanza a
// re-autenticar: el borrado de la cookie de Access tarda un poco en
// propagarse en el edge de Cloudflare, así que un segundo intento inmediato
// (JS) suele pegarle a una cookie que técnicamente ya se limpió pero el edge
// todavía no terminó de reconocer. Un clic manual "funcionaba" solo porque el
// humano tarda en reaccionar, no porque hiciera algo distinto — así que acá
// se reintenta solo tras una pausa corta antes de pedir un clic de verdad.
// Guard con su propia key (no ACCESS_RETRY_KEY, que logout() limpia en cada
// llamada) para no reintentar en loop si de plano no hay acceso real.
import { useEffect, useState } from 'react';
import { logout } from '../lib/apiClient';

const AUTO_RETRY_KEY = 'cmp:sessionScreenAutoRetries';
// En la práctica un solo round-trip no basta — hacen falta 2 antes de que el
// edge de Cloudflare reconozca la cookie nueva. Tope duro para no loopear
// infinito si de plano no hay acceso real (cuenta fuera del dominio, etc.).
const MAX_AUTO_RETRIES = 2;

export function SessionExpiredScreen() {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const count = Number(sessionStorage.getItem(AUTO_RETRY_KEY) || '0');
    if (count >= MAX_AUTO_RETRIES) return;
    sessionStorage.setItem(AUTO_RETRY_KEY, String(count + 1));
    setRetrying(true);
    const t = setTimeout(logout, 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: 16, background: 'var(--bg)', textAlign: 'center', padding: 24,
      }}
    >
      <div style={{ font: '700 16px var(--font-ui)', color: 'var(--ink)' }}>Tu sesión terminó</div>
      <div style={{ font: '400 12.5px var(--font-ui)', color: 'var(--ink-quiet)', maxWidth: 320 }}>
        {retrying ? 'Reintentando…' : 'Vuelve a iniciar sesión con tu cuenta de Google para continuar.'}
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
