# Índice de código — cmp-portal

Mapa curado de archivos fuente (`.ts`, `.tsx`) para orientarse rápido sin explorar el repo entero. Grep aquí antes de explorar. Este índice puede quedar desactualizado; verifica contra el código si algo no cuadra. Generado: 2026-07-21, refrescado: 2026-08-13.

Formato: `- [ruta](ruta) — Propósito (1 frase). Exports: Export1, Export2, Export3.`

Los `*.test.ts` (vitest, `npm test`) no se listan aquí: viven junto al archivo que
prueban. Hoy cubren `worker/lib/canon.ts`, `worker/lib/columnEncode.ts`,
`shared/visibility.ts`, `catalogIndex` de `gridMeta.tsx`, el escritor de PDF
(`worker/lib/pdf/writer.ts` + layout/plantillas), `worker/lib/portalFiles.ts`,
`worker/lib/dal.ts` (scoping de renglones), `worker/lib/costeo.ts`,
`worker/lib/cotizacion.ts`, `worker/lib/oc.ts`, `worker/lib/proyectoTallas.ts`,
`worker/lib/proyectoCotizacionVirtual.ts`, `worker/lib/costoDivergencia.ts`,
`worker/lib/importeEnLetras.ts`, `worker/lib/drive.ts`, `src/lib/productSearch.ts`
y `src/lib/estadoProductoBuckets.ts`.

## shared/

- [shared/analytics.ts](shared/analytics.ts) — Contrato Y cálculo del tablero de Análisis (embudo, tiempo de costeo, conversión, montos, huecos de datos). Puro y testeado: el worker solo le pasa las filas de D1. Exports: ANALYTICS_OPP_COLS, ANALYTICS_LINE_COLS, OppRow, GroupBy, FUNNEL_STEPS, FunnelBucket, TiempoCosteo, Conversion, GrupoMetrics, Hueco, AnalyticsResponse, alcanzo, horasEntre, calcTiempoCosteo, calcEmbudo, calcConversion, agrupar, calcHuecos, buildAnalytics, etapaLabel, SIN_DATO.
- [shared/boardAccess.ts](shared/boardAccess.ts) — Per-equipo (Role) whitelist de boards del sidebar. Exports: BOARD_KEYS, ConfigurableBoardKey, isConfigurableBoardKey, TEAM_ROLES, DEFAULT_BOARD_ACCESS.
- [shared/boards.ts](shared/boards.ts) — Registro de boards con IDs introspectionados (API 2024-10). Never fabricate. Exports: BoardSlug, BoardDef, BOARDS, boardById.
- [shared/column-meta.gen.ts](shared/column-meta.gen.ts) — GENERADO por scripts/introspect-boards.mjs; no leer completo, grepear el id. Exports: COLUMN_META.
- [shared/createFields.ts](shared/createFields.ts) — Whitelist para CREACIÓN de items (por board, campos obligatorios). Exports: CreateField, CREATE_FIELDS, CREATE_DEFAULTS, isCreatable.
- [shared/dealStages.ts](shared/dealStages.ts) — Etapas canon (labels/order) compartidas por frontend y worker (herramientas agente). Exports: DEAL_STAGE_LABELS, DEAL_STAGE_ORDER, CLOSED_STAGES, stageAtOrAfter, stageKeyForLabel.
- [shared/dto.ts](shared/dto.ts) — DTOs genéricos scoped por rol (único productor: serialize.ts). Exports: ColVal, ItemDTO, ItemDetailDTO, ListResponse, MeDTO.
- [shared/embellecimiento.ts](shared/embellecimiento.ts) — Compartido con worker: parse/serialize embellecimiento por zona. Exports: EMBELL_TEMPLATE_KEYS, EmbellZoneKey, EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN.
- [shared/inventory.ts](shared/inventory.ts) — DTOs Inventario + reglas negocio (feature D1 nativa). Exports: MovementType, WarehouseType, MOVEMENT_TYPES, WarehouseDTO, MovementDTO.
- [shared/documents.ts](shared/documents.ts) — Contrato de documentos del portal + firma electrónica: registro de plantillas, roles que generan/firman, consentimiento (ver docs/documentos-firma.md). Exports: DOC_TEMPLATES, SIGN_INTENT, DocumentDTO, SignatureDTO, documentFilename.
- [shared/telemetry.ts](shared/telemetry.ts) — Contrato de la capa de interacción (`ux_event`): vocabulario de eventos, regex de `target` y saneador de `meta` que el worker usa para VALIDAR y el front para generar. Es la contención ejecutable del guardarraíl "nunca texto capturado por el usuario". Exports: UxKind, UX_KINDS, UX_MAX_BATCH, UX_MAX_DT_MS, UX_RETENTION_DAYS, UX_EDIT_RETENTION_DAYS, UX_TARGET_RE, UxEventInput, UxBatch, isValidTarget, isValidUxId, isUxKind, sanitizeMeta, routeSlug.
- [shared/notifications.ts](shared/notifications.ts) — Ruteo del centro de notificaciones (decisión de whitelist de Efraín). Cada etapa puede marcar `severity: 'importante'` para además disparar WhatsApp. Exports: RecipientSelector, StageNotifyEntry, STAGE_NOTIFY, PROJECT_STATUS_NOTIFY, PRODUCT_STATUS_LABELS, PRODUCT_STATUS_NOTIFY.
- [shared/productosPropuestos.ts](shared/productosPropuestos.ts) — Contrato DTO del tab "Nuevos productos" (nativo en D1, sin board de Monday detrás). Exports: ProposedProductDTO, ProposedProductsResponse, AddProposedProductResponse.
- [shared/quoteTerms.ts](shared/quoteTerms.ts) — Campos de condiciones comerciales/tiempo de entrega/vigencia a nivel cotización, con sus textos por defecto centralizados. Exports: QuoteTermField, QUOTE_TERMS_BOARD, QUOTE_TERMS.
- [shared/types.ts](shared/types.ts) — Tipos base compartidos: Role, Identity, MirrorItem. Exports: Role, Identity, MirrorItem.
- [shared/visibility.ts](shared/visibility.ts) — La whitelist como data: reglas de lectura/escritura por columna y rol (fail-closed). Exports: ColRule, VISIBILITY, canRead, canWrite, readableCols.

## worker/

### worker/ (root)

- [worker/env.ts](worker/env.ts) — Interface Env con los bindings del Worker: DB, FILES, R2, claves, y token de webhook. Exports: Env.
- [worker/index.ts](worker/index.ts) — Hono wiring; webhook routes bypass access/identity, el resto va tras middleware. Exports: default.

### worker/lib/

- [worker/lib/agentLoop.ts](worker/lib/agentLoop.ts) — Loop del agente Claude compartido por WhatsApp y portal. Exports: RESET_WORDS, RESET_REPLY, finalText, runAgentLoop.
- [worker/lib/airtable.ts](worker/lib/airtable.ts) — Cliente delgado de Airtable (Fase 0) que resuelve la imagen de producto para la cotización, con degradación silenciosa si falla. Exports: fetchAirtableImageUrl.
- [worker/lib/analytics.ts](worker/lib/analytics.ts) — I/O del tablero de Análisis: una consulta a D1 (hitos con fecha de la Oportunidad + montos sumados de las líneas) scopeada por viewer; los números los saca shared/analytics.ts. Cero llamadas a Monday. Exports: AnalyticsQuery, buildAnalyticsResponse.
- [worker/lib/activityLog.ts](worker/lib/activityLog.ts) — Log de actividad por item (Oportunidades+líneas, Productos, líneas del Proyecto): whitelist propia de columnas (ruido, no permisos) sobre los activity_logs de Monday que ya jala el delta sync, persistidos en D1. El costeo de la OC (PORTAL_WRITE_COLUMNS) se asienta desde el portal con el actor REAL y su eco de Monday se descarta. El actor se guarda con correo (`actor_email`), no solo con monday_user_id — ese id se puede prestar entre personas. Exports: ticksToIso, parseEntry, isPortalWriteColumn, actorNameResolver, persistActivityEntries, listActivity, recordDirectChanges, DirectChange.
- [worker/lib/telemetry.ts](worker/lib/telemetry.ts) — Ingesta y poda de `ux_event` (capa de interacción, medición de fricción). `user_id` SIEMPRE del identity del servidor; INSERT troceado a 7 filas (84 binds) en un solo batch; retención 90 días, salvo los `edit` (400 días: son el rastro de atribución y activity_log no se poda). Exports: toRow, ingestUxEvents, purgeUxEvents.
- [worker/lib/uxMetrics.ts](worker/lib/uxMetrics.ts) — Las 5 métricas de fricción comparables contra la línea base de Monday, con el corte PORTAL-vs-MONDAY: `activity_log` no distingue quién originó una edición (el portal escribe a Monday), así que se atribuye cruzando contra `outbox`. La atribución usa CUATRO rastros (dedupe_key 'native:', item nativo, `ux_event` edit, `outbox`) y EXCLUYE los user_id negativos, que son automatizaciones de Monday, no personas. Exports: ReEdicionStats, UxReport, Q_ATRIBUCION, Q_ATRIBUCION_DETALLE, Q_AUTOMATIZACIONES, Q_AMBIGUOS, Q_CLIC_SIN_ACUSE, Q_REEDICION, Q_TIEMPO_TAREA, Q_ADOPCION, Q_LATENCIA, buildUxReport.
- [worker/lib/assistantPersonas.ts](worker/lib/assistantPersonas.ts) — Una persona de agente por rol (vendedor/compras/admin/almacen), compartida por ambos canales. Exports: Channel, systemPromptFor.
- [worker/lib/assistantTools.ts](worker/lib/assistantTools.ts) — Superficie de herramientas del agente Claude compartida por todos los canales. Exports: TOOL_ROLES, TOOLS, toolsFor, runTool.
- [worker/lib/automations.ts](worker/lib/automations.ts) — Cliente de automaciones cmp-tallas Vercel (trigger, no reimplementar). Exports: AutomationError, AutomationResult, CotizacionResult, validarCosteo.
- [worker/lib/backup.ts](worker/lib/backup.ts) — Export semanal (cron) del mirror D1 completo a R2 para retención más allá de los 30 días de D1 Time Travel. Exports: backupD1ToR2.
- [worker/lib/boardAccess.ts](worker/lib/boardAccess.ts) — DAL para role_board_access (tabla D1) — lectura/escritura de accesos por rol. Exports: getBoardAccess, listAllBoardAccess, BoardAccessError, setBoardAccess.
- [worker/lib/canon.ts](worker/lib/canon.ts) — Canonicalización + hashing de valores de columnas Monday. Exports: md5, ReadColVal, canonValue, ColRawValue.
- [worker/lib/columnEncode.ts](worker/lib/columnEncode.ts) — Encoda valor de formulario a forma JSON de Monday create_item. Exports: encodeColumnValue.
- [worker/lib/conversationHistory.ts](worker/lib/conversationHistory.ts) — Trim/TTL/compact rules compartidas por todo agente (ambos canales). Exports: HISTORY_TTL_MS, trimHistory.
- [worker/lib/costeo.ts](worker/lib/costeo.ts) — "Mandar a costeo" — validación y envío de costeos a cmp-tallas. Exports: CosteoError, validateLinea, EnviarCosteoResult, checkCosteo.
- [worker/lib/costoDivergencia.ts](worker/lib/costoDivergencia.ts) — Compara el Costo Distribuidor del catálogo entre SKU anterior/nuevo al ajustar una línea y avisa a Compras si diverge más del 10%, sin bloquear. Exports: computeDivergencia, checkCostoDivergente.
- [worker/lib/cotizacion.ts](worker/lib/cotizacion.ts) — "Generar Cotización" nativo (Fase 2): arma líneas del mirror, genera PDFs vía Eledo, sube a Monday/Drive y pide firma DocuSeal. Exports: CotizacionError, ProductLine, buildProductLines, computeTotals, buildEledoFile, GenerarCotizacionResult, generarCotizacionNative.
- [worker/lib/cotizacionPdfs.ts](worker/lib/cotizacionPdfs.ts) — Resuelve PDFs de cotización (solicitud, sin firmar, firmada) de columnas Oportunidades. Exports: CotizacionPdfError, PdfKind, resolveCotizacionPdfUrl.
- [worker/lib/cotizacionPreviewPdf.ts](worker/lib/cotizacionPreviewPdf.ts) — Arma los datos de la Cotización vista previa (portal) desde las líneas vigentes de la Oportunidad; solo lectura, no reemplaza la cotización oficial de Eledo. Exports: CotizacionPreviewPdfError, generarCotizacionPreviewPdf.
- [worker/lib/createOportunidad.ts](worker/lib/createOportunidad.ts) — Crear Oportunidad + subitems de línea de producto. Exports: OportunidadError, LineaInput, OportunidadInput, OportunidadResult.
- [worker/lib/createRecord.ts](worker/lib/createRecord.ts) — Creación síncrona de item genérico (no outbox, sin echo necesario). Exports: CreateError, submitCreate.
- [worker/lib/dal.ts](worker/lib/dal.ts) — All reads scoped by viewer; handlers no pueden bypassear estos predicados. El scope de LECTURA incluye la zona que el viewer lidera; el de escritura ('own') nunca. Exports: ScopeMode, ownerIdsFor, leadsOthers, scopeFor, childSlugOf, listItems, getItem, ownsItem, childrenOf.
- [worker/lib/docuseal.ts](worker/lib/docuseal.ts) — Cliente delgado de DocuSeal para pedir firma electrónica (1 o varias, en orden) sobre un PDF ya subido a Monday. Exports: DocuSealError, DocuSealSigner, CreateSubmissionInput, createDocuSealSubmission.
- [worker/lib/drive.ts](worker/lib/drive.ts) — Cliente REST delgado de Google Drive (Fase 5): crea/cachea la carpeta raíz + 12 subcarpetas de licitación de una Oportunidad y sube los PDFs generados ahí. Exports: DriveError, OPORTUNIDADES_PARENT_FOLDER_ID, SUBFOLDERS, OportunidadFolder, ensureOportunidadFolder, uploadPdfToDrive, getOrCreateDriveFolder, oportunidadRootFolderName, getOrCreateDriveFolderForOportunidad, createOportunidadFolderOnCreate.
- [worker/lib/duplicateOportunidad.ts](worker/lib/duplicateOportunidad.ts) — "Duplicar" en drawer: clona Oportunidad + líneas en nueva vigente sin costearse. Exports: DuplicateOportunidadError, duplicateOportunidad.
- [worker/lib/eledo.ts](worker/lib/eledo.ts) — Cliente delgado de Eledo (eledo.online) para renderizar PDFs a partir de una plantilla ya diseñada ahí. Exports: EledoError, ELEDO_TEMPLATE_COTIZACION, ELEDO_TEMPLATE_OC, renderEledoPdf.
- [worker/lib/embellecimientoImagenes.ts](worker/lib/embellecimientoImagenes.ts) — Imágenes de referencia per-zona (upload validation, almacenamiento en R2). Exports: EmbellImageError, embellImageKey, parseFiles, splitZone.
- [worker/lib/errorAlerts.ts](worker/lib/errorAlerts.ts) — Cron cada 15 min que revisa `sync_log` por errores recientes y avisa por WhatsApp. Exports: checkErrorsAndAlert.
- [worker/lib/ganarOportunidad.ts](worker/lib/ganarOportunidad.ts) — "Ganar" desde el portal: replica la automatización nativa de Monday que crea el Proyecto ligado al ganar una Oportunidad. Exports: GanarOportunidadError, ganarOportunidad.
- [worker/lib/googleAuth.ts](worker/lib/googleAuth.ts) — OAuth2 de cuenta de servicio de Google: firma un JWT RS256 con Web Crypto y lo cambia por un access token (usado por drive.ts). Exports: GoogleAuthError, getGoogleAccessToken.
- [worker/lib/anuncios.ts](worker/lib/anuncios.ts) — Anuncios del portal: comunicados que publica el admin, nativos en D1 (sin board de Monday). Audiencia = roles Y zonas, lista vacía = todos. Exports: AnuncioError, AnuncioInput, ensureAnuncioTables, anuncioAlcanzaA, listAnuncios, createAnuncio, updateAnuncio, setArchivado, deleteAnuncio, marcarVisto, registrarWaEnviados, destinatariosWa.
- [worker/lib/home.ts](worker/lib/home.ts) — Pantalla "Inicio": arma pendientes accionables por rol (compras/vendedor) reutilizando los mismos checks que bloquean botones del flujo. Exports: comprasPendientes, vendedorPendientes, buildHomeResponse, insertSeguimiento.
- [worker/lib/http.ts](worker/lib/http.ts) — Helper mínimo compartido por rutas (statusCode responses). Exports: jsonStatus.
- [worker/lib/importeEnLetras.ts](worker/lib/importeEnLetras.ts) — Convierte un monto a su representación en letras para el PDF de cotización/OC, puerto exacto de la función equivalente de cmp-tallas. Exports: importeEnLetras.
- [worker/lib/inventory.ts](worker/lib/inventory.ts) — Inventario DAL + validación (feature D1 nativa, no espejado de Monday). Exports: InventoryError, listWarehouses, listMovements, listStock.
- [worker/lib/lineaAjustes.ts](worker/lib/lineaAjustes.ts) — "Ajustar línea" en Oportunidades: cambia producto/color/embellecimiento/cantidad de una línea sin crear versión ni pasar por costeo, incluso Ganada. Exports: AjusteLineaError, copyRemainingCols, ensureAjustesTable, AjustarLineaResult, ajustarLinea, listAjustes.
- [worker/lib/mime.ts](worker/lib/mime.ts) — Content-Type por extensión para los archivos que sirve el worker (Monday manda todo como octet-stream). Exports: contentTypeFor, isGenericType.
- [worker/lib/monday.ts](worker/lib/monday.ts) — Cliente GraphQL thin de Monday.com (API 2024-10). Exports: MondayCol, MondayItem, gql, ItemsPage.
- [worker/lib/nativeItems.ts](worker/lib/nativeItems.ts) — Piezas comunes de un item NATIVO (Zona Efrain): columnas en shape de mirror, subitem propio y marcador de archivo en R2. Exports: toNativeColumns, insertNativeSubitem, stampNativeFileMarker.
- [worker/lib/nativeUpdates.ts](worker/lib/nativeUpdates.ts) — Feed de Actualizaciones en D1 para items nativos (no existen en Monday); postUpdate/listUpdates eligen el lado por el id. Exports: listUpdates, postUpdate, attachToNativeUpdate, nativeUpdateAsset.
- [worker/lib/notify.ts](worker/lib/notify.ts) — Emisor best-effort del centro de notificaciones (idempotente por dedupe_key). Exports: emitNotification, resolveRecipients, maybeEmitStageChange, statusIndex.
- [worker/lib/updateNotify.ts](worker/lib/updateNotify.ts) — Notificaciones de COMENTARIOS (updates): emisor compartido por el POST del portal y el webhook `create_update` de Monday; filtra updates de máquina y lee menciones nativas. Exports: PORTAL_SIGNATURE, isAutomationUpdate, mentionIdsFromBody, notifyBoardKey, notifyItemComment, notifyUpdateFromWebhook.
- [worker/lib/oc.ts](worker/lib/oc.ts) — "Generar OC" nativo (Fase 4): agrupa líneas del Proyecto por proveedor, genera un PDF por proveedor vía Eledo y pide firma DocuSeal de 3 firmantes en orden. Exports: ProveedorLine, ProveedorGroup, groupSubitemsByProveedor, groupTotals, Signer, Signers, buildEledoOcFile, OrdenResult, GenerarOcResult, generarOcNative.
- [worker/lib/ocProveedorPdf.ts](worker/lib/ocProveedorPdf.ts) — Arma los datos de la Orden de Compra a Proveedor (folio + líneas agrupadas) y delega el dibujo al escritor de PDF nativo; solo lectura, en paralelo al flujo oficial de automations.ts. Exports: OcProveedorPdfError, generarOcProveedorPdf.
- [worker/lib/estadoProducto.ts](worker/lib/estadoProducto.ts) — Historial de "Estado del producto" (proyectos_sub, tab Ejecución) en D1 en vez de una columna de fecha por estado; notifica Incidencia/Retraso. Exports: maybeLogProductoStatus, logProductoStatusFromPortalWrite, listEstadoHistorial.
- [worker/lib/outbox.ts](worker/lib/outbox.ts) — Write path optimista: D1 mirror primero, Monday async vía waitUntil + echo. Exports: OutboxError, submitWrite, flushOutbox.
- [worker/lib/productoResumen.ts](worker/lib/productoResumen.ts) — Resumen libre por producto+color del tab Ejecución del Proyecto, nativo en D1 (sin columna de Monday equivalente). Exports: ProductoResumenRow, listProductoResumen, upsertProductoResumen.
- [worker/lib/productosPropuestos.ts](worker/lib/productosPropuestos.ts) — "Proponer nuevo producto" del tab Nuevos productos, nativo en D1 sin board de Monday detrás. Exports: ProposedProductError, ensureProposedProductsTable, listProposedProducts, addProposedProduct.
- [worker/lib/proyectoCotizacionVirtual.ts](worker/lib/proyectoCotizacionVirtual.ts) — Cotización del Proyecto 100% D1: toma las líneas vigentes de la Oportunidad ligada y aplica encima un log de ajustes propio sin tocar Monday. Exports: ProyectoCotizacionError, ensureProyectoCotizacionTable, applyAjustesVirtuales, getVirtualLines, listCotizacionVirtual, ajustarLineaVirtual.
- [worker/lib/proyectoTallas.ts](worker/lib/proyectoTallas.ts) — Captura de tallas por boxes del Proyecto (alta rápida de subitems, alterna al flujo de Sheet/automations) y validaciones asociadas (todo cuadra, confirmar, reportar incorrectas). Exports: TallaBoxInput, checkOcCliente, resolveOportunidadId, CosteoEnrichment, pctTextToFraction, identityKey, filterWanted, buildTallaColumns, needsUpdate, capturarTallas, ReportarTallasResult, reportarTallasIncorrectas, TodoCuadraMismatch, TodoCuadraResult, checkTodoCuadra, ConfirmTallasResult, confirmTallasNative.
- [worker/lib/quoteVersions.ts](worker/lib/quoteVersions.ts) — Versiones de cotización: vigente siempre es primera subitem, borradores/snapshots para histórico. Exports: QuoteVersionError, listVersions, recordFirstVersion, esDraftVigente.
- [worker/lib/documents.ts](worker/lib/documents.ts) — Documentos del portal: crea/lista/firma sobre D1+R2, snapshot de datos y portón de integridad SHA-256. Exports: createDocument, listDocuments, documentPdf, signDocument, DocumentError.
- [worker/lib/pdf/writer.ts](worker/lib/pdf/writer.ts) — Escritor de PDF sin dependencias (Helvetica, líneas, rects, JPEG; texto en WinAnsi octal). Exports: PdfWriter, widthOf, pdfString, jpegInfo, LETTER.
- [worker/lib/pdf/layout.ts](worker/lib/pdf/layout.ts) — Bloques → páginas: encabezado/pie, tablas paginadas, cajas de firma. Exports: renderDocument, wrapText, Block, DocumentMeta.
- [worker/lib/pdf/logo.ts](worker/lib/pdf/logo.ts) — Logo de CMP embebido en base64 (JPEG) para no depender de un fetch a assets al generar PDFs; también expone CMP_ORANGE (naranja de marca, header de tabla). Exports: LOGO_JPG_BASE64, CMP_ORANGE.
- [worker/lib/pdf/ordenCompraProveedor.ts](worker/lib/pdf/ordenCompraProveedor.ts) — Plantilla nativa de la Orden de Compra a Proveedor que reemplaza el PDF de Eledo (perdía columnas con descripciones largas); template de referencia que copian solicitud-costeo y cotizacionPreview. Exports: OcProveedorLinea, OcProveedorPdfInput, buildOrdenCompraProveedorPdf.
- [worker/lib/pdf/cotizacionPreview.ts](worker/lib/pdf/cotizacionPreview.ts) — Cotización vista previa (SOLO dentro del portal, no reemplaza la oficial de Eledo): mismo template visual que la OC a Proveedor. Exports: CotizacionPreviewLinea, CotizacionPreviewInput, buildCotizacionPreviewPdf.
- [worker/lib/pdf/templates.ts](worker/lib/pdf/templates.ts) — Las 3 plantillas (resumen de oportunidad, remisión, constancia de firma) como funciones puras. Exports: renderTemplate, buildBlocks, titleOf, DocData, RenderedSignature.
- [worker/lib/portalFiles.ts](worker/lib/portalFiles.ts) — Resuelve un key de /api/files → assetId/bytes (R2 con fallback a Monday), mapa key→columna. Exports: readPortalFile, resolveMondayAsset, normalizeFileKey, OPP_FILE_COLS.
- [worker/lib/r2.ts](worker/lib/r2.ts) — Helpers mínimos sobre binding FILES (bucket R2 para documentos). Exports: oportunidadFileKey, putFile.
- [worker/lib/rosterCache.ts](worker/lib/rosterCache.ts) — Cache D1 del roster de usuarios de Monday con TTL configurable. Exports: cachedFetchUsers.
- [worker/lib/serialize.ts](worker/lib/serialize.ts) — Mirror row → role-scoped DTOs: único productor de ItemDTO/ColMeta filtradas. Exports: RawCol, toItemDTO, toColMeta.
- [worker/lib/zonas.ts](worker/lib/zonas.ts) — Zonas de ventas: el líder LEE las oportunidades de sus miembros (solo lectura; el write path pide scope 'own'). La zona privada 'Efrain' se autoriza por CORREO (no por monday_user_id, que se presta). Exports: Zona, ZonaError, ensureZonaTables, readableUserIds, zonaPrivadaMemberIds, hiddenOwnerIdsFor, isZonaPrivadaAdminPermitido, ZONA_PRIVADA_BOARDS, listZonas, createZona, updateZona, deleteZona.

### worker/mw/

- [worker/mw/access.ts](worker/mw/access.ts) — Verifica identidad del caller en c.get('email') vía Cloudflare Access. Exports: access.
- [worker/mw/identity.ts](worker/mw/identity.ts) — Email (de mw/access) → fila D1 → c.get('viewer') con Role + metadata + scope de zona (resuelto una vez por request). Exports: identity.

### worker/routes/

- [worker/routes/admin.ts](worker/routes/admin.ts) — Admin-only: gestionar roster, pullear users de Monday y servir el tablero de Análisis (GET /api/admin/analytics). Exports: adminRoutes.
- [worker/routes/boards.ts](worker/routes/boards.ts) — Rutas genéricas de boards espejados (list/detail/patch/create/updates/activity). Exports: boardRoutes.
- [worker/routes/anuncios.ts](worker/routes/anuncios.ts) — API de Anuncios: leer cualquiera (ya filtrado por rol+zona), escribir SOLO admin. El WhatsApp del anuncio sale en waitUntil y solo con la casilla explícita. Exports: anuncioRoutes.
- [worker/routes/telemetry.ts](worker/routes/telemetry.ts) — `POST /api/telemetry` (204 antes de tocar D1, insert en waitUntil, descarta lotes bajo suplantación) + `GET /api/telemetry/report` agregado, solo admin. Exports: telemetryRoutes.
- [worker/routes/home.ts](worker/routes/home.ts) — Ruta GET /api/home de la pantalla "Inicio", con ETag propio sobre el fingerprint de items pendientes. Exports: homeRoutes.
- [worker/routes/inventario.ts](worker/routes/inventario.ts) — Inventario D1 nativo (no espejado de Monday). Exports: inventarioRoutes.
- [worker/routes/documents.ts](worker/routes/documents.ts) — API /api/documents*: generar, listar, PDF (base/firmado), firmar, trazo. Exports: documentRoutes.
- [worker/routes/notifications.ts](worker/routes/notifications.ts) — API del centro de notificaciones scoped al viewer (list ETag/304, marcar leída). Exports: notificationRoutes.
- [worker/routes/oportunidades.ts](worker/routes/oportunidades.ts) — Rutas específicas de Oportunidades: costeo, versiones, duplicar. Exports: oportunidadRoutes.

### worker/sync/

- [worker/sync/delta.ts](worker/sync/delta.ts) — Delta sync cada 15 min: jala activity_logs recientes de las 8 boards en una call y refetchea solo los items que cambiaron, complementa al reconcile de 12h. Exports: deltaSync.
- [worker/sync/echo.ts](worker/sync/echo.ts) — Outbox echo: ¿estado fresco de Monday coincide con lo que escribimos? Exports: confirmOutboxEcho.
- [worker/sync/index.ts](worker/sync/index.ts) — Superficie pública del módulo A (ver docs/dev-contracts.md). Exports: (exports re-publicados).
- [worker/sync/log.ts](worker/sync/log.ts) — Tiny sync_log writer compartido por helpers de sync. Exports: logSync.
- [worker/sync/reconcile.ts](worker/sync/reconcile.ts) — Reconciliación full-board y full-mirror (cron + manual). Exports: reconcileBoard, reconcileAll.
- [worker/sync/refetch.ts](worker/sync/refetch.ts) — Single-item refetch: nunca confiar en payloads, siempre re-pullear de Monday. Exports: refetchItem, refetchItemTree.
- [worker/sync/upsert.ts](worker/sync/upsert.ts) — Upsert un item de Monday en el mirror D1. Exports: UpsertResult, UpsertOpts, upsertItem.
- [worker/sync/webhook.ts](worker/sync/webhook.ts) — POST /api/sync/webhook/:token — intake de webhooks Monday. Exports: syncRoutes.

### worker/wa/

- [worker/wa/agent.ts](worker/wa/agent.ts) — Canal WhatsApp del agente Claude (el loop real vive en lib/agentLoop). Exports: handleIncoming.
- [worker/wa/notify.ts](worker/wa/notify.ts) — Puente entre el centro de notificaciones y el envío de WhatsApp, solo para severidad 'importante'. Exports: notifyPortalWa.
- [worker/wa/routes.ts](worker/wa/routes.ts) — Webhook de WhatsApp Cloud API (Meta Graph). Exports: waRoutes.
- [worker/wa/send.ts](worker/wa/send.ts) — Helpers de envío: sendText, markRead vía WhatsApp Cloud API. Exports: sendText, markRead.
- [worker/wa/store.ts](worker/wa/store.ts) — Persistencia D1 del bot WhatsApp: identity-by-phone, idempotencia. Exports: normalizePhone, identityByPhone, alreadyProcessed.

### worker/assistant/

- [worker/assistant/agent.ts](worker/assistant/agent.ts) — Canal "burbuja de chat" del portal (loop en lib/agentLoop). Exports: ChatMessage, toDisplayMessages, handleChat.
- [worker/assistant/routes.ts](worker/assistant/routes.ts) — Endpoints de chat bubble del portal. Exports: assistantRoutes.
- [worker/assistant/store.ts](worker/assistant/store.ts) — Persistencia D1 de conversaciones del chat bubble. Exports: loadConversation, saveConversation, clearConversation.

## src/

### src/ (root)

- [src/App.tsx](src/App.tsx) — Root de la app: Sidebar + vistas lazy-loaded por chunk. Exports: default.
- [src/main.tsx](src/main.tsx) — Entry point React: createRoot + StrictMode. Exports: (none).

### src/app/

- [src/app/ChunkReloadBoundary.tsx](src/app/ChunkReloadBoundary.tsx) — Error boundary que recarga una sola vez cuando un chunk lazy falla por deploy nuevo (Cloudflare Workers Assets). Exports: reloadOnceForNewDeploy, ChunkReloadBoundary.
- [src/app/AnalisisPage.tsx](src/app/AnalisisPage.tsx) — Pantalla "Análisis" (admin): tiles, embudo de conversión, tabla por zona/vendedor y panel "Datos por resolver" con deep link al drawer. Exports: AnalisisPage.
- [src/app/AnunciosView.tsx](src/app/AnunciosView.tsx) — Pantalla "Anuncios": tarjetas de comunicados + composer admin (prioridad, audiencia por rol/zona, casilla de WhatsApp). El "visto" se asienta con IntersectionObserver, no al abrir la vista. Exports: AnunciosView.
- [src/app/HomeView.tsx](src/app/HomeView.tsx) — Pantalla "Inicio": saludo + pendientes en tarjetas por rol, con seguimiento inline. Exports: HomeView.
- [src/app/ImpersonationBanner.tsx](src/app/ImpersonationBanner.tsx) — Strip fijo: aviso cuando admin suplanta otro usuario. Exports: ImpersonationBanner.
- [src/app/MobileTopBar.tsx](src/app/MobileTopBar.tsx) — Barra superior móvil: hamburguesa + nombre board activo. Exports: MobileTopBar.
- [src/app/PhoneGateScreen.tsx](src/app/PhoneGateScreen.tsx) — Bloqueo tras login de Access hasta capturar el teléfono, requerido para identificar al usuario en el bot de WhatsApp. Exports: PhoneGateScreen.
- [src/app/SessionExpiredScreen.tsx](src/app/SessionExpiredScreen.tsx) — Pantalla de bloqueo total con reintento automático de logout cuando la sesión de Access expiró. Exports: SessionExpiredScreen.
- [src/app/SettingsPage.tsx](src/app/SettingsPage.tsx) — Admin-only: gestionar roster de identidades del portal. Exports: SettingsPage.
- [src/app/Sidebar.tsx](src/app/Sidebar.tsx) — Navegación principal: boards gateados por role + settings para admins. Exports: BoardKey, BOARD_LABELS.
- [src/app/UserChip.tsx](src/app/UserChip.tsx) — Chip de usuario: avatar + nombre + rol badge (GET /api/me). Exports: UserChip.

### src/lib/

- [src/lib/api.ts](src/lib/api.ts) — ETag-aware polling hooks sobre apiClient; fallback a mock offline. Exports: (re-exports), PollStatus, PollResult.
- [src/lib/apiClient.ts](src/lib/apiClient.ts) — Cliente tipado (no-hook) para worker API (ver docs/dev-contracts.md). Exports: BoardMeta, AccessError, logout.
- [src/lib/telemetry.ts](src/lib/telemetry.ts) — Buffer en memoria de eventos de interacción; sale en lote (~5s / 20 eventos / pagehide) con sendBeacon. Nunca bloquea la UI ni propaga errores. Los GET van muestreados al 2% (la lista poletea cada 5s). Exports: uxNav, uxEdit, uxClick, uxAck, uxError, uxAction, uxClickBusy, uxApiLatency.
- [src/lib/costeoCalc.ts](src/lib/costeoCalc.ts) — Fórmulas de costeo para preview local (1:1 con Monday). Exports: COL, cellNumber, CostChain, computeCostChain.
- [src/lib/dealStages.ts](src/lib/dealStages.ts) — Config de los 6 boards de etapa con nombres + colores. Exports: (re-exports), StageBoardKey, StageBoardConfig, STAGE_BOARDS.
- [src/lib/embellecimiento.ts](src/lib/embellecimiento.ts) — Re-export de shared/embellecimiento (parse/serialize por zona). Exports: (re-exports).
- [src/lib/format.ts](src/lib/format.ts) — Helpers de formato compartidos por renderers y indicators. Exports: isMoneyTitle, fmtMoney, fmtSyncAgo.
- [src/lib/groupBy.ts](src/lib/groupBy.ts) — Agrupa items por valor de columna status/dropdown (con labels). Exports: ColumnGroup, groupByColumn.
- [src/lib/analyticsApi.ts](src/lib/analyticsApi.ts) — Cliente + hook del tablero de Análisis. Sin polling a propósito (la consulta barre todo el mirror): refresco manual. Exports: PeriodoDias, PERIODOS, getAnalytics, UseAnalyticsResult, useAnalytics.
- [src/lib/anunciosApi.ts](src/lib/anunciosApi.ts) — Cliente + hook de Anuncios: store a nivel módulo (un solo poll ETag de 60s para pantalla y badge del sidebar). Exports: crearAnuncio, editarAnuncio, archivarAnuncio, borrarAnuncio, marcarAnuncioVisto, UseAnunciosResult, useAnuncios.
- [src/lib/homeApi.ts](src/lib/homeApi.ts) — Cliente + hook de la pantalla "Inicio": polling ETag cada 30s sobre GET /home y envío de seguimiento. Exports: HomeResponse (re-export), HomePendienteDTO (re-export), HomeSectionDTO (re-export), enviarSeguimiento, UseHomeResult, useHome.
- [src/lib/estadoProductoBuckets.ts](src/lib/estadoProductoBuckets.ts) — Agrupa los 11 labels de "Estado del producto" en buckets de avance para la batería del tab Ejecución (lógica pura, testeada). Exports: batteryFromSubitems, batteryFromMirrorText, ESTADO_PRODUCTO_ORDER.
- [src/lib/impersonation.ts](src/lib/impersonation.ts) — Admin "ver como": target email persiste en localStorage. Exports: getImpersonateTarget, startImpersonation, stopImpersonation.
- [src/lib/inventoryApi.ts](src/lib/inventoryApi.ts) — Cliente fetch para /api/inventario/* (feature D1 nativa). Exports: (tipos), getWarehouses, getStock, createMovement.
- [src/lib/documentsApi.ts](src/lib/documentsApi.ts) — Cliente de /api/documents* (generar, listar, firmar, URL del PDF). Exports: listDocuments, createDocument, signDocument, documentPdfUrl.
- [src/lib/notificationsApi.ts](src/lib/notificationsApi.ts) — Cliente + hook del centro de notificaciones (polling ETag 12s, optimista). Exports: markNotificationRead, markAllNotificationsRead, useNotifications.
- [src/lib/mockFallback.ts](src/lib/mockFallback.ts) — Fallback offline para el board Oportunidades: se activa cuando cualquier fetch al Worker falla, no solo en dev — reusa src/data/oportunidades.ts. Exports: mockBoardMeta, mockPatch, mockList, mockItemDetail.
- [src/lib/productSearch.ts](src/lib/productSearch.ts) — Búsqueda flexible por palabras (nombre/SKU/marca, sin acentos) sobre el catálogo de Productos, usada por ProductPicker. Exports: PRODUCTO_SKU_COL, PRODUCTO_NOMBRE_COL, PRODUCTO_MARCA_COL, norm, alnum, productoSku, productoMarca, productoNombreCorto, productSearchIndex, searchProductos, exactProducto.
- [src/lib/projectStages.ts](src/lib/projectStages.ts) — Config de los 4 accesos Proyectos (post-venta: Tallas, OC, Ejecución, Logística). Exports: ProjectBoardKey, ProjectBoardConfig, PROJECT_STATUS_ORDER, PROJECT_BOARDS.
- [src/lib/routing.ts](src/lib/routing.ts) — Ruteo mínimo por History API (sin react-router, deep links). Exports: useRoute.
- [src/lib/sessionState.ts](src/lib/sessionState.ts) — Señal global de sesión de Access expirada tras agotar el auto-retry, consumida por App.tsx para bloquear la UI. Exports: markSessionExpired, useSessionExpired.
- [src/lib/statusValue.ts](src/lib/statusValue.ts) — Monday status-type columns: parse value {index, post_id, ...}. Exports: statusIndex.
- [src/lib/syncStatus.ts](src/lib/syncStatus.ts) — Board-list header: "actualizado hace X min" (item.updated_at de Monday). Exports: lastMondayUpdateFromItems.
- [src/lib/textMatch.ts](src/lib/textMatch.ts) — Text matching insensible a acentos para búsqueda client-side. Exports: normalizeText, textIncludes.
- [src/lib/useIsMobile.ts](src/lib/useIsMobile.ts) — Breakpoint único móvil/desktop para toda la UI (390px). Exports: useIsMobile.
- [src/lib/useMe.ts](src/lib/useMe.ts) — Cache compartido GET /me (Sidebar necesita role para gatear boards). Exports: invalidateMeCache, useMe.
- [src/lib/useSaveState.ts](src/lib/useSaveState.ts) — Estado de guardado async reutilizable (patrón compartido). Exports: SaveState, useSaveState.
- [src/lib/useSavedView.ts](src/lib/useSavedView.ts) — View state per-persona (filtros + etapas colapsadas). Exports: SavedViewFilters, useSavedView.

### src/components/

- [src/components/assistant/ChatBubble.tsx](src/components/assistant/ChatBubble.tsx) — Floating chat bubble del agente Claude. Exports: ChatBubble.
- [src/components/notifications/NotificationBell.tsx](src/components/notifications/NotificationBell.tsx) — Campana con badge (popover desktop / hoja móvil), vive en Sidebar + MobileTopBar. Exports: NotificationBell.
- [src/components/notifications/NotificationCenter.tsx](src/components/notifications/NotificationCenter.tsx) — Panel de 2 bandejas (Importantes/Actualizaciones), deep-link al drawer. Exports: NotificationCenter.
- [src/components/board/BoardStatus.tsx](src/components/board/BoardStatus.tsx) — Loading/denied/offline states compartidos. Exports: BoardStatus.
- [src/components/board/ProgressBattery.tsx](src/components/board/ProgressBattery.tsx) — Barra segmentada de avance (tab Ejecución + lista): compact para fila de lista, full con leyenda para el header del drawer. Exports: ProgressBattery.
- [src/components/board/BoardTable.tsx](src/components/board/BoardTable.tsx) — Tabla genérica estilo Monday. Exports: BoardTable.
- [src/components/board/PaymentRequestButton.tsx](src/components/board/PaymentRequestButton.tsx) — Botón POST solicitud pago a Monday item. Exports: PaymentRequestButton.
- [src/components/board/SyncIndicator.tsx](src/components/board/SyncIndicator.tsx) — Indicador "sincronizado hace X min". Exports: SyncIndicator.
- [src/components/board/cellHelpers.ts](src/components/board/cellHelpers.ts) — Helpers plain para rendering de celdas. Exports: cellAlign, renderCellText, chipFor.
- [src/components/board/cells.tsx](src/components/board/cells.tsx) — Renderizado genérico de celdas (ColMeta + ColVal). Exports: CellContent.
- [src/components/core/Badges.tsx](src/components/core/Badges.tsx) — Badge de status. Exports: StatusBadge.
- [src/components/core/Button.tsx](src/components/core/Button.tsx) — Botón con variantes. Exports: Button.
- [src/components/core/ConfirmButton.tsx](src/components/core/ConfirmButton.tsx) — Botón confirmación 2-paso. Exports: ConfirmButton.
- [src/components/core/Modal.tsx](src/components/core/Modal.tsx) — Diálogo centrado (no fullscreen como OpportunityDrawer). Exports: Modal.
- [src/components/core/PdfCanvasPreview.tsx](src/components/core/PdfCanvasPreview.tsx) — Renderiza TODAS las páginas de un PDF a canvas con pdfjs, una debajo de otra. Exports: warmPdfWorker, PdfCanvasPreview.
- [src/components/core/FilePreviewModal.tsx](src/components/core/FilePreviewModal.tsx) — Visor de archivos en modal: imágenes inline y PDFs vía PdfCanvasPreview (lazy), con descarga para lo que el navegador no dibuja. Exports: FilePreviewModal.
- [src/components/core/PersonAvatar.tsx](src/components/core/PersonAvatar.tsx) — Avatar circular de iniciales. Exports: PersonAvatar, PersonPair.
- [src/components/documents/DocumentsPanel.tsx](src/components/documents/DocumentsPanel.tsx) — Panel reusable por fuente: genera, lista y firma documentos del portal. Exports: DocumentsPanel.
- [src/components/documents/SignDocumentModal.tsx](src/components/documents/SignDocumentModal.tsx) — Modal de firma: previsualiza el PDF, captura el trazo, consentimiento + huella. Exports: SignDocumentModal.
- [src/components/documents/SignaturePad.tsx](src/components/documents/SignaturePad.tsx) — Captura del trazo con pointer events; exporta JPEG (el writer solo embebe DCTDecode). Exports: SignaturePad, SignaturePadHandle.
- [src/components/forms/ChipSelect.tsx](src/components/forms/ChipSelect.tsx) — Picker de pills one-click para opciones pequeñas. Exports: ChipSelect.
- [src/components/forms/FilterBar.tsx](src/components/forms/FilterBar.tsx) — Fila de selects "Todos"-first para filtrar. Exports: FilterBar.
- [src/components/forms/FormField.tsx](src/components/forms/FormField.tsx) — Campo editable genérico para create forms. Exports: FormField.
- [src/components/forms/PickerRow.tsx](src/components/forms/PickerRow.tsx) — Componente picker row para forms. Exports: PickerRow.
- [src/components/forms/ProductPicker.tsx](src/components/forms/ProductPicker.tsx) — Picker de producto del catálogo para líneas de cotización (busca por nombre o SKU), reemplaza al datalist nativo. Exports: ProductoChoice, ProductPicker.
- [src/components/forms/SearchInput.tsx](src/components/forms/SearchInput.tsx) — Input de búsqueda estilizado. Exports: SearchInput.
- [src/components/forms/SearchableSelect.tsx](src/components/forms/SearchableSelect.tsx) — Combobox searchable type-to-filter. Exports: SearchableSelect.
- [src/components/forms/Select.tsx](src/components/forms/Select.tsx) — Select estilizado. Exports: Select.
- [src/components/icons.tsx](src/components/icons.tsx) — Exports de iconos SVG de la UI. Exports: IconOportunidades, IconGlobe, IconCosteo.
- [src/components/layout/GroupCard.tsx](src/components/layout/GroupCard.tsx) — Wrapper para secciones agrupadas. Exports: GroupCard.
- [src/components/navigation/NavItem.tsx](src/components/navigation/NavItem.tsx) — Item de navegación. Exports: NavItem.
- [src/components/navigation/Tabs.tsx](src/components/navigation/Tabs.tsx) — Control de navegación por tabs. Exports: Tabs.


### src/boards/


### src/boards/generic/

- [src/boards/generic/CreateRecordModal.tsx](src/boards/generic/CreateRecordModal.tsx) — Formulario crear registro genérico (via createFields whitelist). Exports: CreateRecordModal.
- [src/boards/generic/EditContactoModal.tsx](src/boards/generic/EditContactoModal.tsx) — Vendedor relinquea Institución de Contacto. Exports: EditContactoModal.
- [src/boards/generic/GenericBoardView.tsx](src/boards/generic/GenericBoardView.tsx) — Tabla full-board + búsqueda (Productos, Instituciones, Contactos). Exports: GenericBoardView.
- [src/boards/generic/ProductoActividadDrawer.tsx](src/boards/generic/ProductoActividadDrawer.tsx) — Drawer lateral mínimo al hacer click en un producto (Productos no tiene detalle propio) — hoy solo la pestaña Actividad. Exports: ProductoActividadDrawer.

### src/boards/inventario/

- [src/boards/inventario/InventarioBoard.tsx](src/boards/inventario/InventarioBoard.tsx) — Inventario: feature D1 nativa (almacenes/movimientos/stock). Exports: InventarioBoard.

### src/boards/inventario/tabs/

- [src/boards/inventario/tabs/AlmacenesTab.tsx](src/boards/inventario/tabs/AlmacenesTab.tsx) — Catálogo almacenes: lista + agregar (nombre + tipo). Exports: AlmacenesTab.
- [src/boards/inventario/tabs/MovementsTab.tsx](src/boards/inventario/tabs/MovementsTab.tsx) — Tab movimientos: ledger completo, newest first (IDs de DTO). Exports: MovementsTab.
- [src/boards/inventario/tabs/NewMovementTab.tsx](src/boards/inventario/tabs/NewMovementTab.tsx) — Nuevo movimiento: origen/destino show/hide per reglas. Exports: NewMovementTab.
- [src/boards/inventario/tabs/StockTab.tsx](src/boards/inventario/tabs/StockTab.tsx) — Tab stock: stock actual por (producto, almacén), Bodegas primero. Exports: StockTab.

### src/boards/oportunidades/

- [src/boards/oportunidades/BoardTabsBar.tsx](src/boards/oportunidades/BoardTabsBar.tsx) — Tabs subrayadas del diseño: Ventas-side + opcionalmente post-venta. Exports: DrawerTabKey.
- [src/boards/oportunidades/CreateOportunidadModal.tsx](src/boards/oportunidades/CreateOportunidadModal.tsx) — Formulario "Nueva oportunidad" (deliberadamente mínimo). Exports: default.
- [src/boards/oportunidades/EditClienteModal.tsx](src/boards/oportunidades/EditClienteModal.tsx) — Vendedor relinquea Cliente de Oportunidad. Exports: EditClienteModal.
- [src/boards/oportunidades/EditPersonaModal.tsx](src/boards/oportunidades/EditPersonaModal.tsx) — Reasigna Vendedor o Comprador de Oportunidad. Exports: EditPersonaModal.
- [src/boards/oportunidades/OportunidadesBoard.tsx](src/boards/oportunidades/OportunidadesBoard.tsx) — Orquestador de vistas de Oportunidades (stages + drawer). Exports: OportunidadesBoard.
- [src/boards/oportunidades/OpportunityDrawer.tsx](src/boards/oportunidades/OpportunityDrawer.tsx) — Drawer compartido fullscreen de detalle + tabs por role. Exports: OpportunityDrawer.
- [src/boards/oportunidades/ProyectoSection.tsx](src/boards/oportunidades/ProyectoSection.tsx) — Barrel de la sección Proyecto (tabs Tallas, OC, Ejecución): re-exporta de `proyecto/` sin lógica propia. Exports: P_SHEET_LINK, P_OC_CLIENTE, ESTADO_PRODUCTO_COLORS, useProyecto, linkUrl, ProyectoState, ProyectoTallasSection, ProyectoOrdenesSection, EjecucionSection.
- [src/boards/oportunidades/StageBoard.tsx](src/boards/oportunidades/StageBoard.tsx) — Wrapper genérico para boards de etapa (Oportunidades, Costeo, Validación, etc.). Exports: StageBoard.
- [src/boards/oportunidades/StageBoardList.tsx](src/boards/oportunidades/StageBoardList.tsx) — Lista compartida agrupada por etapa + búsqueda. Exports: StageBoardList.

### src/boards/oportunidades/proyecto/

Antes un solo archivo (`ProyectoSection.tsx`, 1196 líneas) — dividido 2026-08-13 por tab para que cada uno se lea sin cargar los otros dos (LogisticaSection se agregó después, 2026-08-17, mismo criterio). `ProyectoSection.tsx` (arriba) queda como barrel.

- [src/boards/oportunidades/proyecto/shared.tsx](src/boards/oportunidades/proyecto/shared.tsx) — Consts de columna (Proyectos + Subelementos), `ProyectoState`/`useProyecto`, `ProyectoActionBar`/`ProyectoLinks`/`FileList`/`Shell` compartidos por las 4 secciones. Exports: P_SHEET_LINK, P_DRIVE_LINK, P_TALLAS_PDF, P_OC_PDF, P_OC_CLIENTE, P_METODO_PAGO, P_COND_PAGO, S_PRODUCTO, S_SKU, S_COLOR, S_TALLA, S_CANTIDAD, S_PROVEEDOR, S_PROVEEDOR_RAZON, S_PROVEEDOR_CORREO, S_ESTADO, S_COSTO, S_DESCUENTO, S_MONEDA, S_ENTREGA_PROV, ESTADO_PRODUCTO_COLORS, ProyectoState, useProyecto, linkUrl, parseFiles, toR2Files, ActionOutcome, describeResult, OUTCOME_COLOR, ProyectoActionBar, ProyectoLinks, FileList, Shell.
- [src/boards/oportunidades/proyecto/TallasSection.tsx](src/boards/oportunidades/proyecto/TallasSection.tsx) — Tab Tallas: tarjetas editables por producto+color con "Cotizado" vs. asignado; `groupByProductoColor`/`TallaGroup` también los reusa EjecucionSection/LogisticaSection. Exports: TallaGroup, sortByTalla, groupByProductoColor, ProyectoTallasSection.
- [src/boards/oportunidades/proyecto/OrdenesSection.tsx](src/boards/oportunidades/proyecto/OrdenesSection.tsx) — Tab Órdenes de compra: líneas agrupadas por proveedor + botón "Generar OC" acotado a cada uno. Compras EDITA la OC aquí (cantidad/costo/moneda/descuento/entrega inline a Monday, mover de proveedor, borrar, "+ Agregar producto") y cada línea trae su reloj de historial. Exports: ProyectoOrdenesSection.
- [src/boards/oportunidades/proyecto/EjecucionSection.tsx](src/boards/oportunidades/proyecto/EjecucionSection.tsx) — Tab Ejecución: batería agregada + tarjetas por producto+color con resumen global y chips de estado por talla. Exports: EjecucionSection.
- [src/boards/oportunidades/proyecto/LogisticaSection.tsx](src/boards/oportunidades/proyecto/LogisticaSection.tsx) — Tab Logística: tarjetas por producto+color, fila compacta por línea (Estado/Producción/Unidad, visible a todos) + detalle expandible solo Compras/Admin (encargado, # de recolección, guías, evidencia, confirmación de tallas y fecha — subida real de archivos vía `/api/proyectos_sub/:id/logistica/:field`). Exports: LogisticaSection.

### src/boards/oportunidades/tabs/

- [src/boards/oportunidades/tabs/ActualizacionesTab.tsx](src/boards/oportunidades/tabs/ActualizacionesTab.tsx) — Live feed de item.updates de Monday (GET/POST). Exports: ActualizacionesTab.
- [src/boards/oportunidades/tabs/ActividadTab.tsx](src/boards/oportunidades/tabs/ActividadTab.tsx) — Log de actividad (worker/lib/activityLog.ts), solo lectura: quién cambió qué columna y cuándo. Reusado por el drawer de Productos. Exports: ActividadTab.
- [src/boards/oportunidades/tabs/CotizacionTab.tsx](src/boards/oportunidades/tabs/CotizacionTab.tsx) — Grid de línea de producto (espeja diseño fixed-column). Exports: CotizacionTab.
- [src/boards/oportunidades/tabs/DocumentacionTab.tsx](src/boards/oportunidades/tabs/DocumentacionTab.tsx) — Cotizaciones/solicitudes son columnas file Oportunidades. Exports: SOLICITUDES_COL, NO_FIRMADAS_COL, FIRMADA_COL.
- [src/boards/oportunidades/tabs/EmbellecimientosTab.tsx](src/boards/oportunidades/tabs/EmbellecimientosTab.tsx) — Resumen read-only embellecimiento per línea (diseño per-zona). Exports: EmbellecimientosTab.
- [src/boards/oportunidades/tabs/EmptyDocTab.tsx](src/boards/oportunidades/tabs/EmptyDocTab.tsx) — Empty state compartido "próximamente" para tabs sin datos. Exports: EmptyDocTab.
- [src/boards/oportunidades/tabs/NuevosProductosTab.tsx](src/boards/oportunidades/tabs/NuevosProductosTab.tsx) — Proponer nuevo producto (sin data source de propuestos). Exports: NuevosProductosTab.
- [src/boards/oportunidades/tabs/TallasTab.tsx](src/boards/oportunidades/tabs/TallasTab.tsx) — Tallas: link a Google Sheet del proyecto. Exports: TallasTab.

### src/boards/oportunidades/tabs/cotizacion/

- [src/boards/oportunidades/tabs/cotizacion/ColumnVisibilityPicker.tsx](src/boards/oportunidades/tabs/cotizacion/ColumnVisibilityPicker.tsx) — Herramienta Columnas: mostrar/ocultar por rol. Exports: ColumnVisibilityPicker.
- [src/boards/oportunidades/tabs/cotizacion/CotizacionPdfRow.tsx](src/boards/oportunidades/tabs/cotizacion/CotizacionPdfRow.tsx) — Thumbnails + preview PDF cotizaciones (solicitud, sin firmar, firmada) + vista previa nativa del portal. Exports: CotizacionPdfRow.
- [src/boards/oportunidades/tabs/cotizacion/LineDetailPanel.tsx](src/boards/oportunidades/tabs/cotizacion/LineDetailPanel.tsx) — Panel expandible con ficha completa de línea. Exports: LineDetailPanel.
- [src/boards/oportunidades/tabs/cotizacion/MobileQuoteRow.tsx](src/boards/oportunidades/tabs/cotizacion/MobileQuoteRow.tsx) — Card de línea mobile (mismo estado/edición que fila desktop, gemela de QuoteRow). Exports: MobileQuoteRow.
- [src/boards/oportunidades/tabs/cotizacion/QuoteRow.tsx](src/boards/oportunidades/tabs/cotizacion/QuoteRow.tsx) — Fila de línea desktop, memoizada (gemela de MobileQuoteRow). Exports: QuoteRowProps (y el componente memoizado).
- [src/boards/oportunidades/tabs/cotizacion/SnapshotTable.tsx](src/boards/oportunidades/tabs/cotizacion/SnapshotTable.tsx) — Tabla snapshot de versión de cotización. Exports: SnapshotTable.
- [src/boards/oportunidades/tabs/cotizacion/TotalsRow.tsx](src/boards/oportunidades/tabs/cotizacion/TotalsRow.tsx) — Fila de totales (desktop/mobile) de grid de cotización. Exports: TotalsRow.
- [src/boards/oportunidades/tabs/cotizacion/VersionChips.tsx](src/boards/oportunidades/tabs/cotizacion/VersionChips.tsx) — Selector de versiones de cotización (vigente + histórico). Exports: VersionChips.
- [src/boards/oportunidades/tabs/cotizacion/gridMeta.tsx](src/boards/oportunidades/tabs/cotizacion/gridMeta.tsx) — Metadata de grid Cotización: IDs columnas Monday, encabezados, `computeLineBanner` (banner de avisos compartido por QuoteRow/MobileQuoteRow). Exports: (constantes), computeLineBanner, getLineWarnings, needsConfirmarTallas, productoProveedorOk.

### src/boards/proyectos/

- [src/boards/proyectos/AgregarLineaModal.tsx](src/boards/proyectos/AgregarLineaModal.tsx) — Línea manual del Proyecto (Compras agrega un producto que no está en la cotización), con costo/descuento/moneda para que la OC nazca completa. Exports: AgregarLineaModal.
- [src/boards/proyectos/AjustarLineaVirtualModal.tsx](src/boards/proyectos/AjustarLineaVirtualModal.tsx) — Modal "Ajustar línea" del Proyecto (versión virtual sobre QuoteLineSnapshot), calcado del de Oportunidades. SÍ escribe a Monday desde 2026-08-13 (reusa `applyAjusteLinea`) — la descripción vieja decía "sin tocar Monday". Exports: AjustarLineaVirtualModal.
- [src/boards/proyectos/CotizacionVirtualTab.tsx](src/boards/proyectos/CotizacionVirtualTab.tsx) — Tab Cotización del Proyecto: son las MISMAS líneas vigentes de la Oportunidad ligada (`childrenOf`, no una copia), rotuladas con el log de ajustes. Editar/Dividir aquí modifica la Oportunidad y llega a Monday (2026-08-13) — la descripción vieja decía "sin tocar Monday". Exports: CotizacionVirtualTab.
- [src/boards/proyectos/EmbellecimientosVirtualTab.tsx](src/boards/proyectos/EmbellecimientosVirtualTab.tsx) — Tab Embellecimientos del Proyecto, solo lectura, sobre las mismas líneas virtuales de CotizacionVirtualTab. Exports: EmbellecimientosVirtualTab.
- [src/boards/proyectos/ProyectoBoard.tsx](src/boards/proyectos/ProyectoBoard.tsx) — Orquestador de Proyectos (post-venta). Exports: ProyectoBoard.
- [src/boards/proyectos/ProyectoBoardList.tsx](src/boards/proyectos/ProyectoBoardList.tsx) — Lista Proyectos (post-venta) para los 3 accesos sidebar. Exports: ProyectoBoardList.
- [src/boards/proyectos/ProyectoDrawer.tsx](src/boards/proyectos/ProyectoDrawer.tsx) — Drawer Proyecto (post-venta), abierto por su propio id; incluye el tab Actividad (log del proyecto + sus líneas). Exports: ProyectoDrawer.

### src/data/

- [src/data/oportunidades.ts](src/data/oportunidades.ts) — Fixture data del prototipo de diseño, reusada como fallback offline real por `src/lib/mockFallback.ts` (no es mockup muerto — ver ahí). Exports: Status, OppProduct, UpdateEntry, Opportunity, statuses, opportunities, fmtMoney.
