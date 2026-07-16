# cmp-tallas — mapa de endpoints y flujos (introspección 2026-07-15)

Fuente: código en `~/Documents/dev/cmp-tallas/api/*.py` + blueprints reales de los
escenarios de Make (org CMP 6294235, team 1775188). Regla del portal: **disparar,
nunca reimplementar** (`worker/lib/automations.ts`).

Base URL: `https://cmp-tallas.vercel.app` (env `CMP_TALLAS_BASE`).
Contrato común: `POST {item_id, dry_run?}` → siempre HTTP 200 con
`{ok, skipped?, reason?, ...}`; 500 solo en fallas de infra. `dry_run: true`
valida y devuelve el payload sin escribir nada (disponible en validar_costeo,
generate_cotizacion, confirm_tallas, import_tallas, generate_oc).
**Sin auth de entrada hoy** — el portal ya manda `X-CMP-Secret`; el check del
lado cmp-tallas sigue pendiente (PR propuesto).

## Endpoints disparados por botones/eventos de Monday (flujo de venta)

| # Make | Trigger en Monday | Endpoint | Item esperado | Qué hace | Efectos en Monday |
|---|---|---|---|---|---|
| 100 | Item **creado** en Oportunidades (18395657596) | *(Drive nativo de Make)* + `POST /api/create_subfolders` `{parent_folder_id}` | — | Make crea carpeta Drive (nombre = oportunidad, padre `1UuhMjK1HrNaOyC_yhD9zB7FswisZpGff`, shared drive `0ALj_2-Dlrb72Uk9PVA`); el endpoint crea las 12 subcarpetas de licitación (01. BASES … 12. FACTURA), idempotente | Escribe URL de carpeta en `link_mm468m26` |
| 101 | Botón **"Solicitar costeo"** (`button_mkzmq31f`, Oportunidades) | `POST /api/validar_costeo` | Oportunidad | Valida subitems (cantidad>0, color ∈ colores stock, ficha existe, embellecimiento completo con auto-reparación), snapshotea lookups→columnas editables (subitems "No iniciado", TC 18 si USD, precio = costo·(1−desc)·(1+gastos)·TC·1.3), genera PDF de costeo (Eledo `69a23e1d…`) | OK: sube PDF a `file_mm10k65a`, `deal_stage`→"En costeo", mueve a grupo `group_mkzmdg9c`. Rechazo: `deal_stage`→"Nueva oportunidad" + update con los errores |
| 102 | Botón **"Generar Cotización"** (`button_mm0f4mhx`, Oportunidades) | `POST /api/generate_cotizacion` | Oportunidad | Folio en ledger Sheets (`1DtSipCW…`, tab historial), PDF con precio y sin precio (Eledo `69a0eb3d…`), imagen de producto vía Airtable, DocuSeal a firma del vendedor | Sube PDFs a `file_mm0fgrzq` (con precio) y `file_mm0z6rze` (sin precio), update de bitácora, `deal_stage`→"Cotización" (index 6), grupo `topics`. Skip si ningún producto tiene precio (notifica a Compras) |
| 200 | Item **creado** en Proyectos (18395657594), +60 s | `POST /api/generate_sheet` | Proyecto | Crea el Google Sheet de tallas (`tallas_{opp_item_id}`) en la carpeta Drive del proyecto (`link_mm462saa`), pestañas Desglose/Data con fórmulas y semáforo "TODO CUADRA" en `Desglose!D1`; en regeneración preserva cantidades previas | Escribe URL del sheet en `link_mm1amwz8` |
| 211 | Botón **"Regenerar Tallas"** (`button_mm46pc4a`, Proyectos) | `POST /api/generate_sheet` | Proyecto | Igual que 200 (mismo endpoint) | Igual que 200 |
| 201 | Botón **"VENDEDOR: validar tallas"** (`button_mm1a7qtd`, Proyectos) | `POST /api/confirm_tallas` | Proyecto | Gate: `Desglose!D1 == "TODO CUADRA"`; lee `Data!A2:Q1000`, genera PDF de relación de tallas (Eledo `69b3137e…`), DocuSeal a firma del vendedor | OK: sube PDF a `file_mm0hcrtz` + DocuSeal. No cuadra: update "no cuadra" + `project_status`→"Desglose de tallas" |
| 202 | Botón **"COMPRAS: validar tallas"** (hook "click validar tallas", Proyectos) | `POST /api/import_tallas` | Proyecto | Lee `Data!A2:Q1000` del sheet, **borra los subitems existentes** del Proyecto y crea uno por fila de talla (precio/moneda/descuento/unidad desde el board Productos, col I) + subitems de embellecimiento únicos por zona | Subitems del Proyecto reconstruidos |
| 203 | Botón **"Generar OC Proveedor"** (`button_mm0prtfk`, Proyectos) | `POST /api/generate_oc` (acepta `only_proveedor`) | Proyecto | Agrupa subitems por proveedor (`board_relation_mm1cfgv5`), folio OC-n en ledger Sheets (`1X9Uay20…`), un PDF por proveedor (Eledo `69b3b936…`), DocuSeal con 3 firmas secuenciales (Elaborado→Revisado=Pam→Autorizado=Elisa) | Sube PDFs a `file_mm0hj9pn`, update de bitácora por OC |

## Flujos de fondo (el portal NO los dispara; solo consume sus efectos vía mirror)

| # Make | Trigger | Endpoint / acción | Qué hace |
|---|---|---|---|
| 001 | Airtable watch (cada 8 h hábiles) | `POST /api/sync_producto` `{record_id\|record_ids}` | Upsert Airtable → board Productos (18395657591) |
| 701 | Airtable watch | `POST /api/generate_ficha` (campos del producto) | Genera Google Doc de ficha comercial, guarda doc_id en Airtable |
| 702 | Airtable watch | `POST /api/generate_licitacion` `{texto, nombre, ficha_licitacion_doc_id?}` | Genera doc de ficha de licitación |
| 801 | DocuSeal `submission.completed` | módulos Monday nativos | Baja el PDF firmado y lo sube a la columna de archivos correspondiente (cotización firmada → `file_mm0zjras` en Oportunidades; tallas/OC firmadas → columnas de Proyectos) |
| 210 | Cambio de columna de archivo en Monday | módulos Monday nativos | Mueve archivo a columna "oculta" |

`test_licitacion.py` es harness de pruebas, no forma parte del flujo.

## Mapa fase del portal → endpoint

Las 6 vistas de Ventas filtran Oportunidades por `deal_stage`
(`src/lib/dealStages.ts`). Los flujos de tallas/OC viven en el item **Proyecto**
ligado (Proyectos `board_relation_mm0hf0y3` → Oportunidad). **El Proyecto se crea
cuando la oportunidad se GANA** (confirmado por Efraín 2026-07-15) — fuera del
portal hoy; hasta entonces las secciones de tallas/OC muestran "aún no tiene
Proyecto". Al crearse, Make 200 genera solo el archivo de tallas (+60 s).

| Fase (sidebar) | deal_stage | Acción de usuario | Endpoint | Estado en portal |
|---|---|---|---|---|
| Oportunidades | 4 | (automático al crear) carpeta Drive + subcarpetas | create_subfolders vía Make 100 — se dispara solo con el webhook de Monday, incluso para items creados desde el portal/WhatsApp | Nada que llamar; falta mostrar link `link_mm468m26` |
| Oportunidades | 4 | "Mandar a costeo" | **validar_costeo** (el flujo real: snapshot + PDF + rechazo automático) | ⚠️ Hoy el portal solo valida localmente y cambia stage (`worker/lib/costeo.ts`) — NO genera el PDF de costeo ni snapshotea. Divergencia a resolver |
| Costeo | 15 | Compras captura costos; pasar a validación | (sin endpoint — cambio de stage manual) | Editable vía columnas; falta botón de avance si se quiere |
| Validación Costeo | 7 | "Generar Cotización" | generate_cotizacion | ✅ Ruta `POST /api/oportunidades/:id/cotizacion` + `automations.ts` ya existen; falta el botón en la UI del drawer |
| Documentación y Tallas | 9 | Crear/regenerar archivo de tallas | generate_sheet | ❌ Falta (ruta + botón, sobre el Proyecto ligado) |
| Documentación y Tallas | 9 | VENDEDOR: validar tallas | confirm_tallas | ❌ Falta |
| Documentación y Tallas | 9 | COMPRAS: importar tallas | import_tallas | ❌ Falta (destructivo: borra y recrea subitems del Proyecto) |
| Órdenes de Compra | 8 | Generar OC por proveedor | generate_oc | ❌ Falta |
| Logística | 1 | — | (sin endpoint; firmados llegan solos vía 801) | Solo lectura de archivos |
| Catálogo Productos | — | — | sync_producto / generate_ficha / generate_licitacion son pipeline Airtable, no acciones del portal | N/A |
