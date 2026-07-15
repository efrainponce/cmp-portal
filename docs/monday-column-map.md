# Monday column map — introspected 2026-07-13, API 2025-04

Source of truth is now code: `shared/visibility.ts` (curated vis + writable tags,
fail-closed) + `shared/column-meta.gen.ts` (generated titles/labels). This doc is the
human-readable review copy (✅ seller sees · 🔒 internal · ❓ needs Efraín's call).

## Writable dimension (NEW 2026-07-14 — PROPOSED, pending Efraín)

Sellers (+admin) may edit these columns; everything else is read-only. Flip = one-line
change in `visibility.ts`:

| Writable by vendedor | ID | Board |
|---|---|---|
| Vigencia de la cotización | `text_mm0gje0` | Oportunidades |
| Tiempo de entrega | `text_mm0gjrrd` | Oportunidades |
| Comentarios cotización | `long_text_mm1m416j` | Oportunidades |
| Institución | `contact_account` | Contactos |

Overnight-build additions (2026-07-14): Instituciones (18395657597) and Contactos
(18395657595) mirrored as reference catalogs — all CRM fields ✅ for authenticated
roles, internal INEGI ids 🔒; full tags in `shared/visibility.ts` (PROPOSED, review).

Boards: Oportunidades **18395657596** · Oportunidades subitems **18395657607** ·
Proyectos **18395657594** · Subelementos **18395657609** · Productos **18395657591**.

## Creatable fields (NEW 2026-07-14 — PROPOSED, pending Efraín)

Portal now supports creating Instituciones and Contactos records (roles: vendedor,
compras, admin). Whitelist is `shared/createFields.ts`, enforced fail-closed by the new
`POST /api/boards/:slug/items` route — a column not listed here is rejected even if it's
readable/writable for edits. Oportunidades creation EXISTS since 2026-07-15 via the
WhatsApp bot (`worker/lib/createOportunidad.ts`, see docs/whatsapp-bot.md): initial
`deal_stage` = "Nueva oportunidad", `deal_owner` = creating vendedor, `deal_contact`
linkable (verified live — the link lands but only `BoardRelationValue.linked_item_ids`
reflects it immediately; text/value stay null at first). Product lines are subitems
linked through `board_relation_mkzmafgp`, which populates all catalog mirrors.

**Instituciones** — Nombre* · Municipio · Tipo · Grupo · Estado · RFC ·
Domicilio Fiscal · Régimen Fiscal · Fin de Administración · Vendedor. (Proyectos and
Documentos excluded — no proyecto exists yet at creation time, no upload UI built.)

**Contactos** — Nombre* · Email · Teléfono · Cargo (`text_mm0dz8yj`) · Vendedor ·
Comentarios. **❓ Efraín**: Contactos has ambiguous/possibly-duplicate columns left out
by default — `text_mm562a0m` (a second "Cargo"), `text_mm454qq1` (Prioridad),
`text_mm45xn3` (Calificación), `text_mm45tqrm` (Ciudad), `text_mm456fbp` (Estado). Tell
me which are actually in use and I'll add them.

**Resolved 2026-07-14 (was: known limitation):** Contactos' Institución field
(`contact_account`) is Monday's built-in CRM-template "Account" relation column. Writes
to it silently no-op'd on API version `2024-10` via `create_item`,
`change_multiple_column_values`, and `change_column_value` alike — but work correctly
on `2025-04` (verified live: linked and unlinked a test contact). The worker now pins
`2025-04` (`worker/lib/monday.ts`, `worker/lib/outbox.ts`) and `contact_account` is
writable by vendedor/admin (`shared/visibility.ts`). Still excluded from the *create*
form (`shared/createFields.ts`) — that needs an Instituciones picker in `FormField`,
a separate change; editing an existing contact's Institución works today.

**Creación de Oportunidades desde el portal (2026-07-15, pedido de Efraín):**
`CREATE_FIELDS.oportunidades` = Nombre* · Vendedor* (`deal_owner`) · Compras
(`multiple_person_mm03qyw9`) · Contacto (`deal_contact`) · Zona (`dropdown_mm03g067`) ·
Tipo de cotización (`color_mm47f0ca`) · ¿Nuevos productos? (`color_mm0ex0ed`) · Fecha
límite (`deal_expected_close_date`). `deal_stage` inicia en "Nueva oportunidad"
(default server-side). **Cambios de visibilidad PROPUESTOS con esto**: `color_mm0ex0ed`
y `multiple_person_mm03qyw9` pasaron de 🔒/no-listado a ✅ (necesarios para el form y
los filtros de la lista) — revertir es una línea en `shared/visibility.ts`.

**Validación enviar-costeo (2026-07-15):** POST /api/oportunidades/:id/enviar-costeo
exige ≥1 línea, producto asignado (`board_relation_mkzmafgp` o `text_mm0bkm1j`),
cantidad>0 (`numeric_mkzm6399`) y color (`text_mm07s2mg`) dentro de "Colores
disponibles" (`lookup_mkznm0h3`, mirror del catálogo) cuando la lista existe.

## Oportunidades (18395657596) — item level

| Vis | Column | ID | Type |
|---|---|---|---|
| ✅ | Name | `name` | name |
| ✅ | Folio | `pulse_id_mm0qcq0m` | item_id |
| ✅ | Etapa | `deal_stage` | status |
| ✅ | Vendedor | `deal_owner` | people — **authz key** |
| ✅ | Vendedores secundarios | `multiple_person_mm0wt53c` | people — **authz key** |
| ✅ | Fecha Limite | `deal_expected_close_date` | date |
| ✅ | Contacto | `deal_contact` | board_relation |
| ✅ | Institución | `lookup_mm1bs976` | mirror |
| ✅ | Cargo | `lookup_mm0xf2r5` | mirror |
| ✅ | Zona | `dropdown_mm03g067` | dropdown |
| ✅ | Cantidad Total | `lookup_mm0pt4mj` | mirror |
| ✅ | Subtotal | `lookup_mkznd66k` | mirror |
| ✅ | Total | `lookup_mm00p07m` | mirror |
| ✅ | Fecha Cotización | `date_mm09mv5b` | date |
| ✅ | Vigencia de la cotización | `text_mm0gje0` | text |
| ✅ | Tiempo de entrega | `text_mm0gjrrd` | text |
| ✅ | Comentarios cotización | `long_text_mm1m416j` | long_text |
| ✅ | Cotizaciones generadas | `file_mm0fgrzq` | file |
| ✅ | Cotizaciones Firmadas | `file_mm0zjras` | file |
| ✅ | Tipo de cotización | `color_mm47f0ca` | status |
| ✅ | Razón de Pérdida / Comentario | `dropdown_mm0mg00` / `text_mm47xmh` | dropdown/text |
| ❓ | Etapa Costeo | `lookup_mm087at6` | mirror — workflow state, no montos. **Recomiendo ✅** (el vendedor ve dónde está su costeo) |
| ❓ | Cotizaciones sin precio | `file_mm0z6rze` | file — **Recomiendo ✅** (las usa el vendedor) |
| ❓ | Fechas solicitud/validación costeo | `date_mm094kzf` / `date_mm09b6nz` / `date_mm0mc3dj` | date — **Recomiendo ✅** |
| 🔒 | Utilidad Total | `lookup_mm4g2hqf` | mirror |
| 🔒 | Costo Total | `lookup_mm35sk4e` | mirror |
| 🔒 | Utilidad promedio (%) | `lookup_mm0cvyfc` | mirror |
| 🔒 | Margen Gob Total | `lookup_mm1w47fq` | mirror |
| 🔒 | Compras / Responsable compras | `multiple_person_mm03qyw9` / `multiple_person_mm1m73qp` | people |

(Buttons, automation dates, Event ID, checkboxes de origen: omitted from DTOs — untagged = invisible.)

## Oportunidades subitems (18395657607) — product lines

| Vis | Column | ID | Type |
|---|---|---|---|
| ✅ | Name | `name` | name |
| ✅ | Producto | `text_mm0bkm1j` | text |
| ✅ | Nombre del Producto | `lookup_mm0x4kda` | mirror |
| ✅ | SKU | `lookup_mkzn7x9a` (auto) / `text_mm0bxy39` | mirror/text |
| ✅ | Marca | `lookup_mm0xn98d` | mirror |
| ✅ | Color | `text_mm07s2mg` | text |
| ✅ | Tallas | `lookup_mm19c0b6` | mirror |
| ✅ | Cantidad | `numeric_mkzm6399` | numbers |
| ✅ | Unidad | `lookup_mm0w4f4v` | mirror |
| ✅ | Descripción Cotización | `lookup_mm0xw8p7` | mirror |
| ✅ | Embellecimiento (status) | `color_mm1b34bg` | status |
| ✅ | Descripción Embellecimientos | `long_text_mm1bj4pt` | long_text |
| ✅ | Comentarios Ventas | `long_text_mm1hyszv` | long_text |
| ✅ | **Precio de Venta C/U** | `numeric_mkzneg3d` | numbers — el precio que hoy no pueden ver |
| ✅ | Subtotal | `formula_mkznmjh6` | formula (`display_value`) |
| ✅ | IVA | `formula_mm0rtdqp` | formula |
| ✅ | Total Con IVA | `formula_mm00xy0n` | formula |
| ✅ | Etapa Costeo (línea) | `color_mm084gvf` | status — same ❓ as item-level; **recomiendo ✅** |
| ❓ | Moneda | `lookup_mm11t8gj` | mirror — es la moneda del **costo** proveedor. **Recomiendo 🔒** |
| 🔒 | Costo Distr. C/U | `numeric_mm0bph99` | numbers |
| 🔒 | Descuento Distr. % / Descuento (auto) / Descuento | `numeric_mkzn2q51` / `lookup_mm0bdwb5` / `formula_mkznqx51` | — |
| 🔒 | Costo Real C/U | `formula_mkzngnjm` | formula |
| 🔒 | Valor de Conversión / Costo Convertido | `numeric_mm0rvhgs` / `formula_mm0rqjv1` | — |
| 🔒 | Gastos % (+auto) | `numeric_mkzngs9x` / `lookup_mm0bbz02` | — |
| 🔒 | Costo Embellecimiento | `long_text_mm1b9bh8` | long_text |
| 🔒 | Costo Total Embellecimento C/U | `numeric_mm0gxvpa` | numbers |
| 🔒 | Costo Total Unitario / Costo Total | `formula_mkznpfgg` / `formula_mkznrm5a` | formula |
| 🔒 | Techo | `numeric_mkznpn83` | numbers |
| 🔒 | Precio de Venta (formula) | `numeric_mm2qzzbe` | numbers — precio sugerido interno |
| 🔒 | Margen Gob % / Total / MG | `numeric_mkznnm5s` / `formula_mkznsb7m` / `formula_mkznpp33` | — |
| 🔒 | Utilidad / Total / % / Diferencia | `formula_mkzne7gd` / `formula_mkznry25` / `formula_mkznpw5p` / `formula_mkzn28xk` | — |
| 🔒 | Historial de Precios | `lookup_mm1tjv9n` | mirror |

## Proyectos (18395657594) — module 1 shows status summary only

Authz key: Vendedor `multiple_person_mm0hrnqq`. Seller-visible (✅): Name, Folio
`pulse_id_mm1a12gy`, Estado Proyecto `project_status`, Estado de productos
`lookup_mm20g4n6`, Fecha Entrega `date_mm0m1vfv`, Link Tallas `link_mm1amwz8`,
Cotizaciones `file_mm0hwapr`, Institución `lookup_mm1dwn6`.
🔒: Estado Facturación/Pago (`color_mm0md4z8`/`color_mm0mcrjq`) ❓ — **recomiendo ✅ solo
Estado Pago** (al vendedor le sirve saber si su cliente ya pagó); OC files, firmas
internas, Método/Condiciones de pago → 🔒 salvo indicación.

## Subelementos de Proyectos (18395657609)

Seller-visible (✅): Producto, Color, Cantidad, Talla, Género, SKU, Estado del producto
`color_mm0hqf79`, Comentario de Estado, fechas de tracking (`date_mm20xdtm`,
`date_mm20t4kr`, etc.), zonas de embellecimiento (`long_text_mm1cqh8e` Espalda,
`long_text_mm1cyqts` Frente der., `long_text_mm1c59cg` Frente izq., `long_text_mm1c2eyf`
Manga der., `long_text_mm1cyq91` Manga izq., `long_text_mm1c6ya0` Etiq. fabricante,
`long_text_mm1cnbbr` Etiq. propiedad, `long_text_mm2077h1` Otros).
🔒: Costo Distr. C/U `numeric_mm1dj4fp`, Descuento, Moneda, Proveedor (+mirrors Razón
Social / Correo Proveedor) — el vendedor no necesita saber el proveedor. ❓ confirmar.

## Productos (18395657591) — catalog, no module-1 UI

🔒 always: Costo Distribuidor `numeric_mkzpx7eb`, Descuento Distribuidor
`numeric_mm0bgd2f`, Gastos envío/importación `numeric_mm0bnkch`, Historial precios
`long_text_mm1tcga0`, Proveedor + mirrors. Rest available to authenticated roles when a
module needs the catalog.

## Identity anchors

- Vendedor people columns hold `monday_user_id`s; `users(ids:…) {id name email}` resolves
  them (same pattern as `resolve_vendedor` in cmp-tallas) → seeds the `identity` table.
- Etapa (`deal_stage`) labels: 0 En Seguimiento · 1 Ganada · 2 Perdida · 3 En Negociación ·
  4 Nueva oportunidad · 5 Cancelada · 6 Cotización · 7 Costeo en validación ·
  8 Esperando OC · 9 Costeo Confirmado · 15 En costeo.
