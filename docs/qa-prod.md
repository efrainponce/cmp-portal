# QA en producción

Cómo se prueba el portal **en producción**, con datos y gente reales. Este
documento manda; `scripts/qa-prod.mjs` es su ejecución automatizada.

Existe porque durante meses "probado" quiso decir *el endpoint contestó 200*.
Con ese criterio pasaron cosas que un usuario sí notó al primer intento: en la
Zona Efrain se podía crear una oportunidad pero **no costearla ni ponerle
precio**, y nadie se enteró hasta que Efraín lo intentó a mano (2026-08-18).

---

## 1. Las reglas

### R1 — Un 200 no prueba nada. Se relee.

Toda escritura se vuelve a **leer del servidor** y se compara contra el valor
esperado. Un endpoint que contesta `{ok:true}` y no guarda nada es el bug más
caro y el más fácil de no ver.

```js
ok(await q.api('PATCH', ruta, { cols: { [COL]: '442.04' } }), 'escribir precio');
const l = await q.item('oportunidades_sub', id);       // ← esto es la prueba
casi(numReq(l, COL, 'precio'), 442.04, 'Precio de Venta C/U');
```

### R2 — Los números se comparan contra la fórmula, no contra sí mismos.

El QA **reescribe** la fórmula desde `docs/monday-column-map.md`, no importa
`worker/lib/costeoSnapshot.ts`. Importarlo probaría que el código es igual a sí
mismo; reescribirla es lo único que hace ruido cuando alguien la cambia.

```
precio sugerido = (1 + gastos%) · costo · (1 − desc%) · TC · 1.3
costo total unitario = (1 + gastos%) · (costo − desc% · costo) · TC + embellecimiento
```

### R3 — Hay que probar lo que pasa cuando algo **se mueve**.

Crear y llenar una vez no prueba casi nada: los bugs viven en el segundo
cambio. Por cada campo que la gente edita de verdad:

- cambiar de producto → el costeo se re-estampa con el catálogo NUEVO
- cambiar a un producto **sin costo** → el snapshot se **limpia** (dejar el del
  producto anterior es peor que no tener ninguno)
- volver al producto original → el costeo original vuelve
- cambiar el precio **otra vez** → se guarda (no se atora en el eco)
- **borrar** el precio → queda vacío, no con el valor viejo
- cambiar la cantidad → mueve el total y **no** toca el costo unitario

### R4 — Un candado solo cuenta si el **servidor** lo aplica.

Un botón deshabilitado no es un permiso. Cada regla de rol se prueba pegándole
al endpoint como esa persona, con `X-Impersonate-Email` (`worker/mw/identity.ts`),
y se verifica que el rechazo sea real: status ≥ 400 **y** el dato sin cambiar.

### R5 — Los PDFs se **parsean**, no se pesan.

"Devolvió 200 y pesa 40 KB" es compatible con un PDF vacío, con los productos
de otra oportunidad o con todos los importes en `$0` — que es exactamente lo
que estaba pasando. Se extrae el texto con `pdfjs-dist` y se afirma sobre el
contenido: los productos, las cantidades, el proveedor por NOMBRE, el total
calculado aparte. Y también lo que **no** debe salir: la solicitud de costeo no
lleva precios de venta.

### R6 — La procedencia del dato se audita punta a punta.

Los precios nacen en **Airtable**, un sync externo los copia a **Monday**, la
línea los hereda por **espejo** y el **snapshot** los congela. Nadie estaba
comparando las puntas. La auditoría cruza los 1300+ productos reales campo por
campo y separa dos cosas:

- **deriva** — Airtable dice A y el portal dice B: el sync no corrió.
- **trampa** — el dato es incoherente aunque las dos puntas coincidan. La
  grande: Descuento y Gastos son **fracciones** (`0.18` = 18%); un `18`
  capturado como `18` pasa el sync tal cual y costea con 1800%.

### R7 — Nunca actuar sobre una lista que no se contó.

Todo filtro se aplica **localmente** y se verifica cuántos elementos son
propios (`hijosDe()`). El 2026-08-18 un script pidió una lista con `?parent=`
—un filtro que la ruta no conoce—, recibió el board completo y borró 70 líneas
de 22 oportunidades en 4½ minutos. En Monday no hay deshacer masivo. Por eso
las rutas ahora contestan **400** a un parámetro desconocido, y eso también se
prueba.

### R8 — Un paso que no se pudo correr es una **falla**, no un "saltado".

Solo se marca `omitido` lo que se decidió deliberadamente no cubrir, con el
motivo escrito, y sale listado aparte en el reporte. Ejemplo real: *"el portal
no borra en Monday"* no se prueba en vivo porque exigiría un `DELETE` contra un
item real — queda anclado en `worker/lib/monday.destructivo.test.ts`, que corre
en CI antes de cada deploy.

### R9 — Lo que la corrida escriba debe poder borrarse, y decirse.

Todo lo que el QA crea lleva el prefijo `QA PROD` y vive en la Zona Efrain
(items **nativos**, ids ≥ 900 000 000 000: existen solo en D1, Monday no se
toca). `node scripts/qa-prod.mjs --limpiar` lo borra. Lo que **no** se puede
deshacer se dice en voz alta: cada corrida completa consume folios globales de
OC y el contador no se puede regresar.

---

## 2. El happy path, escrito

Lo que tiene que suceder cuando todo sale bien. Las etapas (`deal_stage`) son
las de `shared/dealStages.ts`.

### Paso 1 — Ventas levanta la oportunidad · etapa 4 «Nueva oportunidad»

El vendedor captura nombre, **contacto**, zona, origen y si es catálogo. Al
elegir el contacto el portal resuelve la **Institución** — sin ella "Mandar a
costeo" es imposible más adelante.

Agrega una línea por producto: elige el producto del catálogo, el **color**
(validado contra los colores del catálogo), la cantidad y, si aplica, marca
**«Con Embellecimiento»** y escribe las 8 zonas.

Al ligar el producto la línea hereda del catálogo el nombre, SKU, ficha
comercial, tallas, moneda, costo, descuento y gastos.

> **Debe verse:** el nombre de la línea cambia al del producto (las tallas se
> cruzan luego POR ESE NOMBRE), y la línea queda con su costeo base.

Cuando está completa, **«Mandar a costeo»** → etapa **15 «En costeo»** y el
portal genera y asienta solo el **PDF de solicitud de costeo**: los productos y
las cantidades, **sin precios**. Es una petición a Compras, no una cotización.

### Paso 2 — Compras costea · etapa 15 → 7

Compras captura el **Costo Distr. C/U** real de cada línea y la marca
**«Listo»**. Expande cada línea (chevron), revisa Descripción y Tallas y marca
en el catálogo **«Descripción y tallas confirmadas»** — la confirmación vive en
el producto, no en la línea, para no repetirla en cada cotización donde
aparezca ese SKU.

**«Mandar a Validación de costeo»** → etapa **7 «Costeo en validación»**. El
servidor lo rechaza con la lista de pendientes si falta alguna confirmación.

> Compras **ve** el Precio de Venta pero **no** puede escribirlo.

### Paso 3 — Dirección valida · etapa 7 → 9

Solo **admin**. Captura el **Precio de Venta C/U** —la única columna con
`w: ['admin']`— y **«Validar costeo»** → etapa **9 «Costeo Confirmado»**, que
genera la **hoja de validación** (esta sí con precios, costos y utilidad).

### Paso 4 — Ventas cotiza y gana · etapa 9 → 1

**«Generar cotización»** produce el PDF para el cliente (productos, cantidades,
precio unitario, subtotal, IVA 16%, total). Cuando llega la OC del cliente:
**«Ganar»** → etapa **1 «Ganada»** y nace el **Proyecto** ligado.

> El Proyecto nace **sin líneas**: los renglones se crean al capturar tallas.

### Paso 5 — Compras y Logística ejecutan

Capturan las **tallas** por producto/color (la suma de tallas debe cuadrar con
la cantidad de la línea), suben la **OC del cliente** y **confirman tallas** —
que genera el PDF de **relación de tallas**. Confirmar sin la OC del cliente se
rechaza.

**«Generar OC»** produce **una orden por proveedor**, con folio y monto. El PDF
sale a nombre de la **razón social** del proveedor y solo con las líneas de ese
proveedor.

Al final Logística captura # de recolección, # de guía del cliente y sube la
**guía de la empresa**.

### La Zona Efrain: el mismo camino sin ida y vuelta

La zona privada (`worker/lib/zonas.ts`) es una excepción deliberada: la **misma
persona** cotiza, costea y aprueba de un jalón. Por eso ahí, al elegir el
producto, la línea ya queda **costeada** con el catálogo, en vez de esperar el
"Mandar a costeo" que en un pipeline normal congela ese snapshot.

Los items de la zona son **nativos**: no existen en Monday. Todo lo que en un
item real llega por columna espejo (`lookup_*`) lo resuelve localmente
`worker/lib/nativeMirrors.ts`. **Si un flujo nuevo lee un `lookup_*`, hay que
agregarlo a ese mapa — el typecheck no puede avisar.**

Y es privada de verdad: ni vendedor, ni compras, **ni un admin fuera de la
whitelist** la leen. Eso se prueba en cada corrida, no se asume.

---

## 3. Cómo se corre

```bash
node scripts/prod-login.mjs        # una vez: login de Google, deja la sesión de Access
node scripts/qa-prod.mjs           # todo
node scripts/qa-prod.mjs --lectura # solo lo que no escribe nada
node scripts/qa-prod.mjs --catalogo | --ciclo | --blindaje
node scripts/qa-prod.mjs --limpiar # borra lo que dejaron las corridas
```

| Archivo | Qué prueba |
|---|---|
| `scripts/qa/lib.mjs` | Sesión de Access, suplantación de roles, aserciones, lectura de PDFs, reporte |
| `scripts/qa/catalogo.mjs` | **R6** — Airtable ↔ Monday, 1300+ productos, campo por campo (solo lectura) |
| `scripts/qa/ciclo.mjs` | **R1·R2·R3·R5** — el happy path completo del §2, con relectura y fórmulas |
| `scripts/qa/blindaje.mjs` | **R4·R7** — permisos por rol, zona privada, rechazos del write path |

El reporte separa **✓ pasó**, **✗ falla** y **○ no cubierto**. Sale con código
1 si hay una sola falla.

### Cuándo correrlo

- **`--lectura`**: cuando quieras, no toca nada. Bueno para vigilar el sync de
  Airtable.
- **completo**: antes de un cambio grande en costeo, cotización, PDFs,
  permisos o Zona Efrain. Después del deploy, no antes: prueba lo desplegado.

---

## 4. Lo que hoy NO cubre

Escrito para que nadie lo confunda con cobertura:

- **El camino real de Monday.** El ciclo corre en la Zona Efrain, donde escribe
  solo en D1. Probar el pipeline normal punta a punta escribiría en el Monday
  real y dispararía las automatizaciones de cmp-tallas. Lo que sí se prueba con
  datos reales de Monday: la auditoría del catálogo y todo el blindaje de roles.
- **El borrado en Monday**: `worker/lib/monday.destructivo.test.ts` (R8).
- **Firma electrónica**: los documentos se generan y se verifica su `sha256`,
  pero no se asienta ninguna firma.
- **WhatsApp y el asistente.**
- **Columnas que la API no expone a nadie** (`lookup_mm5ck4b3` Costo (auto),
  `lookup_mkznm0h3` Colores disponibles): no se pueden afirmar desde el cliente.
  Que llegaron bien se prueba indirecto — el costo, por el **snapshot**; los
  colores, porque `costeo-check` valida el color capturado contra ellos.

---

## 5. Hallazgos abiertos

Lo que la primera corrida completa encontró y **sigue sin arreglarse**. Un
check en rojo aquí es señal, no ruido: se deja fallando a propósito hasta que
se corrija.

1. **La hoja de validación sale con costos y subtotales en `$0` (Zona Efrain).**
   Una línea nativa no recibe columnas de fórmula —nadie las calcula, no existen
   en Monday— y la plantilla las imprime tal cual: `COSTO REAL $0`, `SUBTOTAL
   $0`, `UTILIDAD $0 0%`, aunque la línea sí tenga costo y precio capturados. El
   Precio de Venta sale bien. La cotización al cliente **no** tiene el problema
   porque calcula sus totales aparte.
2. **El write path acepta una etiqueta de status que no existe.**
   `PATCH color_mm084gvf: "Etiqueta Que No Existe QA"` devuelve **200** y la
   guarda como texto crudo (`value: "Etiqueta…"`) en vez de `{index}`. Es la
   misma forma del bug que hacía desaparecer al Proyecto nativo de los boards
   que filtran por índice, y en un item real de Monday una etiqueta desconocida
   hace que Monday asigne **otra al azar, en silencio**.
3. **Catálogo — 2 productos sin sincronizar desde Airtable**: `Pantalon Command`
   (costo 858.48, moneda USD, gastos 0.05 → todo vacío en el portal) y
   `OUISTITI` (moneda y gastos vacíos).
4. **Catálogo — 36 productos guardan un id de Airtable que ya no existe**
   (record borrado allá, id viejo aquí): la imagen del producto sale vacía en
   sus cotizaciones.
5. **Catálogo — 27 productos en EUR o GBP.** El costeo solo distingue USD
   (TC=18) del resto (TC=1), así que un producto en euros se costea como si su
   costo estuviera en pesos.
6. **El PDF de solicitud tarda >1 minuto en abrirse desde el drawer.** El
   documento queda asentado en D1 de inmediato (`/api/documents/:id/pdf` lo
   sirve al segundo), pero el botón del drawer lee el archivo de R2, que se
   sube en segundo plano después de responder "Mandar a costeo": en esa
   ventana el usuario da click y recibe 404. El check mide la demora en cada
   corrida.
