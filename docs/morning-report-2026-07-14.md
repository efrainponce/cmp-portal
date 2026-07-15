# 🌅 Reporte de la madrugada — 2026-07-14

**El portal funciona.** Local y desplegado. Todo verificado end-to-end esta noche.

## Pruébalo ahora mismo

- **Local (con datos, como admin):** ya está corriendo → http://localhost:8787
  (si lo cerraste: `npm run build && npx wrangler dev --env-file=.dev.vars`)
- **Producción (cerrado con candado):** https://cmp-portal.efrainponce-cloudflare.workers.dev
  — la UI carga pero la API responde 401 a todo hasta que actives Cloudflare Access (a propósito, fail-closed).

## Qué se construyó (3 subagentes Sonnet en paralelo + integración)

Vistas: **Oportunidades** (lista → detalle con líneas y Precio de Venta, botón Actualizar,
campos editables) · **Post-venta** (= Proyectos + Subelementos, zonas de embellecimiento) ·
**Costeo** (líneas agrupadas por Etapa Costeo — columnas de costo solo admin/compras) ·
**Productos · Instituciones · Contactos** (catálogos con búsqueda).
No existe board "Post-venta" ni "Costeo" en Monday — esa fue mi interpretación.

Data layer (plan 1 + discusión del hash): D1 espejo con **8,574 items de 7 boards**,
webhooks activos en los 5 boards (poke → refetch, nunca confiamos en el payload),
reconciliación cron cada 6 h, refresh manual, y el **write path con outbox**:
UI → D1 optimista → mutación a Monday → eco del webhook → hash canónico → `confirmed`.
Probado en vivo: escritura confirmada en ~8 s; cambio externo en Monday visible en ~12 s.

Seguridad verificada con curl (todo pasó):
- Vendedor ve solo SUS oportunidades (53 de 565 en la prueba) — scoping en el servidor.
- Columnas de costo/utilidad **nunca salen del Worker** para vendedores (whitelist fail-closed).
- Item ajeno → **404** (no filtra existencia). Columna no-escribible → 403. Email desconocido → 403.
- Producción sin Access → 401 todo; el backdoor DEV_EMAIL se ignora en prod.

## Decisiones que tomé (revisables, una línea cada una)

1. **Writable whitelist (PROPUESTO)** — solo Vigencia, Tiempo de entrega, Comentarios
   cotización, para vendedor+admin (`shared/visibility.ts`). Lo demás read-only.
2. **Tags de visibilidad para los boards nuevos** (Proyectos/Subelementos/Productos/
   Instituciones/Contactos) — propuestos por mí, marcados en `visibility.ts`; costos y
   proveedor → solo admin/compras. **Revisa esto.**
3. `compras@mexicanadeproteccion.com` → rol `compras`; todos los demás usuarios → `vendedor`;
   tus 2 correos → `admin`; usuario de soporte Monday desactivado. Ajusta en la tabla `identity`.
4. Creé los webhooks en Monday (12+ ids) apuntando al Worker desplegado — parte del plan aprobado.
5. No hice commit (no lo pediste). **Sugerencia: `git add -A && git commit` hoy mismo.**

## Tus 4 pendientes para dejarlo en producción real

1. **Cloudflare Access** delante del Worker (Google OAuth): crea la app en el dash de
   Zero Trust, agrega policy para tu dominio de correo, **bypass para `/api/sync/webhook/*`**,
   y pon `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` en `wrangler.jsonc` vars + `npx wrangler deploy --env-file=.dev.vars`.
2. **Revisar/firmar** los tags PROPUESTOS en `shared/visibility.ts` (vis + writable).
3. **cmp-tallas:** PR de ~5 líneas para exigir `X-CMP-Secret` (sigue sin auth); luego pon
   `CMP_TALLAS_BASE` + `CMP_SECRET` como secrets para activar el botón de cotización.
4. **Commit** del repo.

## Notas técnicas

- Quirk: el `CLOUDFLARE_API_TOKEN` de `.env` secuestra a wrangler y no tiene permisos →
  **todo comando wrangler lleva `--env-file=.dev.vars`** (documentado en dev-contracts.md).
- `.env` tiene `MONDAY_API_KEY` duplicado (mismo valor). Secrets de prod ya subidos.
- D1: `cmp-portal` (babdcd7e…). Esquema en `worker/schema.sql`. Scripts: `hydrate.mjs`,
  `seed-identity.mjs`, `introspect-boards.mjs` (regenera column-meta y detecta drift), `create-webhooks.mjs`.
- La UI antigua de tabs mock (tallas/nuevos productos) se retiró — no tenía equivalente en la
  API real; el scaffold de diseño (tokens/components) se reutilizó completo.
