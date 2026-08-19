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
- `npm run typecheck` — typecheck REAL de las 3 tsconfigs (app/node vía `tsc -b`,
  worker aparte). **No uses `npx tsc --noEmit`**: `tsconfig.json` es solo archivo
  solución (`"files": []` + references), así que ese comando no revisa nada y sale
  0 siempre — dejó pasar errores hasta 2026-08-13. `npm run build` = tsc -b + vite
  (o sea, el build tampoco cubre el worker por su cuenta).
- `npm run lint` — oxlint.
- `npm test` — vitest sobre lógica pura (`{src,worker,shared}/**/*.test.ts`): canon/echo
  del write path a Monday, shapes de `columnEncode`, whitelist de `visibility`. Corre en
  CI **antes** del deploy. Si tocas esas áreas, corre esto — el typecheck no las cubre
  (todo son strings).
- Screenshots de verificación: Playwright + Chromium ya instalados
  (`node_modules/playwright`, import por ruta absoluta en scripts sueltos).

## Reglas duras

- **NUNCA inventes IDs de columnas de Monday** — vienen de `docs/monday-column-map.md`
  o de `shared/column-meta.gen.ts` (generado; grepea el id — el archivo trae una
  columna por línea, así que el grep ya te devuelve title/type/labels completos).
  Ante duda, re-introspecciona con `scripts/introspect-boards.mjs`.
- Columnas de status se escriben como `{label: "..."}` — el formato `{labels:[...]}`
  hace que Monday asigne una etiqueta arbitraria en silencio.
- Permisos por columna/rol viven en `shared/visibility.ts` (server las filtra; la UI
  solo refleja `ColMeta.w`). Decisiones de whitelist son de Efraín — no las cambies solo.
- **El portal y Monday quedan 1-1: lo que se borra en el portal se borra en
  Monday** (Efraín, 2026-08-19 tarde). Ese día, por unas horas, "borrar" fue
  OCULTAR y rompió costeo el mismo día: la línea escondida seguía viva en Monday
  y `validar_costeo` (cmp-tallas, que lee los subitems DIRECTO de Monday) rechazó
  el envío por una línea que el portal ya no le mostraba a nadie. Todo lo que se
  esconda del portal reaparece como error en costeo/cotización/tallas/OC.
  El borrado vive en **un solo lugar**, `worker/lib/itemBorrado.ts`, con guardas:
  respaldo del renglón completo en `item_borrado` ANTES de borrar, de a un id a
  la vez (nunca a partir de una lista) y tope de 40 borrados por hora y persona.
  Anclado en `worker/lib/monday.destructivo.test.ts` — `delete_item` en cualquier
  otro fuente, o cualquier otra mutación destructiva (`delete_board`,
  `delete_column`…), tumba el test. Las guardas existen porque el 2026-08-18 un
  script pidió una lista con un filtro que la ruta no conocía (`?parent=`),
  recibió el board COMPLETO y borró 70 líneas de 22 oportunidades en 4.5 minutos:
  en Monday no hay deshacer masivo. Excepción: items NATIVOS (Zona Efrain, ids
  ≥ 900000000000) no existen en Monday y solo se borra su fila de D1.
- **Los ARCHIVOS también son 1-1** (`worker/lib/archivoBorrado.ts`, 2026-08-19):
  sí se puede quitar UN archivo de una columna `file` sin vaciar la columna —
  `update_assets_on_item` la reescribe a partir de los assets que se quedan (no
  hace falta ningún `delete_*`). Ojo: el asset que se deja fuera DESAPARECE de
  Monday, así que va con las mismas guardas — respaldo de los bytes en R2
  (`…/documento-borrado/<assetId>-<nombre>`) + renglón en `archivo_borrado`
  ANTES de tocar Monday, de a un archivo por assetId, tope de 30 por hora y
  persona, y la lista de sobrevivientes leída EN VIVO de Monday (con el mirror
  atrasado se borraría un archivo recién subido). Quién puede: **solo quien lo
  subió** (`archivo_subido`; en Monday todo aparece subido por el token de
  servicio, por eso el registro es propio) o un admin.
- **Las rutas rechazan query params que no conocen** (`rejectUnknownQuery` en
  `worker/lib/http.ts`): un filtro mal escrito no debe degradar a "sin filtro".
- Permisos por RENGLÓN: `worker/lib/dal.ts`. Leer = lo propio + la zona que el viewer
  lidera (`worker/lib/zonas.ts`); escribir = SOLO lo propio (`getItem(..., 'own')`).
  Todo endpoint que muta pide scope `'own'` — si agregas uno, hazlo también.
- Antes de cada commit, agrega la entrada a `log.md` (fecha + bullets del cambio,
  sin hash — todavía no existe) y súbela en el MISMO commit junto con el código.
  Nunca un commit aparte solo para loggear (evitar doble commit). Mensajes de
  commit en español.
- Cada push a `main` dispara deploy automático (GitHub Actions `deploy.yml`:
  typecheck + test + build + `wrangler deploy`) — un push a main sale a
  producción. No pushear con un tree sucio ajeno ni sin correr `npm test` si
  tocaste write path/visibility.
- Puede haber otra sesión de Claude concurrente: commits selectivos, no hagas deploy
  con un tree sucio ajeno.

## Mapa del repo

- **`docs/code-index.md`** — índice curado archivo→propósito+exports de `src/`, `worker/`,
  `shared/`. **Grepéalo antes de explorar** (ahorra tokens); si algo no cuadra, verifica
  contra el código.
- `shared/` — contratos front↔worker: `boards.ts` (ids de boards), `dto.ts`,
  `visibility.ts` (roles/writable), `dealStages.ts` (etapas canon), `column-meta.gen.ts`
  (generado, 2.4k líneas — solo grep), `embellecimiento.ts`, `inventory.ts`,
  `documents.ts` (plantillas de PDF + firma electrónica).
- `worker/index.ts` — solo wiring de Hono. Rutas en `worker/routes/{boards,oportunidades,admin,inventario}.ts`;
  webhooks/sync en `worker/sync/`; WhatsApp en `worker/wa/`; chat portal en `worker/assistant/`.
- `worker/lib/` — dal (scoping por viewer), outbox (writes → Monday con echo),
  monday (GraphQL), costeo/quoteVersions/automations (flujos cmp-tallas),
  agentLoop (agente compartido WA+portal, prompt caching), serialize, rosterCache,
  documents + `pdf/` (generación de PDFs y firma electrónica), portalFiles.
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
  (automatizaciones Vercel: dispara, no reimplementes), `whatsapp-bot.md`,
  `documentos-firma.md` (PDFs del portal + firma).
- `log.md` — bitácora de commits con contexto de decisiones (qué pidió Efraín y por qué).

## Flujos clave (no reimplementar)

- Etapas (`deal_stage`): 4 Nueva oportunidad → 15 En costeo → 7 Validación → 9 Costeo
  Confirmado → 8 Esperando OC → 1 Ganada. Orden/labels canon en `shared/dealStages.ts`.
- Mandar a costeo / generar cotización / tallas / OC = endpoints de cmp-tallas
  (`worker/lib/automations.ts`) — el portal los dispara y refetchea el mirror; nunca
  cambia el stage por su cuenta (excepción: enviar-validacion 15→7, sin endpoint).
- Ediciones de líneas: inline solo en stage 4; en otras etapas vía "Nueva versión"
  (`worker/lib/quoteVersions.ts`). **Precio de Venta C/U (`numeric_mkzneg3d`): solo
  admin lo escribe** (`w: WA`); vendedor y compras lo VEN pero no lo editan (Efraín,
  2026-07-24). Anclado en `shared/visibility.test.ts`.
- Writes: front → `PATCH /api/boards/:slug/items/:id` → outbox D1 → Monday → echo/refetch.
  El mirror tarda: usa previews locales en la UI (patrón ya en CotizacionTab).
- Documentos del portal (`docs/documentos-firma.md`): la **cotización al cliente
  sigue en Eledo** — el portal NO la genera. Sí genera la solicitud de costeo
  (líneas sin precios, sale sola al "Mandar a costeo") y, pendiente, la OC a
  proveedor. Sin imágenes de producto: el motor solo embebe JPEG.
- Firma electrónica (`docs/documentos-firma.md`): el PDF se
  renderiza desde el snapshot que guarda `documents.data` (nunca de una lectura
  fresca del mirror) y `sha256` se re-verifica antes de asentar cada firma. Un PDF
  ajeno (cotización de cmp-tallas) NO se modifica: se sella una copia en R2 y la
  firma vive en su constancia. El escritor de PDF es propio, sin dependencias —
  solo escribe, no parsea.
