import { Component, type ReactNode } from 'react';

const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i;
const RELOAD_KEY = 'cmp:chunkReload';

// Cloudflare Workers Assets pisa los archivos del build anterior en cada
// deploy — si el navegador ya tenía la app abierta y dispara un import()
// diferido (lazy de una vista, ver App.tsx) justo después de un push a main,
// el chunk viejo ya no existe y el import falla. Guard de sessionStorage:
// recarga una sola vez, no en loop si el deploy sigue roto por otra razón.
export function reloadOnceForNewDeploy() {
  if (sessionStorage.getItem(RELOAD_KEY)) return false;
  sessionStorage.setItem(RELOAD_KEY, '1');
  window.location.reload();
  return true;
}

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ChunkReloadBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (CHUNK_ERROR.test(error.message)) reloadOnceForNewDeploy();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const isChunkError = CHUNK_ERROR.test(error.message);
    return (
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', gap: 16, background: 'var(--bg)', textAlign: 'center', padding: 24,
        }}
      >
        <div style={{ font: '700 16px var(--font-ui)', color: 'var(--ink)' }}>
          {isChunkError ? 'Hay una versión nueva del portal' : 'Algo salió mal'}
        </div>
        <div style={{ font: '400 12.5px var(--font-ui)', color: 'var(--ink-quiet)', maxWidth: 320 }}>
          {isChunkError ? 'Actualizando…' : 'Recarga la página para continuar.'}
        </div>
        {!isChunkError && (
          <button
            onClick={() => window.location.reload()}
            style={{
              border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-lg)',
              padding: '10px 20px', font: '700 12.5px var(--font-ui)', cursor: 'pointer',
            }}
          >
            Recargar
          </button>
        )}
      </div>
    );
  }
}
