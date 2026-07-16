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
