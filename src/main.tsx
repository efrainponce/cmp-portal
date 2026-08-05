import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ChunkReloadBoundary, reloadOnceForNewDeploy } from './app/ChunkReloadBoundary'

window.addEventListener('vite:preloadError', () => reloadOnceForNewDeploy())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChunkReloadBoundary>
      <App />
    </ChunkReloadBoundary>
  </StrictMode>,
)
