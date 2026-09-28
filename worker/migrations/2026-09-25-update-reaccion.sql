-- Reacciones con emoji a los comentarios del feed de Actualizaciones (Jorge,
-- 2026-09-25, fase 3). Viven SOLO en el portal — por qué no van a Monday, en
-- shared/reacciones.ts.
--
-- Opcional: worker/lib/reacciones.ts crea la tabla sola en el primer request.
-- Correrlo antes del deploy solo adelanta ese paso:
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-25-update-reaccion.sql
CREATE TABLE IF NOT EXISTS update_reaccion (
  update_id  TEXT NOT NULL,
  email      TEXT NOT NULL,
  nombre     TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  item_id    INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (update_id, email, tipo)
);
