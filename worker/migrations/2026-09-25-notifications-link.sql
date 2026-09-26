-- Link externo en las notificaciones (Efraín, 2026-09-25): el aviso "Sin costo
-- en Airtable" (worker/lib/costoSinAirtable.ts) lleva al registro del producto
-- en Airtable. emitNotification solo manda la columna cuando hay link, así que
-- los demás avisos no dependen de esta migración.
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-25-notifications-link.sql
ALTER TABLE notifications ADD COLUMN link TEXT;
