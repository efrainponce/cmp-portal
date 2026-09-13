# Plan — WhatsApp como asistente de cartera (vendedores y compras)

Status: **propuesta 2026-09-12, pendiente de aprobación de Efraín**. Nada de esto
está en código todavía.

## En una línea

No hace falta un MCP. La "fuente fresca que Haiku lee rápido" es una **vista de
cartera por persona** (`worker/lib/cartera.ts`), calculada en D1 a partir del
espejo + `activity_log` + `seguimientos`, y servida por tres puertas: una
herramienta del bot (`mi_cartera`), un **resumen matutino** por plantilla de Meta
(sin modelo de por medio) y la pantalla Inicio (que ya existe). El mismo cálculo
alimenta las tres; Haiku redacta y conversa, **nunca calcula**.

## Por qué no un MCP

- MCP es un protocolo para conectar un modelo con herramientas remotas. Aquí el
  modelo y los datos viven en el mismo Worker: `assistantTools.ts` YA es ese
  catálogo de herramientas, con gating por rol y por correo. Un servidor MCP
  aparte agregaría un salto de red, otra autenticación y otro hosting sin ganar
  ni un segundo de frescura (misma decisión que tomamos el 2026-07-15).
- Lo que sí falta, y un MCP no resuelve, son dos cosas:
  1. **Datos derivados**: días en etapa, días sin movimiento, último seguimiento,
     prioridad, "qué le falta para avanzar". Hoy el bot lee columnas crudas.
  2. **Iniciativa**: nadie le pregunta al bot a las 8 de la mañana. El resumen
     tiene que salir solo.
- **Frescura**: el espejo ya se refresca cada 15 min (delta sync) y con el latido
  de 30 s desde cualquier GET del portal. Para el resumen matutino, antes de
  armarlo se hace `refetchItems` (lote de 100 ids) de las oportunidades abiertas
  de esa persona, igual que `?fresh=1` del drawer: el mensaje de las 8:00 lleva
  datos de las 7:59. Para el bot, el webhook de WhatsApp es POST y hoy NO
  dispara el latido: hay que llamar `deltaSyncIfStale(env, 2 min)` al entrar un
  mensaje.

## Lo que ya existe y se reúsa

| Pieza | Dónde | Qué aporta |
|---|---|---|
| "Apagada" = ≥14 días sin cambio en Monday, más viejas primero | `worker/lib/home.ts` `vendedorPendientes` | El umbral y la lista ya están decididos (Efraín, 2026-08-10) |
| Seguimiento = Update REAL en Monday + fila `seguimientos` | `home.ts` `insertSeguimiento`, `nativeUpdates.postUpdate` | "Guardar el mensaje en Actualizaciones" es exactamente este camino |
| Costeo atorado = "En costeo" que no pasa `checkValidacion` | `home.ts` `comprasPendientes` | Resumen de compras |
| Cambios de etapa con fecha y actor | D1 `activity_log` (`deal_stage` en la whitelist) | "Lleva 2 días en costeo" con fecha real |
| Consultas del pipeline por rol | `assistantTools.ts` (`consultar_pipeline`, `listar_oportunidades`, `detalle_oportunidad`) | El bot ya contesta "¿qué tengo en costeo?" |
| Envío proactivo por template + bitácora | `worker/wa/send.ts` `sendTemplate`, `wa_mensaje` | Entregado / leído / fallido por mensaje |
| Gate horario dentro del cron de 15 min | `salud.ts` `revisarSaludSiToca` | No hay cupo para un cron más (5/5 de la cuenta) |
| Ganar / Perder / Archivar desde el drawer | `OpportunityDrawer.tsx` → PATCH `deal_stage` | Archivar = Cancelada, Perder = Perdida; `w: V` (vendedor sí escribe etapa) |
| Autor excluido de su propia notificación | `updateNotify.ts` `actorEmailsFor` | Un seguimiento por WA no le rebota a quien lo escribió |

## Números de arranque (D1 de producción, 2026-09-12)

| Dato | Valor |
|---|---|
| Vendedores activos con teléfono en `identity` | 3 de 14 |
| Compras con teléfono | 4 |
| Conversaciones de WhatsApp con el bot, histórico | 2 |
| Seguimientos capturados desde Inicio, histórico | 14 |
| Cambios de `deal_stage` en `activity_log` | 753, desde 2026-08-14 |

El riesgo es **adopción**, no tecnología. Sin teléfonos dados de alta no llega
nada, y sin que la persona conteste el resumen no hay bot (ventana de 24 h de
Meta). Por eso la Fase 0 no tiene código.

## Arquitectura

```
                     ┌──────────────────── D1 ────────────────────┐
  Monday ──sync───▶  │ items · activity_log · seguimientos · wa_* │
                     └──────────────────┬─────────────────────────┘
                                        ▼
                     worker/lib/cartera.ts — vistaCartera(viewer)
                     por oportunidad abierta: etapa, días en etapa, días sin
                     movimiento, último seguimiento, monto, fecha límite,
                     prioridad, siguiente paso, y UNA candidata a cerrar
          ┌─────────────────────────────┼──────────────────────────────┐
          ▼                             ▼                              ▼
  tool `mi_cartera`             resumen matutino                pantalla Inicio
  (Haiku, cuando preguntan)     cron */15 + gate 08:00 CDMX     (ya existe;
  "¿qué priorizo hoy?"          template de Meta, SIN modelo    misma lista)
                                        │
                                        ▼  la persona contesta ("1", "la 2 sigue viva, piden muestra")
                                bot con el resumen del día en contexto
                                 → registrar_seguimiento  (Update en Monday)
                                 → cerrar_oportunidad     (Perdida/Cancelada, con confirmación)
                                 → posponer 7 días
```

## 1. Vista de cartera (`worker/lib/cartera.ts`)

Función pura sobre filas ya filtradas por el DAL (scope `'own'` para vendedor;
compras/admin ven todo, mismo criterio que `home.ts`). Por oportunidad abierta:

| Campo | Fuente | Nota |
|---|---|---|
| folio, nombre, institución, etapa, monto, fecha límite | `items` (mismos ids que `assistantTools.ts` `OPP`/`SUB`) | monto = Σ precio × cantidad de las líneas, como hoy |
| `dias_en_etapa` | último evento `deal_stage` en `activity_log` | si no hay evento (etapa sin cambio desde antes del 2026-08-14) → desde `monday_updated_at`, marcado `aprox: true` |
| `dias_sin_movimiento` | `monday_updated_at` | el mismo que usa Inicio |
| `ultimo_seguimiento` | `seguimientos` (fecha + primeras 120 letras) | vacío = nunca se le ha dado seguimiento desde el portal |
| `siguiente_paso` | reglas por etapa | Nueva → "mandar a costeo"; En costeo → lo que diga `checkValidacion`; Validación → "falta Precio de Venta" o "lista para confirmar"; Esperando OC → "pedir la OC" |
| `prioridad` | score determinista | fecha límite a ≤7 días (+3), etapa avanzada (Esperando OC +3, Validación +2, Costeo +1), monto en el tercio alto de la cartera (+1), ≥14 días sin movimiento (+1) |
| `categoria` | derivada | `se_mueve` (siguiente paso listo), `atorada` (En costeo ≥ 2 días o Nueva ≥ 3 días sin mandar a costeo), `apagada` (≥14 sin movimiento) |
| `candidata_cierre` | 1 por persona | la más vieja con ≥45 días sin movimiento, saltando las pospuestas (`wa_snooze`) y las propuestas en los últimos 7 días |

Todo esto va con test (`cartera.test.ts`): fechas fijas, filas sintéticas, sin
Monday. Los umbrales (14, 45, 2, 3, 7) viven en una constante exportada, para
que cambiarlos sea una línea.

## 2. Resumen matutino (sin modelo)

- **Cuándo**: 08:00 CDMX, lunes a viernes. Gate `enviarResumenSiToca` dentro
  del cron `*/15` (`ALERT_CRON`, junto a `revisarSaludSiToca`). Idempotente por
  `(email, fecha)` en la tabla `wa_resumen`; el gate acepta cualquier corrida
  entre 08:00 y 10:00 (el cron se ha saltado invocaciones antes) y marca por
  fecha, no por minuto.
- **A quién**: `identity` con `phone` y `wa_resumen = 1` (columna nueva,
  default 0 → **opt-in**). Si la cartera está vacía no se manda nada.
- **Cómo**: template nuevo de Meta `resumen_cartera` (Utility, `es_MX`).
  Obligatorio: es un mensaje fuera de la ventana de 24 h. Meta no acepta saltos
  de línea dentro de un parámetro, así que cada renglón es un parámetro:

  ```
  Buenos días {{1}}. Tu cartera hoy: {{2}}.
  • {{3}}
  • {{4}}
  • {{5}}
  Para cerrar hoy: {{6}}
  [Ver detalle]  [Cerrar esa]  [Hoy no]
  ```

  `{{2}}` = "2 se mueven · 1 atorada · 5 apagadas"; `{{3}}`–`{{5}}` = las tres
  de mayor prioridad ("PRO-812 Hospital Ángeles · en costeo desde hace 2 días");
  `{{6}}` = la candidata ("PRO-640 IMSS Celaya · 45 días sin movimiento").
  Los tres botones son *quick reply*: al tocarlos Meta abre la ventana de 24 h y
  el bot sigue en texto libre. Si Meta rechaza 6 parámetros, plan B: template
  corto ("Tu cartera tiene {{2}}, toca Ver para el detalle") y el detalle sale
  como texto normal al tocar el botón.
- **Registro**: `wa_resumen(email, fecha, item_ids_json en orden, wamid)`. Sirve
  para que "la 2" se resuelva en el chat y para medir entregado/leído en
  `wa_mensaje`.
- **Costo**: cero tokens (el texto lo arma el código). Meta cobra la
  conversación utility iniciada por el negocio, centavos de dólar; con 10
  personas × 22 días hábiles son ~220 mensajes al mes.
- **"Sin ser muy intenso"**: un solo mensaje al día, una sola candidata a
  cerrar, y "Hoy no" la pospone 7 días. Meta lo refuerza: fuera de la ventana no
  se puede insistir con texto libre.

## 3. Guardar en Actualizaciones (`registrar_seguimiento`)

- Herramienta nueva del bot (vendedor / compras / admin). Llama
  `postUpdate(itemId, texto)` y `insertSeguimiento`: el mismo camino que el
  composer de Inicio, así que aparece en Monday, en el drawer y en Inicio.
- El texto lleva firma "— {nombre}, vía WhatsApp" (el token de servicio es el
  autor en Monday; sin firma no se sabe quién fue). `actorEmail` = quien escribe,
  para que no se auto-notifique.
- Scope: el vendedor solo sobre lo suyo (`getItem(..., 'own')`); compras sobre
  cualquiera (compras hace todo lo de ventas desde 2026-08-28).
- Propuesta: **sin pedir confirmación** (un comentario es de bajo riesgo y se
  borra en Monday). Sí confirma después: "Guardado en Actualizaciones de
  PRO-812". Decisión de Efraín (abajo).

## 4. Cerrar una al día (`cerrar_oportunidad`)

- "Archivar" = mover `deal_stage`, **nunca** `archive_item` de Monday: es una
  mutación destructiva (tumbaría `monday.destructivo.test.ts`) y el item
  desaparecería del espejo y de la analítica. Mismo significado que el drawer:
  Archivar → Cancelada (5), Perder → Perdida (2). Va por el outbox, como
  cualquier PATCH.
- Con **confirmación explícita** (regla que ya tienen `crear_oportunidad` y
  `crear_movimiento`), scope `'own'`, y deja un Update "Cerrada desde WhatsApp:
  {motivo}" para que quede el porqué.
- "Hoy no" / "recuérdamela después" → `wa_snooze(email, item_id, hasta)`; la
  candidata rota y no se repite dentro de 7 días.

## 5. Consultas nuevas del bot (cuando preguntan)

- `mi_cartera` (vendedor / compras / admin): la vista completa o filtrada
  (`solo: se_mueve | atorada | apagada`), ordenada por prioridad. Contesta "¿qué
  priorizo hoy?", "¿cuáles llevan más de un mes paradas?", "¿qué me falta para
  avanzar la de Hospital X?".
- `historial_oportunidad(item)`: cambios de etapa con fecha y actor
  (`activity_log`) + seguimientos. Contesta "¿cómo va la de Celaya?" con fechas
  reales, no con "está en costeo".
- Compras: `mi_cartera` devuelve los costeos pendientes con días en costeo
  (`comprasPendientes` + `activity_log`).
- **Contexto del resumen en el chat**: si hay `wa_resumen` de hoy para esa
  persona, se inyecta la lista numerada como segundo bloque de `system`. Cambia
  una vez al día, igual que la fecha del prompt, así que el prompt caching no se
  invalida más de lo que ya se invalida. Con eso "la 2 sigue viva, piden
  muestra" → `registrar_seguimiento(item de la posición 2, …)`.
- Webhook: hoy solo procesa `type === 'text'`; hay que aceptar `button`
  (quick reply de template) e `interactive` (botones de respuesta) y convertirlos
  en texto ("Ver detalle") antes del loop.

## 6. Barato para Haiku: qué sale sin modelo (Efraín, 2026-09-12)

Regla: **el código contesta todo lo que tenga forma fija; Haiku solo entra con
texto libre, y entonces con UNA llamada.** Un router de comandos
(`worker/wa/comandos.ts`) corre ANTES del loop del agente; solo lo que no
reconoce pasa a `runAgentLoop`.

| Interacción | Quién contesta | Costo Haiku |
|---|---|---|
| Resumen matutino | código (template) | $0 |
| Botón "Ver detalle" | código: renderiza la cartera completa numerada (`renderCartera`, el MISMO texto que ve la tool) | $0 |
| Botón "Hoy no" | código: `wa_snooze` 7 días + texto fijo | $0 |
| Botón "Cerrar esa" → "¿Muevo PRO-640 a Cancelada? Responde SÍ o NO" → SÍ | código: PATCH `deal_stage` por outbox + Update fijo | $0 |
| "cartera", "hoy", "pendientes", "atoradas", "apagadas" | código: `renderCartera` filtrada | $0 |
| "3" (un número del resumen) | código: detalle fijo de esa oportunidad (`renderDetalle`) | $0 |
| "2: llamé, piden muestra" (número + dos puntos + texto) | código: `registrar_seguimiento` en la #2, sin modelo | $0 |
| "sí / no / ok / cancelar" con una confirmación pendiente (`wa_pendiente`) | código | $0 |
| "la de Celaya sigue viva, piden muestra" (texto libre) | Haiku, 1 llamada: elige `registrar_seguimiento`, la tool contesta directo | ~$0.002 |
| "¿qué me falta para avanzar la de Hospital X?" | Haiku, 1 llamada + tool de respuesta directa | ~$0.002 |
| Crear oportunidad / contacto (ya existe) | Haiku, varias vueltas, como hoy | ~$0.01–0.03 |

Cómo se logra la "una llamada":

- **Tools de respuesta directa** (`DIRECT_REPLY_TOOLS` en `agentLoop.ts`):
  `mi_cartera`, `historial_oportunidad`, `registrar_seguimiento` y
  `detalle_*` devuelven texto YA formateado para WhatsApp (lo arma el código con
  el mismo `render*` del router). Si el modelo llamó solo una de estas, el loop
  **manda ese texto tal cual y no vuelve a llamar al modelo**. Se ahorra la
  segunda llamada, que es la cara (es la que genera texto). Hoy el loop siempre
  da la vuelta extra para "redactar" lo que la tool ya dijo.
- **Tool results compactos**: texto plano, no JSON. Menos tokens de entrada y el
  modelo no tiene que "traducir".
- **Prompt caching** ya está (system + tools cacheados). El resumen del día
  entra como bloque de system que cambia una vez al día, igual que la fecha.
- **Confirmaciones en código**: la confirmación pendiente vive en
  `wa_pendiente(phone, accion, item_id, expira)`, no en el historial del modelo.
  "SÍ" lo resuelve el router. El modelo solo llega a `cerrar_oportunidad` si la
  persona lo pide en texto libre, y aun así la tool deja la confirmación en
  `wa_pendiente` y contesta directo: el SÍ ya no pasa por Haiku.
- **Textos fijos con variaciones** (`worker/wa/textos.ts`): 3–4 formas de cada
  mensaje fijo elegidas por día, para que el resumen y las confirmaciones no se
  sientan de máquina sin gastar un token.

Con esto, en un día normal de un vendedor (resumen, un botón, un seguimiento
numerado) el gasto de modelo es **cero**; Haiku solo cobra cuando escriben
libre. Precio de referencia Haiku 4.5: $1 entrada / $5 salida por millón de
tokens; una llamada con prefijo cacheado y una tool sale en ~2 milésimas de
dólar.

## Fases (cada una sale sola, detrás de `WA_CARTERA=1`, apagada por default)

| Fase | Qué | Esfuerzo | Se ve así |
|---|---|---|---|
| 0 | Dar de alta teléfonos y `wa_resumen=1` a quien va a probar (Efraín / PAM, comando de `whatsapp-bot.md`). Pedir a Meta la aprobación del template (tarda 1-2 días; se pide desde el día 1). | sin código, hoy | — |
| 1 | `cartera.ts` + `render*` + tests, router de comandos (`comandos.ts`), tools de respuesta directa (`DIRECT_REPLY_TOOLS`), `deltaSyncIfStale` al entrar un mensaje | ~1½ días | Preguntar "¿qué priorizo hoy?" por WhatsApp o en la burbuja |
| 2 | `registrar_seguimiento` (por router "2: texto" y por tool) + `wa_pendiente` + resumen del día en el contexto del chat | ~½ día | "La de Celaya: llamé, piden muestra" queda en Actualizaciones de Monday |
| 3 | Tabla `wa_resumen`, `enviarResumenSiToca` en el cron, `sendTemplate` con quick replies, webhook acepta `button`/`interactive` | ~1 día + espera de Meta | El mensaje de las 8:00 |
| 4 | Botones "Cerrar esa" / "Hoy no" en código, `cerrar_oportunidad` como tool, `wa_snooze` + rotación de la candidata | ~½ día | "Cerrar esa" → confirma → Cancelada en Monday |
| 5 | Resumen de equipo para dirección (Elisa / CEO / Efraín, whitelist `puedeConsultarDireccion`): conteos por vendedor y las 3 más viejas de cada uno. Medir 2 semanas con `wa_mensaje` (entregado/leído), seguimientos por WA vs portal, cierres. | ~½ día | — |

Cada fase entra en `log.md` y en `docs/whatsapp-bot.md` como las anteriores.

## Decisiones de Efraín (bloquean fases)

1. **Quién y a qué hora**: opt-in por persona (propuesto) o todos los que tengan
   teléfono. Hora fija 08:00 o por persona.
2. **Cerrar desde el bot**: ¿el vendedor puede mover a Cancelada/Perdida desde
   WhatsApp, o el bot solo propone y el cierre se hace en el portal? Hoy el
   drawer sí se lo permite (`deal_stage` `w: V`).
3. **Comentario sin confirmación** (propuesto) o con resumen + "sí" como las
   creaciones.
4. **Umbrales**: 14 días apagada (ya vigente), 45 días candidata a cierre, 2
   días en costeo para compras, 3 días en Nueva sin mandar a costeo.
5. **Compras**: ¿recibe resumen matutino desde la Fase 3 o después de ver cómo
   funciona con ventas?
6. **Texto literal del template**: Meta lo aprueba tal cual; cada cambio es una
   nueva aprobación. Va en el PR de la Fase 3 para que lo revise antes.

## Riesgos y límites

- **Ventana de 24 h**: el resumen es template; todo lo demás depende de que la
  persona conteste. Si no contesta, no hay conversación ese día. Es también la
  razón por la que no se puede "insistir".
- **Template rechazado**: Meta rechaza variables al inicio/fin y saltos de línea
  en parámetros (ya nos pasó con `portal_notificacion`). Plan B descrito arriba.
- **Cron saltado**: el gate acepta 08:00–10:00 y se marca por fecha.
- **Historial parcial**: `dias_en_etapa` solo es exacto para etapas cambiadas
  desde 2026-08-14; antes de eso sale de `monday_updated_at` y se dice "aprox".
- **Conversación sin lock** (límite conocido del bot): un resumen y una
  respuesta simultánea pueden pisarse el historial.
- **Ids prestados**: la atribución del seguimiento va por correo del `identity`
  del teléfono, no por `monday_user_id` (se presta con "Actuar en Monday como").
