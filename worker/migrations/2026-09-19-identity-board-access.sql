-- Menú del sidebar por persona. El código tolera que falte la tabla (cae al menú
-- del rol), así que se puede aplicar antes o después del deploy:
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-19-identity-board-access.sql
CREATE TABLE IF NOT EXISTS identity_board_access (
  email      TEXT NOT NULL,          -- en minúsculas
  board_key  TEXT NOT NULL,
  PRIMARY KEY (email, board_key)
);
