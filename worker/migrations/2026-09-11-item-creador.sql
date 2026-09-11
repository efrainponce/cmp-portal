-- Quién creó cada item desde el portal (worker/lib/itemCreador.ts). Aplicar ANTES
-- del deploy (si falta la tabla, el código cae a la regla de antes y no truena):
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-11-item-creador.sql
CREATE TABLE IF NOT EXISTS item_creador (
  item_id    INTEGER PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Las 3 oportunidades que Rodrigo creó antes de esto (accion_log contra el
-- created_at de Monday, 2026-09-11): OPP-0949, OPP-0958 (duplicado), OPP-1031.
INSERT OR IGNORE INTO item_creador (item_id, email, created_at) VALUES
  (12868101232, 'coordinador2.centro@mexicanadeproteccion.com', '2026-08-21T20:23:09Z'),
  (12885360225, 'coordinador2.centro@mexicanadeproteccion.com', '2026-08-24T19:52:43Z'),
  (13000139831, 'coordinador2.centro@mexicanadeproteccion.com', '2026-09-08T19:02:30Z');
