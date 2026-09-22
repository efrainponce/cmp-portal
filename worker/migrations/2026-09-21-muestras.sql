-- Board "Solicitudes de muestra" para Ventas y Compras (shared/boardAccess.ts).
-- Las tablas muestra_* las crea el código solo (worker/lib/muestras.ts); lo único
-- que hace falta en remoto es el acceso del sidebar por rol:
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-21-muestras.sql
INSERT OR IGNORE INTO role_board_access (role, board_key) VALUES
  ('vendedor', 'muestras'), ('compras', 'muestras');
