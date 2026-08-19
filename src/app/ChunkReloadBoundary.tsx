import { Component, type ReactNode } from 'react';

const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i;
const RELOAD_KEY = 'cmp:chunkReload';
// Máximo de recargas automáticas y espera entre la 2ª y la última: el deploy
// puede tardar unos segundos en propagarse, así que la 1ª recarga es inmediata
// y las siguientes esperan a que los assets nuevos estén servidos.
const MAX_TRIES = 3;
const RETRY_MS = 6000;
// Si el último intento fue hace más de esto, la app estuvo viva un buen rato:
// es un deploy distinto, el contador vuelve a empezar.
const WINDOW_MS = 60_000;

function readTries(): number {
  const raw = sessionStorage.getItem(RELOAD_KEY);
  if (!raw) return 0;
  const [tries, at] = raw.split(':').map(Number);
  if (!Number.isFinite(tries) || !Number.isFinite(at)) return 0;
  return Date.now() - at > WINDOW_MS ? 0 : tries;
}

// Cloudflare Workers Assets pisa los archivos del build anterior en cada
// deploy — si el navegador ya tenía la app abierta y dispara un import()
// diferido (lazy de una vista, ver App.tsx) justo después de un push a main,
// el chunk viejo ya no existe y el import falla. Recarga sola: la 1ª vez de
// inmediato y, si al volver sigue fallando, hasta MAX_TRIES veces esperando
// RETRY_MS (antes se recargaba UNA sola vez y quien caía en la 2ª se quedaba
// mirando «Actualizando…» para siempre). Pasado el tope se rinde y deja el
// botón, para no quedar en loop si el deploy está roto por otra razón.
export function reloadOnceForNewDeploy() {
  const tries = readTries();
  if (tries >= MAX_TRIES) return false;
  sessionStorage.setItem(RELOAD_KEY, `${tries + 1}:${Date.now()}`);
  if (tries === 0) window.location.reload();
  else window.setTimeout(() => window.location.reload(), RETRY_MS);
  return true;
}

type Props = { children: ReactNode };
type State = { error: Error | null; recargando: boolean };

export class ChunkReloadBoundary extends Component<Props, State> {
  state: State = { error: null, recargando: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (CHUNK_ERROR.test(error.message) && reloadOnceForNewDeploy()) {
      this.setState({ recargando: true });
    }
  }

  render() {
    const { error, recargando } = this.state;
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
          {recargando ? 'Actualizando…' : 'Recarga la página para continuar.'}
        </div>
        {!recargando && (
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
