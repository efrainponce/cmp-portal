-- 2026-08-20 — Totales por línea de cotización materializados en `items`.
-- worker/schema.sql ya trae estas columnas en el CREATE TABLE (para una base
-- nueva); este archivo es para las bases que YA existen, donde
-- "CREATE TABLE IF NOT EXISTS" no hace nada. Aplicar una sola vez:
--   npx wrangler d1 execute DB --remote --env-file=.dev.vars --file=worker/migrations/2026-08-20-linea-totales.sql
-- (y lo mismo con --local para la base de desarrollo).
ALTER TABLE items ADD COLUMN t_costo      REAL;
ALTER TABLE items ADD COLUMN t_subtotal   REAL;
ALTER TABLE items ADD COLUMN t_total      REAL;
ALTER TABLE items ADD COLUMN t_utilidad   REAL;
ALTER TABLE items ADD COLUMN t_margen_gob REAL;

-- Backfill de lo que ya está en el mirror, leyendo las fórmulas que Monday
-- calculó por línea. Las líneas NATIVAS (Zona Efrain) no tienen fórmulas: se
-- quedan en 0 aquí y las llena POST /api/admin/totales/recalcular, que usa la
-- misma matemática de la grid (worker/lib/lineaTotales.ts).
UPDATE items SET
  t_costo      = COALESCE((SELECT CAST(json_extract(je.value,'$.text') AS REAL) FROM json_each(items.columns) je WHERE json_extract(je.value,'$.id')='formula_mkznrm5a'), 0),
  t_subtotal   = COALESCE((SELECT CAST(json_extract(je.value,'$.text') AS REAL) FROM json_each(items.columns) je WHERE json_extract(je.value,'$.id')='formula_mkznmjh6'), 0),
  t_total      = COALESCE((SELECT CAST(json_extract(je.value,'$.text') AS REAL) FROM json_each(items.columns) je WHERE json_extract(je.value,'$.id')='formula_mm00xy0n'), 0),
  t_utilidad   = COALESCE((SELECT CAST(json_extract(je.value,'$.text') AS REAL) FROM json_each(items.columns) je WHERE json_extract(je.value,'$.id')='formula_mkznry25'), 0),
  t_margen_gob = COALESCE((SELECT CAST(json_extract(je.value,'$.text') AS REAL) FROM json_each(items.columns) je WHERE json_extract(je.value,'$.id')='formula_mkznsb7m'), 0)
WHERE board_id = 18395657607;
