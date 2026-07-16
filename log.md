# Log de commits

## 2026-07-15

- **`1ae8165`** — Initial commit: CMP portal (Vite/React + Cloudflare Worker)
  - Thin UI over Monday.com boards con una capa de sincronización en Cloudflare Worker.
  - Outbox + reconciliación respaldados en D1.
  - Bot de WhatsApp para crear contactos/oportunidades vía la API de Monday.
- **`44c5ffd`** — Create oportunidad from portal, pre-costeo validations, fewer Monday calls
  - Nuevo `POST /api/boards/oportunidades/items` (8 campos) + modal "Nueva oportunidad".
  - Nuevo `POST /api/oportunidades/:id/enviar-costeo` con validaciones (línea de producto, cantidad > 0, color disponible) antes de mover `deal_stage` a "En costeo".
  - `reconcileAll` ahora se salta boards sin cambios usando `board_state.updated_at` (full pass forzado cada 24 h).
  - `flushOutbox` agrupa filas pendientes por item: 1 mutación + 1 refetch por item en vez de por fila.
  - Fix: las columnas de status deben escribirse como `{label}` (el formato `{labels:[...]}` hacía que Monday asignara una etiqueta arbitraria en silencio).
  - Queries D1 en paralelo para list/detail; creación de subitems de WA en paralelo.
  - Code-splitting por board vía `React.lazy`.
  - Visibilidad (PROPUESTO): `color_mm0ex0ed` y `multiple_person_mm03qyw9` ahora visibles para vendedor en el formulario de creación y filtros de lista.
- **`0a73648`** — Versiones de cotización, chat del portal, inventario y ampliación cmp-tallas
  - Versiones de cotización (Oportunidades): tabla D1 `cotizacion_versions`, la vigente siempre se arma del mirror de Monday; nueva versión al cambiar producto/color/cantidad/embellecimiento de una línea o agregar/quitar una, sin tocar columnas de costo. UI: chips V1/V2…, editor "Nueva versión".
  - Burbuja de chat del portal (`worker/assistant/`, `src/components/assistant/`): mismo agente Claude y set de herramientas que el bot de WhatsApp, historial persistido en D1 por email de vendedor.
  - Módulo de Inventario (`worker/lib/inventory.ts`, `src/boards/inventario/`): feature nativa en D1 (bodegas/movimientos/stock), no espejada de Monday.
  - Ampliación de integración cmp-tallas: flujos de Proyecto/Tallas/Órdenes de compra (`ProyectoSection.tsx`) documentados en `docs/cmp-tallas-endpoint-map.md`.
  - Captura de costeo inline en `CotizacionTab` (variant costeo) para compras, con preview local de fórmulas (`src/lib/costeoCalc.ts`).
- **`bf882f2`** — Cerrar el flujo de versiones: candado de costeo + placeholders de imagen
  - Nueva versión con cambios ahora manda a costeo de verdad (mismo flujo que "Mandar a costeo": valida, PDF, `deal_stage` → "En costeo"), sin importar la etapa previa; el botón se movió junto a los chips V1/V2 como "+ Enviar a costeo" y aparece en cualquier etapa salvo Ganada/Perdida.
  - `listVersions` siempre sintetiza la vigente en cuanto hay líneas (antes requería una versión archivada); `submitVersion` auto-ancla V1 si nunca existió, y resetea Etapa Costeo a "No iniciado" en líneas editadas que Compras ya había avanzado, para que `validar_costeo` (cmp-tallas) las vuelva a snapshotear en vez de dejar costo viejo pegado a datos nuevos.
  - Grid de Costeo/Validación: se cerró un leak donde Cantidad (writable para el form de nueva versión) también quedaba editable inline sin pasar por versiones; ahora el inline-edit está restringido a costeo + precio.
  - Fix: `precioUnitario` en los snapshots de versión leía `.value` (JSON crudo con comillas) en vez de `.text`, dejando todos los totales en $0.
  - Columna Etapa Costeo agregada al grid de Costeo con badge de color.
  - Placeholders de imagen (cliente, sin endpoint aún) en Embellecimientos y Nuevos productos; regeneración de `column-meta.gen.ts`.
- **`f75dfae`** — Vendedores editan precio en Cotización + optimizaciones de costo/velocidad
  - `CotizacionTab`: inline-edit ya no exclusivo del variant costeo — el vendedor edita Precio de Venta C/U en los boards de Ventas con preview local de Subtotal/IVA/Total; prop `editable` bloquea Ganada/Perdida.
  - Fix de carrera en `POST /oportunidades/:id/version`: `submitVersion` hace `await flushOutbox` antes de reenviar a costeo (cmp-tallas leía Monday sin los cambios) y el refetch de árbol se movió a la ruta después del costeo (recoge stage/PDF/snapshots; antes quedaba mirror viejo).
  - Asistente: loop unificado `worker/lib/agentLoop.ts` (WA + portal) con prompt caching (system+tools y prefijo completo, lecturas ~0.1×); `trimHistory` compacta `tool_result`s con >10 mensajes de antigüedad.
  - Roster de Monday cacheado en D1 (`api_cache`): `/api/users` TTL 6 h (441ms→16ms), admin 10 min, stale-if-error.
  - Frontend: `/api/boards` cacheado por sesión, polling pausado con pestaña oculta, drawer con cache SWR (reabrir oportunidad = instantáneo).

## 2026-07-16

- **`c32067a`** — Edición inline de cotizaciones en Nueva oportunidad + auto-open tras crear opp
  - `CotizacionTab`: en stage 4 (Nueva oportunidad) el vendedor edita inline producto/color/cantidad; precio nunca editable para vendedor (solo lectura). Otras etapas siguen editando solo vía "Nueva versión" (archivable).
  - Botón "+ Agregar línea" en Nueva oportunidad crea subitems vacíos; nuevo `POST /api/oportunidades/:id/productos` para crear líneas sin versioning.
  - `CreateOportunidadModal`: hace polling al folio, cierra el modal y auto-abre el drawer en cuanto está listo.
- **`edfb9c2`** — Deep links por oportunidad (`/boardKey/itemId`) + botón Copiar link
  - Ruteo por URL con History API (sin librería nueva): `useRoute()` en `src/lib/routing.ts` deriva board/itemId de la ruta; `App.tsx` y los 6 boards de oportunidad (Oportunidades, Costeo, Validación Costeo, Documentación y Tallas, Órdenes de Compra, Logística) pasaron de `useState` local a `openId`/`onOpenChange` por props.
  - Permite compartir un link directo a una oportunidad (WhatsApp, chat interno) y soporta back/forward del navegador; el fallback SPA de `wrangler.jsonc` ya cubre la navegación directa en producción.
  - `OpportunityDrawer` suma botón "Copiar link" junto a "Actualizar".
- **`eee5186`** — Fix: agregar línea no vinculaba subitem + producto/color no editables en cotización
  - `POST /oportunidades/:id/productos` usaba `create_item` en el board de subitems en vez de `create_subitem` — Monday nunca lo linkeaba al padre. También corregido el parseo del stage (`MirrorItem.columns` es JSON crudo, no el shape serializado de ItemDTO).
  - `CotizacionTab`: columna Color agregada al grid de Ventas (faltaba); Producto editable con datalist del catálogo (relación real o texto libre, igual que `NuevaVersionForm`); Color editable con datalist de colores disponibles del producto ligado.
  - Preview local del mirror de producto tras el write — antes parecía que la edición no se guardaba porque Monday puebla `lookup_mm0x4kda` de forma asíncrona.
- **`5c50882`** — Color de línea: dropdown real, no texto libre
  - El campo Color pasó de input+datalist a `<select>` con opciones tomadas del catálogo de Productos (`dropdown_mkztty4b`, ya en memoria) — instantáneo, sin depender del mirror asíncrono del subitem. Deshabilitado hasta elegir producto; un color guardado que ya no esté en la lista se conserva como opción suelta.
- **`ab3d53b`** — Warnings de color/cantidad + toggle Con Embellecimiento en Cotización
  - Cantidad de línea nueva arranca en 0 (antes 1) con warning "Cantidad requerida"; mismo trato para color vacío. Mismos checks que ya hacía `enviarCosteo`, ahora visibles por línea sin esperar a mandar a costeo.
  - Checkbox "Con Embellecimiento" en el grid de Ventas (Nueva oportunidad) / badge de solo lectura en otras etapas, escribe el mismo status column que `submitVersion` (`color_mm1b34bg`).
  - `EmbellecimientosTab` filtra: solo líneas marcadas "Con Embellecimiento" aparecen ahí (antes mostraba todas sin importar el status); mismo filtro en el snapshot de versiones superadas.
- **`8797f7d`** — Fix: color bloqueado sin explicación + labels reales de Embellecimiento
  - Color ya no se queda bloqueado cuando el producto no tiene lista de colores configurada — cae a texto libre en ese caso específico en vez de mostrar "Elige un producto primero" con un producto ya ligado.
  - Badge/toggle de embellecimiento muestra los labels reales de Monday ("Con Embellecimiento"/"Sin Embellecimiento") en vez de "Sí"/"No".
- **`8f9f99a`** — Color sin lista: dejar en blanco, no texto libre
  - Efraín: el vendedor no debe poder "inventar" un color que el catálogo no define — sin colores configurados, el campo queda vacío y deshabilitado en vez de abrir texto libre.
- **`a66ecc4`** — Embellecimientos: versiones (V1/V2 + Enviar a costeo) y agregar posición con imagen/archivo
  - `EmbellecimientosTab` comparte los chips de versión de `CotizacionTab` (`VersionChips` exportado) — el embellecimiento va pegado a la misma línea de producto (`QuoteLineSnapshot`), así que comparte versión y el botón "+ Enviar a costeo"; snapshot de zonas de solo lectura al ver una versión superada.
  - "+ Agregar posición" ya funciona: elige zona (de las 8 del template) + descripción, hace PATCH de `long_text_mm1bj4pt` preservando las demás zonas (`upsertEmbellZone`/`serializeEmbellecimiento`, inverso de `parseEmbellecimiento`).
  - El endpoint de imagen por zona ya no exige `image/*` — `file_mm5akjy5` es una columna de archivo genérica de Monday; el preview cae a un link "Ver archivo" si la URL no carga como `<img>`.
  - Gateado por permisos reales (`ColMeta.w` de `subCols`) y por `editable` (bloqueado en Ganada/Perdida, igual que Cotización).
