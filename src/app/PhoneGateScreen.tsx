// Bloqueo total tras el login de Access: sin teléfono registrado el bot de
// WhatsApp no puede identificar a nadie (worker/wa/store.ts identityByPhone),
// así que el portal no deja pasar hasta capturarlo (Efraín, 2026-07-31).
// App.tsx lo salta durante impersonación ("ver como") — ahí el admin solo
// está mirando, no tiene por qué llenar el teléfono ajeno.
import { useState } from 'react';
import { logout, putMyPhone } from '../lib/apiClient';
import { refreshMe } from '../lib/useMe';

export function PhoneGateScreen() {
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = phone.replace(/\D/g, '').length >= 10;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await putMyPhone(phone.trim());
      if (!result.ok) { setError(result.error ?? 'No se pudo guardar el teléfono.'); return; }
      await refreshMe();
    } catch {
      setError('No se pudo guardar el teléfono. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: 16, background: 'var(--bg)', textAlign: 'center', padding: 24,
      }}
    >
      <div style={{ font: '700 16px var(--font-ui)', color: 'var(--ink)' }}>Falta tu teléfono</div>
      <div style={{ font: '400 12.5px var(--font-ui)', color: 'var(--ink-quiet)', maxWidth: 340 }}>
        Captura el número de WhatsApp con el que vas a usar el bot. Lo necesitamos para identificarte cuando escribas.
      </div>
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        placeholder="Ej. 4771234567"
        autoFocus
        style={{
          width: 220, textAlign: 'center', font: '600 14px var(--font-ui)', color: 'var(--ink)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 14px',
        }}
      />
      {error && <div style={{ font: '400 12px var(--font-ui)', color: 'var(--status-perdida)' }}>{error}</div>}
      <button
        onClick={save}
        disabled={!valid || saving}
        style={{
          border: 'none', background: valid && !saving ? 'var(--accent)' : 'var(--border)', color: '#fff',
          borderRadius: 'var(--radius-lg)', padding: '10px 20px', font: '700 12.5px var(--font-ui)',
          cursor: valid && !saving ? 'pointer' : 'default',
        }}
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
      <button
        onClick={logout}
        style={{
          border: 'none', background: 'transparent', color: 'var(--ink-quiet)',
          font: '400 11.5px var(--font-ui)', cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        Cerrar sesión
      </button>
    </div>
  );
}
