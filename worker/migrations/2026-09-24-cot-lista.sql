-- Board "Lista de cotizaciones" para Ventas (shared/boardAccess.ts). La tabla
-- cot_pdf_datos la crea el código solo (worker/lib/cotLista.ts); lo único que
-- hace falta en remoto es el acceso del sidebar por rol:
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-24-cot-lista.sql
INSERT OR IGNORE INTO role_board_access (role, board_key) VALUES
  ('vendedor', 'cot_lista'), ('compras', 'cot_lista');
