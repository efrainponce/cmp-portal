-- Caché de lo que Compras captura a mano en las OC (producto/concepto fuera del
-- catálogo) para poder volver a buscarlo. El código tolera que falte la tabla
-- (no guarda y no sugiere), así que se puede aplicar antes o después del deploy:
--   env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute cmp-portal --remote --env-file=.dev.vars --file worker/migrations/2026-09-21-oc-concepto.sql
CREATE TABLE IF NOT EXISTS oc_concepto (
  clave          TEXT PRIMARY KEY,   -- producto|sku normalizados (minúsculas, sin acentos ni puntuación)
  producto       TEXT NOT NULL,
  sku            TEXT,
  color          TEXT,
  talla          TEXT,
  unidad         TEXT,
  costo          REAL,
  moneda         TEXT,
  proveedor_id   INTEGER,
  proveedor_name TEXT,
  usos           INTEGER NOT NULL DEFAULT 1,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS oc_concepto_updated ON oc_concepto (updated_at);
