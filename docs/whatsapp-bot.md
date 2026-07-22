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

- La conversación no tiene lock: dos mensajes simultáneos del mismo vendedor pueden
  pisarse el historial (gana el último). Aceptable para el volumen esperado.
- Solo mensajes de texto; audio/imagenes responden "solo texto por ahora".
- `zona` en oportunidades usa `create_labels_if_missing` — un typo del modelo podría
  crear una etiqueta nueva en el dropdown (el prompt le dice que solo la use si el
  vendedor la indica).
- Institución del contacto: sigue la limitación conocida de Monday (se liga a mano).
