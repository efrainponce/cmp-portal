# Bot de WhatsApp para vendedores — 2026-07-15

Chatbot en WhatsApp para que los vendedores en ruta creen **contactos** y
**oportunidades** (con líneas de producto ligadas al catálogo) sin abrir la app.
Vive en el mismo worker (`worker/wa/`), sin infraestructura nueva.

## Arquitectura

```
WhatsApp (vendedor) → Meta Cloud API → POST /wa/webhook (worker)
  → identidad por teléfono (D1 `identity.phone`, fail-closed)
  → agente Claude Haiku 4.5 (tool-use, historial en D1 `wa_conversations`)
      herramientas: buscar_productos / buscar_contactos / buscar_instituciones
                    crear_contacto (misma whitelist del portal, createFields.ts)
                    crear_oportunidad (worker/lib/createOportunidad.ts)
  → respuesta por Meta Cloud API
```

Decisiones tomadas (revisables):

- **Sin MCP**: un tool-loop dentro del worker es más simple y barato; un MCP solo
  agregaría un intermediario que igual habría que hospedar.
- **Modelo**: `claude-haiku-4-5` ($1/$5 por MTok). Una conversación típica de alta de
  oportunidad cuesta ~$0.01–0.03 USD. Mensajes de WhatsApp: entrantes y respuestas
  dentro de la ventana de servicio de 24 h no tienen costo Meta.
- **Oportunidad nueva** queda en etapa **"Nueva oportunidad"** con `deal_owner` = el
  vendedor del teléfono. Contacto opcional (`deal_contact`, verificado vía
  `linked_item_ids` — el echo del create llega vacío aunque el vínculo sí se hace).
- **Líneas de producto**: subitems con `board_relation_mkzmafgp` → Productos, así los
  mirrors (SKU, marca, tallas, descripción) cuadran solos y las automatizaciones de
  Monday corren igual que si se capturara a mano. Producto fuera de catálogo = línea
  con texto libre + nota en Comentarios Ventas.
- **Confirmación obligatoria**: el agente siempre resume y espera un "sí" antes de
  crear (regla de system prompt).
- **Historial**: 24 h de vida, máx. 40 mensajes por conversación; "reiniciar" borra.
- **Seguridad**: firma HMAC de Meta (`WA_APP_SECRET`, obligatoria en prod, el webhook
  rechaza sin ella), dedupe de entregas (`wa_processed`), y solo números dados de alta
  en `identity` con rol vendedor/compras/admin pueden usar el bot.

## Setup en Meta (una vez)

1. <https://developers.facebook.com> → crear app tipo **Business** → agregar producto
   **WhatsApp**. Meta regala un número de prueba; para producción hay que registrar un
   número propio (no puede estar activo en la app normal de WhatsApp).
2. En *WhatsApp → API Setup* copia:
   - **Phone number ID** → secret `WHATSAPP_PHONE_NUMBER_ID`
   - **Token permanente**: crea un *System User* en Business Settings con permiso
     `whatsapp_business_messaging` → secret `WHATSAPP_TOKEN`
3. En *App Settings → Basic*: **App Secret** → secret `WA_APP_SECRET`.
4. En *WhatsApp → Configuration → Webhook*:
   - Callback URL: `https://<worker>/wa/webhook`
   - Verify token: el valor que pongas en `WA_VERIFY_TOKEN`
   - Suscribir el campo **messages**.

## Secrets del worker

```sh
npx wrangler secret put ANTHROPIC_API_KEY --env-file=/dev/null
npx wrangler secret put WHATSAPP_TOKEN --env-file=/dev/null
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID --env-file=/dev/null
npx wrangler secret put WA_VERIFY_TOKEN --env-file=/dev/null
npx wrangler secret put WA_APP_SECRET --env-file=/dev/null
```

(El `--env-file=/dev/null` es por el quirk del token de CF en `.env`.)

Y aplicar el schema nuevo en prod (tablas `wa_conversations`, `wa_processed`):

```sh
npx wrangler d1 execute cmp-portal --remote --file=worker/schema.sql --env-file=/dev/null
```

## Agente de inventario (rol `almacen`) — 2026-07-22

El mismo bot atiende a logística con una persona dedicada (`almacenPrompt` en
`worker/lib/assistantPersonas.ts`). Puede **registrar y consultar movimientos** de
inventario por WhatsApp (o por la burbuja del portal — es el mismo agente):

- Herramientas nuevas (`worker/lib/assistantTools.ts`):
  - `listar_almacenes` — catálogo de almacenes activos con su id (para no inventar ids).
  - `crear_movimiento` — captura un movimiento llamando a `createMovement`
    (`worker/lib/inventory.ts`), **la misma función y reglas que el formulario del
    portal** (`shared/inventory.ts`: `validateMovementEndpoints`, folio autoincremental,
    `captured_by` = nombre del identity). Soporta los 4 tipos: Entrada / Salida /
    Transferencia / Consolidación.
- Gating (`TOOL_ROLES`): consulta (`consultar_inventario`, `movimientos_inventario`,
  `listar_almacenes`, `buscar_productos`) = `almacen` + `compras` + `admin`; **escritura**
  (`crear_movimiento`) = **`almacen` + `admin`** (decisión de Efraín — `compras` sigue
  solo-consulta, como en el portal). El agente de almacén NO ve pipeline ni oportunidades.
- El agente pregunta un dato a la vez y **exige confirmación explícita** antes de
  capturar (regla en `REGLAS_INVENTARIO`), igual que crear_oportunidad.

Alta de un usuario de almacén = una identidad con `role='almacen'` y `phone` (mismo
mecanismo de whitelist de abajo).

## Notificaciones "importantes" por WhatsApp — 2026-07-31

El Centro de Notificaciones del portal (`worker/lib/notify.ts`, tabla `notifications`)
también reenvía por WhatsApp las notificaciones de severidad **`importante`**
(menciones, costeo incompleto, producto propuesto, documento firmado) — **no**
`actualizacion`/cambios de etapa, por decisión de alcance de Efraín.

- `emitNotification()` dispara `notifyPortalWa()` (`worker/wa/notify.ts`) solo cuando
  el `INSERT OR IGNORE` insertó fila nueva (evita reenvíos en replays con el mismo
  `dedupe_key`) y solo si el destinatario tiene `identity.phone`.
- `worker/wa/send.ts::sendTemplate()` reusa los secrets `WHATSAPP_TOKEN` /
  `WHATSAPP_PHONE_NUMBER_ID` ya dados de alta arriba — no hay secrets nuevos.
- **Requiere un template pre-aprobado por Meta** (mensaje proactivo, fuera de la
  ventana de servicio de 24h del bot). Template dado de alta en Meta Business Manager:
  - Nombre: `portal_notificacion` · Categoría: Utility · Idioma: `es_MX`
  - Body: `{{1}}` = título de la notificación (texto con contenido fijo antes/después,
    Meta rechaza variables pegadas al inicio/fin del mensaje)
  - Botón "Visit website" con URL dinámica: base `https://portal.mexicanadeproteccion.com/`
    + `{{1}}` = `{boardKey}/{itemId}` (mismo formato de ruta que `src/lib/routing.ts`,
    así que el link abre la oportunidad directo en la app).
- Si el template no está aprobado (o Meta lo rechaza), el envío falla y se loguea a
  `sync_log` — best-effort, no rompe la notificación del portal ni el flujo que la
  disparó.

## Asistente de cartera — 2026-09-12

Plan completo en `docs/plan-wa-cartera.md`. Lo que quedó en código (Efraín:
"implementa todo", "que sea barato para Haiku", "log de todo", "opción para
no recibir las actualizaciones o por número saber cuáles recibir o no"):

- **Vista de cartera** (`worker/lib/cartera.ts`): por oportunidad abierta del
  viewer — días en etapa (último `deal_stage` en `activity_log`; sin registro,
  "aprox" desde `monday_updated_at`), días sin movimiento, último seguimiento,
  siguiente paso por etapa/rol, prioridad (fecha límite, etapa avanzada, monto
  alto, apagada, atorada), categoría (`se_mueve` / `atorada` / `apagada` /
  `normal`) y UNA candidata a cerrar (≥45 días, sin pospuestas ni repetidas en
  7 días). Umbrales en `UMBRALES` (14 / 45 / 2 / 3 / 7). Compras ve las que están
  en costeo o validación con lo que dice `checkValidacion`. Los `render*`
  devuelven el texto final para WhatsApp: **el código redacta, el modelo no**.
- **Router de comandos sin modelo** (`worker/wa/comandos.ts`, corre ANTES del
  agente): `cartera` / `apagadas` / `atoradas` / `se mueven`, `3` (detalle de
  la #3 de la última lista, `wa_lista`), `3: llamé, piden muestra` (Update real
  en Monday + `seguimientos`, sin confirmación), `cerrar 3` / `perder 3` /
  `cerrar` (la candidata) → confirmación en `wa_pendiente` → `SÍ` / `NO` /
  `PERDIDA`, `motivo: …` (nota en la recién cerrada), `hoy no` / `posponer 3`
  (`wa_snooze` 7 días), `ayuda`, y los botones del template. "Archivar" =
  `deal_stage` Cancelada por el outbox (como el drawer), nunca `archive_item`.
- **Tools de respuesta directa** (`DIRECT_REPLY_TOOLS`, `agentLoop.ts`):
  `mi_cartera`, `historial_oportunidad`, `registrar_seguimiento`,
  `cerrar_oportunidad` devuelven texto listo; si el modelo llamó solo una, el
  loop lo manda tal cual y NO vuelve a llamar al modelo (se ahorra la llamada
  cara). La última lista numerada entra como segundo bloque de system
  (`contextoDeLista`) para que "la 2 sigue viva" resuelva el item_id en una
  llamada. El webhook hace `deltaSyncIfStale(2 min)` antes de contestar.
- **Resumen matutino** (`worker/wa/resumen.ts`, `WA_CARTERA=1`): gate por
  persona dentro del cron `*/15` (su hora CDMX y las dos siguientes, L–V,
  sábado opcional, una fila por día en `wa_resumen` aunque NO salga, con
  motivo). Relee de Monday las abiertas de la persona (`refetchItems`) antes
  de armarlo. Template `resumen_cartera` (Utility, es_MX) — **hay que darlo
  de alta en Meta** con este cuerpo literal y 3 botones quick-reply
  (payloads `CARTERA_VER`, `CARTERA_CERRAR`, `CARTERA_HOY_NO`):

  ```
  Buenos días {{1}}. Tu cartera hoy: {{2}}.
  • {{3}}
  • {{4}}
  • {{5}}
  Para cerrar hoy: {{6}}
  [Ver detalle] [Cerrar esa] [Hoy no]
  ```

  Sin el template aprobado el envío falla y queda en `wa_resumen.motivo` +
  `wa_mensaje` (y la revisión de salud lo marca). "Mandar resumen ahora" desde
  Ajustes (`POST /api/admin/wa/resumen/enviar`) sirve para probarlo.
- **Qué recibe cada número** (`worker/wa/preferencias.ts`, `wa_preferencias`):
  1 resumen (opt-in, apagado por default), 2 propuesta de cierre, 3 avisos
  importantes (`wa/notify.ts` lo consulta; prendido por default), 4 hora
  (7–12), 5 sábados; `pausa` / `pausa 2 semanas` (1 y 2), `parar` (todo lo
  proactivo, exigencia de Meta), `reanudar`, menú `ajustes` numerado. Cada
  cambio en `wa_preferencias_log`. Admin: Ajustes → "WhatsApp: qué recibe cada
  número" (`src/app/WaPreferenciasCard.tsx`, `GET/PATCH /api/admin/wa/preferencias`).
- **Bitácora de todo** (`worker/wa/bitacora.ts`): `wa_entrante` (cada mensaje
  que llega, quién lo atendió — `router:<cmd>` / `agente` / `rechazado:<motivo>`
  —, respuesta, latencia, error) y `agente_evento` (cada llamada al modelo con
  tokens y costo USD, cada tool con input/resultado resumidos; WhatsApp Y
  burbuja del portal). Retención 400 días (poda en el cron semanal). Leer:
  `node scripts/wa-bitacora.mjs --correo x@… --dias 7` (línea de tiempo) o
  sin correo (gasto por persona); `GET /api/admin/wa/bitacora?correo=&horas=`.
  Salud (`salud.ts` revisión `cartera`): entrante que tronó, resumen de hoy
  que no salió por error, persona con > $1 USD de modelo en 24 h.
- Todas las tablas nuevas se crean lazy (`CREATE TABLE IF NOT EXISTS`) — no
  hay migración que aplicar; están documentadas en `worker/schema.sql`.

## Detalle de un proyecto — 2026-09-11

`detalle_proyecto` (vendedor/compras/admin; el vendedor solo los suyos):
campos visibles para su rol, documentos subidos o faltantes (solo nombres) y
líneas resumidas por producto+color (piezas, tallas, estado, guías). Por
folio (PRO-…), item_id o texto; si hay varios, regresa candidatos.

## Consultas de dirección — 2026-09-11

Solo para **Elisa, el CEO, Efraín y Jorge (webcmp)** — whitelist por CORREO
(`puedeConsultarDireccion`, `shared/visibility.ts`), además del rol admin. PAM
es admin y no las tiene. Aplica al bot de WhatsApp y a la burbuja del portal.

- `ranking_vendedores` — "¿quién es el mejor vendedor?": por vendedor, creadas,
  cotizadas, ganadas, tasa de cierre, pipeline abierto; ordenable.
- `resumen_ventas` — "¿cuánto hemos cotizado/ganado?": embudo con montos,
  conversión, tiempo de costeo, datos por resolver; desglose opcional por zona
  o vendedor.
- `oportunidades_por_validar` — "¿qué hay que verificar?": las que están en
  "Costeo en validación", listas vs. sin Precio de Venta, días esperando.

Ranking y resumen salen de `buildAnalyticsResponse` (mismos números que el
tablero de Análisis, periodo por fecha de creación, montos sin IVA). La
utilidad sigue detrás de `puedeVerUtilidades`: Jorge usa las consultas pero no
ve utilidad. Anclado en `worker/lib/assistantTools.test.ts`.

- `consulta_libre` — preguntas abiertas ("¿qué zona va mejor?", "¿qué producto
  se vende más?", "¿cómo vamos por mes?"). El modelo NO escribe SQL ni suma de
  cabeza: arma filtros + agrupar + métricas y el worker lo ejecuta
  (`shared/consultaLibre.ts`) sobre filas ya filtradas por permisos
  (`worker/lib/consultaLibre.ts`). Campo desconocido o tapado = error que el
  modelo usa para corregirse. Proveedor y Tipo de Producto NO están (sus
  columnas no están en `VISIBILITY`; agregarlas es decisión de Efraín).
- **Periodo por defecto = año en curso** (desde el 1 de enero, hora de CDMX)
  en ranking, resumen y consulta libre; `toda_la_historia: true` solo cuando
  piden el histórico. El resultado trae el periodo y el bot debe decirlo.
- Regla 7 del prompt (todas las personas): pregunta ambigua → elegir el
  criterio más razonable, decirlo, contestar y ofrecer alternativas; no
  contestar con otra pregunta.

Para usarlas por WhatsApp cada persona necesita su `identity.phone` (ver
abajo). Dados de alta el 2026-09-11: Jorge (`webcmp@`), Elisa
(`administracion@`) y el CEO (`efrain.ponce@`).

## Alta de vendedores (whitelist — decisión de Efraín)

El bot solo atiende teléfonos que estén en `identity.phone` (se comparan los últimos
10 dígitos, así que da igual el `521`). Alta manual:

```sh
npx wrangler d1 execute cmp-portal --remote --env-file=/dev/null \
  --command="UPDATE identity SET phone='4771234567' WHERE email='vendedor@mexicanadeproteccion.com'"
```

## Probar en local

```sh
# Terminal 1 — worker (el puerto por defecto es 8787)
npx wrangler dev --env-file=.dev.vars

# Terminal 2 — chat interactivo (requiere ANTHROPIC_API_KEY real en .dev.vars)
node scripts/wa-chat.mjs
```

En local (`ENVIRONMENT=dev`) existe `POST /wa/dev-chat` (`{phone, text}` → `{reply}`),
deshabilitado en prod. El número de prueba local `4770000001` está sembrado en
`efrain.ponces@gmail.com`. Sin clave de Anthropic se puede probar la tubería completa
(identidad, herramientas, D1, Monday) con el mock determinista:

```sh
node scripts/wa-mock-anthropic.mjs   # y en .dev.vars: ANTHROPIC_BASE_URL=http://127.0.0.1:8788
```

## Verificado en vivo (2026-07-15)

- Handshake GET de Meta ✅ · token inválido → 403 ✅ · teléfono desconocido → rechazo ✅
- Búsquedas de productos/contactos contra el espejo D1 (con SKU/marca/cargo) ✅
- Creación real de oportunidad de prueba en Monday: etapa "Nueva oportunidad", dueño,
  fecha límite, contacto vinculado, subitem con mirrors del catálogo poblados y
  automatizaciones disparadas (folio, condiciones, carpeta Drive) ✅ (items de prueba
  borrados después).
- Historial multi-turno persistido y trimming sin romper pares tool_use/tool_result ✅

## Pendientes / límites conocidos

- **Confiabilidad (2026-09-12):** el router deja pasar SÍ/OK/NO al agente si
  no tiene un cierre propio pendiente; lee ese estado una sola vez y exige
  ganar la actualización condicional de la confirmación antes de ejecutar.
  El cierre consulta su `outboxId` exacto: ambos canales distinguen
  confirmado/pendiente/conflicto/fallido y un cierre nativo dice "en el portal".
  Evidencia y límites en `docs/portal-reliability-2026-09-12.md`.

- La conversación no tiene lock: dos mensajes simultáneos del mismo vendedor pueden
  pisarse el historial (gana el último). Aceptable para el volumen esperado.
- Solo mensajes de texto; audio/imagenes responden "solo texto por ahora".
- `zona` en oportunidades usa `create_labels_if_missing` — un typo del modelo podría
  crear una etiqueta nueva en el dropdown (el prompt le dice que solo la use si el
  vendedor la indica).
- Institución del contacto: sigue la limitación conocida de Monday (se liga a mano).
