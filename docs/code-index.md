# Índice de código — cmp-portal

Mapa curado de archivos fuente (`.ts`, `.tsx`) para orientarse rápido sin explorar el repo entero. Grep aquí antes de explorar. Este índice puede quedar desactualizado; verifica contra el código si algo no cuadra. Generado: 2026-07-21.

Formato: `- [ruta](ruta) — Propósito (1 frase). Exports: Export1, Export2, Export3.`

## shared/

- [shared/boardAccess.ts](shared/boardAccess.ts) — Per-equipo (Role) whitelist de boards del sidebar. Exports: BOARD_KEYS, ConfigurableBoardKey, isConfigurableBoardKey, TEAM_ROLES, DEFAULT_BOARD_ACCESS.
- [shared/boards.ts](shared/boards.ts) — Registro de boards con IDs introspectionados (API 2024-10). Never fabricate. Exports: BoardSlug, BoardDef, BOARDS, boardById.
- [shared/column-meta.gen.ts](shared/column-meta.gen.ts) — GENERADO por scripts/introspect-boards.mjs; no leer completo, grepear el id. Exports: COLUMN_META.
- [shared/createFields.ts](shared/createFields.ts) — Whitelist para CREACIÓN de items (por board, campos obligatorios). Exports: CreateField, CREATE_FIELDS, CREATE_DEFAULTS, CREATABLE_SLUGS, isCreatable.
- [shared/dealStages.ts](shared/dealStages.ts) — Etapas canon (labels/order) compartidas por frontend y worker (herramientas agente). Exports: DEAL_STAGE_LABELS, DEAL_STAGE_ORDER, CLOSED_STAGES, stageAtOrAfter, stageKeyForLabel.
- [shared/dto.ts](shared/dto.ts) — DTOs genéricos scoped por rol (único productor: serialize.ts). Exports: ColVal, ItemDTO, ItemDetailDTO, ListResponse, MeDTO.
- [shared/embellecimiento.ts](shared/embellecimiento.ts) — Compartido con worker: parse/serialize embellecimiento por zona. Exports: EMBELL_TEMPLATE_KEYS, EmbellZoneKey, EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN.
- [shared/inventory.ts](shared/inventory.ts) — DTOs Inventario + reglas negocio (feature D1 nativa). Exports: MovementType, WarehouseType, MOVEMENT_TYPES, WarehouseDTO, MovementDTO.
- [shared/types.ts](shared/types.ts) — Tipos base compartidos: Role, Identity, MirrorItem, EmbellecimientoSpec. Exports: Role, Identity, MirrorItem, EmbellecimientoSpec.
- [shared/visibility.ts](shared/visibility.ts) — La whitelist como data: reglas de lectura/escritura por columna y rol (fail-closed). Exports: ColRule, VISIBILITY, canRead, canWrite, readableCols.

## worker/

### worker/ (root)

- [worker/env.ts](worker/env.ts) — Interface Env con los bindings del Worker: DB, FILES, R2, claves, y token de webhook. Exports: Env.
- [worker/index.ts](worker/index.ts) — Hono wiring; webhook routes bypass access/identity, el resto va tras middleware. Exports: default.

### worker/lib/

- [worker/lib/agentLoop.ts](worker/lib/agentLoop.ts) — Loop del agente Claude compartido por WhatsApp y portal. Exports: RESET_WORDS, RESET_REPLY, finalText, runAgentLoop.
- [worker/lib/assistantPersonas.ts](worker/lib/assistantPersonas.ts) — Una persona de agente por rol (vendedor/compras/admin/almacen), compartida por ambos canales. Exports: Channel, systemPromptFor.
- [worker/lib/assistantTools.ts](worker/lib/assistantTools.ts) — Superficie de herramientas del agente Claude compartida por todos los canales. Exports: TOOL_ROLES, TOOLS, toolsFor, runTool.
- [worker/lib/automations.ts](worker/lib/automations.ts) — Cliente de automaciones cmp-tallas Vercel (trigger, no reimplementar). Exports: AutomationError, AutomationResult, CotizacionResult, validarCosteo.
- [worker/lib/boardAccess.ts](worker/lib/boardAccess.ts) — DAL para role_board_access (tabla D1) — lectura/escritura de accesos por rol. Exports: getBoardAccess, listAllBoardAccess, BoardAccessError, setBoardAccess.
- [worker/lib/canon.ts](worker/lib/canon.ts) — Canonicalización + hashing de valores de columnas Monday. Exports: md5, ReadColVal, canonValue, ColRawValue.
- [worker/lib/columnEncode.ts](worker/lib/columnEncode.ts) — Encoda valor de formulario a forma JSON de Monday create_item. Exports: encodeColumnValue.
- [worker/lib/conversationHistory.ts](worker/lib/conversationHistory.ts) — Trim/TTL/compact rules compartidas por todo agente (ambos canales). Exports: HISTORY_TTL_MS, trimHistory.
- [worker/lib/costeo.ts](worker/lib/costeo.ts) — "Mandar a costeo" — validación y envío de costeos a cmp-tallas. Exports: CosteoError, validateLinea, EnviarCosteoResult, checkCosteo.
- [worker/lib/cotizacionPdfs.ts](worker/lib/cotizacionPdfs.ts) — Resuelve PDFs de cotización (solicitud, sin firmar, firmada) de columnas Oportunidades. Exports: CotizacionPdfError, PdfKind, resolveCotizacionPdfUrl.
- [worker/lib/createOportunidad.ts](worker/lib/createOportunidad.ts) — Crear Oportunidad + subitems de línea de producto. Exports: OportunidadError, LineaInput, OportunidadInput, OportunidadResult.
- [worker/lib/createRecord.ts](worker/lib/createRecord.ts) — Creación síncrona de item genérico (no outbox, sin echo necesario). Exports: CreateError, submitCreate.
- [worker/lib/dal.ts](worker/lib/dal.ts) — All reads scoped by viewer; handlers no pueden bypassear estos predicados. Exports: childSlugOf, listItems, getItem, childrenOf.
- [worker/lib/duplicateOportunidad.ts](worker/lib/duplicateOportunidad.ts) — "Duplicar" en drawer: clona Oportunidad + líneas en nueva vigente sin costearse. Exports: DuplicateOportunidadError, duplicateOportunidad.
- [worker/lib/embellecimientoImagenes.ts](worker/lib/embellecimientoImagenes.ts) — Imágenes de referencia per-zona (upload validation, almacenamiento en R2). Exports: EmbellImageError, embellImageKey, parseFiles, splitZone.
- [worker/lib/http.ts](worker/lib/http.ts) — Helper mínimo compartido por rutas (statusCode responses). Exports: jsonStatus.
- [worker/lib/inventory.ts](worker/lib/inventory.ts) — Inventario DAL + validación (feature D1 nativa, no espejado de Monday). Exports: InventoryError, listWarehouses, listMovements, listStock.
- [worker/lib/monday.ts](worker/lib/monday.ts) — Cliente GraphQL thin de Monday.com (API 2024-10). Exports: MondayCol, MondayItem, gql, ItemsPage.
- [worker/lib/outbox.ts](worker/lib/outbox.ts) — Write path optimista: D1 mirror primero, Monday async vía waitUntil + echo. Exports: OutboxError, submitWrite, flushOutbox.
- [worker/lib/quoteVersions.ts](worker/lib/quoteVersions.ts) — Versiones de cotización: vigente siempre es primera subitem, borradores/snapshots para histórico. Exports: QuoteVersionError, listVersions, recordFirstVersion, esDraftVigente.
- [worker/lib/r2.ts](worker/lib/r2.ts) — Helpers mínimos sobre binding FILES (bucket R2 para documentos). Exports: oportunidadFileKey, putFile, getFile.
- [worker/lib/rosterCache.ts](worker/lib/rosterCache.ts) — Cache D1 del roster de usuarios de Monday con TTL configurable. Exports: cachedFetchUsers.
- [worker/lib/serialize.ts](worker/lib/serialize.ts) — Mirror row → role-scoped DTOs: único productor de ItemDTO/ColMeta filtradas. Exports: RawCol, toItemDTO, toColMeta.

### worker/mw/

- [worker/mw/access.ts](worker/mw/access.ts) — Verifica identidad del caller en c.get('email') vía Cloudflare Access. Exports: access.
- [worker/mw/identity.ts](worker/mw/identity.ts) — Email (de mw/access) → fila D1 → c.get('viewer') con Role + metadata. Exports: identity.

### worker/routes/

- [worker/routes/admin.ts](worker/routes/admin.ts) — Admin-only: gestionar roster y pullear users de Monday. Exports: adminRoutes.
- [worker/routes/boards.ts](worker/routes/boards.ts) — Rutas genéricas de boards espejados (list/detail/patch/create). Exports: boardRoutes.
- [worker/routes/inventario.ts](worker/routes/inventario.ts) — Inventario D1 nativo (no espejado de Monday). Exports: inventarioRoutes.
- [worker/routes/oportunidades.ts](worker/routes/oportunidades.ts) — Rutas específicas de Oportunidades: costeo, versiones, duplicar. Exports: oportunidadRoutes.

### worker/sync/

- [worker/sync/echo.ts](worker/sync/echo.ts) — Outbox echo: ¿estado fresco de Monday coincide con lo que escribimos? Exports: confirmOutboxEcho.
- [worker/sync/index.ts](worker/sync/index.ts) — Superficie pública del módulo A (ver docs/dev-contracts.md). Exports: (exports re-publicados).
- [worker/sync/log.ts](worker/sync/log.ts) — Tiny sync_log writer compartido por helpers de sync. Exports: logSync.
- [worker/sync/reconcile.ts](worker/sync/reconcile.ts) — Reconciliación full-board y full-mirror (cron + manual). Exports: reconcileBoard, reconcileAll.
- [worker/sync/refetch.ts](worker/sync/refetch.ts) — Single-item refetch: nunca confiar en payloads, siempre re-pullear de Monday. Exports: refetchItem, refetchItemTree.
- [worker/sync/upsert.ts](worker/sync/upsert.ts) — Upsert un item de Monday en el mirror D1. Exports: UpsertResult, UpsertOpts, upsertItem.
- [worker/sync/webhook.ts](worker/sync/webhook.ts) — POST /api/sync/webhook/:token — intake de webhooks Monday. Exports: syncRoutes.

### worker/wa/

- [worker/wa/agent.ts](worker/wa/agent.ts) — Canal WhatsApp del agente Claude (el loop real vive en lib/agentLoop). Exports: handleIncoming.
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

- [src/app/ImpersonationBanner.tsx](src/app/ImpersonationBanner.tsx) — Strip fijo: aviso cuando admin suplanta otro usuario. Exports: ImpersonationBanner.
- [src/app/MobileTopBar.tsx](src/app/MobileTopBar.tsx) — Barra superior móvil: hamburguesa + nombre board activo. Exports: MobileTopBar.
- [src/app/SettingsPage.tsx](src/app/SettingsPage.tsx) — Admin-only: gestionar roster de identidades del portal. Exports: SettingsPage.
- [src/app/Sidebar.tsx](src/app/Sidebar.tsx) — Navegación principal: boards gateados por role + settings para admins. Exports: BoardKey, BOARD_LABELS.
- [src/app/UserChip.tsx](src/app/UserChip.tsx) — Chip de usuario: avatar + nombre + rol badge (GET /api/me). Exports: UserChip.

### src/lib/

- [src/lib/api.ts](src/lib/api.ts) — ETag-aware polling hooks sobre apiClient; fallback a mock offline. Exports: (re-exports), PollStatus, PollResult.
- [src/lib/apiClient.ts](src/lib/apiClient.ts) — Cliente tipado (no-hook) para worker API (ver docs/dev-contracts.md). Exports: BoardMeta, AccessError, logout.
- [src/lib/costeoCalc.ts](src/lib/costeoCalc.ts) — Fórmulas de costeo para preview local (1:1 con Monday). Exports: COL, cellNumber, CostChain, computeCostChain.
- [src/lib/dealStages.ts](src/lib/dealStages.ts) — Config de los 6 boards de etapa con nombres + colores. Exports: (re-exports), StageBoardKey, StageBoardConfig, STAGE_BOARDS.
- [src/lib/embellecimiento.ts](src/lib/embellecimiento.ts) — Re-export de shared/embellecimiento (parse/serialize por zona). Exports: (re-exports).
- [src/lib/format.ts](src/lib/format.ts) — Helpers de formato compartidos por renderers y indicators. Exports: isMoneyTitle, fmtMoney, fmtSyncAgo.
- [src/lib/groupBy.ts](src/lib/groupBy.ts) — Agrupa items por valor de columna status/dropdown (con labels). Exports: ColumnGroup, groupByColumn.
- [src/lib/impersonation.ts](src/lib/impersonation.ts) — Admin "ver como": target email persiste en localStorage. Exports: getImpersonateTarget, startImpersonation, stopImpersonation.
- [src/lib/inventoryApi.ts](src/lib/inventoryApi.ts) — Cliente fetch para /api/inventario/* (feature D1 nativa). Exports: (tipos), getWarehouses, getStock, createMovement.
- [src/lib/mockFallback.ts](src/lib/mockFallback.ts) — Fallback offline-only para que board Oportunidades demo sin API. Exports: mockBoardMeta, mockPatch, mockList, mockItemDetail.
- [src/lib/projectStages.ts](src/lib/projectStages.ts) — Config de los 3 accesos Proyectos (post-venta: Tallas, OC, Logística). Exports: ProjectBoardKey, ProjectBoardConfig, PROJECT_STATUS_ORDER, PROJECT_BOARDS.
- [src/lib/routing.ts](src/lib/routing.ts) — Ruteo mínimo por History API (sin react-router, deep links). Exports: useRoute.
- [src/lib/statusValue.ts](src/lib/statusValue.ts) — Monday status-type columns: parse value {index, post_id, ...}. Exports: statusIndex.
- [src/lib/syncStatus.ts](src/lib/syncStatus.ts) — Board-list header: "actualizado hace X min" (item.updated_at de Monday). Exports: lastMondayUpdateFromItems.
- [src/lib/textMatch.ts](src/lib/textMatch.ts) — Text matching insensible a acentos para búsqueda client-side. Exports: normalizeText, textIncludes.
- [src/lib/useIsMobile.ts](src/lib/useIsMobile.ts) — Breakpoint único móvil/desktop para toda la UI (390px). Exports: useIsMobile.
- [src/lib/useMe.ts](src/lib/useMe.ts) — Cache compartido GET /me (Sidebar necesita role para gatear boards). Exports: invalidateMeCache, useMe.
- [src/lib/useSaveState.ts](src/lib/useSaveState.ts) — Estado de guardado async reutilizable (patrón compartido). Exports: SaveState, useSaveState.
- [src/lib/useSavedView.ts](src/lib/useSavedView.ts) — View state per-persona (filtros + etapas colapsadas). Exports: SavedViewFilters, useSavedView.

### src/components/

- [src/components/assistant/ChatBubble.tsx](src/components/assistant/ChatBubble.tsx) — Floating chat bubble del agente Claude. Exports: ChatBubble.
- [src/components/board/BoardStatus.tsx](src/components/board/BoardStatus.tsx) — Loading/denied/offline states compartidos. Exports: BoardStatus.
- [src/components/board/BoardTable.tsx](src/components/board/BoardTable.tsx) — Tabla genérica estilo Monday. Exports: BoardTable.
- [src/components/board/EditableField.tsx](src/components/board/EditableField.tsx) — Campo editable: label + input/textarea + save. Exports: EditableField.
- [src/components/board/InfoGrid.tsx](src/components/board/InfoGrid.tsx) — Grid key/value read-only para headers. Exports: InfoGrid.
- [src/components/board/PaymentRequestButton.tsx](src/components/board/PaymentRequestButton.tsx) — Botón POST solicitud pago a Monday item. Exports: PaymentRequestButton.
- [src/components/board/SyncIndicator.tsx](src/components/board/SyncIndicator.tsx) — Indicador "sincronizado hace X min". Exports: SyncIndicator.
- [src/components/board/cellHelpers.ts](src/components/board/cellHelpers.ts) — Helpers plain para rendering de celdas. Exports: cellAlign, renderCellText, chipFor.
- [src/components/board/cells.tsx](src/components/board/cells.tsx) — Renderizado genérico de celdas (ColMeta + ColVal). Exports: CellContent.
- [src/components/core/Badges.tsx](src/components/core/Badges.tsx) — Badges: status y count. Exports: StatusBadge, CountBadge.
- [src/components/core/Button.tsx](src/components/core/Button.tsx) — Botón con variantes. Exports: Button.
- [src/components/core/ConfirmButton.tsx](src/components/core/ConfirmButton.tsx) — Botón confirmación 2-paso. Exports: ConfirmButton.
- [src/components/core/Modal.tsx](src/components/core/Modal.tsx) — Diálogo centrado (no fullscreen como OpportunityDrawer). Exports: Modal.
- [src/components/core/PdfCanvasPreview.tsx](src/components/core/PdfCanvasPreview.tsx) — Renderiza PDF a canvas con pdfjs. Exports: warmPdfWorker, PdfCanvasPreview.
- [src/components/core/PersonAvatar.tsx](src/components/core/PersonAvatar.tsx) — Avatar circular de iniciales. Exports: PersonAvatar, PersonPair.
- [src/components/forms/ChipSelect.tsx](src/components/forms/ChipSelect.tsx) — Picker de pills one-click para opciones pequeñas. Exports: ChipSelect.
- [src/components/forms/DocUploadList.tsx](src/components/forms/DocUploadList.tsx) — Lista de upload de documentos. Exports: DocUploadList.
- [src/components/forms/FilterBar.tsx](src/components/forms/FilterBar.tsx) — Fila de selects "Todos"-first para filtrar. Exports: FilterBar.
- [src/components/forms/FormField.tsx](src/components/forms/FormField.tsx) — Campo editable genérico para create forms. Exports: FormField.
- [src/components/forms/PickerRow.tsx](src/components/forms/PickerRow.tsx) — Componente picker row para forms. Exports: PickerRow.
- [src/components/forms/SearchInput.tsx](src/components/forms/SearchInput.tsx) — Input de búsqueda estilizado. Exports: SearchInput.
- [src/components/forms/SearchableSelect.tsx](src/components/forms/SearchableSelect.tsx) — Combobox searchable type-to-filter. Exports: SearchableSelect.
- [src/components/forms/Select.tsx](src/components/forms/Select.tsx) — Select estilizado. Exports: Select.
- [src/components/icons.tsx](src/components/icons.tsx) — Exports de iconos SVG de la UI. Exports: IconOportunidades, IconGlobe, IconCosteo.
- [src/components/layout/GroupCard.tsx](src/components/layout/GroupCard.tsx) — Wrapper para secciones agrupadas. Exports: GroupCard.
- [src/components/navigation/NavItem.tsx](src/components/navigation/NavItem.tsx) — Item de navegación. Exports: NavItem.
- [src/components/navigation/Tabs.tsx](src/components/navigation/Tabs.tsx) — Control de navegación por tabs. Exports: Tabs.


### src/boards/

- [src/boards/BoardPlaceholder.tsx](src/boards/BoardPlaceholder.tsx) — Placeholder para vistas vacías o sin datos. Exports: BoardPlaceholder.

### src/boards/generic/

- [src/boards/generic/CreateRecordModal.tsx](src/boards/generic/CreateRecordModal.tsx) — Formulario crear registro genérico (via createFields whitelist). Exports: CreateRecordModal.
- [src/boards/generic/EditContactoModal.tsx](src/boards/generic/EditContactoModal.tsx) — Vendedor relinquea Institución de Contacto. Exports: EditContactoModal.
- [src/boards/generic/GenericBoardView.tsx](src/boards/generic/GenericBoardView.tsx) — Tabla full-board + búsqueda (Productos, Instituciones, Contactos). Exports: GenericBoardView.

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
- [src/boards/oportunidades/ProyectoSection.tsx](src/boards/oportunidades/ProyectoSection.tsx) — Sección Proyecto compartida por tabs Tallas y OC. Exports: P_SHEET_LINK, P_OC_CLIENTE.
- [src/boards/oportunidades/StageBoard.tsx](src/boards/oportunidades/StageBoard.tsx) — Wrapper genérico para boards de etapa (Oportunidades, Costeo, Validación, etc.). Exports: StageBoard.
- [src/boards/oportunidades/StageBoardList.tsx](src/boards/oportunidades/StageBoardList.tsx) — Lista compartida agrupada por etapa + búsqueda. Exports: StageBoardList.

### src/boards/oportunidades/tabs/

- [src/boards/oportunidades/tabs/ActualizacionesTab.tsx](src/boards/oportunidades/tabs/ActualizacionesTab.tsx) — Live feed de item.updates de Monday (GET/POST). Exports: ActualizacionesTab.
- [src/boards/oportunidades/tabs/CotizacionTab.tsx](src/boards/oportunidades/tabs/CotizacionTab.tsx) — Grid de línea de producto (espeja diseño fixed-column). Exports: CotizacionTab.
- [src/boards/oportunidades/tabs/DocumentacionTab.tsx](src/boards/oportunidades/tabs/DocumentacionTab.tsx) — Cotizaciones/solicitudes son columnas file Oportunidades. Exports: SOLICITUDES_COL, NO_FIRMADAS_COL, FIRMADA_COL.
- [src/boards/oportunidades/tabs/EmbellecimientosTab.tsx](src/boards/oportunidades/tabs/EmbellecimientosTab.tsx) — Resumen read-only embellecimiento per línea (diseño per-zona). Exports: EmbellecimientosTab.
- [src/boards/oportunidades/tabs/EmptyDocTab.tsx](src/boards/oportunidades/tabs/EmptyDocTab.tsx) — Empty state compartido "próximamente" para tabs sin datos. Exports: EmptyDocTab.
- [src/boards/oportunidades/tabs/NuevosProductosTab.tsx](src/boards/oportunidades/tabs/NuevosProductosTab.tsx) — Proponer nuevo producto (sin data source de propuestos). Exports: NuevosProductosTab.
- [src/boards/oportunidades/tabs/TallasTab.tsx](src/boards/oportunidades/tabs/TallasTab.tsx) — Tallas: link a Google Sheet del proyecto. Exports: TallasTab.

### src/boards/oportunidades/tabs/cotizacion/

- [src/boards/oportunidades/tabs/cotizacion/ColumnVisibilityPicker.tsx](src/boards/oportunidades/tabs/cotizacion/ColumnVisibilityPicker.tsx) — Herramienta Columnas: mostrar/ocultar por rol. Exports: ColumnVisibilityPicker.
- [src/boards/oportunidades/tabs/cotizacion/CotizacionPdfRow.tsx](src/boards/oportunidades/tabs/cotizacion/CotizacionPdfRow.tsx) — Thumbnails + preview PDF cotizaciones (solicitud, sin firmar, firmada). Exports: CotizacionPdfRow.
- [src/boards/oportunidades/tabs/cotizacion/LineDetailPanel.tsx](src/boards/oportunidades/tabs/cotizacion/LineDetailPanel.tsx) — Panel expandible con ficha completa de línea. Exports: LineDetailPanel.
- [src/boards/oportunidades/tabs/cotizacion/MobileQuoteRow.tsx](src/boards/oportunidades/tabs/cotizacion/MobileQuoteRow.tsx) — Card de línea mobile (mismo estado/edición que fila desktop). Exports: MobileQuoteRow.
- [src/boards/oportunidades/tabs/cotizacion/SnapshotTable.tsx](src/boards/oportunidades/tabs/cotizacion/SnapshotTable.tsx) — Tabla snapshot de versión de cotización. Exports: SnapshotTable.
- [src/boards/oportunidades/tabs/cotizacion/TotalsRow.tsx](src/boards/oportunidades/tabs/cotizacion/TotalsRow.tsx) — Fila de totales (desktop/mobile) de grid de cotización. Exports: TotalsRow.
- [src/boards/oportunidades/tabs/cotizacion/VersionChips.tsx](src/boards/oportunidades/tabs/cotizacion/VersionChips.tsx) — Selector de versiones de cotización (vigente + histórico). Exports: VersionChips.
- [src/boards/oportunidades/tabs/cotizacion/gridMeta.tsx](src/boards/oportunidades/tabs/cotizacion/gridMeta.tsx) — Metadata de grid Cotización: IDs columnas Monday, encabezados. Exports: (constantes).

### src/boards/proyectos/

- [src/boards/proyectos/AgregarLineaModal.tsx](src/boards/proyectos/AgregarLineaModal.tsx) — Línea manual del Proyecto (Compras agrega producto faltante). Exports: AgregarLineaModal.
- [src/boards/proyectos/ProyectoBoard.tsx](src/boards/proyectos/ProyectoBoard.tsx) — Orquestador de Proyectos (post-venta). Exports: ProyectoBoard.
- [src/boards/proyectos/ProyectoBoardList.tsx](src/boards/proyectos/ProyectoBoardList.tsx) — Lista Proyectos (post-venta) para los 3 accesos sidebar. Exports: ProyectoBoardList.
- [src/boards/proyectos/ProyectoDrawer.tsx](src/boards/proyectos/ProyectoDrawer.tsx) — Drawer Proyecto (post-venta), abierto por su propio id. Exports: ProyectoDrawer.

### src/data/

- [src/data/oportunidades.ts](src/data/oportunidades.ts) — Mock data del proyecto de diseño CMP Portal. Exports: Status, Embellecimiento, OppProduct.

