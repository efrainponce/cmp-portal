// Burbuja de sincronización, abajo a la derecha (2026-10-02). Dice en todo
// momento si lo que hiciste se está guardando, ya se guardó, falló o no hay
// conexión — para que nadie le dé F5 a una escritura que solo va lenta. Si
// todavía hay escrituras en vuelo, el navegador pregunta antes de recargar o
// cerrar. Estado en src/lib/syncEstado.ts (lo alimenta apiFetch).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { faseDe, marcarRed, suscribirSync, syncSnapshot, type Fase } from '../../lib/syncEstado';

const COLOR: Record<Exclude<Fase, 'oculta'>, string> = {
  guardando: 'var(--accent)', lento: 'var(--accent)', guardado: 'var(--status-ganada)',
  fallo: 'var(--status-perdida)', sinRed: 'var(--status-perdida)',
};

export function SyncBurbuja() {
  const [snap, setSnap] = useState(syncSnapshot);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => suscribirSync((s) => { setSnap(s); setAhora(Date.now()); }), []);

  const fase = faseDe(snap, ahora);
  // Reloj solo mientras hay algo que mostrar: el contador de segundos y el
  // "Guardado ✓" que se apaga solo.
  useEffect(() => {
    if (fase === 'oculta') return;
    const t = window.setInterval(() => setAhora(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [fase]);

  // El navegador avisa cuando se pierde/regresa la red, sin esperar a un poll.
  useEffect(() => {
    const on = () => marcarRed(true);
    const off = () => marcarRed(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // F5 / cerrar con una escritura en vuelo la corta: que el navegador pregunte.
  useEffect(() => {
    if (snap.activas === 0) return;
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [snap.activas]);

  if (fase === 'oculta') return null;
  const seg = snap.desde != null ? Math.max(0, Math.round((ahora - snap.desde) / 1000)) : 0;
  const color = COLOR[fase];
  const texto = {
    guardando: 'Guardando…',
    lento: `Guardando… ${seg} s · no recargues`,
    guardado: 'Guardado',
    fallo: 'No se guardó',
    sinRed: 'Sin conexión · reintentando',
  }[fase];
  const titulo = {
    guardando: 'Tu cambio va en camino al servidor.',
    lento: 'Sigue trabajando (Monday a veces tarda). Si recargas la página ahora, se puede perder.',
    guardado: 'Tu cambio quedó guardado.',
    fallo: 'El servidor rechazó el último cambio — el aviso en rojo dice por qué.',
    sinRed: 'No hay conexión con el portal. Lo que veas puede estar desactualizado; se reconecta solo.',
  }[fase];

  return createPortal(
    <div
      role={fase === 'fallo' || fase === 'sinRed' ? 'alert' : 'status'}
      aria-live="polite"
      title={titulo}
      className="sync-burbuja"
      style={{
        position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', zIndex: 1900,
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px 7px 10px',
        borderRadius: 'var(--radius-pill)', background: 'var(--bg-raised)', color: 'var(--ink-secondary)',
        border: '1px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,.12)',
        font: 'var(--text-label)', pointerEvents: 'auto', cursor: 'default', whiteSpace: 'nowrap',
      }}
    >
      {fase === 'guardando' || fase === 'lento'
        ? <span className="sync-burbuja-giro" aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${color}`, borderRightColor: 'transparent', boxSizing: 'border-box', flex: 'none' }} />
        : <span aria-hidden style={{ color, fontWeight: 700, width: 12, textAlign: 'center' }}>{fase === 'guardado' ? '✓' : '!'}</span>}
      <span style={{ color: fase === 'fallo' || fase === 'sinRed' ? color : 'var(--ink-secondary)' }}>{texto}</span>
    </div>,
    document.body,
  );
}
