// Renders the shared loading/denied/offline states for any board view; falls
// through to `children` once data is ready.
import type { PollStatus } from '../../lib/api';

interface Props {
  status: PollStatus;
  children: React.ReactNode;
}

export function BoardStatus({ status, children }: Props) {
  if (status === 'loading') return <Centered>Cargando…</Centered>;
  if (status === 'denied') return <Centered>No tienes acceso a este tablero. Pide acceso a un administrador.</Centered>;
  if (status === 'offline') return <Centered>No se pudo conectar con el servidor. Verifica que el worker esté corriendo.</Centered>;
  return <>{children}</>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200, padding: 24, textAlign: 'center', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
      {children}
    </div>
  );
}
