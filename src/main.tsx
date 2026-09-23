import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ChunkReloadBoundary, reloadOnceForNewDeploy } from './app/ChunkReloadBoundary'
import { instalarCapturaDeErrores } from './lib/telemetry'
import { instalarPerfReal } from './lib/perfReal'

window.addEventListener('vite:preloadError', () => reloadOnceForNewDeploy())
// Errores de JavaScript sin atrapar → sync_log (ver src/lib/telemetry.ts).
instalarCapturaDeErrores()
// Rendimiento de usuarios reales → ux_event kind 'perf' (ver src/lib/perfReal.ts).
instalarPerfReal()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChunkReloadBoundary>
      <App />
    </ChunkReloadBoundary>
  </StrictMode>,
)
