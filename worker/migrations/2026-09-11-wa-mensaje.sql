-- Bitácora de cada WhatsApp que manda el portal (worker/wa/log.ts). Aplicar ANTES
-- del deploy (sin la tabla, el envío sigue funcionando pero no queda registro):
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-11-wa-mensaje.sql
CREATE TABLE IF NOT EXISTS wa_mensaje (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  wamid        TEXT,              -- id de Meta; NULL si Meta rechazó el envío
  tipo         TEXT NOT NULL,     -- 'aviso' | 'anuncio' | 'alerta' | 'bot'
  telefono     TEXT NOT NULL,     -- tal como se mandó
  email        TEXT,              -- destinatario, si se sabe
  titulo       TEXT,              -- texto mandado (recortado a 300)
  board_key    TEXT,
  item_id      INTEGER,
  estado       TEXT NOT NULL,     -- rechazado | enviado | entregado | leido | fallido
  error        TEXT,              -- motivo de Meta (rechazo al mandar o fallo de entrega)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  entregado_at TEXT,
  leido_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_mensaje_wamid   ON wa_mensaje(wamid);
CREATE INDEX IF NOT EXISTS idx_wa_mensaje_email   ON wa_mensaje(email, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_mensaje_estado  ON wa_mensaje(estado, updated_at);
CREATE INDEX IF NOT EXISTS idx_wa_mensaje_created ON wa_mensaje(created_at);
