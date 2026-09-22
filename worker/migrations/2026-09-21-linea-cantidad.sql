-- 2026-09-21 — Cantidad de cada línea materializada en `items` (t_cantidad),
-- para la columna "Cantidad" de la lista de Oportunidades (admin). Mismo
-- patrón que 2026-08-20-linea-totales.sql: worker/schema.sql ya la trae para
-- una base nueva; esto es para las que YA existen. Aplicar ANTES de desplegar
-- el código que la lee (el upsert del sync la escribe: sin la columna, TODO el
-- sync de líneas falla):
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute DB --remote --env-file=.dev.vars --file=worker/migrations/2026-09-21-linea-cantidad.sql
-- (y lo mismo con --local para la base de desarrollo).
ALTER TABLE items ADD COLUMN t_cantidad REAL;

-- Backfill desde lo que ya está en el mirror (Cantidad = numeric_mkzm6399).
UPDATE items SET
  t_cantidad = COALESCE((SELECT CAST(REPLACE(json_extract(je.value,'$.text'), ',', '') AS REAL) FROM json_each(items.columns) je WHERE json_extract(je.value,'$.id')='numeric_mkzm6399'), 0)
WHERE board_id = 18395657607;
