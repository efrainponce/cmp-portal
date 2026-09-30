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
2. **El piso de ~200 ms por request.** Cada request paga dos viajes a D1 en
   serie antes de su ruta (identidad, luego zona). `Server-Timing: auth` dirá
   cuánto es. Opciones: (a) juntar las dos consultas en un batch — sin cambio
   de comportamiento; (b) guardar identidad+zona 30 s en memoria del worker —
   más rápido, pero un cambio de permisos tardaría hasta 30 s en aplicar:
   **decisión de Efraín**.
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
