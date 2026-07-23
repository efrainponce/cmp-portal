# Plan 3 — Runbook de activación (capa nativa "salir de Monday")

Complemento operativo de [`plan-3-native-independence.md`](plan-3-native-independence.md)
(el diseño). Esto es **cómo prenderla**. Vive en la branch `native/salir-de-monday`.

## Estado actual (2026-07-23)

- **Construido y verificado, DORMIDO.** Commits `bbd1951` (fundación) + `e96b942`
  (campos de catálogos) sobre `b9d2039` (== `main` hoy). `tsc` + `oxlint` limpios; SQL de
  scoping/búsqueda e ids probado en D1 local.
- **Cero impacto en producción.** Sin el flag `NATIVE_SHADOW`, `upsertItem` solo evalúa un
  `if` y sigue; `/api/native/*` da 404. Nada nativo está en `main` ni desplegado.
- Piezas: `shared/native.ts`, `worker/schema-native.sql`, `worker/lib/native/*`,
  `worker/routes/native.ts`. Ver el índice en `docs/code-index.md`.

## Activar el shadow (cuando Efraín lo decida)

Ojo con el quirk de wrangler: el `CLOUDFLARE_API_TOKEN` de `.env` secuestra la auth y NO
tiene permisos de D1/deploy. Pásale `--env-file=.dev.vars` (o `--env-file=/dev/null` para
comandos que no necesiten secrets del worker, p.ej. un `d1 execute --remote`) para caer al
login OAuth. Ver memoria `cmp-portal-wrangler-quirk`.

1. **Aplicar el esquema nativo a D1 remoto** (idempotente, `IF NOT EXISTS` — no toca datos):
   ```
   npx wrangler d1 execute cmp-portal --remote --env-file=/dev/null --file=worker/schema-native.sql
   ```
   (En runtime también se auto-crea lazy vía `ensureNativeSchema`, pero aplicarlo explícito
   deja el estado claro y evita el primer costo por request.)

2. **Encender el flag** en el Worker de producción:
   ```
   npx wrangler secret put NATIVE_SHADOW --env-file=.dev.vars   # valor: 1
   ```
   Desde aquí, cada sync (webhook/reconcile) proyecta al modelo nativo. Best-effort: si algo
   falla se traga el error y se loguea a `sync_log` (kind `native`) — nunca rompe el sync.

3. **Backfill del histórico** (admin autenticado en el portal):
   ```
   POST /api/native/admin/backfill
   ```
   Recorre todo el mirror `items` y lo proyecta. Idempotente (upsert) — se puede re-correr.

4. **Verificar paridad**:
   ```
   GET /api/native/admin/status        → conteos nativo vs mirror por entidad
   GET /api/native/opportunity          → lista nativa (scoping por viewer aplicado)
   GET /api/native/opportunity/:id      → detalle + hijos + relaciones
   ```
   Deben cuadrar con lo que ve el board de Oportunidades hoy.

## Apagar / revertir

- `npx wrangler secret delete NATIVE_SHADOW` → la proyección se detiene y `/api/native/*`
  vuelve a 404. Las tablas nativas quedan (inertes); se pueden `DROP` si se quiere, pero no
  estorban.
- Nada de esto toca el mirror ni el camino de escritura a Monday, así que revertir es seguro.

## Lo que NO está hecho (decisiones de Efraín, fases futuras)

- **Dual-write**: que el outbox escriba a Monday **y** a `records`. Hoy el modelo nativo es
  solo lectura-proyectada; el camino de escritura nativo (`nativeCreate`/`nativePatch`)
  existe pero no está cableado al outbox.
- **Flip de lecturas**: que el DAL/`apiClient` lean nativo en vez del mirror.
- **Reemplazar automations cmp-tallas** por cálculo nativo (`src/lib/costeoCalc.ts` ya
  replica las fórmulas 1:1 — es la semilla del motor de costeo nativo).

No empezar ninguna de esas sin que Efraín lo pida: romperían la invariante actual
("todo sincronizado con Monday como hoy").
