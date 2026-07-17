# CMP Portal

UI delgada sobre boards de Monday.com (Vite/React 19 + Cloudflare Worker/Hono + D1).
El Worker mantiene un mirror en D1 (sync/reconcile/outbox) y el frontend solo habla
con el Worker (`/api/*`). Bot de WhatsApp + chat del portal comparten agente Claude.

## Comandos

- `npm run dev` — Vite en :5173 (proxy `/api` → :8787). **Antes de lanzar dev servers,
  checa si ya corren**: `lsof -nP -iTCP:5173 -sTCP:LISTEN` y `:8787` (suele haber otra
  sesión con ellos arriba; no los relances a ciegas).
- Worker local: `npx wrangler dev --env-file=.dev.vars` — **SIEMPRE `--env-file=.dev.vars`**:
  el `.env` del repo trae un token de CF que secuestra a wrangler si no.
- `npx tsc --noEmit` — typecheck (3 tsconfigs: app/worker/node). `npm run build` = tsc -b + vite.
- `npm run lint` — oxlint.
- Screenshots de verificación: Playwright + Chromium ya instalados
  (`node_modules/playwright`, import por ruta absoluta en scripts sueltos).

## Reglas duras

- **NUNCA inventes IDs de columnas de Monday** — vienen de `docs/monday-column-map.md`
  o de `shared/column-meta.gen.ts` (generado; NO lo leas completo, grepea el id).
  Ante duda, re-introspecciona con `scripts/introspect-boards.mjs`.
- Columnas de status se escriben como `{label: "..."}` — el formato `{labels:[...]}`
  hace que Monday asigne una etiqueta arbitraria en silencio.
- Permisos por columna/rol viven en `shared/visibility.ts` (server las filtra; la UI
  solo refleja `ColMeta.w`). Decisiones de whitelist son de Efraín — no las cambies solo.
- Cada commit se registra en `log.md` (entrada con hash + bullets) y luego un commit
  "Registrar hash de X en log.md". Mensajes de commit en español.
- Puede haber otra sesión de Claude concurrente: commits selectivos, no hagas deploy
  con un tree sucio ajeno.

## Mapa del repo

- `shared/` — contratos front↔worker: `boards.ts` (ids de boards), `dto.ts`,
  `visibility.ts` (roles/writable), `dealStages.ts` (etapas canon), `column-meta.gen.ts`
  (generado, 2.4k líneas — solo grep), `embellecimiento.ts`, `inventory.ts`.
- `worker/index.ts` — solo wiring de Hono. Rutas en `worker/routes/{boards,oportunidades,admin,inventario}.ts`;
  webhooks/sync en `worker/sync/`; WhatsApp en `worker/wa/`; chat portal en `worker/assistant/`.
- `worker/lib/` — dal (scoping por viewer), outbox (writes → Monday con echo),
  monday (GraphQL), costeo/quoteVersions/automations (flujos cmp-tallas),
  agentLoop (agente compartido WA+portal, prompt caching), serialize, rosterCache.
- `src/lib/` — `apiClient.ts` (fetch + DTOs), `api.ts` (hooks de polling/ETag),
  `dealStages.ts` (config de los 6 boards de pipeline), `costeoCalc.ts` (fórmulas 1:1
  con Monday para preview local), `routing.ts` (deep links `/boardKey/itemId`).
- `src/boards/oportunidades/` — corazón de la UI: `StageBoardList` (lista por etapa),
  `StageBoard.tsx` (wrapper genérico de los 5 boards de etapa; Oportunidades tiene el
  suyo por el modal de crear), `OpportunityDrawer.tsx` (drawer compartido, modos por
  `boardKey`: costeo=readOnly, validacion=precioOnly), `tabs/` y `tabs/cotizacion/`
  (grid de cotización compartimentada: gridMeta, TotalsRow, VersionChips, SnapshotTable,
  CotizacionPdfRow con pdfjs lazy).
- `docs/` — **léelos antes de tocar el área**: `monday-column-map.md` (ids de columnas),
  `dev-contracts.md` (contratos entre módulos), `cmp-tallas-endpoint-map.md`
  (automatizaciones Vercel: dispara, no reimplementes), `whatsapp-bot.md`.
- `log.md` — bitácora de commits con contexto de decisiones (qué pidió Efraín y por qué).

## Flujos clave (no reimplementar)

- Etapas (`deal_stage`): 4 Nueva oportunidad → 15 En costeo → 7 Validación → 9 Costeo
  Confirmado → 8 Esperando OC → 1 Ganada. Orden/labels canon en `shared/dealStages.ts`.
- Mandar a costeo / generar cotización / tallas / OC = endpoints de cmp-tallas
  (`worker/lib/automations.ts`) — el portal los dispara y refetchea el mirror; nunca
  cambia el stage por su cuenta (excepción: enviar-validacion 15→7, sin endpoint).
- Ediciones de líneas: inline solo en stage 4; en otras etapas vía "Nueva versión"
  (`worker/lib/quoteVersions.ts`). Precio NUNCA editable por vendedor.
- Writes: front → `PATCH /api/boards/:slug/items/:id` → outbox D1 → Monday → echo/refetch.
  El mirror tarda: usa previews locales en la UI (patrón ya en CotizacionTab).
