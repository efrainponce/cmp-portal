# Plan de performance

Efraín, 2026-09-30: "el tiempo me preocupa". Este documento es el plan vigente:
qué se midió, qué se hizo, qué sigue y qué ya se descartó con datos. Regla de
siempre: **medir antes y después** (`scripts/perf-real.mjs` en producción,
`scripts/perf-bench.mjs` / `perf-cls.mjs` en local).

## Línea base (producción, 23–30 sep 2026, `ux_event` kind `perf`)

Tiempo que la gente pasó ESPERANDO al servidor, por endpoint (respuestas 200):

| Endpoint | Peticiones/sem | Espera media | Nota |
|---|---|---|---|
| Lista de Oportunidades | 1,066 | 811 ms | el 304 tarda 214 ms: ~600 ms eran leer el board entero |
| `/api/home` (Inicio) | 47 (+442 con 304) | 1,879 ms (304: 1,577 ms) | la pantalla donde aterriza todo mundo |
| Detalle de oportunidad | 1,551 | 330 ms | bien |
| Notificaciones | 544 | 628 ms | el 304 tarda 235 ms |
| Generar cotización | 10 | 16.8 s | cmp-tallas (Eledo + DocuSeal) |
| Mandar a costeo | 5 | 16.5 s | cmp-tallas |
| Validar costeo | 36 | 4.5 s | |
| Comentarios (updates) | 138 | 1.2 s | lectura en vivo a Monday |

Piso de cualquier request: ~190–260 ms aunque la ruta no haga nada
(`/api/boards` no toca D1 y promedia 416 ms). Abrir un drawer: 230–400 ms (bien).

Dos correcciones a lo que decía el reporte:

- **"La primera lista tarda 2–6 s" estaba inflado.** La métrica contaba desde
  que cargó la página, y casi todos aterrizan en Inicio: incluía el rato que la
  persona pasaba ahí antes de dar clic. En recargas directas la mediana real es
  ~1.6 s. Corregida el 2026-09-30 (`directa` / `vista`).
- **CLS ~0.5 no es de la carga.** En local, con datos reales, la carga y el
  flujo de abrir oportunidades dan 0.002. La mitad de las sesiones reales pasa
  de 0.25 y casi todas con interacción: brinca algo que el laboratorio no
  ejercita. Se agregó `perf:brinco` para saber qué.

## Hecho el 2026-09-30

| Cambio | Antes → después (local, datos reales) | Esperado en producción |
|---|---|---|
| Poll incremental de la lista ya no lee el board entero (`listItemsDesde`) | 47 → 5 ms | 811 → ~250 ms en ~1,000 respuestas/sem; 8.5 MB menos leídos de D1 por respuesta |
| Inicio: una lectura del board (admin leía dos) y validación en lote | admin 151 → 70 ms | 1.6–1.9 s → ~0.5 s (estimado): de una consulta por oportunidad y por producto, en serie, a ~5 en total |
| `validacion-check`: productos en una consulta | — | un viaje a D1 por producto menos (688 llamadas/sem) |
| "/" ya no monta la lista de Oportunidades antes de saltar a Inicio | 1 lista completa de más → 0 | ~130 KB y ~800 ms de servidor menos por entrada |
| `/api/home` precargado desde `index.html` | — | Inicio ya no espera al bundle |
| ETag de la lista: las dos versiones en paralelo | — | un viaje a D1 menos en el request más frecuente |

Las respuestas son idénticas byte por byte (comparadas antes/después por rol)
y quedó anclado en `worker/lib/listaIncremental.test.ts`.

Medición nueva: `Server-Timing` en todo `/api/*` (`auth`, `total`),
`perf:brinco` (qué se mueve) y la métrica de lista corregida.

## Qué sigue (en este orden)

1. **Verificar en producción** (2–3 días de datos): `node scripts/perf-real.mjs
   --dias 3`. Metas: `/api/home` < 600 ms, lista 200 < 350 ms, `lista_p50`
   (directa) < 1.2 s.
2. **El piso por request — HECHO 2026-09-30 (tarde).** Medido en producción
   con `Server-Timing` (desde DFW): identidad+zona costaba 40–63 ms, dos viajes
   en serie a una D1 que vive en **WNAM** (EE.UU. oeste), ~20 ms por viaje, y
   cada ruta suma los suyos. Efraín eligió, de tres opciones, la que no toca
   permisos:
   - identidad + zona + zona privada en UN batch (`identidadConZona`,
     anclado en `worker/lib/zonas.identidad.test.ts`: mismo viewer exacto);
   - **Smart Placement** (`wrangler.jsonc`): el worker corre junto a la D1, así
     cada consulta cuesta ~1-5 ms; la persona paga un solo salto más largo.
   - Descartada: recordar identidad 30 s en memoria (un cambio de permisos
     tardaría hasta 30 s en aplicar).
   Verificar: header `cf-placement` (`remote-…` = ya se movió) y `auth`/`total`
   de `Server-Timing` contra la línea base de arriba.
3. **Carga en frío de la lista** (hoy lee 8.5 MB para mandar 45 KB). Camino:
   tabla chica con solo las columnas de la lista, mantenida al leer. Baja la
   primera lista ~400 ms.
4. **Botones lentos** (cotización 17 s, mandar a costeo 16.5 s, validar 4.5 s).
   Primero cronometrar cada paso (cmp-tallas vs relectura vs PDFs del portal);
   candidato: generar los PDFs de acuse en segundo plano.
5. **Brincos de pantalla**: con una semana de `perf:brinco`, reproducir el
   peor y arreglarlo.
6. Menores: admin baja la lista dos veces al cargar (la segunda con las
   columnas de fechas); notificaciones 200 en 628 ms; comentarios 1.2 s.

## Filas leídas de D1 — HECHO 2026-09-30 (noche)

`wrangler d1 info cmp-portal`: 90.6 M filas leídas en 24 h. En el plan de pago
eso cabe de sobra en lo incluido (~2,700 M/mes); el problema era de tiempo:
D1 atiende una consulta a la vez y los recorridos grandes hacen esperar a
todos. De dónde salían (`wrangler d1 insights cmp-portal --sort-by reads`):

| Qué | Filas/día | Arreglo |
|---|---|---|
| Revisión de salud de SKU | 22.3 M (21%) | cada 3 h en el cron, no cada hora (`SKU_CADA_HORAS`) |
| Alertas + limpieza de `sync_log` cada 15 min | 23.0 M (23%) | índices por fecha; el conteo ya ni corre con las alertas apagadas; la limpieza pasó a la noche |
| Respaldo diario a R2 | 12.6 M (12%) | página por `rowid` en vez de OFFSET |
| Líneas de un padre, línea por id, pendientes del outbox | 15.0 M (14%) | índices `idx_items_board_parent`, `idx_items_item`, `idx_outbox_board_status` |

Medido en producción al crear los índices: líneas de un padre 4,547 → 3
filas; línea por id 13,466 → 2; errores recientes 93,222 → 13. El respaldo y
las limpiezas corren a las 3 am de México (`BACKUP_CRON = '0 9 * * *'`).

Queda (~25 M/día): la versión de las listas (`COUNT`/`MAX(synced_at)` por
board), los totales y la búsqueda con `json_each`. El paso 4 del plan es el
que más los baja. Verificar mañana: `wrangler d1 info cmp-portal`.

## Plan Core Web Vitals — 2026-10-08 (Mérida)

Efraín: "quiero que la app sea más rápida todavía", con foco en Mérida
(internet muy lento). Medición nueva desde hoy: la CASCADA completa de cada
carga real (`scripts/perf-cascada.mjs`) y vitals sin ruido de pestaña oculta
ni de `confirm()` — **los números de antes del 2026-10-08 no son comparables**.

Línea base (p75 por persona, 1–8 oct, `perf-real.mjs --dias 7`): LCP 1.0–4.8 s
(más dos de 10.7 y 29.6 s que eran pestañas en segundo plano), INP 64–656 ms,
CLS 0.002–0.51. Metas: LCP < 2.5 s, INP < 200 ms, CLS < 0.1.

Laboratorio contra producción (`prod-waterfall.mjs`, admin):

| Red | Ruta | FCP | LCP | Qué se ve |
|---|---|---|---|---|
| 1.5 Mbps / 300 ms, sin caché | /oportunidades | 1.4 s | 4.2 s | la lista se pide DOS veces |
| 1.5 Mbps / 300 ms, con caché | /oportunidades | 0.4 s | 3.4 s | las dos bajan completas: 131 + 156 KB |
| 0.7 Mbps / 400 ms, sin caché | /costeo | 2.9 s | 6.4 s | la lista real sale hasta 3.8 s |

Hallazgos:

1. **La precarga de la lista no le sirve a admin.** `index.html` precarga las
   8 columnas base; la vista extendida de admin agrega las fechas en cuanto
   llega `/api/me`, la URL no coincide y la lista se baja otra vez, después
   del bundle y de los chunks de la ruta. Admin son Efraín, el CEO, PAM y
   webcmp: justo los LCP más altos.
2. **La lista no sobrevive a una recarga**: 156 KB (zstd) en CADA carga, aunque
   no haya cambiado nada. En 0.7 Mbps son ~2.2 s solo de bajada.
3. **Dos rondas de JS antes de pedir datos**: `index.js` (86 KB gz) y luego ~15
   chunks chiquitos de la ruta (StageBoardList, GroupCard, Button…), que el
   navegador descubre hasta que corre `index.js`. A 400 ms de RTT es una vuelta
   de ~0.9 s.
4. **Cada deploy tira la caché del JS**: 42 deploys en 2 semanas, y React viaja
   dentro de `index.js`, así que cada deploy obliga a bajar los 86 KB otra vez
   (cache_js 38–76% por persona).
5. **Clarity (25 KB) compite con `index.js`** en el primer segundo.
6. **El chunk del drawer pesa 65 KB gz** (`EditableItemName-*.js`): trae TODAS
   las secciones de Proyecto (Órdenes, Ejecución, Logística, Tallas, CrearOc)
   aunque se abra una oportunidad.
7. **CLS**: los brincos grandes son del drawer, no de la carga
   (`oportunidades +drawer y≈300` ×25, 219 px que suben 319 px ~1.2 s tras el
   clic; validación ~5 s tras el clic).
8. **INP sin atribución**: sabemos el número (PAM 656 ms, CEO 392 ms), no qué
   interacción.

### Pasos (en este orden; medir cada uno con `perf-real.mjs --dias 3` y `perf-cascada.mjs --tipica --lentas`)

| # | Cambio | Esperado | Esfuerzo |
|---|---|---|---|
| 1 | Precargar la URL EXACTA que pidió la última lista de ese board (guardada en localStorage al pedirla), no una fija | admin en Mérida LCP 6.4 → ~3.5 s; −130 KB por carga | ~1 h |
| 2 | La lista se guarda en el navegador (IndexedDB, por correo) con su ETag: pinta al instante y revalida con 304 | LCP en cargas repetidas ≈ FCP; −156 KB por carga. **Decisión de Efraín**: los datos de la lista quedan en la máquina (se borran al cambiar de usuario) | ~3–4 h |
| 3 | `modulepreload` de los chunks de la ruta de aterrizaje desde `index.html` + React en un chunk aparte que no cambia entre deploys | −1 vuelta (~0.9 s en Mérida); deploys ya no tiran 45 KB de React | ~2 h |
| 4 | Clarity después del `load` (en idle) | FCP −0.3 s a 0.7 Mbps. **Decisión de Efraín**: la grabación arranca unos segundos tarde | 15 min |
| 5 | Separar las secciones de Proyecto del drawer de Oportunidades | drawer de oportunidad ~65 → ~30 KB gz | ~2 h |
| 6 | INP con atribución: la peor interacción con etiqueta, ruta y fases (espera/proceso/pintado) + el script culpable (LoAF) | saber qué arreglar | ~1 h |
| 7 | Reproducir y arreglar los brincos del drawer (`perf-cls.mjs`, reservar alto) | CLS < 0.1 | ~2–3 h |

Antes del paso 1: dejar 2–3 días de cascadas reales de Compras para confirmar
que en Mérida pasa lo mismo que en el laboratorio.

## Medido y descartado (no volver a proponer sin datos nuevos)

- **Proyectar columnas en SQL con `json_each`** para la lista: baja el peso
  (10.4 → 1.4 MB) pero D1 cuenta 68,818 filas leídas por consulta contra 1,891
  — con ~150 listas al día se comería la cuota de filas leídas del plan.
- **Virtualizar las listas**: 60 fps con todos los renglones (2026-08-13).
- **CLS de la carga**: ≤ 0.003 en las 4 rutas y 3 roles con datos reales.

## Cómo medir en local con datos reales

`wrangler dev` contra una copia de la D1 local del repo principal
(`.wrangler/state`), con un `--env-file` sin las llaves de Monday, WhatsApp ni
cmp-tallas (así nada sale de la máquina), identidad por `X-Dev-Email`. En local
D1 contesta en ~1 ms, así que lo que ahorra VIAJES a D1 casi no se nota: ahí
cuenta el número de consultas y manda la medición de producción.
