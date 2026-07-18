# CMP Portal

Portal interno para Mexicana de Protección (CMP): una UI delgada sobre los boards de
Monday.com, respaldada por un Cloudflare Worker que sincroniza datos a D1, expone una API
propia con control de acceso por rol, y corre un bot de WhatsApp para crear
contactos/oportunidades desde el celular.

Ver [log.md](log.md) para el historial de cambios por fecha.

## Arquitectura

- **Frontend** — React 19 + Vite, servido como assets estáticos por el Worker.
  Vistas por board (Oportunidades, Costeo, Logística, Órdenes de compra, Validación,
  Inventario, Documentación de tallas) más un drawer compartido de detalle.
- **Worker** (`worker/`) — Hono sobre Cloudflare Workers. Expone la API REST que
  consume el frontend, procesa webhooks de Monday, corre la reconciliación periódica
  y aloja las rutas del bot de WhatsApp.
- **D1** — espejo local de los boards de Monday (`worker/schema.sql`). Las lecturas del
  portal pegan contra D1, no contra Monday directamente.
- **Outbox** — las escrituras del portal van: UI optimista → D1 → mutación a Monday →
  eco por webhook → hash canónico → `confirmed`. Nunca se confía ciegamente en el payload
  del webhook; siempre se hace un refetch.
- **Shared** (`shared/`) — tipos, DTOs y reglas de visibilidad/campos-escribibles
  compartidas entre frontend y worker.

## Desarrollo

```bash
npm install
npm run dev              # Vite dev server (frontend)
npx wrangler dev --env-file=.dev.vars   # Worker local, sirve la API + assets
```

> ⚠️ Quirk local: si existe un `.env` con `CLOUDFLARE_API_TOKEN`, wrangler lo usa en vez
> de las credenciales correctas y falla por permisos. Todo comando de wrangler debe
> incluir `--env-file=.dev.vars`.

Otros scripts:

```bash
npm run build     # tsc -b && vite build
npm run lint      # oxlint
npm run preview   # preview del build de Vite
```

Scripts de mantenimiento en `scripts/`: `hydrate.mjs` (carga inicial D1),
`seed-identity.mjs` (roles de usuario), `introspect-boards.mjs` (regenera
`shared/column-meta.gen.ts` y detecta drift de columnas en Monday),
`create-webhooks.mjs` (registra webhooks de Monday hacia el Worker),
`backfill-r2-files.mjs` (copia a R2 los archivos de documento/embellecimiento
subidos antes de la migración a R2 — no es prerequisito, solo pre-warm).

## Roles y visibilidad

Tres roles: `vendedor`, `compras`, `admin`. Cada vendedor solo ve sus propias
oportunidades (scoping server-side); columnas de costo/utilidad nunca salen del
Worker para vendedores. Reglas de visibilidad y campos escribibles viven en
`shared/visibility.ts`.

## Documentación adicional

- [docs/dev-contracts.md](docs/dev-contracts.md) — contratos de API entre frontend y worker.
- [docs/monday-column-map.md](docs/monday-column-map.md) — mapeo de columnas de Monday por board.
- [docs/whatsapp-bot.md](docs/whatsapp-bot.md) — diseño del bot de WhatsApp.
- [docs/cmp-tallas-endpoint-map.md](docs/cmp-tallas-endpoint-map.md) — integración con las
  automatizaciones de cmp-tallas (Vercel).
