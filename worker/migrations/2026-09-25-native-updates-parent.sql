-- Hilos de respuestas en los comentarios de items NATIVOS (Zona Efrain) —
-- Jorge, 2026-09-25: "Responder" en el feed de Actualizaciones, estilo Slack.
-- Del lado de Monday la respuesta usa `create_update(parent_id)`; un item
-- nativo no existe allá, así que su hilo vive aquí.
--
-- Opcional: worker/lib/nativeUpdates.ts (ensureNativeUpdateTable) agrega la
-- columna solo en el primer request que toque la tabla. Correrlo antes del
-- deploy solo adelanta ese paso:
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-25-native-updates-parent.sql
ALTER TABLE native_updates ADD COLUMN parent_id TEXT;
