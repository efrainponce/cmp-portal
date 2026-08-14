import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // NO se fusionan los ~11 chunks de ~1 KB (Button, Badges, Modal, GroupCard…)
  // aunque tiente: los ~350 ms que costaban se midieron contra `wrangler dev`,
  // que habla HTTP/1.1. Producción va por HTTP/3 multiplexado, donde esos
  // requests chicos en paralelo salen casi gratis — en la cascada real de prod
  // el cuello eran la fuente y los chunks del drawer, no estos. Si algún día se
  // vuelve a intentar, medir contra producción (scripts/prod-login.mjs +
  // el waterfall), no contra local.
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
