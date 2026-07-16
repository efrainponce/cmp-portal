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
