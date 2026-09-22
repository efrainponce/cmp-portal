# Plan de salida de Monday (oct 2026 → ene 2027)

Auditoría del 2026-09-21. Tres fuentes: el código (dependencias de Monday y
paridad por rol), D1 de producción (`node scripts/adopcion.mjs`,
`node scripts/salud.mjs --horas 168`) y el calendario de Efraín (capacitación
14 sep–9 oct, olas 12 oct–4 dic, estabilización 7 dic–2 ene, go live 5 ene,
decisión de Monday 8–19 feb).

**Dos salidas distintas, no mezclarlas:**

- **Salida A — la gente deja de entrar a Monday.** Monday sigue siendo el
  backend (mirror, outbox, cmp-tallas, Make). Es lo de octubre–enero.
- **Salida B — Monday deja de existir como backend.** Es la "decisión de
  Monday" de febrero. No hace falta para el go live del 5 de enero.

## Veredicto

| | ¿Listos? | Por qué |
|---|---|---|
| A · técnica | **Casi** — 6 huecos, ~3 semanas de trabajo | Los 8 boards tienen UI; de las 25 columnas que más se editan en Monday, 19 ya se escriben desde el portal y las otras 6 son de catálogo (hueco 2) o las llena una automatización |
| A · adopción | **No** | ~98% de las ediciones humanas siguen ocurriendo en Monday |
| B · backend | **No** (y no urge) | Los 5 flags `*_NATIVE` están apagados en prod, la capa `native/salir-de-monday` no está en main |

El problema de octubre no es de código: es de hábito.

## Los números (últimos 30 días, producción)

Ediciones de columna atribuidas (sin contar a Efraín, cuyo renglón mezcla lo que
escribe el token de servicio): **~7,200 en Monday vs ~125 en el portal.**

| Persona | Rol | Días activos en portal | Ediciones portal | Ediciones en Monday |
|---|---|---|---|---|
| Elizabeth | compras | 11 | 51 | 2,344 |
| Emily | compras | **1** | 0 | 1,241 |
| Liliana | compras | 19 | 73 | 897 |
| Josué | compras | 7 | 0 | 890 |
| Pamela | admin | 14 | 0 | 522 |
| Ricardo | vendedor | 17 | (378 writes) | 1 |
| Los otros 11 vendedores | vendedor | 0–5 | 0 | 23–226 c/u |

- **12 de 14 vendedores no usan el portal**, y el calendario no tiene ola para
  ellos (las 4 olas son de compras). → Pregunta abierta 1.
- Lo que más se edita en Monday: líneas de oportunidad (8,136), líneas de
  proyecto (1,855), productos (1,583), oportunidades (687). Todo eso ya es
  editable en el portal, salvo Productos.
- WhatsApp: **31 de 49 avisos fallaron** en 7 días (131049 = Meta frena el
  template; 131026 = el número de cotizaciones4 no recibe). Cuando se apague
  Monday, sus notificaciones se van con él: el portal queda como único canal.
- Outbox: 19 conflictos de 225 (8%) — vienen de editar lo mismo en los dos
  lados; bajan solos conforme la gente salga de Monday.
- 20 hallazgos abiertos "tallas no cuadran": limpiar antes de que compras
  pierda Monday, o no sabrán si el error es suyo o heredado.

## Huecos técnicos de la Salida A — estado al 2026-09-21

| # | Hueco | Estado |
|---|---|---|
| 1 | **Proveedores** solo lectura, 5 de 13 columnas | **Hecho**: alta, edición de todos los datos y subida/lectura de Constancia, Cuenta de Banco y Actas (compras/admin). Falta: borrar un archivo |
| 2 | **Productos** sin alta | **No es hueco** (Efraín: Airtable es y seguirá siendo el catálogo). Lo que sí: dejar de editar el board de Productos en Monday — 1,583 ediciones/mes, casi todas de una persona; lo que no sea Tallas/Proveedor/confirmación se captura en Airtable |
| 3 | **Logística en líneas de Proyecto** | **Hecho**: Almacén 5.11, Fecha de Llegada, Fecha Entrega Cliente y Flete Extra Final en el tab Logística (compras/admin) |
| 4 | **Carpeta Drive en la Oportunidad** | **Hecho**: merge de `feat/drive-proyectos` — Documentación lista carpeta, subcarpetas y archivos de Drive |
| 5 | **Tallas fuera de Google Sheets** | **A medias** — ver abajo |
| 6 | **Exportar a Excel** | **Hecho**: botón en catálogos, etapas de Oportunidades, Proyectos y Lista de OC; exporta lo filtrado y solo lo que el rol ya ve |

### Hueco 5 — tallas sin Sheet

El Sheet lo llenan SOLO los vendedores (Efraín, 2026-09-21: el cliente nunca lo
toca; existía porque en Monday no se podía capturar nativo). Todos tienen cuenta
en el portal, así que no hace falta ni plantilla ni formulario público: basta la
captura del portal. Lo único que todavía exige el Sheet es `confirm_tallas` de
cmp-tallas (pide "TODO CUADRA" en el archivo).

- **Hecho**: pegar desde Excel en los boxes (fila de cantidades, encabezado +
  cantidades, o talla | cantidad), borrador que sobrevive a cerrar el drawer, y
  **el corte queda en un solo switch**: con `TALLAS_NATIVE=1` el tab Tallas
  esconde "Crear/Regenerar archivo" y "Traer del archivo", "Validar tallas" deja
  de pedir el Sheet y confirma contra D1 con el PDF propio (`/api/me` →
  `tallasSinSheet`). Apagado = todo igual que hoy.
- **Falta:**
  1. Probar `TALLAS_NATIVE=1` con un proyecto real y dejarlo prendido (Efraín).
  2. Editar talla y borrar una línea equivocada desde el tab Tallas (hoy el 🗑
     vive en Órdenes); embellecimiento por zona desde el portal (hoy solo entra
     por el Sheet).

No bloquean, pero se van a pedir: búsqueda global entre boards, edición masiva,
vistas compartidas, ayuda dentro del portal (hoy no hay ninguna).

## Cómo quitar el acceso sin romper nada

**No desactivar usuarios en Monday: bajarlos a Viewer.** El portal asigna
personas por `monday_user_id` (columnas Vendedor/Compras, scoping de `dal.ts`,
roster). Un usuario desactivado puede dejar de ser asignable y las altas del
portal fallarían. Viewer = no edita, sigue existiendo y se puede seguir
asignando en columnas de personas. El backend no se entera: el portal escribe
TODO con un solo token de servicio (el de Efraín), nunca con el usuario de cada
quien — por eso en Monday todo sale firmado por Efraín y la autoría real vive en
el portal (`outbox.author_email`, `accion_log`, `activity_log.actor_email`). **Probarlo con UN usuario
de prueba antes de la Ola 1** (crear oportunidad a su nombre, mención, aviso).
El asiento se libera hasta febrero, con la Salida B.

Cada ola, mismo protocolo (2 semanas):

1. Día 1 — sesión 1:1 con la persona + sus vendedores; se corre
   `node scripts/adopcion.mjs` como línea base.
2. Días 1–5 — trabaja en el portal con Monday todavía abierto. Todo lo que la
   mande de regreso a Monday se anota y se arregla esa semana.
3. Día 5 — semáforo: **≥90% de sus ediciones en portal y 0 huecos abiertos de
   su rol** → se baja a Viewer. Si no, una semana más; no se fuerza.
4. Días 6–10 — sin Monday. Office hours del viernes para lo que salga.
5. Reversa: subirla de Viewer a Member toma 1 minuto. No hay nada que migrar.

## Calendario

| Fecha | Qué | Hecho cuando |
|---|---|---|
| 22 sep – 9 oct | Desplegar huecos 1, 3, 4, 6 (hechos el 21 sep) y cerrar el 5; arreglar WhatsApp (template + teléfono de cotizaciones4); limpiar los 20 hallazgos de tallas; probar Viewer con usuario de prueba; decidir hueco 2 y la pregunta 1 | `salud.mjs` sin hallazgos heredados; WhatsApp >90% entregado |
| 12–23 oct | Ola 1 · Josué | ≥90% portal, Viewer |
| 26 oct – 6 nov | Ola 2 · Elizabeth | ídem |
| 9–20 nov | Ola 3 · Emily (la de mayor riesgo: 1 día en portal en un mes — empezar a sentarla ya, en capacitación) | ídem |
| 23 nov – 4 dic | Ola 4 · Liliana | ídem |
| 7 dic – 2 ene | Estabilización: Pamela/Elisa a Viewer; nadie edita en Monday salvo Efraín; se apagan automatizaciones de Monday que ya replica el portal (assign-creator de Contactos) | `adopcion.mjs`: 0 personas en Monday dos semanas seguidas |
| 5 ene | Go live | — |
| 5 ene – 6 feb | Colchón + preparar Salida B (abajo) | — |
| 8–19 feb | Decisión de Monday | — |

Sugerencia: **Liliana primero, no al final.** Es la que más usa el portal (19
días, 73 ediciones): ola corta, casi sin riesgo, y deja una persona de compras
que ya vive sin Monday para ayudar a las otras tres. Josué de primero arranca
con 0 ediciones en portal.

## Salida B (backend) — qué falta para poder decidir en febrero

Zona Efrain ya demuestra que todos los flujos corren en D1+R2 sin Monday
(crear, líneas, costeo, cotización, tallas, OC, archivos, comentarios, ganar,
borrar). Es migración, no re-arquitectura. En orden:

1. Prender los flags en paralelo, uno por uno, con oportunidad real de prueba:
   `COSTEO_NATIVE` → `COTIZACION_NATIVE` → `TALLAS_NATIVE` → `OC_NATIVE` →
   `DRIVE_NATIVE` (apagar Make 100 antes). Ideal: nov–dic, mientras corren las olas.
2. Folio propio (hoy es el auto-número de Monday; un item nativo no tiene folio).
3. Backfill a R2 de los archivos que solo viven en Monday (los que sube
   cmp-tallas: `OPP_FILE_COLS`/`PROYECTO_FILE_COLS`).
4. Comentarios: hoy se leen en vivo de Monday, D1 solo guarda el "visto". Copiarlos.
5. Roster: pasar de `fetchUsers` de Monday a `identity`.
6. Congelar espejos/fórmulas de los items reales (los nativos ya se calculan local).
7. Catálogo Airtable↔portal sin pasar por Monday (Fase 6, sin empezar).
8. Decidir entre "todo item nace nativo" (camino Zona Efrain, ya en prod) y la
   capa `native/salir-de-monday` (modelo semántico, dormida desde julio, fuera
   de main). Recomendación: el camino Zona Efrain — es el que está probado en prod.

Estimado: 6–8 semanas de trabajo. Si se quiere no renovar en febrero, los puntos
1–3 tienen que arrancar en noviembre.

## Preguntas abiertas para Efraín

Resueltas el 2026-09-21: los vendedores entran en la ola de su persona de
compras; Airtable sigue siendo el catálogo; las 4 columnas de logística se
exponen; "100% aquí" sí incluye sacar las tallas de Google Sheets.

Siguen abiertas:

1. ¿Cuándo se prueba `TALLAS_NATIVE=1` y con qué proyecto?
