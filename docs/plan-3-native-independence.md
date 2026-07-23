# Plan 3 — Native independence layer (capa nativa, dormida)

Status: **en construcción 2026-07-22** (rama `optimizacion/tokens-y-writes`). Retoma el
"Goal 3 — salir de Monday" que Efraín pospuso el 2026-07-21 (ver memoria
`optimizacion-2026-07-21`). Parte de `docs/plan-1-data-layer.md` (el mirror D1 ya existe).

## Objetivo

Poder **operar sin Monday** el día que Efraín lo decida, sin reescribir la app. Se
construye un **modelo de datos nativo** (semántico, con nombres de campo propios, no los
blobs opacos de Monday) y una **API paralela** que replica las interacciones de Monday
(listar / detalle / crear / editar / comentar / relacionar), **dormida tras un flag**.

## Regla dura (lo que Efraín pidió en mayúsculas)

**NO se toca el comportamiento actual.** Todo sigue sincronizado con Monday exactamente
como hoy:

- Lecturas siguen saliendo del mirror `items` vía `worker/lib/dal.ts`.
- Escrituras siguen yendo por `worker/lib/outbox.ts` → Monday → echo.
- Sync (webhook/reconcile) y automations (cmp-tallas) intactos.
- Monday sigue siendo el **sistema de registro** (source of truth).

La capa nativa es **puramente aditiva** y **inerte por defecto**. Se enciende con la env
var `NATIVE_SHADOW=1`. Con el flag apagado (estado de producción hoy):

- `upsertItem` solo evalúa un `if (env.NATIVE_SHADOW)` extra y sigue de largo.
- El router `/api/native/*` responde 404 (como si no existiera).
- Cero tablas nativas se tocan, cero latencia extra, cero writes extra.

## Arquitectura

```
                 (HOY, sin cambios)
 Monday  ──webhook/reconcile──▶  mirror `items` (D1)  ──dal──▶  app
   ▲                                   │
   │ outbox                            │ projectToNative()  ← SOLO si NATIVE_SHADOW=1
   └── app writes                      ▼
                              native `records` (D1)  ──repo──▶  /api/native/*  (dormido)
```

- **Shadow projection**: cada vez que un item de Monday se upserta al mirror, si el flag
  está encendido se **proyecta** también al modelo nativo (`records` + relaciones +
  actividad). Best-effort, traga errores, nunca rompe el sync — mismo patrón que
  `maybeEmitStageChange` (`worker/lib/notify.ts`). Así el modelo nativo se mantiene
  caliente en paralelo, listo para el corte.
- **Puente de identidad**: el `id` nativo de una fila proyectada **es** su `monday_item_id`
  (1:1). No hay tabla de mapeo, y los deep-links (`/boardKey/itemId`) siguen válidos tras
  el corte. Las filas nacidas nativas (camino de creación dormido) reciben id de un
  contador propio en rango alto para no colisionar con ids de Monday.
- **Fidelidad total**: la proyección guarda los campos mapeados por su **nombre nativo** y
  además cualquier columna no mapeada bajo `x_<colId>`, así no se pierde nada para el corte.

## Modelo nativo (D1) — `worker/schema-native.sql`

- `records` — una fila por registro de negocio. Columnas calientes indexadas
  (`entity`, `parent_id`, `stage`, `folio`, `amount`, `owner_ids`) + `fields` JSON con
  todos los campos semánticos. `source` = `monday` (proyectado) | `native` (nació aquí).
- `record_relations` — enlaces explícitos (opp↔contacto, línea↔producto, proyecto↔opp,
  contacto↔institución). Reemplaza a los `board_relation`/`mirror` de Monday.
- `record_activity` — log append-only: creación, cambios de campo, cambios de etapa,
  comentarios. Equivalente nativo de los `updates` + `activity_logs` de Monday.
- `record_files` — refs a archivos en R2 (equivalente nativo de las columnas file).
- `native_counters` — asignación de ids nativos para registros nacidos nativos.

El contrato entidad↔campo vive en `shared/native.ts` (mapa columna-Monday → campo-nativo,
tipos, columnas calientes, relaciones). Único productor de la forma nativa.

## API paralela (dormida) — `worker/routes/native.ts`

Replica las interacciones de Monday sobre las tablas nativas, **reusando el mismo scoping
por viewer y la misma whitelist de visibilidad** (no es un bypass de seguridad):

| Método | Ruta | Equivale a |
|---|---|---|
| GET | `/api/native/:entity` | listar items (con búsqueda) |
| GET | `/api/native/:entity/:id` | detalle + hijos |
| POST | `/api/native/:entity` | crear item |
| PATCH | `/api/native/:entity/:id` | editar columnas |
| GET | `/api/native/:entity/:id/activity` | feed de actividad/updates |
| POST | `/api/native/:entity/:id/activity` | comentar |
| POST | `/api/native/admin/backfill` | proyectar todo el mirror → nativo (admin) |
| GET | `/api/native/admin/status` | conteos nativo vs mirror (admin) |

Todo el router 404ea salvo `NATIVE_SHADOW=1`. Ningún componente del frontend lo llama —
es el "sistema paralelo sin usar" que pidió Efraín.

## Camino al corte (cuando Efraín decida, fuera de este plan)

1. Encender `NATIVE_SHADOW=1` → el modelo nativo empieza a hidratarse en cada sync.
2. `POST /api/native/admin/backfill` → llenar el histórico.
3. Verificar paridad con `/api/native/admin/status` + spot-checks de la API paralela.
4. (Futuro) Dual-write: el outbox escribe a Monday **y** a `records`.
5. (Futuro) Flip del DAL/apiClient para leer nativo; el outbox deja de llamar Monday.
6. (Futuro) Reemplazar las automations cmp-tallas por cálculo nativo (`costeoCalc.ts` ya
   replica las fórmulas 1:1 para el preview — es la semilla del motor nativo).

Los pasos 4–6 son decisiones de Efraín y NO se construyen aquí. Este plan entrega 1–3:
el modelo nativo + la proyección + la API paralela, todo dormido.

## Qué NO hace este plan

- No cambia una sola ruta, lectura o escritura existente.
- No crea dependencias nuevas del frontend.
- No decide el corte ni el dual-write (son de Efraín).
- No re-implementa las automations (solo deja la puerta lista).
