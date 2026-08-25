# Log de commits

## 2026-08-25 (7)

- **Agregar imágenes a un producto para la OC** (Efraín: "puedes poder AGREGAR
  imágenes a un producto, así como las imágenes de embellecimientos o renders"
  … "y que salga en la OC con imágenes" … "es solo por proyecto, no es para
  todo"). En la tira de fotos del tab Órdenes de compra, cada producto estrena
  **"+ Imagen"**: se suben renders, la muestra aprobada o el detalle del
  bordado, y quedan como miniaturas con ✕ para quitarlas.
- **Viven en el PROYECTO, no en el SKU.** La foto del catálogo (Airtable) sigue
  siendo la principal y se hereda a todas las OC; estas no: el render del
  bordado de ESTE cliente no tiene por qué aparecer en la orden del siguiente.
- **En el PDF cada imagen se lleva su propia ficha de media hoja**, con la foto
  grande y el título "Producto — imagen 2 de 3" (Efraín eligió esto sobre una
  tira de miniaturas: para eso se sube un render, para que el proveedor lo VEA).
  Esas fichas no repiten tallas ni totales — el pedido ya va en la ficha de
  arriba y repetirlo se leería como el doble. La numeración cuenta solo las
  imágenes que el proveedor ve: sin foto de catálogo, dos extras son "1 de 2".
- Bytes en R2 y registro en D1, nada en Monday. Tope de 6 por producto (cada una
  es media hoja), 5 MB, y el tipo se decide por la FIRMA de los bytes — un
  .webp renombrado a .jpg saldría como hueco gris sin explicación. Quitar una
  puede hacerlo quien la subió o un admin.
- **Bug encontrado en la prueba y corregido antes de subir:** el key de R2 salía
  del sha de la imagen, así que la MISMA foto subida dos veces compartía objeto
  y borrar una dejaba a la otra sin bytes (miniatura rota, hueco en el PDF). El
  key ahora es único por fila, y el borrado además comprueba que ninguna otra
  fila referencie el objeto antes de tirarlo.
- Ajuste al motor de PDF: una ficha sin tallas ya no dibuja el encabezado
  "TALLA / CANT." vacío — se leía como un dato que se hubiera perdido.
- Probado end-to-end en local: permisos (vendedor 403), archivo que no es imagen,
  query param desconocido, tope de 6, borrado por autor y por admin, y la OC
  real generada y revisada página por página (5 hojas, las fichas extra con su
  foto grande). La OC sin imágenes sale idéntica a antes.

## 2026-08-25 (6)

- **"Cambiar producto…" con todas sus letras** (Efraín, viendo la tabla: "no se
  entiende el icono 🔁, pon editar o algo así"). El enlace va bajo el nombre del
  producto —donde está lo que cambia— y no en la columna de acciones: esa mide
  0.5fr para cuatro botones y no le cabe texto. La celda de arriba sigue
  sirviendo para corregir cómo se LEE el producto en el PDF; el enlace es para
  cambiar DE producto.

## 2026-08-25 (5)

- **"Cambiar producto" en la tabla de Órdenes de compra** (Efraín: "a veces
  necesitamos cambiar el PRODUCTO y el proveedor por falta de inventario, pero
  YA se subieron tallas y las tallas son correctas con el otro producto").
  Botón 🔁 por línea: se elige el producto nuevo del CATÁLOGO y el worker lo
  escribe —con su SKU y su proveedor— en todas las tallas de ese producto+color
  de un jalón. **Talla y cantidad no se tocan**: son datos del renglón, no del
  producto, y por eso el desglose (y con él logística, estado e historial de
  cada línea) sobrevive intacto al cambio.
- **La Oportunidad y su cotización NO cambian** — decisión de Efraín: el cliente
  cotizó lo que cotizó. Efecto conocido y aceptado: el badge "Cotizado" del tab
  Tallas cruza contra la Oportunidad por producto+color, así que para el
  producto cambiado deja de cruzar. Es la verdad, no un bug: ese producto no
  está cotizado.
- Por qué un modal a nivel GRUPO y no la celda inline que ya existía: el
  producto vive repetido en cada renglón de talla (8 tallas = 8 celdas) y un
  typo parte el grupo producto+color en dos — de ahí cuelgan las tarjetas del
  tab Tallas, la ficha de la OC con imágenes y el SKU con el que se resuelve la
  foto. Al venir del catálogo, el SKU se actualiza SIEMPRE (antes era de solo
  lectura y se quedaba el viejo, con la foto del producto anterior en la OC).
- **Marca visible** (Efraín, a media implementación: "agrega info que diga que
  se cambió el producto, así como le hacemos en cotizaciones"): chip "Producto
  cambiado" bajo el nombre de la línea, con el antes completo en el hover
  (producto, SKU, proveedor, quién y cuándo). Sale del respaldo real del cambio,
  no de una reconstrucción; si la línea se cambió dos veces, el "antes" que
  muestra es el original.
- Guardas del mismo linaje que `itemBorrado.ts`: las líneas NO vienen del
  cliente (el body describe el grupo y el worker lo resuelve contra los hijos
  reales del Proyecto), respaldo del "antes" en `linea_producto_cambio` ANTES de
  tocar Monday, topes por operación y por hora, y whitelist FIJA de columnas —
  talla, cantidad, estado y logística quedan fuera por construcción. Si la OC
  anterior ya salió (estado "OC Proveedor enviada", "En produccion"…) no
  bloquea: pide confirmación explícita diciendo cuántas líneas y en qué estado.
- Solo Compras/Admin. Cada línea escribe solo su delta real, para que el reloj
  de historial no se llene de "Moneda MXN → MXN". Probado end-to-end contra un
  proyecto de prueba nativo en local (permisos, 404s, confirmación, alcance
  grupo vs. una talla, quitar proveedor, espejos del proveedor en nativo) y por
  la UI: las 4 tallas se movieron a la tarjeta del proveedor nuevo con las
  cantidades intactas y su chip.

## 2026-08-25 (4)

- **La foto del catálogo ahora es el DEFAULT** (Efraín, viendo la tira de fotos
  en "Sin foto": "esto tiene que ser POR DEFECTO del catálogo"). Antes el tab
  solo leía lo guardado y había que pedir la foto con el botón "Del catálogo";
  se hizo así para no pegarle a Airtable en cada apertura, pero el resultado era
  que la tira mostraba "Sin foto" de productos que SÍ tienen foto en el
  catálogo. Ahora `?sync=1` jala al abrir, en paralelo y con tope de 8.
- Lo que hace que eso no sea caro: **`estado='sin-foto'`**. Un producto que ya
  se buscó y no tiene foto en el catálogo queda marcado, así que no se le vuelve
  a preguntar a Airtable nunca. El costo es de una vez por producto, no por
  apertura. Un fallo de RED no marca —se reintenta— porque marcar ahí sería
  confundir "no hay foto" con "Airtable estaba caído".
- **Guarda importante:** esa marca PISA la fila existente, así que solo se
  escribe sobre SKUs que aún no tienen una. "Del catálogo" sobre un producto sin
  foto en Airtable habría BORRADO la que alguien subió — ahora devuelve 404 sin
  tocar nada y lo dice ("si ya habías subido una, se conserva"). Anclado en test.
- La tira distingue los tres estados de verdad: la foto, "Buscando…" y "El
  catálogo no tiene foto". El botón dice "Del catálogo" solo cuando hay una
  subida que descartar; si no, dice "Reintentar".


## 2026-08-25 (3)

- **El key de R2 lleva el assetId de Monday al frente** (`oportunidades/<opp>/
  <categoria>/<assetId>-<nombre>`). Sin él, dos archivos DISTINTOS con el mismo
  nombre en la misma categoría eran el mismo objeto en R2: Monday guardaba los
  dos y el portal se quedaba con uno, en silencio. En producción hay **146
  nombres repetidos dentro de una misma columna, 61 en columnas que el portal
  espeja así**. No es teórico: el comentario de `parseFiles` en DocumentacionTab
  ya decía que el assetId "es lo único que distingue dos archivos con el MISMO
  nombre — el caso que originó quitar (la misma OC subida dos veces)".
- Acotado a propósito a lo que suben PERSONAS (inventario, documento del
  Proyecto, guías de Logística), que es donde dos archivos distintos sí pueden
  llamarse igual. Los documentos GENERADOS (cotización, tallas, OC) se quedan
  sin prefijo: su nombre lleva folio y regenerarlos con el mismo nombre es un
  reemplazo, no un archivo nuevo. Además el key de una cotización es su
  identidad para la firma electrónica (`sourceId`) — cambiarlo desligaría las
  constancias. Hoy hay 0 firmas ligadas a un key, así que el momento de moverlo
  era ahora.
- Nada se migra: los archivos viejos siguen en su key sin prefijo y `keyLegado`
  los rescata al leer, probando SIEMPRE el key original primero (un archivo que
  de verdad se llame "2026-08 informe.pdf" también matchea el patrón). Detrás
  sigue el respaldo que ya existía: los bytes vivos de Monday.
- **La OC ya no se busca parseando el nombre del archivo.** `findLatestOcFile`
  pregunta al ledger, que trae el nombre exacto que se emitió; el parseo queda
  de respaldo para las 217 órdenes anteriores al ledger (no tienen
  proveedor_id). Deducir el proveedor del nombre es de donde salió el bug de los
  acentos de esta mañana.
- El ID nuevo que se consideró para el nombre VISIBLE se descartó: para las OC
  el folio ya es ese ID, el nombre lo recibe el proveedor, y en el flujo de
  DocuSeal es llave. El problema estaba en el key interno, no en el nombre.


## 2026-08-25 (2)

- **Ledger de OC en D1** (`worker/lib/ocLedger.ts`). El contador iba en 230 y el
  espejo llegaba a OC-235, pero no existía UNA fila que dijera qué es cada
  folio: 219 se podían reconstruir escarbando nombres de archivo y **16 no
  dejaban rastro de ningún tipo**. El portal ya era dueño de la numeración y no
  del significado — la peor mitad.
- La regla que lo hace servir: **la fila se escribe ANTES de generar el PDF**,
  en la misma operación que asigna el folio. Si truena después, queda en estado
  'fallida' en vez de desaparecer. Un folio quemado en silencio es justo lo que
  dejó esos 16 huecos. Los tres caminos que emiten (portal, nativo-d1 de Zona
  Efrain, y Eledo+DocuSeal) registran.
- `POST /api/admin/oc/backfill` siembra las viejas desde el espejo, idempotente.
  Los huecos entran explícitos como 'sin-rastro': el backfill **no adivina** si
  fueron fallas, archivos borrados o del ledger viejo en Sheets de cmp-tallas.
  Lectura en `GET /api/oc` y `GET /api/oc/:folio` (compras/admin).
- **Bitácora de archivos** (`worker/lib/archivoLog.ts`), a partir de "¿de hecho
  de todos los archivos?". Había ~30 puntos del código que escriben archivos y
  exactamente **2** registraban algo: 3 filas en `archivo_subido` de toda la
  historia. Consecuencia viva: `puedeBorrarArchivo` deja pasar a cualquiera
  cuando no hay registro de quién subió —fallback deliberado para archivos
  viejos— y sin registros ESE era el caso normal, así que la regla "lo borra
  solo quien lo subió" era letra muerta. Ahora registran OC (las dos copias),
  cotización, solicitud de costeo, hoja de costeo, tallas, embellecimientos,
  inventario, logística, updates nativos, productos propuestos, las copias entre
  items (duplicar/ganar/dividir línea) y los borrados.
- **Lo que la bitácora NO es, a propósito: un índice de qué archivos existen.**
  Esa verdad sigue siendo Monday + R2. Una tabla que afirme que un archivo
  existe cuando Monday ya no lo tiene es la falla del 2026-08-19 otra vez. Es
  historia, no inventario, y nunca se consulta para decidir si algo existe.
- Es best-effort y **nunca lanza**: una OC que no se emite por no poder loggear
  sería peor que perder el registro. Anclado en test.
- Dos correcciones que salieron de sus propios tests, ya con el backfill
  corrido en prod: el nombre del archivo se guardaba URL-encodeado
  ("ATHLETIC%20FOOTWEAR") y dejaba de coincidir con el archivo real; y un '%'
  suelto en un nombre lanzaba URIError, lo que habría abortado la siembra
  COMPLETA de las 235 por un solo nombre raro. Las filas ya sembradas se
  reconstruyeron.
- `registrarSubida` ahora escribe en la bitácora; `archivo_subido` queda de solo
  lectura y `subidoPor` la sigue consultando como respaldo — son 3 filas y
  migrarlas cambiaría quién puede borrar ESOS archivos.


## 2026-08-25

- **Al emitir la OC con imágenes salen DOS copias del MISMO folio**: la de
  costos y la copia sin costos (Efraín eligió esto sobre dejarlo como vista
  previa). Es un pedido, no dos: un solo folio del ledger, las dos guardadas en
  el Proyecto. La vista previa no servía para mandarla porque el folio se asigna
  al emitir — una copia sin referencia a la orden no le sirve al proveedor.
- Las dos salen de UNA sola preparación (`prepararOcProveedor` +
  `renderOcProveedor`): volver a armarla significaría bajar de R2 y decodificar
  cada PNG otra vez, el doble de CPU en un Worker que lo tiene contado. La copia
  sin costos va en `try` aparte — la orden ya quedó emitida y perderla no vale
  deshacer un folio que el ledger ya consumió. Verificado: el PDF con costos
  sale byte por byte idéntico al de antes del refactor.
- En el tab, junto a la miniatura de la OC aparece un link **"Sin costos"**, y
  solo si es del MISMO folio que la orden que se está mostrando: la copia de una
  OC anterior llevaría cantidades viejas.
- **Bug viejo que destapó el test:** el portal saneaba la razón social al
  nombrar el archivo (`\w` convierte "é" en "_", así que "México" quedaba
  "M_xico") pero la buscaba SIN sanear, y como el nombre del archivo es lo único
  que liga la OC con su proveedor (`findLatestOcFile`, no hay id), la tarjeta se
  quedaba sin miniatura para toda OC emitida por el portal con acento o punto en
  el nombre. Ahora los acentos pasan a ASCII antes de sanear
  (`nombreArchivoOc`) y el lado que compara colapsa la puntuación. Las OC de
  cmp-tallas siempre casaron porque suben el nombre crudo.
- `generarOcNative` (Eledo + DocuSeal) NO usa el helper nuevo y se quedó con su
  nombre a mano, anotado en el código: ahí el filename viaja a DocuSeal y es su
  llave — cambiarlo rompería las firmas en vuelo.


## 2026-08-24

- **OC con imágenes: una ficha de media hoja por producto, con su foto.**
  Efraín: "necesitamos hacer una orden de compra más avanzada donde se pueda
  poner la imagen del producto en GRANDE porque a veces los mismos SKUs pueden
  tener unas diferencias, por ejemplo un chaleco puede ser con broches y otro
  con velcro". El problema no es de números sino de identidad: el proveedor no
  tiene cómo saber cuál variante le tocaba. Botón **"Generar OC con imágenes"**
  al lado del de siempre, y "Ver OC" ahora alterna Normal / Con imágenes en la
  vista previa (importa poder verla antes: generar consume folio).
- Es la MISMA orden — mismo folio, mismos totales, mismas 3 firmas, misma
  subida a Monday y a R2. Solo cambia la presentación:
  `worker/lib/pdf/ordenCompraProveedorImagenes.ts`, plantilla **aparte** de
  `ordenCompraProveedor.ts` (esa es el template de referencia que copian
  solicitud-costeo y cotizacionPreview; meterle otro layout por dentro
  arriesgaba tres documentos para arreglar uno).
- Layout que pidió Efraín: media hoja por producto (2 por página), foto a la
  izquierda ~3.7×4.2", datos y tallas a la derecha. Agrupa **por producto**, no
  por línea: las 10 tallas de un SKU van en una sola ficha en vez de repetir la
  foto 10 veces. Los embellecimientos no llevan ficha (no son un artículo del
  catálogo) — van en su tabla compacta al final, como siempre.
- **Un producto con más de 20 tallas se parte en varias fichas ("Apex Pant
  (1 de 2)"), no se recorta.** La primera versión ponía "+4 tallas más" al pie
  y eso es una OC mal surtida esperando a pasar: la lista de tallas ES el
  pedido. Anclado en `ordenCompraProveedorImagenes.test.ts` — la suma de tallas
  impresas tiene que ser exactamente la del pedido.
- **El motor de PDF aprendió PNG** (`worker/lib/pdf/png.ts`, sin dependencias).
  Nació embebiendo solo JPEG (la firma del canvas), pero media el catálogo de
  Airtable son PNG y la OC habría salido con huecos justo en los productos que
  motivan la función. Workers trae `DecompressionStream`/`CompressionStream`
  nativos: se infla el IDAT, se deshacen los 5 filtros por scanline, se tira el
  alfa **sobre blanco** (el PDF va a papel) y se re-comprime como
  `/FlateDecode`. Fuera de alcance a propósito → `null` → placeholder gris:
  entrelazado Adam7, profundidad ≠ 8 bits y > 4 MP (presupuesto de CPU).
- **La foto vive por SKU, no por proyecto ni por línea** (`worker/lib/
  ocImagenes.ts`, tabla `oc_imagen` + R2): "estaría genial poder guardarla y
  volverla a usar". Default = "Imagen producto" del catálogo de Airtable, que se
  **copia a R2** — las URLs de attachment de Airtable expiran a las pocas horas,
  así que guardar la liga daría OCs con huecos a los dos días. Se pide el
  thumbnail `large` (~500px) y no el `full` (hasta 3000px): imprime de sobra a
  3.7 pulgadas y no infla el PDF. Una foto subida desde el portal le gana al
  catálogo, y "Del catálogo" la devuelve.
- Las líneas del Proyecto **no traen el id de Airtable** (`oportunidades_sub` sí
  lo tiene espejado, `proyectos_sub` no), así que se resuelve SKU → item del
  catálogo en el mirror → `text_mkzmgvc7`. El LIKE acota y la verificación real
  es parseando: solo con LIKE, un SKU que es prefijo de otro daría la foto
  equivocada.
- Nada de esto toca Monday: la foto es un objeto de R2 del portal, así que **no
  le aplican las guardas de `archivoBorrado.ts`** (esas son para columnas `file`,
  que sí son 1-1 con Monday). Reemplazar una foto tampoco borra la anterior —
  el objeto es direccionable por su sha256 y se queda; basura barata en R2 antes
  que un borrado que nadie pidió. El tipo se decide por la **firma de los bytes**
  (no por el Content-Type): un WEBP renombrado a .jpg se rechaza en la subida en
  vez de aparecer como recuadro gris sin explicación.
- **La orden básica va PRIMERO; las fichas son un ANEXO** (Efraín, mismo día:
  "si necesita la orden de compra básica al principio, las imágenes son como
  anexo"). El PDF arranca con la OC de siempre —tabla de líneas, totales, notas
  y las tres firmas— y el anexo entra en página aparte. No es cosmético: la
  tabla es el documento que rige y las fotos son referencia; el anexo lo dice
  impreso. Para que las dos versiones no se separen con el tiempo, la de
  imágenes REUSA los bloques de la normal (`buildOcProveedorBlocks`, extraído de
  `ordenCompraProveedor.ts` sin cambiar su salida) en vez de copiarlos. Bloque
  `pageBreak` nuevo en el motor de layout.
- **Copia SIN COSTOS de la misma orden** (Efraín, mismo día). Se caen precio,
  descuento, moneda, subtotal, IVA, total e importe en letras; quedan producto,
  talla, cantidad, términos de pago, notas y firmas. La tabla se reparte el
  ancho que dejan las 4 columnas de dinero, así que los nombres largos ya no se
  parten. Va marcada impresa ("COPIA SIN COSTOS") porque las dos copias de una
  misma orden se van a cruzar en algún escritorio y de lejos se ven idénticas.
  Aplica a las dos versiones (normal y con imágenes); en la vista previa es una
  casilla. El pie de la ficha pierde el dinero pero conserva su ALTO —ese alto
  decide cuántas tallas caben, y no puede cambiar entre copias—, anclado en test.
- Tope de 10 fotos jaladas de Airtable por generación de PDF (presupuesto de
  subrequests): el resto queda para la siguiente corrida, ya con las anteriores
  en caché. Verificado renderizando el PDF real con pdf.js: foto con alfa sobre
  blanco, placeholder gris, dos fichas por página y las 25 tallas completas.


## 2026-08-21

- **PAM y EMY ya ven la Zona Efrain.** Efraín: "necesito que les des acceso a
  EMY y a PAM a zona efrain como Elisa". Entran a la whitelist por correo de
  `worker/lib/zonas.ts`: `compras@` (Pamela Ricalde, admin) y `cotizaciones4@`
  (Emily Martínez, compras).
- Lo que lo destapó fue **OPP-0946 - LICITACIÓN OAXACA**. Se creó desde un
  formulario de Monday a las 13:14 con Pamela como Vendedor y como Responsable
  compras, y llegó al mirror 4.6 s después. A las **14:17 le cambiaron el
  Vendedor a "Efrain Ponce"** y en ese instante desapareció del portal para
  ella: es miembro de la zona privada y PAM no estaba en la whitelist. Siguió
  siendo la Responsable compras —el selector `comprador` de `notify.ts` no
  filtra por zona, solo `role:admin`—, así que a las 14:30 le llegó la
  notificación de una oportunidad que ya no podía abrir y se fue a trabajarla a
  Monday.
- Aparte, su queja de las **13:40** era otra cosa: en ese momento la
  oportunidad todavía era suya. El encabezado de su captura decía "actualizado
  hace 25 min" y eso solo se pinta cuando el server SÍ devolvió renglones
  (`SyncIndicator` pone "sin datos de actualización" con la lista vacía), así
  que el 0 se lo hizo un **filtro guardado** de `useSavedView` — Compras o
  Estado, los dos que su captura corta. Sin relación con permisos.
- **EMY no queda igual que Elisa y está anotado en el código:** la whitelist
  solo levanta la excepción de "admin ve todo" (`hiddenOwnerIdsFor` ni mira a
  los no-admins). Con rol `compras` su lectura la sigue acotando
  `comprasScopeFor`, así que el tab Zona Efrain le muestra las oportunidades
  donde ella es la Responsable compras — hoy 15 de 75. Para verla completa
  tendría que ser admin; esa decisión no se tomó sola.
- Efecto secundario correcto: `idPrestadoBloqueado` (`worker/routes/admin.ts`)
  ahora también rechaza prestar los monday_user_id de PAM y de EMY con "Actuar
  en Monday como" — ver ellas la zona ya no es heredable por préstamo de id.
- Anclado en `worker/lib/zonas.test.ts`: los dos correos nuevos dentro, y el
  resto de Compras (`cotizaciones5@`) y el resto de admins (`webcmp@`) fuera.

- **Los archivos se descargan con el número de la oportunidad.** Elizabeth, con
  el "Guardar como" de Windows abierto: "cuando le demos descargar al documento
  será que se pueda guardar con el número de la oportunidad". Salía
  `sin_firmar.pdf` — el navegador estaba usando el último segmento de la URL
  (`/cotizacion-pdf/sin_firmar`), porque el Worker no mandaba nombre. Ahora sale
  `OPP-0934 - UNIFORME KEVIN VERGAS - Cotización sin firmar.pdf`.
- El folio no se busca aparte: el `name` del item de Monday YA lo trae adelante
  ("OPP-0947 - CONOS-TRAFITAMBOS TORREON"), y el del **Proyecto** también, así
  que tallas y OC quedan igual de identificadas ("y si está el proyecto igual").
- **Nada de esto renombra archivos en Monday.** Efraín lo marcó en el momento:
  "cuidado con las cotizaciones porque usamos el nombre del archivo en DocuSeal
  para ligarlo a la opp — no vayas a romper eso; es solo al descargar del
  portal". El nombre bonito vive SOLO en el encabezado `Content-Disposition` de
  las rutas de LECTURA; los `filename` con los que se sube a Monday
  (`cotizacion_0934_-_2.pdf` de `cotizacion.ts`, `OC_<folio>_<razón social>.pdf`
  de `oc.ts`, el de `proyectoTallas.ts`) no se tocaron — igual que el key de R2
  y el hash de los PDFs firmados. La miniatura "última OC de este proveedor"
  también sigue encontrando su archivo por el nombre de Monday.
- Cubre todo lo que se baja del portal: los 3 PDFs de cotización, la vista
  previa, la hoja de Validación de costeo, los documentos con firma, los
  adjuntos de comentarios, e `/api/files` (documentación, inventario, tallas,
  OC oficiales).
- El nombre lo decide el **server** a propósito: el `filename` del encabezado le
  gana al atributo `download` del HTML, así que ponerlo en la UI no habría
  servido. `shared/nombreArchivo.ts` (+ test) quita lo que Windows no acepta,
  conserva acentos vía `filename*=UTF-8''…`, acota el largo sin comerse la
  extensión, no le inventa extensión "11" a "INVENTARIO 5.11" y no duplica el
  folio si el archivo ya venía identificado por cmp-tallas.
- Verificado contra el Worker local con oportunidades reales: los 6 endpoints
  devuelven el `Content-Disposition` esperado.

## 2026-08-20 (3)

- **Las métricas de la cotización, en la lista.** Efraín, con el tablero de
  Monday a la vista: "en validación de costeo pueden VER las métricas de las
  cotizaciones súper fácil… por lo pronto solo verlas estaría genial". En Monday
  esas seis cifras (Costo Total, Subtotal, Total, Utilidad %, Margen Gob,
  Utilidad Total) son columnas ESPEJO del item padre y **los espejos de dinero
  llegan vacíos por la API** — por eso el portal nunca las pintó. No se traen:
  se **calculan**, que fue justo lo que él propuso ("eso lo podemos CALCULAR, de
  hecho dentro de la cotización ya se calcula").
- Cada línea guarda sus cinco totales al sincronizarse (columnas `t_*` nuevas en
  `items`, `worker/lib/lineaTotales.ts`) y la lista los suma por oportunidad.
  Materializar no fue estética: sumar al vuelo obligaba a un `json_each` sobre
  el board de líneas completo — **medido contra producción: 803 ms y 441,663
  filas leídas por consulta**, y la lista la pediría en cada invalidación de
  ETag. Con las columnas `t_*`: **44 ms y 7,304 filas**. Migración en
  `worker/migrations/2026-08-20-linea-totales.sql` (aplicada en remoto y local).
- **Cuadran con Monday**: los cinco montos de OPP-0344, OPP-0857, OPP-0865 y
  OPP-0909 salen idénticos al tablero. El **porcentaje no**, y es a propósito:
  la columna de Monday se llama "Utilidad **promedio** (%)" y promedia los
  renglones (25.101 % en TIZIMIN 2); el portal usa el **ponderado**
  (utilidad ÷ subtotal = 22.582 %), que es el que ya muestra la fila de totales
  del tab Cotización y el que no se deja engañar por una línea chiquita con
  200 % de margen. Verificado renglón por renglón antes de darlo por bueno.
- **Fuga cerrada antes de salir**: el agregado devolvía los totales de las 608
  oportunidades del board a un vendedor que solo ve 71 — indexados por id, o
  sea el subtotal de cotizaciones ajenas por la puerta de atrás. Ahora se filtra
  por los renglones que el viewer YA recibió (los que scopea `dal.ts`), además
  del filtro por columna que ya heredaba de `shared/visibility.ts`: un vendedor
  recibe Subtotal y Total, nunca costo/utilidad/margen.
- El ETag de la lista incorpora la versión del board de LÍNEAS: sin eso, editar
  una línea no mueve el board de Oportunidades y los números se quedaban
  congelados detrás de un 304.
- **Validación Costeo ahora muestra de validación en adelante**, no solo
  `['7','9']` (Efraín: "necesitamos poder ver TODAS las oportunidades después de
  validación para que se vea esta info"). El culpable era la etapa **Cotización
  ('6')**, que en el orden real de Monday va justo después de Costeo Confirmado:
  la oportunidad pasaba a cotización y desaparecía del board. Quedan fuera solo
  Nueva oportunidad / En costeo (aún no llegan) y Perdida / Cancelada.
- Dinero abreviado ($500K, $1.3M) "para facilitar la lectura" y el semáforo de
  siempre en Utilidad % y Utilidad Total. En celular caben cuatro —Subtotal,
  Utilidad %, Utilidad Total, Margen Gob—, en el orden que pidió. `fmtMoney` no
  cambia: la cotización y los PDFs siguen sin redondear nada.
- `POST /api/admin/totales/recalcular` recorre las líneas con la matemática de
  verdad: es el backfill de las líneas NATIVAS de Zona Efrain, que no pasan por
  Monday y por tanto no tienen fórmulas que copiar.
- **Arreglado el encabezado de columnas** (Efraín, con captura, minutos después
  de salir): el contenedor de la lista llevaba 16 px de padding arriba y un
  `sticky` se pega al borde del *padding box*, así que esa franja quedaba POR
  ENCIMA del encabezado y al hacer scroll se veía media fila deslizándose sobre
  los títulos. Ahora el padding se lo lleva el encabezado y su fondo es el del
  lienzo (`--bg`), no un gris propio. Reproducido en local antes de tocarlo.
- **Y las columnas no cuadraban** (Efraín, otra captura, "fix urgente"): dos
  causas encimadas. Las celdas iban sueltas en el renglón, así que heredaban su
  `gap` de 16 px mientras el encabezado usaba 10 — 6 px de deriva por columna,
  36 al final; y el encabezado vive FUERA de las GroupCards, que meten 24 px de
  margen y 1 px de borde que nadie estaba descontando. Ahora las celdas van en
  su propio bloque con gaps constantes compartidos y el encabezado copia la
  geometría de la tarjeta. Se comprueba con **`node scripts/verificar-alineacion.mjs`**,
  que MIDE el DOM (título vs número, columna por columna) y sale con código 1 si
  algo no cuadra — este bug salió dos veces por revisarlo a ojo en una captura.

## 2026-08-20 (2)

- **Bitácora de intentos de escritura (`accion_log`).** Efraín, sobre OPP-0933:
  "el CEO le dio validar precios a unas oportunidades y no se envió la info a
  Monday… no veo ningún log". Contestarlo tomó media hora de cruzar cinco
  fuentes (outbox, sync_log, activity_log, ux_event y los logs del Worker) y
  ninguna podía sola: **las cinco cuentan lo que SÍ pasó**. Faltaba el negativo
  —quién pidió qué y se fue con un 403/400/404/500—, que es justo el caso que
  alguien reporta como "el portal no hizo nada" y no dejaba rastro en ningún
  lado. Ahora cada POST/PATCH/PUT/DELETE de `/api/*` deja renglón con ruta,
  status, milisegundos y **el motivo del rechazo tal cual lo devolvió la ruta**.
- Los GET no entran (son el 99% del tráfico y su latencia ya vive muestreada en
  `ux_event`; aquí el muestreo lo volvería inútil para auditar a UNA persona en
  UNA tarde) y el beacon de telemetría tampoco, para que no se registre a sí
  mismo. El INSERT va en `waitUntil` y todo está envuelto en try/catch: una
  bitácora jamás debe tumbar la acción que registra. Retención 400 días, podada
  en el cron diario que ya existía — **sin cron nuevo** (la cuenta está en el
  tope de 5).
- Registra a las **dos** personas cuando hay suplantación (`email` = quien
  actuó, `actua_como` = el suplantado): `ux_event` tira el lote completo en ese
  caso y `outbox` guarda solo al segundo, así que hoy una acción hecha "viendo
  como alguien" era indistinguible de una suya. Anclado en
  `worker/mw/accionLog.test.ts`.
- Se consulta con `GET /api/admin/acciones` (`email`, `ruta` —subcadena, para
  pasarle el id de una oportunidad—, `dias`, `solo=errores`). Query desconocida
  = 400, como el resto de las rutas.
- **Los 304 dejaron de contarse como error.** `apiFetch` medía el éxito con
  `res.ok`, que es false para un 304 Not Modified — y el polling de listas va
  con ETag, así que el camino más rápido y más frecuente del portal ("no cambió
  nada") se grababa como `error` en `ux_event`: ~2,750 falsos errores diarios
  en `api:get:boards:slug:items`. Además de ser ruido, ensuciaba la métrica de
  fricción para el comparativo de feb-2027.
- **La etapa se puede cambiar a mano, solo admin** (Efraín: "cuando eres admin
  puedes modificar la etapa directamente desde la oportunidad"). El chip de
  etapa del drawer ahora es un `<select>` para admin y sigue siendo etiqueta
  para todos los demás. Hasta ahora la etapa solo se movía con los botones del
  flujo, y cada uno aparece nada más en la etapa exacta que lo habilita: una
  oportunidad que se adelantó no se podía regresar desde el portal, había que ir
  a Monday. Pasó justo con OPP-0933, que llegó a "Costeo Confirmado" y luego a
  "Cotización" **sin un solo precio** porque los botones de Monday.com no
  validan nada (el del portal está deshabilitado si ninguna línea tiene Precio
  de Venta).
- Escribe `deal_stage` por el PATCH genérico, igual que Perder/Cancelar/Reabrir:
  **no** dispara las automatizaciones de cmp-tallas (ni PDFs, ni folio, ni
  avisos) y lo dice en la confirmación — mover la etapa a mano es corregir el
  estado, no rehacer el paso. Excepción: "Ganada" sigue yéndose por su endpoint,
  porque ahí también se crea el Proyecto.

## 2026-08-20 (1)

- **La captura de tallas ahora vive en el Proyecto, no solo en la
  Oportunidad.** Efraín, sobre un proyecto de la Zona Efrain: "necesito dónde
  capturar las tallas, no me aparece". La pestaña Tallas del Proyecto solo
  mostraba el vacío con la instrucción de ir a *otro* drawer ("captúralas en
  la pestaña Tallas de la Oportunidad") — el camino existía y funcionaba, pero
  nadie lo encontraba. Ahora las mismas cajitas por producto+talla salen ahí
  mismo, debajo del desglose.
- Es **el mismo componente y el mismo endpoint** (`TallaBoxesCapture`, movido
  de `tabs/TallasTab.tsx` a `proyecto/TallaCapture.tsx` para que los dos
  lugares lo usen): lo capturado se guarda como subitems del Proyecto
  (`worker/lib/proyectoTallas.ts`), con costo/proveedor copiados de la línea de
  cotización. La captura desde la Oportunidad sigue igual.
- Las líneas se leen de la **Oportunidad ligada** (`getItem('oportunidades')`),
  no de la cotización virtual: la captura necesita el `subitemId` real de cada
  línea para copiar costo/moneda/proveedor.
- **Capturar tallas ya no es solo del vendedor** (Efraín: "todos pueden
  capturar las tallas, no solo el vendedor"): se quitó el gate por rol de
  `POST /api/proyectos/:id/tallas-capturar`, que devolvía 403 a Compras. Queda
  el candado de renglón de siempre — `getItem(..., 'own')`, o sea solo sobre
  proyectos propios.
- Pendiente de decisión: **almacén** sigue sin ver las líneas de cotización
  (`shared/visibility.ts`, grupo V), así que para ese rol la captura no se
  pinta. Abrirlo implicaría tocar la whitelist, y eso es decisión de Efraín.

## 2026-08-19 (19)

- **Zona Efrain cotiza de un jalón: "Generar cotización" desde Nueva
  oportunidad.** Efraín: "necesito que en Zona Efrain la etapa sea Generar
  cotización, porque la verdad no hay etapas, toda la info ya está de jalón…
  puede pasar de nueva oportunidad a cotización enseguida". Ahí una sola
  persona captura líneas, costos y Precio de Venta en la misma pantalla, así
  que costeo → validación → confirmado eran tres clics de trámite sobre datos
  que ya estaban puestos.
- En la zona **"Mandar a costeo" desaparece** (Efraín: "solo generar
  cotización") y "Generar cotización" se pinta en cualquier etapa abierta,
  incluida Nueva oportunidad. Fuera de la zona nada cambia: sigue apareciendo
  solo en "Costeo Confirmado", después de que dirección valida el precio. La
  regla vive en `shared/dealStages.ts` (`puedeGenerarCotizacion`), anclada en
  tests.
- **Los dos PDFs no se pierden** (Efraín: "pero sí deja el PDF de solicitud y
  validación"): la solicitud de costeo y la hoja "Costeo — Validación" las
  emite ahora la propia cotización, con los mismos helpers y el mismo acuse
  automático. El gate es la **etapa de antes**, no el board: si se cotiza
  saltándose la validación del precio, salen; en el pipeline normal ya existían
  y no se regeneran.
- Sigue visible en etapa "Cotización" dentro de la zona a propósito: tras
  "+ Nueva versión" no habría ningún otro botón para volver a cotizar ahora que
  "Mandar a costeo" ya no está ahí.

## 2026-08-19 (18)

- **Tarjeta de proveedor reacomodada: los 3 botones en una sola línea.** Efraín,
  con la foto: "puedes mejorar el UI? o poner todos los botones en la misma
  línea?". Método y Condiciones de pago eran dos inputs sueltos en el encabezado
  —con la etiqueta solo de placeholder— y empujaban "Generar OC (Monday)" a un
  segundo renglón. Ahora el encabezado es nombre del proveedor a la izquierda y
  **Ver OC · Generar OC (portal) · Generar OC (Monday)** a la derecha, en fila.
- Debajo, una franja "datos de esta OC" agrupa lo que se captura por orden:
  Método de pago, Condiciones de pago (ya con etiqueta arriba y ejemplo en el
  placeholder) y las Notas al proveedor. Antes las notas colgaban solas y los
  dos campos de pago vivían lejos, entre los botones.
- "Ver OC (portal)" se llama ahora **"Ver OC"** y dejó de parecer un input (era
  un `<button>` con estilo de campo de texto): es botón secundario, al lado de
  los otros dos. Sigue siendo vista previa: no consume folio ni guarda nada.
- Verificado a 980px (los 3 botones en una línea) y a 430px (se acomodan en dos
  renglones, sin desbordar).

## 2026-08-19 (18)

- **"Hay una versión nueva del portal" ya no se queda pegado en
  "Actualizando…".** Efraín mandó la captura de alguien esperando en esa
  pantalla: la recarga automática tras un deploy estaba topada a UNA sola vez
  por pestaña (guard de `sessionStorage`), así que quien volvía a tropezar con
  un chunk viejo — el deploy tarda unos segundos en propagarse — se quedaba
  mirando el mensaje sin que nada pasara.
- Ahora `ChunkReloadBoundary` cuenta intentos y recarga sola **hasta 3 veces,
  esperando 6 segundos cada una**. La recarga instantánea se quitó a petición de
  Efraín ("la 1era recarga no sirve de nada, a mi no me ha servido nunca"): con
  el deploy todavía propagándose vuelve a caer en el chunk viejo y lo único que
  logra es quemar un intento. Pasado el tope se rinde y muestra el botón
  **Recargar** en vez de mentir con "Actualizando…" — el loop infinito, que era
  el motivo del guard original, sigue descartado.
- El contador vive en `sessionStorage` con timestamp: si el último intento fue
  hace más de un minuto la app estuvo viva un buen rato, es otro deploy y
  vuelve a empezar de cero.

## 2026-08-19 (17)

- **"Generar OC (portal)": la orden ya se EMITE con el motor propio, sin
  firmas.** Efraín: "puedes hacer un GENERAR OC PORTAL? por fa sin firmas por lo
  pronto". El PDF nativo existía desde el 2026-08-13 pero solo como vista previa
  ("Ver OC (portal)"): ahora el botón toma folio del ledger, sube el PDF a la
  columna de OCs del Proyecto en Monday (portal y Monday 1-1), deja copia en R2
  y anota la bitácora. **Sin DocuSeal**: el documento sale con los espacios de
  firma física impresos. El botón viejo se queda al lado como **"Generar OC
  (Monday)"** (cmp-tallas/Eledo + las 3 firmas), igual que el del ActionBar.
- **El folio ya no puede repetirse entre los dos motores.** Hay DOS ledgers que
  no se hablan: cmp-tallas cuenta filas en su Google Sheet y el portal cuenta en
  D1. El contador de D1 iba en **23** mientras las OC reales del Sheet ya iban en
  la **224** — el primer folio del portal habría salido "OC-24", repetido con una
  orden de hace meses. `nextOcFolio` ahora lee el folio más alto que ya existe en
  el espejo (los nombres `OC_OC-<n>_<proveedor>.pdf` de la columna de OCs) y
  emite por encima de eso. Aplica también a los otros dos caminos nativos.
- El espejo se refresca ANTES de armar el PDF: las líneas se acaban de editar en
  esa misma pantalla (costo, producto, color) y el echo del outbox puede ir
  atrás — una OC con el costo viejo es una OC mal mandada.
- El PDF ahora imprime **Folio OC** en el encabezado (antes no había folio que
  imprimir) y toma método/condiciones de pago de la tarjeta que la generó, no del
  default del Proyecto. La vista previa sigue sin consumir folio.

## 2026-08-19 (16)

- **Notas al proveedor en la Orden de Compra, impresas en el PDF.** Efraín
  (WhatsApp, con la foto del tab de OC): "un campo de texto en las Órdenes de
  Compra para dejar notas al proveedor (que aparezcan impresas en el documento
  final)". Cada tarjeta de proveedor tiene ahora su recuadro de notas, arriba de
  sus líneas; se guarda al salir del campo y sale impreso en la OC, justo antes
  del pie de firmas (es parte de lo que se firma, no un pie de página).
- **La nota es POR PROVEEDOR, no por Proyecto** (`worker/lib/ocNotas.ts`, D1,
  tabla `oc_nota`). En Monday la única columna de comentarios de OC
  (`text_mm4c74f8`) es una sola para todo el Proyecto, y un Proyecto reparte sus
  líneas entre varios proveedores: una nota dirigida a uno saldría impresa en la
  OC de todos. Esa columna se queda como fallback (proyectos que ya la traen
  llena imprimen lo mismo que antes) y como puente para cmp-tallas, que arma su
  PDF leyéndola y no acepta la nota por request: en ese camino la ruta la estampa
  en la columna justo antes de disparar. Los dos caminos nativos (Eledo y el
  motor propio del portal) la leen directo de D1.
- **Producto y Color se editan en la OC antes de mandarla.** Segundo pedido de
  la misma foto. Eran de solo lectura desde el import de tallas ("texto libre del
  catálogo de cmp-tallas"), pero son justo lo que el proveedor lee en el
  documento y corregir un color obligaba a entrar a Monday. Los escriben
  **compras y admin** (Efraín: "compras y admin pueden modificar todo"); el
  vendedor los sigue viendo. La **talla no** se toca: es la que cuadra contra el
  desglose de tallas.
- Ambas columnas entraron a `PORTAL_WRITE_COLUMNS` (`worker/lib/activityLog.ts`),
  así que el reloj de cada línea registra quién cambió el producto o el color con
  el usuario REAL del portal, igual que ya pasaba con el costo. Whitelist anclada
  en `shared/visibility.test.ts` (el test que fijaba "talla y color de solo
  lectura" ahora fija talla de solo lectura + producto/color de compras/admin).
- La celda de Producto envuelve el texto en vez de recortarlo: las descripciones
  de bordado se llevan medio renglón y recortadas no se pueden ni revisar.

## 2026-08-19 (15)

- **El catálogo de Productos ahora se trae cada 10 minutos.** Emy (WhatsApp, con
  la foto de la línea de Chamarra Condor en rojo): "cuánto tarda en cargar las
  tallas?, ya tengo como 15 min que subí las tallas y precio a Airtable, ya le di
  varias veces a actualizar pero nadita". El grupo de reconcile que traía
  productos corría cada 12h (`0 6,18`); ahora corre `*/10 * * * *`. Es lo que el
  delta sync no cubría: el catálogo no lo teclea gente, lo escribe el bot del
  sync de Airtable, y sus writes llegan en ráfaga — el delta capea 50 refetches
  por corrida (tope que existe desde los 270 "Too many subrequests" del
  2026-08-14).
- **Productos no se llevó un cron propio: no cabía.** El primer intento agregaba
  un quinto trigger al Worker y el deploy salió en rojo — el PUT de
  `/schedules` contestó `10072`: **Workers Free permite 5 cron triggers POR
  CUENTA** y ya estaban los 5 (4 de cmp-portal + 1 de janing-portal). El código
  del Worker sí se había subido, o sea que quedó en producción con los crons
  viejos y el Action en rojo como único aviso — el mismo modo de falla del
  2026-08-12. Así que instituciones/contactos/proveedores se vienen de pasajeros
  en el cron de 10 min y el total de triggers no se movió.
- Sale barato: `reconcileAll` pide UNA vez el `updated_at` de los cuatro boards y
  solo pagina el que de verdad se movió (productos 14 páginas, instituciones 32,
  contactos 8, proveedores 2). La corrida típica es una sola call a Monday, y el
  peor caso —los cuatro movidos— es el trabajo que ese grupo ya hacía a las 6 y a
  las 18. Con Workers Paid el tope sube a 1000 y ahí sí convendría darle a cada
  board su propia cadencia.
- **De pilón, un bug que congelaba el reconcile de Oportunidades.** El primer
  disparo del cron nuevo cayó en el fallback (los 8 boards) porque a las 18:00 el
  Worker todavía servía el código anterior — el deploy había terminado 2 min
  antes. Ese barrido dejó `D1_ERROR: too many SQL variables` en oportunidades: el
  `IN (...)` que trae las columnas previas iba en lotes de `BATCH_CHUNK` = 100
  ids **más** el `board_id` = 101 parámetros, y D1 no acepta más de ~100 por
  query (tope que `worker/lib/updateSeen.ts` ya documentaba desde su propio
  500). Hacía falta que 100 items YA EXISTENTES cambiaran de golpe para verlo,
  pero cuando pasa es peor que un error suelto: la SELECT va **antes** de
  cualquier escritura, así que aborta el board entero sin escribir nada y
  `board_state` no avanza — la siguiente corrida vuelve a encontrar los mismos
  100 cambios y falla igual, indefinidamente. Ahora ese lote va por `BIND_CHUNK`
  = 99.

- Sync forzado a mano en producción al momento (`POST /api/admin/sync/productos`).
  De paso, el diagnóstico del caso de Emy: la espera **no era del portal**. El
  producto CHA5047 quedó escrito en Monday a las 17:48:09 UTC (11:48 hora de
  Mérida) por el usuario de integración (98389537, que no es nadie del portal),
  o sea exactamente cuando ella mandó el mensaje — el costo (719) y las tallas
  ("XCH, CH, M, G, XL, XXL") tardaron en cruzar de Airtable a Monday, no de
  Monday al portal. Los 10 minutos acotan nuestro tramo; el de Airtable→Monday
  sigue siendo del scenario de Make.

## 2026-08-19 (14)

- **Duplicar una oportunidad ahora sí hace una copia exacta.** Elizabeth
  (WhatsApp, con la foto del clon de OPP-0593): "acabo de duplicar una opp pero
  no jala todos los datos". Efraín: "se necesita hacer una copia exacta y no es
  lo que esta pasando". Comparado en producción OPP-0593 contra su clon
  OPP-0925, el duplicado copiaba **4 columnas** de la cabecera (Etapa, Vendedor,
  Compras, Contacto) y todo lo demás nacía vacío: Zona ("Centro"), Tipo de
  cotización ("Estudio de mercado"), Fecha límite, Fecha de cotización,
  "¿Quieres cotizar nuevos productos?", Vendedores secundarios, Responsable
  compras, Vigencia, Tiempo de entrega — y las **condiciones comerciales**, que
  aparecían con el texto por defecto de Monday en vez del que había escrito
  Compras.
- La cabecera pasó de 4 campos sueltos a una tabla, `COPY_ITEM_COLS`, con el
  tipo de escritura de cada columna (status `{label}`, dropdown `{labels:[…]}`,
  date `{date:…}`). La Zona va por TEXTO, nunca por id de label — mismo motivo
  ya documentado en `ganarOportunidad.ts`, donde copiar `{ids:[…]}` tradujo
  "Centro" a "Sur" en silencio.
- **Las líneas ya no se revuelven.** Se creaban con `Promise.all`, y en Monday
  el orden de los subitems es el orden en que se crean: el clon salió
  Chamarra/UA Stellar/Camisola cuando la original iba Pantalón/Camisola/Chamarra,
  con los renglones todavía llamados "1".."9" pero en otra posición. Ahora se
  crean una por una. Las imágenes de embellecimiento siguen en paralelo (ya no
  hay orden que preservar) para no pagar toda la latencia.
- En cada línea se agregaron SKU, el desglose de Costo Embellecimiento por zona,
  Recosteo?, Nuevo producto y el Precio de Venta sugerido; y el nombre del
  producto + SKU se copian **siempre**, no solo cuando la línea no está ligada al
  catálogo (un producto escrito a mano perdía su nombre). También se re-sube la
  imagen de Inventario Actual.
- Lo que sigue sin copiarse es **decisión de Efraín** (2026-08-19), no olvido:
  los PDFs (cotizaciones generadas/sin precio/firmadas, solicitud de costeo),
  las fechas de solicitud y validación de costeo, la liga al Proyecto y la
  carpeta de Drive, la razón de pérdida, y el Event ID / Origen Web. "Copia
  exacta" son los datos, no la evidencia de pasos que el clon no vivió.
- `worker/lib/duplicateOportunidad.test.ts` (nuevo) ancla las dos cosas: cada
  columna escribible de Oportunidades y de sus subitems tiene que estar copiada
  o listada en `NO_COPIAR` con su razón —si Monday gana una columna y se
  re-introspecta, el test truena hasta que alguien decida de qué lado va—, y
  las líneas tienen que crearse una por una.
- El nombre del clon se queda como está (`OPP-0925 - OPP-0593 - … (copia)`,
  con el folio viejo adentro): Efraín lo prefirió así.

## 2026-08-19 (14)

- **Admin igual que Compras: color y cantidad, y también como mini versión.**
  Efraín (2026-08-19): "te faltó que yo como admin también puedo hacerlo…
  o sea los admins pueden hacer todo esto igual". El server ya se lo permitía
  (`w: V` incluye admin), pero la grid solo le pintaba los campos a Compras y la
  mini versión estaba atada a ese rol: un admin editando desde Costeo veía todo
  de solo lectura, y desde Oportunidades su cambio archivaba versión completa.
- `esAjusteInlineCompras` → `esAjusteInline` (compras + admin). El vendedor no
  entra: su cambio sigue archivando versión y regresando esa línea a costeo, que
  es lo que el traspaso Ventas→Compras necesita.
- Sin cambios en Validación de Costeo (ahí lo único editable sigue siendo el
  Precio de Venta, Efraín 2026-07-16) ni en Ganada/Perdida, donde la vía es el
  lápiz "Ajustar línea" — que compras y admin ya tenían.

## 2026-08-19 (13)

- **Remandar a costeo ya no pisa el costo que Compras capturó.** Efraín
  (2026-08-19): "no quiero que nunca se pierda lo costeado y el precio por fa".
  Hueco encontrado al revisar el arreglo anterior: "Mandar a costeo" estampa el
  snapshot del catálogo (Costo Distr., Descuento %, Gastos %, IVA, TC y
  `numeric_mm2qzzbe`) en **toda** línea con Etapa Costeo "No iniciado" — y ese
  estado dejó de significar "nunca se costeó" en cuanto el versionado automático
  empezó a regresar ahí la línea editada. O sea: Compras costeaba una línea a
  mano, alguien le cambiaba el color, y al remandarla a costeo el costo volvía al
  del catálogo. Peor: si el espejo del catálogo venía vacío (Monday no siempre
  recalcula los mirrors a tiempo), lo sobrescribía con **ceros**.
- `debeEstamparSnapshot` (nuevo, en `worker/lib/costeoSnapshot.ts`) decide por
  línea: se siembra si no hay costo capturado (primer costeo) o si cambió el
  producto —SKU o nombre congelados ya no coinciden con el catálogo, o sea que
  el costo viejo era de OTRO producto—. En cualquier otro caso gana lo que
  capturó Compras. Ante duda (espejo vacío, dato incomparable) NO se pisa:
  perder un costo negociado es más caro que no sembrar uno.
- Aplica a los dos caminos de "Mandar a costeo": el de Monday (`runCosteoNative`)
  y el nativo de la Zona Efrain (`runCosteoNativeD1`).
- **El Precio de Venta C/U (`numeric_mkzneg3d`) nunca estuvo en riesgo** y ahora
  hay test que lo ancla: el snapshot escribe `numeric_mm2qzzbe`, otra columna con
  nombre parecido. En todo el worker solo lo escriben restaurar una versión (por
  definición, restaura esa foto) y duplicar una oportunidad.

## 2026-08-19 (12)
- **El vendedor ya puede borrar un documento que subió.** Ricardo (WhatsApp, con
  la foto de la pestaña Documentación de OPP-0506): "Subi dos veces el
  documento… ¿Cómo puedo borrar algún documento en orden de compra?". Efraín:
  "Vendedor puede borrar documentos que el SUBIO por favor".
- La lista de "Órdenes de compra / contrato firmado" tiene ahora un **Borrar**
  por renglón. Borra en el portal y en Monday a la vez — 1-1, la regla de la
  entrada anterior.
- Corrige lo que quedó escrito ahí: la API de Monday **sí** sabe quitar un
  archivo suelto de una columna `file`. No con un `delete_*`, sino con
  `update_assets_on_item`, que reescribe la lista de la columna a partir de
  assets existentes; se manda sin el archivo a quitar y los demás quedan
  intactos. Probado en vivo contra OPP-0506 (de paso se fue el duplicado de la
  OC que reportó Ricardo).
- Ojo con lo que eso significa: el asset que se deja fuera **desaparece de
  Monday** (`assets(ids:)` ya no lo devuelve). Es destructivo aunque no lleve la
  palabra delete, así que lleva las mismas guardas que `itemBorrado.ts`:
  respaldo de los BYTES en R2 (`…/documento-borrado/<assetId>-<nombre>`, key
  propio para que un duplicado no pise la copia buena) + renglón en
  `archivo_borrado` ANTES de tocar Monday, de a un archivo por assetId, y tope
  de 30 por hora y persona.
- La lista que se reescribe se lee EN VIVO de Monday, no del mirror: con el
  espejo atrasado, un archivo subido hace un minuto no aparecería en la lista y
  la mutación lo borraría sin que nadie lo pidiera.
- "Que el SUBIO" necesitó tabla propia: todo lo que sube el portal va con el
  token de servicio, así que en Monday los 8 assets de OPP-0506 aparecen
  subidos por "Efrain Ponce Salinas". Desde hoy cada subida deja renglón en
  `archivo_subido` y solo ese correo (o un admin) puede borrar el archivo. Los
  archivos anteriores no tienen dueño registrado: los puede borrar el dueño del
  proyecto — que es lo que deja a Ricardo limpiar el suyo.
- Escribir sigue pidiendo scope `'own'` (`getItem(..., 'own')`): un líder de
  zona ve los documentos de su equipo y no los borra.
- `archivoBorrado.test.ts` ancla las dos mitades: la lógica pura (empate por
  assetId cuando dos archivos se llaman igual, quitar uno y no los dos, el key
  del respaldo, quién puede borrar) y que `update_assets_on_item` aparezca en un
  solo archivo, con respaldo y tope antes de la mutación.
- `docs/code-index.md`: la entrada de `itemOculto.ts` (borrado en la entrada
  anterior) se reemplazó por `itemBorrado.ts` y se agregó `archivoBorrado.ts`.
- Probado en producción (suplantando a Ricardo y al comprador dueño del
  proyecto): se fue el duplicado de la DECLARACION, la segunda llamada da 404,
  y los otros dos documentos siguen en Monday. El respaldo quedó en R2 con su
  renglón en `archivo_borrado`.
- Ahí salió un bug: la ruta buscaba el archivo en el ESPEJO, que tarda en ver
  una subida — borrar algo recién subido contestaba "ese documento ya no está en
  el proyecto". Ahora lo busca en vivo (`buscarArchivo`), igual que la lista que
  se reescribe.
- `CLAUDE.md` decía que los archivos se ocultaban "porque la API de Monday no
  sabe quitar un archivo suelto". Corregido con la regla real y sus guardas.

## 2026-08-19 (11)

- **Editar una línea ya no tira el costeo de toda la cotización.** Efraín
  (2026-08-19): "esto hay que resolverlo, no podemos perder toda la info". El
  versionado automático del 2026-08-14 llamaba a `duplicateVersion`, que regresa
  la Etapa Costeo de **todas** las líneas a "No iniciado" — cambiar el color de
  una línea de 15 borraba el rastro de las 14 que Compras ya había costeado y
  obligaba a repasarlas todas.
- `duplicateVersion` ahora recibe **qué resetear**. `'todas'` (default) es el
  "+ Nueva versión" explícito: el vendedor está re-cotizando y el borrador
  completo es justo lo que pidió. Una **lista** es el versionado automático:
  editar una línea resetea SOLO esa (`[lineaId]`), y borrar o agregar una no
  resetea ninguna (`[]`) — la que se borró queda en la versión archivada y las
  vivas siguen costeadas igual.
- El resto del pipeline ya trabajaba por línea: `enviarACosteo` no recongela una
  línea costeada y solo manda las pendientes, y `checkCosteo` reactiva el botón
  con que haya **una** pendiente. El reset en bloque era el único que razonaba
  "toda la cotización".
- **El guard del auto-versionado pasa de "es borrador completo" a "ya hay alguna
  línea pendiente"** (`hayLineaPendiente`, nuevo, junto a `esDraftVigente`): con
  el reset por línea la vigente casi nunca queda entera en borrador, y sin este
  cambio cada tecleo posterior habría archivado otra versión (V2, V3, V4…). La
  primera edición sobre una cotización enteramente costeada archiva la foto de
  ese estado; mientras quede trabajo pendiente, las siguientes solo editan.
- **UI:** "Mandar a costeo" ya no exige que TODA la vigente esté en borrador,
  basta con que quede una línea pendiente — la UI pedía `.every` mientras el
  server siempre evaluó `.some`, así que con el reset por línea el botón se
  habría escondido justo cuando hace falta. De paso el grid deja de esconder
  Precio/Subtotal/IVA/Total después de cada edición (eso era el modo borrador).
- La notificación a la otra parte dice cuál de los dos pasó: "todas las líneas
  regresaron a costeo" o "solo la línea que cambió; el resto conserva su Etapa
  Costeo".
- `worker/lib/quoteVersions.test.ts` (nuevo) ancla lo puro: `lineasAResetear`
  (todas / solo la editada / ninguna, y nunca reescribe una línea que ya estaba
  pendiente) y la diferencia entre `esDraftVigente` y `hayLineaPendiente`.
- Commiteado desde un worktree aparte: otra sesión tiene el árbol principal con
  cambios en vuelo sobre estos mismos archivos (borrado real en Monday).

## 2026-08-19 (10)

- **Ricardo no podía mandar a costeo y el error hablaba de una línea invisible.**
  Efraín con la foto de la pantalla de Ricardo (OPP-0923): "Error a RICH no puede
  mandar a costeo sin razón, yo no veo el error pero él sí". El aviso decía
  `Nueva línea: ⚠️ Cantidad incorrecta. ⚠️ Compras debe subir la ficha comercial
  a Airtable` sobre una línea que en el portal no existía.
- La causa: esa misma mañana "borrar una línea" pasó a ser OCULTARLA
  (`item_oculto`) para cumplir la regla de no borrar en Monday. La línea salía
  del portal y seguía viva en Monday — y `validar_costeo` (cmp-tallas) lee los
  subitems DIRECTO de Monday. Encontró la línea vacía (sin producto, cantidad 0),
  rechazó el envío y revirtió la etapa. El pre-chequeo del portal, que lee D1 sin
  las ocultas, daba todo en verde: por eso Efraín no veía nada y Ricardo sí.
- Efraín: "necesito que se borren las líneas por favor, que todo sea 1-1 con
  Monday si no errores van a pasar". El problema no era solo el bloqueo: una
  línea quitada CON datos pasa la validación y se cotizaba al cliente igual.
- Producción: se borraron en Monday las 17 líneas que estaban marcadas como
  quitadas (1 vacía en OPP-0923 + 8 en OPP-0921 + 8 en OPP-0716), con respaldo
  previo de sus columnas y verificando id por id que existieran, que fueran del
  board de subitems y que su padre fuera el esperado. D1 quedó igual que Monday.
- El código ahora borra de verdad, por un solo camino: `worker/lib/itemBorrado.ts`
  (borra en Monday + mirror). `itemOculto.ts` se eliminó y `dal.ts` dejó de
  filtrar ocultos. Cambian los cuatro caminos que ocultaban: DELETE genérico de
  `/api/boards`, eliminar línea de cotización, eliminar línea de proyecto y
  restaurar una versión vieja.
- Las guardas del incidente del 2026-08-18 se quedan, ahora en ese archivo:
  respaldo del renglón completo (nombre + todas las columnas) en `item_borrado`
  ANTES de borrar, de a un id a la vez, y tope de 40 borrados por hora y persona
  (un bucle se corta ahí; restaurar una versión de 15 líneas cabe de sobra).
- `monday.destructivo.test.ts` deja de prohibir `delete_item` y ahora ancla que
  aparezca SOLO en `itemBorrado.ts`, que el respaldo y el tope estén antes del
  borrado, y que no se borre a partir de listas de ids. Las demás mutaciones
  destructivas (`delete_board`, `delete_column`…) siguen prohibidas.
- Los ARCHIVOS siguen ocultándose (`archivoOculto.ts`): la API de Monday no sabe
  quitar un archivo suelto de una columna `file`, solo vaciar la columna entera.

## 2026-08-19 (9)

- **Compras ya puede cambiar color y cantidad en la cotización.** Elizabeth
  (WhatsApp, 2026-08-19): "oigan no he hecho nada, solo abrí la oportunidad y no
  me deja cambiar colores o las cantidades" — con la captura del board Costeo y
  los dos campos subrayados. Efraín: "en cotización los de compras SIEMPRE
  pueden modificar colores y cantidades, acuérdate de hacer mini versiones 1.1.
  Habilita los cambios a compras".
- El candado real estaba en `shared/visibility.ts`: Color (`text_mm07s2mg`) y
  Cantidad (`numeric_mkzm6399`) eran `w: WV` (vendedor+admin), y `outbox.ts`
  gatea con `canWrite()` — la grid solo reflejaba eso. Pasan a `w: V`. Producto,
  embellecimiento y Precio de Venta NO se tocan: siguen siendo de Ventas y de
  admin respectivamente (anclado en `shared/visibility.test.ts`).
- **El cambio de Compras no reinicia el costeo**: un PATCH de vendedor sobre una
  línea ya costeada archiva la vigente y regresa la Etapa Costeo de TODAS las
  líneas a "No iniciado" (auto-versionado del 2026-08-14). Aplicado a Compras eso
  significaba tirar su propio costeo por corregir un color. Ahora, si el que
  escribe es Compras y solo toca color/cantidad, se asienta una **mini versión
  V{n}.{m}** en `cotizacion_ajustes` — el mismo registro que "Ajustar línea", que
  ya sale en los chips de versión y marca la línea como "Editada". Si el mismo
  PATCH arrastra producto o embellecimiento, versiona completo como siempre.
- `worker/lib/lineaAjustes.ts` expone `esAjusteInlineCompras` (puro, con test) y
  `registrarAjusteInline`; `worker/routes/boards.ts` elige camino antes del write
  y asienta la mini versión después, best-effort — la trazabilidad nunca convierte
  un write ya aplicado en un 500, y un borrador sin costear no genera subversión.
- En la grid, `inlineEditableCols` acepta un modo "compras" que abre color y
  cantidad aunque el board sea de solo lectura (Costeo). Se apaga en Validación
  (ahí lo único editable es el Precio de Venta) y en una oportunidad ajena de
  líder de zona. En Ganada/Perdida las líneas siguen bloqueadas inline y el
  camino es el lápiz "Ajustar línea", que Compras ya tenía.
- `lineaAjustes.test.ts` ancla que las dos mitades (mini versión vs versionable)
  sumen exactamente `LINE_DEFINING_COLS`: si alguien agrega una columna
  definitoria allá y no la clasifica aquí, truena en vez de colarse como mini
  versión.

## 2026-08-19 (8)

- **QA agresivo en producción: reglas escritas + arnés que las ejecuta.** Efraín
  (2026-08-19): "necesito que hagas mejores test en Prod… tú solo checas cosas
  mínimas, quiero un QA agresivo, sabiendo qué pasa cuando algo se mueve". El
  caso que lo detonó: en la Zona Efrain no pudo crear una oportunidad, costearla
  y meterle precio, y ninguna prueba existente lo habría detectado — todas se
  conformaban con que el endpoint contestara 200.
- **`docs/qa-prod.md`** es el entregable principal, y por pedido explícito de
  Efraín ("deja un .MD con el proceso, no solo código") incluye el **happy path
  escrito paso por paso y por rol** (Ventas levanta → Compras costea → Dirección
  valida → Ventas cotiza y gana → Compras/Logística ejecutan), además de las 9
  reglas: relectura obligatoria tras cada escritura, números contra la fórmula
  reescrita a mano, probar el SEGUNDO cambio, candados verificados contra el
  server y no contra la UI, PDFs parseados en vez de pesados, procedencia del
  dato auditada punta a punta, nunca actuar sobre una lista sin contarla, un
  paso que no corrió es falla y no "saltado", y todo lo que se escriba debe
  poder borrarse.
- **`scripts/qa-prod.mjs` + `scripts/qa/{lib,catalogo,ciclo,blindaje}.mjs`** —
  89 checks. Suplanta roles reales vía `X-Impersonate-Email`
  (`worker/mw/identity.ts`), así que los permisos se prueban como vendedor, como
  compras y como un admin fuera de la whitelist, sin pedirle la contraseña a
  nadie. Los PDFs se leen con `pdfjs-dist` (ya era dependencia) y se afirma
  sobre su CONTENIDO: productos, cantidades, el proveedor por razón social y no
  por id, el total calculado aparte — y lo que NO debe salir (la solicitud de
  costeo no lleva precios). Supera a `scripts/e2e-zona-efrain.mjs`, que se deja
  intacto por si otra sesión lo usa.
- **Las fórmulas del costeo se reescribieron a mano** desde
  `docs/monday-column-map.md` en vez de importar `worker/lib/costeoSnapshot.ts`:
  importarlo probaría que el código es igual a sí mismo.
- **La primera corrida completa encontró 6 cosas reales**, todas anotadas en la
  sección "Hallazgos abiertos" del doc y dejadas EN ROJO a propósito:
  1. La **hoja de validación sale con costos y subtotales en `$0`** en la Zona
     Efrain — una línea nativa no recibe columnas de fórmula (nadie las calcula)
     y la plantilla las imprime tal cual, aunque la línea sí tenga costo y precio
     capturados. La cotización al cliente no sufre esto porque calcula aparte.
  2. El write path **acepta una etiqueta de status que no existe**: `PATCH
     color_mm084gvf: "Etiqueta Que No Existe QA"` devuelve 200 y la guarda como
     texto crudo en vez de `{index}` — misma forma del bug que desaparecía al
     Proyecto nativo de los boards que filtran por índice, y en un item real de
     Monday una etiqueta desconocida hace que Monday asigne otra al azar.
  3. **2 productos sin sincronizar desde Airtable** (`Pantalon Command`:
     costo 858.48, USD y gastos 0.05 → todo vacío en el portal; `OUISTITI`).
  4. **36 productos guardan un id de Airtable que ya no existe** → su imagen sale
     vacía en las cotizaciones.
  5. **27 productos en EUR/GBP**: el costeo solo distingue USD (TC=18) del resto
     (TC=1), así que se costean como si el costo estuviera en pesos.
  6. El **PDF de solicitud tarda >1 min** en abrirse desde el drawer (el
     documento está en D1 al instante, pero el botón lee R2 y la subida va en
     segundo plano); el check mide la demora en cada corrida.
- **Dos checks propios se corrigieron por falsos positivos**, no el código: un
  tope inventado de "costo absurdo" (el catálogo tiene sistemas de 28 M reales) y
  aserciones sobre `lookup_mm5ck4b3` / `lookup_mkznm0h3`, que la API no expone a
  NINGÚN rol — que esos espejos llegan bien se comprueba indirecto (el costo por
  el snapshot, los colores porque `costeo-check` valida contra ellos).
- La corrida escribe en producción (nativo en Zona Efrain, Monday no se toca) y
  consume folios globales de OC que no se pueden regresar. Todo lo creado durante
  el desarrollo se borró con `node scripts/qa-prod.mjs --limpiar`; el tree quedó
  verde en `npm test` (417), typecheck y lint.

## 2026-08-19 (7)

- **"Pendiente de costeo" mentía cuando el producto nunca tuvo costo.** Efraín
  (2026-08-19): "Pendiente de costeo no es correcto, es agregar precio en
  Airtable". El aviso supone que alguien va a costear; si el CATÁLOGO no trae
  Costo Distribuidor no hay nada que esperar — esa columna
  (`numeric_mkzpx7eb`) es de solo lectura en el portal (`vis: AC` sin `w`), se
  captura en Airtable y baja por el sync del catálogo. Ahora la línea dice
  **"Falta costo en Airtable"**. No es un caso raro: **685 de 1335** productos
  del mirror no traen costo.
- Aplica en el board **Costeo** y en la **Zona Efrain** (decisión de Efraín):
  cambia el texto del aviso, no lo que se puede hacer — el Costo distr. C/U de
  la línea se sigue pudiendo teclear igual.
- Si NO se puede saber (sin producto ligado, o un rol que no ve esa columna —
  vendedor), el aviso se queda en el genérico: `productoSinCosto` devuelve
  `undefined` en vez de afirmar algo falso.
- `numeric_mkzpx7eb` entra a `CATALOGO_COLS` — sin eso la lectura llegaba
  siempre vacía y el aviso habría salido en TODAS las líneas. Lo cachó
  `src/lib/catalogoCols.test.ts`, que rehace la auditoría de columnas sola.

## 2026-08-19 (6)

- **Zona Efrain: elegir el producto ya deja la línea COSTEADA.** Efraín
  (2026-08-19): "en Zona Efrain todo se puede hacer de jalón, entonces cuando
  seleccionas un producto debe poner al día todo". Antes la línea nativa
  copiaba los espejos del catálogo (SKU, ficha, colores, tallas, costo *auto*)
  pero las columnas de costeo REALES —Costo distr. C/U, Desc. %, Gastos %, IVA,
  Tipo de cambio, precio sugerido— seguían vacías: la grid pintaba "Pendiente
  de costeo" y Costo real en $0 aunque el catálogo ya tuviera el dato. Se
  llenaban solo al "Mandar a costeo", que en la zona privada es un ida y vuelta
  que no existe (la misma persona cotiza, costea y aprueba).
- **El camino NO nativo no cambia en nada**: el estampado cuelga de
  `stampProductoEnLinea`, que solo corre bajo `isNativeId`
  (`worker/lib/outbox.ts`). En el pipeline normal el costeo lo sigue congelando
  "Mandar a costeo" con Compras de por medio, con los mismos valores de
  siempre.
- Fórmula e ids del snapshot salieron de `worker/lib/costeo.ts` a
  **`worker/lib/costeoSnapshot.ts`** (módulo hoja): `nativeMirrors.ts` no puede
  importar `costeo.ts` sin cerrar un ciclo (costeo → outbox → nativeMirrors).
  Es exactamente el mismo snapshot, no una copia paralela.
- La **moneda de la línea** (`color_mm5s709s`) también sigue al catálogo, con
  el shape `{index}` de Monday; si el producto nuevo NO trae costo, el costeo
  se **limpia** en vez de dejar el del producto anterior (y vuelve a salir el
  aviso "Pendiente de costeo", que es la verdad).
- El **Precio de Venta C/U** (`numeric_mkzneg3d`) no se toca: es la única
  columna que decide una persona (`w: ['admin']`). Lo que sí se llena es el
  precio sugerido, igual que el costeo normal.
- `worker/lib/nativeMirrors.test.ts` ancla las 4 reglas (costeo estampado en
  MXN, TC=18 y moneda en USD, limpieza sin costo, y que el Precio de Venta C/U
  nunca se escriba).

## 2026-08-19 (5)

- **Los mapas de "Estado del producto" llevaban semanas desfasados de Monday**
  (Efraín, 2026-08-19: "monday es la verdad, copia todo lo que se hizo"). El
  board había cambiado `color_mm0hqf79` y nada avisó, porque las dos rutas que
  lo consumen fallan EN SILENCIO: `maybeLogProductoStatus` hace
  `if (!newLabel) return` y `LABEL_TO_BUCKET` ignora lo que no conoce.
  - Índice 5: "Enviado con el" → **"Pendiente de Recolectar"**. El historial de
    estados venía asentando la etiqueta vieja.
  - Índices 11/12/13 (ALMACEN CDMX, ALMACEN MERIDA, "Pendiente de Recoleccion")
    no existían en `PRODUCT_STATUS_LABELS`: esas transiciones NO se registraban
    y esas líneas no sumaban a ningún segmento de la batería del Proyecto.
    Ahora también se pueden elegir en el selector del tab Ejecución.
  - Buckets asignados por criterio del portal (Monday no los define):
    recolección pendiente → "Por surtir"; ALMACEN CDMX/MERIDA → "En camino",
    igual que "En CMP para entrega cliente".
- **Dos columnas de Logística estaban rotuladas al revés.** En Monday
  `text_mm4pywyx` pasó a llamarse "#GUIA - EMPRESA" y `file_mm4pz90b` "Guia EMB
  o Cliente Final" — intercambiados respecto a como los pintaba el portal, o
  sea que Compras capturaba cada guía en el campo del otro. También
  `date_mm4p59q2` es "Fecha Recolección", no "Fecha confirmacion". Los rótulos
  y los nombres de las constantes ya siguen a Monday; la llave del API de
  subida (`guia-empresa`) se queda como está a propósito: es interna y
  renombrarla rompería subidas en vuelo.
- **`shared/estadoProductoLabels.test.ts`** ancla los mapas contra
  `column-meta.gen.ts`: en cuanto alguien regenere el meta y deje los mapas
  atrás, truena en vez de degradar en silencio. Probado a la inversa (quitando
  una etiqueta el test falla).
- Las columnas NUEVAS del board (ALMACEN 5.11, Fecha de Llegada, Flete Extra
  Final, Fecha Entrega Cliente) NO se expusieron: eso es cambiar la whitelist
  de `shared/visibility.ts` y esa decisión es de Efraín.

## 2026-08-19 (4)

- **"Etapa Costeo" y "Listo" aparecían como zonas de venta.** No era del
  portal: la columna Zona del board Oportunidades (`dropdown_mm03g067`) tenía 9
  etiquetas en Monday y las dos últimas eran basura. Verificado contra la API
  antes de tocar nada: **cero oportunidades** las usaban.
  - Borradas en Monday (Efraín autorizó el 2026-08-19). La API exige quitar
    UNA etiqueta por llamada — `update_column` con más de un borrado responde
    "Deleting or updating more than one label is unsupported without actions",
    así que van dos mutaciones encadenando la `revision`.
  - `shared/column-meta.gen.ts` regenerado: los labels que ve el form salen de
    ese archivo estático vía `toColMeta`, NO del mirror, así que sin regenerar
    el portal habría seguido ofreciéndolas.
- **La re-introspección destapó drift del board Líneas de Proyecto** (nadie lo
  había regenerado en semanas). Queda asentado en el generado; los mapas
  hardcodeados NO se tocaron porque cada uno necesita decisión de Efraín:
  - `color_mm0hqf79` índice 5 hoy es "Pendiente de Recolectar" (antes vacío),
    pero `PRODUCT_STATUS_LABELS` lo llama "Enviado con el" → el historial de
    estados asienta la etiqueta equivocada. Mismo tipo de bug que el corregido
    el 2026-08-13.
  - Índices 11/12/13 (ALMACEN CDMX, ALMACEN MERIDA, "Pendiente de Recoleccion")
    no existen en ese mapa: `maybeLogProductoStatus` hace `if (!newLabel)
    return` → esas transiciones no se registran, en silencio. Tampoco están en
    `LABEL_TO_BUCKET`, así que no cuentan en la batería del Proyecto.
  - "Pendiente de Recolectar" (5) y "Pendiente de Recoleccion" (13) parecen la
    misma etiqueta duplicada en Monday.
  - `text_mm4pywyx` y `file_mm4pz90b` INTERCAMBIARON título en Monday: el texto
    ahora se llama "#GUIA - EMPRESA" y el archivo "Guia EMB o Cliente Final" —
    justo al revés de como los rotula LogisticaSection.tsx. Y `date_mm4p59q2`
    pasó de "Fecha confirmacion" a "Fecha Recolección".

## 2026-08-19 (3)

- **Un campo elegido en "Nueva oportunidad" no se podía dejar vacío.** Ni el
  combobox (Vendedor, Vendedor secundario, Compras, Contacto, Institución,
  Zona) ni los chips (Tipo de cotización, ¿nuevos productos?) tenían forma de
  volver a "sin valor": una vez tocados, la única salida era elegir OTRA opción
  o cerrar el modal y volver a empezar. Efraín lo reportó el 2026-08-19.
  - `SearchableSelect`: botón **×** a la derecha del campo cuando hay algo
    elegido (22px, oculto si el campo está deshabilitado). Va por `mousedown`
    con `preventDefault` para ganarle al `onFocus` del input, que si no reabría
    la lista al instante. Backspace/Delete con la caja de búsqueda vacía limpia
    también.
  - `ChipSelect`: volver a hacer click en el chip ya elegido lo deselecciona.
  - Limpiar el Vendedor arrastra el Contacto (ya existía ese efecto: el contacto
    debe pertenecer al vendedor), así que el form no queda en un estado inválido.
  - Verificado con Playwright montando ambos componentes en aislado.

## 2026-08-19 (2)

- **El respaldo de D1 nunca había producido un archivo.** Al preguntarse qué red
  de seguridad tiene D1 si el desastre pasa allá, la respuesta resultó ser "solo
  Time Travel": el export semanal a R2 corrió UNA vez (2026-08-15), falló con
  `access to _cf_KV.key is prohibited` y nadie se enteró — el cron era semanal y
  el error solo se asentaba en `sync_log`. Confirmado contra la API de R2: cero
  objetos bajo `backups/`. El bug del `_cf_KV` ya estaba corregido, pero sin
  forma de probarlo hasta el siguiente sábado.
  - `POST /api/admin/backup` (solo admin) dispara el respaldo y devuelve la
    llave y el TAMAÑO del archivo escrito, para poder verificar de inmediato que
    de verdad quedó algo en R2 y no otro fallo silencioso.
  - El cron pasa de semanal a DIARIO mientras se estabiliza.
- **Nuestro propio log de actividad guardaba el cambio sin el "antes".**
  `parseEntry` leía solo `previous_textual_value`, y Monday NO lo manda para
  todos los tipos: en las columnas NUMÉRICAS solo viene `{"value": "1170"}`.
  Medido el 2026-08-19: **Precio de Venta, 918 filas, CERO valores previos**,
  mientras que Historial precios (texto largo, que sí trae textual_value) tenía
  83 de 89. Por eso los 1,081 precios del incidente solo se pudieron devolver
  leyendo el activity_log de MONDAY — el nuestro no servía. Para los items
  NATIVOS, que no tienen activity_log en Monday, no habría habido de dónde.
  - `textualOf` (puro, con tests) saca el texto de las formas reales de Monday:
    `{value}` numéricas, `{label:{text}}` status, `{date}`, `{url}`, listas de
    board_relation/people. Se usa como respaldo cuando falta el textual.
  - Un `0` legítimo no se pierde (está anclado en un test).

- **Reparación del incidente del 2026-08-18** (ver entrada anterior), toda
  verificada releyendo Monday, no confiando en lo que reportó cada script:
  - 1,081 líneas con el precio falso: 896 devueltas a su valor real (del
    `previous_value` del activity_log de Monday) y 184 vaciadas — esas nunca
    tuvieron precio, el script se lo inventó. Verificación final: 1,080/1,080
    correctas, cero discrepancias.
  - 70 líneas restauradas de la papelera de Monday perdieron el vínculo al
    producto: **Monday no restaura las columnas connect-boards**. Se repusieron
    89 cruzando snapshots del portal + espejo + SKU. Un snapshot venía MAL
    (decía USWPT24008 donde el SKU real era PA2011) — de ahí que cada
    reasignación se verificara contra el SKU de la propia línea.
  - 85 líneas quedaron con Etapa Costeo en "No iniciado" por el
    `duplicateVersion` que disparó el borrado falso; 15 seguían así y se
    devolvieron a Listo/En curso, 70 ya se habían movido solas.
  - Barrido de 30 días en Monday con el detector correcto (ráfagas que tocan
    MÁS DE UNA oportunidad): no había pasado antes.
  - `scripts/e2e-zona-efrain.mjs` tenía el mismo `?parent=` y estampaba datos de
    prueba sobre la primera línea del board entero. Corregido.

## 2026-08-19

- **El portal ya NUNCA borra en Monday** (Efraín: "no se puede NUNCA NUNCA NUNCA
  borrar de monday — solo modificar y o duplicar o crear"). El 2026-08-18 un
  script de verificación limpió su rastro con
  `GET /boards/oportunidades_sub/items?parent=<opp>`; ese parámetro NO existe en
  esa ruta (acepta `q` y `cols`), se ignoró en silencio, la respuesta trajo el
  board COMPLETO y el loop de borrado que venía detrás se llevó **70 líneas de
  22 oportunidades** en 4.5 minutos. Nada lo frenó: el viewer era admin
  (`unrestricted` en dal), no hay rate limiting de entrada, y `delete_item`
  estaba a un import de distancia. Las 70 quedaron recuperables en la papelera
  de Monday.
  - `deleteItem` ya no existe en `worker/lib/monday.ts`. "Borrar" desde el
    portal ahora es OCULTAR (`worker/lib/itemOculto.ts`): el item desaparece de
    las lecturas del portal (dal: listItems/getItem/childrenOf/getItemTrusted) y
    sigue intacto en Monday. El estado vive en su propia tabla `item_oculto`, no
    en `items`, para que refetch/reconcile no resuciten la línea.
  - Los cuatro caminos que borraban ahora ocultan: DELETE genérico de boards,
    "ajustar línea → eliminar", línea de Proyecto y las líneas que quedan fuera
    al restaurar una versión. Excepción: items NATIVOS (Zona Efrain) no existen
    en Monday, ahí D1 es el sistema de registro y sí se borra la fila.
  - Anclado en `worker/lib/monday.destructivo.test.ts`: lee el fuente del worker
    y falla si aparece cualquier mutación destructiva de Monday, venga de un
    helper o de un gql armado a mano.
- **Las rutas rechazan query params que no conocen** en vez de ignorarlos
  (`rejectUnknownQuery`, `worker/lib/http.ts`, con tests). Un filtro mal escrito
  no debe degradar a "sin filtro": en una ruta de lista eso convierte un error
  de tecleo en un barrido del board entero. Aplicado a la lista y al detalle de
  boards.
- **`scripts/e2e-zona-efrain.mjs` tenía el mismo bug**: pedía las líneas del
  Proyecto con `?parent=` y se quedaba con la primera línea del board ENTERO,
  que después estampaba con datos de prueba. Ahora filtra del lado del cliente.


## 2026-08-18

- **Un vendedor nuevo aparecía cambiando el Precio de Venta** (Efraín: "¿cómo
  pudo Rodrigo cambiar el precio?"). No lo cambió: la actividad de los items
  nativos guardaba solo el `monday_user_id`, y "Actuar en Monday como"
  (alta de usuarios, 2026-08-06) hace que varias filas de `identity` compartan
  ese id a propósito. El tab Actividad armaba el mapa de nombres por id, así
  que la ÚLTIMA fila con ese id le ponía su nombre a todas las ediciones — las
  del admin incluidas. La whitelist nunca se rompió: `numeric_mkzneg3d` es
  `w: ['admin']` y outbox rechaza el write antes de tocar nada.
  - `activity_log` estrena `actor_email`: quién editó de verdad. Lo llenan los
    seis caminos que asientan actividad directo (outbox nativo y portal,
    createRecord, alta/baja de líneas). Las filas viejas no lo traen.
  - `actorNameResolver` (puro, con test): manda el correo; sin correo se usa el
    roster de Monday —la persona bajo la que se actuó, lo único que de verdad
    se sabe de esas filas— y `identity` solo rellena ids que el roster no
    conoce (usuarios nativos) y que no comparta nadie.
- **La zona privada 'Efrain' se autoriza por CORREO, no por monday_user_id.**
  Mismo origen: el id prestado hacía que un vendedor heredara la zona entera
  —tab de Zona Efrain, alta de registros dentro y las notificaciones
  reservadas a la whitelist— sin que apareciera en ninguna pantalla. Son las
  mismas tres personas de siempre, ahora listadas por sus correos; anclado en
  `worker/lib/zonas.test.ts`.
  - Además, el alta de usuarios rechaza prestar el id de alguien de la zona
    privada o de la whitelist: el scoping de renglón va por id y eso deja ver
    sus oportunidades aunque ya no herede lo demás.
- **Fricción portal vs Monday: un rastro estaba muerto.** `uxMetrics` buscaba
  `dedupe_key LIKE 'native:%'` y `recordDirectChanges` escribe `direct:%`, así
  que ese rastro nunca clasificó nada (el fixture del test repetía el prefijo
  equivocado). Los otros tres cubrían casi todo; ahora también cuenta el
  costeo de la OC en items reales.

- **La cotización nativa se construye con Eledo, igual que la real** (Efraín:
  "replicar la construcción de una cotización con Eledo y DocuSeal nativo").
  Desde el 2026-08-13 la Zona Efrain generaba su propio PDF con el motor del
  portal — servía como respaldo, pero no es el documento que ve el cliente.
  - `generarCotizacionNativeD1` ahora arma el MISMO payload de Eledo que el
    flujo real (`buildEledoFile`, plantilla `template_cotizacion_v2`), en sus
    dos versiones: con precio y sin precio. Las líneas salen del mirror en D1
    (`buildProductLinesFromMirror`) porque a Monday no se le puede preguntar
    por un item que no existe ahí; los datos que necesita —SKU, marca, ficha,
    unidad, id de Airtable— ya los deja `nativeMirrors.ts` al elegir producto.
    La imagen del producto sigue viniendo de Airtable.
  - Los PDFs no pueden subirse a una columna de archivo de Monday: van a **R2**
    y en la columna queda el marcador con el nombre (`stampNativeFileMarker`),
    que es lo que enciende los cuadros "Costeo"/"Sin firmar" de la UI igual que
    en una oportunidad real. `cotizacionR2Key` centraliza la convención de
    carpetas: quien escribe y quien lee llaman a la misma función. La ruta
    `/api/oportunidades/:id/cotizacion-pdf/:kind` sirve esos bytes desde R2
    cuando el id es nativo (antes solo sabía resolver assets de Monday).
  - Firma y correo por DocuSeal con el PDF de Eledo en base64, sin bcc a
    administración (zona privada). Si DocuSeal falla, la cotización igual queda
    guardada y el motivo se postea en Actualizaciones.
  - **Secrets que faltaban en el Worker de producción**: `ELEDO_API_KEY` y
    `AIRTABLE_API_KEY` (vivían solo en `.env` porque hasta ahora el único que
    renderizaba con Eledo era cmp-tallas). Ya están puestos.
  - La plantilla `cotizacion` de documents.ts queda sin uso — se conserva como
    respaldo si Eledo se cae.

- **La hoja "Costeo — Validación" ahora sí trae el precio, y sin IVA** (Efraín,
  viendo el PDF de OPP-0913: "el documento de validacion esta mal... no tomas el
  precio y el iva no nos interesa" + "obvio necesito el precio si no no sirve de
  nada"). No era una columna mal leída: el documento se congelaba en el momento
  equivocado. Cronología de OPP-0913 (hora CDMX): 10:20 se capturan IVA % y
  Margen Gob, **10:31 se genera el documento con el Precio de Venta todavía
  vacío**, 12:16 se escribe el precio por primera vez (8,500) y hasta 14:37
  queda en 2,490. De ahí el $0 en precio/subtotal/total y la utilidad negativa
  igual al costo (−156,765 = −6,270.6 × 25).
  - **El disparo se mueve de "Mandar a validación" (15→7) a "Validar costeo"
    (7→9)** — Efraín eligió moverlo, no duplicarlo. El precio se captura
    *durante* la validación, así que ese es el primer punto del flujo donde
    existe; además "Validar costeo" es literalmente la aprobación de esa columna
    y la UI ya no deja apretarlo sin ella. Se pierde el documento del momento en
    que se pidió la validación — aceptado a cambio de que el que queda sirva.
  - `refetchItemTree` **antes** de generar (no `refetchItem`): el precio se
    captura seguido en Monday directo, y el documento congela lo que vea el
    espejo. Releyendo solo el padre, las líneas podían entrar con el precio
    viejo — el mismo bug, una hora más tarde.
  - Fuera **IVA** y **Total c/IVA** de la tabla (y del snapshot: ya no se
    guardan). Se llevaban el 18% del ancho y por eso los demás encabezados
    salían cortados ("COSTO REAL C…", "MARGE…", "UTILID…"); ese ancho se repartió
    y los encabezados se acortaron hasta que ninguno se corta. El pie ahora
    suma Subtotal y Utilidad en vez de Subtotal/IVA/Total.
  - `worker/lib/pdf/validacionCosteo.test.ts` ancla las dos cosas que pidió
    (precio impreso, IVA ausente) más "ningún encabezado con elipsis", que es
    lo que un typecheck jamás vería.

- **La cotización de la Zona Efrain sale a firma y por correo** (Efraín: "no me
  llegó la cotización por correo"). En una oportunidad nativa el portal genera
  su propio PDF y ahí se acababa: `generarCotizacionNativeD1` estaba escrito
  explícitamente "sin DocuSeal ni Drive", y DocuSeal es justo quien manda el
  correo.
  - **Por qué no se puede usar el endpoint de cmp-tallas aquí** (que sí es el
    camino normal): `POST /api/generate_cotizacion` recibe un `item_id` y lee
    la oportunidad **de Monday**. Una oportunidad de la Zona Efrain no existe
    en Monday — ese es el punto de la zona. No hay parámetro que arregle eso.
  - Entonces el Worker llama a DocuSeal directo (ya lo hacía para el flujo
    nativo-sobre-Monday), con el PDF del portal **en base64**: `documents[].file`
    acepta base64 o URL (verificado contra api.docuseal.com), y una URL nuestra
    no le sirve porque `/api/*` está detrás de Cloudflare Access y DocuSeal no
    podría descargarla.
  - **Sin bcc a administración** en la zona privada (`bccCompleted: false`) —
    el resto del pipeline lo mantiene, como cmp-tallas.
  - No fatal: si falla (o el vendedor no tiene correo en Monday) la cotización
    igual queda guardada y se postea el motivo en Actualizaciones.
  - `DOCUSEAL_API_KEY` no estaba como secret del Worker en producción (vivía
    solo en `.env`, porque hasta hoy solo cmp-tallas firmaba). Ya está puesto.

- **"Mandar a costeo" se esconde por etapa** (Efraín, probando Zona Efrain:
  "tienes que ir escondiendo dinámicamente los botones dependiendo de la
  etapa… mandar a costeo siempre se queda, los otros sí se mueven bien"). El
  botón vivía SIEMPRE visible por decisión de 2026-07-17 y en media docena de
  etapas lo único que hacía era pintarse muerto con un banner rojo listando un
  "pendiente" imposible de resolver: *"Falta esto para Mandar a costeo: la
  oportunidad ya está en costeo"*.
  - `COSTEO_STAGE_BLOCKED` se muda de worker/lib/costeo.ts a
    **shared/dealStages.ts**: la UI esconde con la MISMA lista con la que el
    server rechaza, así no pueden desincronizarse. Con ella, `puedeMandarACosteo
    (stage, borradorPendiente)` — las dos condiciones de `checkCosteo`: la
    etapa no lo bloquea (en costeo, en validación, Ganada/Perdida/Cancelada) y
    hay algo sin costear (Nueva oportunidad o un borrador de versión).
  - El camino para regresar a costeo desde una etapa avanzada no cambia: es
    "+ Nueva versión", y en cuanto la vigente queda en borrador el botón
    reaparece solo. El banner rojo de pendientes ahora se muestra únicamente
    cuando el botón existe (en Nueva oportunidad sigue diciendo qué falta).
  - De paso, el poll de respaldo de `checkCosteo` (cada 8s) dejó de correr de
    por vida en oportunidades ya costeadas, donde nadie lo iba a leer.
  - Anclado en `shared/dealStages.test.ts`.

- **Zona Efrain = Costeo + Validación en una sola pantalla** (Efraín: "ZONA
  efrain debe ser igual que COSTEO y VALIDACION COSTEO, aquí no puedo cambiar
  nada ni costos ni precio ni nada, es una combinación de los dos"). El board
  privado heredaba la vista de **Venta**: sin columnas de costo (no existen en
  `GRID_COLS_VENTA`) y con Precio de Venta de solo lectura (solo el board
  Validación lo abre, vía `precioOnly`) — o sea, la única persona que trabaja
  ahí no podía costear NI poner precio en su propio board.
  - `GRID_COLS_ZONA` (gridMeta): se arma **desde** `GRID_COLS_COSTEO` (así una
    columna nueva de Costeo aparece sola aquí) y le suma "Con Embellecimiento",
    lo único que la vista de Venta edita en la grid y Costeo no pinta — en el
    pipeline normal esa marca es trabajo de Ventas desde Oportunidades, y sin
    ella no habría cómo prender un embellecimiento en la zona (la tab
    Embellecimientos solo lista las líneas YA marcadas).
  - `inlineEditableCols(lineEdits, precio)`: el precio es un eje aparte del de
    edición de líneas. **No relaja ningún permiso** — la celda sigue pasando
    por `writableIds` (`ColMeta.w`), y `numeric_mkzneg3d` sigue siendo `w: WA`
    (solo admin) en shared/visibility.ts; lo que cambia es que ya no se
    esconde donde el rol sí podía escribir. Anclado en `gridMeta.test.ts`.
  - Botón **"Mandar a Validación de costeo"** (etapa 15) y las **condiciones de
    la cotización** (comerciales/entrega/vigencia) vivían solo en el board
    Costeo: ahora también en la zona, con su mismo `checkValidacion` de
    respaldo. Sin eso el recorrido obligaba a salirse a /costeo/:id a medio
    flujo (se vio en el E2E de producción).
  - El reparto Ventas/Compras/dirección que justifica los candados de Costeo y
    Validación no existe en la zona privada: ahí la misma persona captura las
    líneas, costea y aprueba el precio.
  - Con el desglose visible saltó lo otro: en una oportunidad **nativa** las
    columnas de fórmula (Costo real, Costo total, Subtotal, IVA, Utilidad…)
    las calcula **Monday**, y esas líneas no viven en Monday — llegaban vacías
    y la grid mostraba "—" con TOTAL $0 aunque el costo y el precio estuvieran
    capturados. `previewRow(..., todas)` las deriva con la misma cadena ya
    verificada 1:1 contra Monday que usa el preview al teclear; es solo lo que
    se pinta (nada se escribe) y qué columnas se ven lo sigue decidiendo el
    meta filtrado por el server. Anclado en `costeoCalc.test.ts`.

- **Elegir la Institución desde la oportunidad, y que se ligue sola al contacto**
  (Efraín: "necesito que se pueda elegir una institución a la oportunidad y
  cuando lo haces lo ligas al contacto automáticamente… al crear una
  oportunidad o al modificarla en la vista de oportunidad"). Hasta hoy la
  Institución solo se podía corregir dando la vuelta por el board Contactos.
  - La oportunidad NO tiene columna propia de Institución: `lookup_mm1bs976` es
    un **espejo** del Contacto ligado. Elegirla escribe `contact_account` **en
    el contacto** — el mismo dato que ya editaba `EditContactoModal`, ahora
    alcanzable desde donde se trabaja. Eso también quiere decir que queda
    ligada al contacto y aparece en todas sus oportunidades; los dos lugares
    nuevos lo dicen en pantalla.
  - `POST /api/oportunidades/:id/institucion` (worker/routes/oportunidades.ts):
    scope `'own'` sobre la oportunidad, y el contacto pasa por `submitWrite`
    (whitelist de columna vendedor+admin + su propio scope `'own'`). Sin
    Cliente ligado se rechaza con el motivo en claro en vez de guardar en el
    aire; un contacto de otro vendedor devuelve 403 diciendo a quién pedirle.
  - `stampInstitucionEnOpsDeContacto` (worker/lib/nativeMirrors.ts): Monday
    recalcula ese espejo **diferido y sin webhook** (ya documentado en
    outbox.ts), así que el valor se adelanta en el mirror de TODAS las
    oportunidades del contacto — si no, el header seguiría en "Institución: —"
    hasta el reconcile de 6h, y en una oportunidad **nativa** para siempre
    (ahí nadie más calcula el espejo y `checkCosteo` la exige).
  - UI: lápiz "Cambiar institución" en el header del drawer
    (`EditInstitucionModal`, mismo patrón que "Cambiar cliente") y campo
    Institución en "Nueva oportunidad", precargado con la que ya trae el
    contacto y avisando cuando cambiarla reasigna al contacto. En el form la
    liga se escribe ANTES de crear: una oportunidad nativa copia el espejo al
    nacer (createRecord.ts) y al revés nacería con la institución vieja.
  - Verificado local: los cuatro rechazos del endpoint (sin institución, id
    inexistente, oportunidad sin cliente, oportunidad ajena) y las dos
    pantallas nuevas. El write feliz NO se probó en vivo — escribe en Monday
    real; queda para la prueba de Efraín.

- **Las imágenes de embellecimiento ahora se ven, ya no se descargan** (Efraín:
  "can you create an opener for images as PDFs, embellecimientos images have to
  be downloaded"). Los PDFs de cotización ya se abrían dentro del portal
  (`PdfCanvasPreview` en un `Modal`); las imágenes no tenían visor: el link
  "Ver archivo" mandaba a `/api/files/…` en otra pestaña y el navegador
  **descargaba** el archivo en vez de mostrarlo.
  - Causa real: el Content-Type. Monday sirve los assets de sus columnas de
    archivo como `application/octet-stream`, y R2 guarda lo que trajo el upload
    (a veces vacío). La miniatura sí se veía porque `<img>` no depende del
    Content-Type, pero navegar a la URL sí. `worker/lib/mime.ts` deduce el tipo
    de la extensión y lo aplican los tres caminos que sirven archivos:
    `/api/files/:key` (rama R2 y fallback a Monday) y el asset de
    `/api/boards/:slug/items/:id/asset/:assetId`, que hasta hoy solo distinguía
    PDF. `svg` queda fuera de la tabla **a propósito**: servirlo inline desde el
    origen del portal dejaría correr script dentro de esa pestaña.
  - `src/components/core/FilePreviewModal.tsx` — visor compartido: imagen o PDF
    (pdf.js sigue entrando lazy, no lo carga quien solo ve fotos), y para lo que
    el navegador no dibuja (HEIC de iPhone, .ai…) ofrece descarga en vez de un
    cuadro roto. Pie con "Abrir en pestaña" y "Descargar".
  - `ZoneImage` estrena el ojito que abre el visor (y la miniatura misma es
    clicable cuando no hay permiso de subir, donde no compite con el input de
    archivo), así que lo heredan las tres vistas que la usan:
    Embellecimientos de la Oportunidad, la del Proyecto y el panel de línea de
    Costeo/Validación — ahí la imagen era una `<img>` muerta de 28px sin forma
    de ver el archivo completo.

- **El historial de actividad ya no lo ve el vendedor** (Efraín: "las
  actividades (historial) no quiero que las pueda ver el vendedor, solo admin y
  compras"). El tab Actividad y el reloj por renglón nacieron en este mismo día
  para rastrear el costeo de la OC; la parte del historial que sí era del
  vendedor (etapa, fechas, nombre, precio de venta de su propia oportunidad)
  también queda fuera — es información interna de operación: quién se equivocó,
  cuántas veces se corrigió un precio, cuándo entró Compras a la línea.
  - `canReadActivity` en `shared/visibility.ts` (compras + admin) y **403 en el
    endpoint completo** `GET /api/boards/:slug/items/:id/activity`. Se niega
    entero y no columna por columna a propósito: el vendedor tiene permiso
    legítimo de leer sus oportunidades, así que el filtro por `canRead` que ya
    tenía el endpoint le seguía devolviendo el rastro de quién cambió qué.
    Almacén tampoco lo ve. Anclado en `shared/visibility.test.ts`.
  - La UI solo deja de ofrecer lo que el server niega: tab Actividad oculto en
    los drawers de Oportunidad y Proyecto, botón `📋` de la cotización oculto,
    y en el catálogo de **Productos** la fila deja de ser clicable (el clic
    abría justamente el historial del producto). `ActividadTab` no dispara la
    llamada y explica de quién es la vista, por si queda un deep link abierto.

- **Compras ya puede modificar las órdenes de compra, no solo generarlas**
  (Efraín: "los de compras necesitan poder MODIFICAR las órdenes de compra o
  crear nuevas a partir de productos que puede que no estén en la cotización" +
  "veo que no se puede modificar el COSTO C/U en órdenes de compra, eso se debe
  poder hacer y guardar la actividad por si cometemos error"). Todo escribe a
  Monday por el camino de siempre (outbox / create_subitem / delete_item), no
  se queda en D1.
  - Whitelist (`shared/visibility.ts`, decisión de Efraín en esta sesión):
    **Costo Distr. C/U** (`numeric_mm1dj4fp`), **Descuento** (`numeric_mm1dmsaz`),
    **Moneda** (`text_mm1gdsvg`) y **Proveedor** (`board_relation_mm1cfgv5`)
    pasan a `w: compras+admin`; eran `vis: AC` SIN `w`, así que el server
    rechazaba el PATCH viniera de donde viniera y había que entrar a Monday.
    La **fecha estimada de entrega del proveedor** (`date_mm20xdtm`) se saca del
    grupo de solo lectura: la escribe Compras, el vendedor la sigue VIENDO.
    Ventas y almacén siguen sin ver nada de esto — anclado en
    `shared/visibility.test.ts`.
  - Tab Órdenes de compra: cada celda de Cantidad/Costo/Moneda/Descuento/Entrega
    se edita con un clic y guarda al salir del campo; `⇄` mueve la línea a otro
    proveedor (o la deja sin proveedor, fuera de toda OC — con eso una línea
    sobrante sale de la OC sin borrarse) y `✕` la borra. El encabezado de cada
    tarjeta muestra ahora el **total de esa OC** ya con costo y descuento
    aplicados, que es contra lo que se revisa que no se fue un cero de más.
  - **"+ Agregar producto"**: `AgregarLineaModal` existía desde 2026-07-17 con
    su endpoint, pero no estaba colgado de ninguna pantalla — nunca se pudo
    usar. Ahora vive en el tab, y el alta lleva también costo/descuento/moneda
    para que una OC "de la nada" nazca completa (sin costo el PDF salía en
    ceros). Con un proveedor que no tenía líneas, se abre una tarjeta = una OC
    nueva.
  - `DELETE /api/proyectos/:id/lineas/:lineaId` propio en vez del DELETE
    genérico de `/api/boards`: ese no distingue rol (un vendedor podía borrar
    líneas del proyecto) ni deja rastro.
  - **Actividad con el actor real.** Monday atribuye TODA escritura del portal
    al dueño del token de la API, o sea que su activity_log dice siempre la
    misma persona — inútil justo donde el punto es saber quién se equivocó. El
    costeo de la línea del Proyecto (`PORTAL_WRITE_COLUMNS`) se asienta desde
    `outbox.ts` en el momento del write, con el valor anterior real y el usuario
    del portal; el eco que llega después por el delta sync se descarta con una
    ventana de 45 min, así que una edición hecha DENTRO de Monday sí se sigue
    registrando y no hay renglones duplicados. El borrado se asienta contra el
    Proyecto padre (una fila colgada del item borrado sería inalcanzable).
  - Se ve en dos lados, como pidió Efraín: el **reloj** de cada línea (su
    historial) y el tab **Actividad** del Proyecto (todo el proyecto y sus
    líneas), que además aplica el filtro de visibilidad por rol que ya tenía el
    endpoint.
  - Verificado en local contra el espejo real con el token de Monday
    invalidado a propósito (producción intacta): PATCH de costo 685.6 → 999.5 →
    712.3 con su historial, alta de línea con proveedor nuevo abriendo tarjeta
    ($23,940 = 3 × 8,400 × 0.95), borrado, y el tab Actividad mostrando las dos
    bajas. Gap conocido: en un Proyecto **nativo** (Zona Efrain) mover una línea
    con `⇄` deja el id crudo del proveedor como título de la tarjeta hasta el
    siguiente sync — el alta sí estampa el nombre.
  - Doble revisión pedida sobre la cotización: editar una línea desde el tab
    **Cotización** del acceso Órdenes de Compra sí modifica la Oportunidad y sí
    llega a Monday — `ajustarLineaVirtual` → `applyAjusteLinea` → `submitWrite`
    sobre `oportunidades_sub` + `flushOutbox`, y las líneas que muestra ese tab
    son literalmente las de la Oportunidad (`childrenOf`), no una copia. Lo que
    NO se toca entre sí (por diseño) son la cotización y las líneas del
    Proyecto: la primera es lo que se le vende al cliente, las segundas lo que
    se le compra al proveedor.

- Contactos e Instituciones también pueden vivir sin Monday (Efraín: "eso es
  vital también"). Era la fuga que quedaba abierta en Zona Efrain: la
  oportunidad ya nacía invisible del lado de Monday, pero su **Contacto**
  apuntaba a un item REAL — o sea que el negocio se ocultaba y *con quién* se
  está negociando (nombre, correo, teléfono, institución), no.
  - `submitCreateNative` deja de estar clavado a oportunidades: ahora recibe el
    slug (`NativeCreatableSlug` = oportunidades | contactos | instituciones).
    Todo lo demás ya era genérico por id nativo — scoping, edición, borrado,
    los guards de reconcile/refetch y los espejos de `nativeMirrors.ts`.
  - **Sin casilla ni forma aparte** (decisión de Efraín): lo que dan de alta las
    3 personas de la whitelist en esos dos catálogos nace nativo y punto —
    `submitCreate` lo deriva solo. Dentro del portal se comportan como cualquier
    otro registro (Contactos sigue scopeado por Vendedor, así que ningún
    vendedor ajeno los ve; un admin sí). Lo único que cambia es que no existen
    del lado de Monday. Oportunidades sigue pidiendo `native` explícito: ahí la
    decisión la toma el tab de la zona, no quién eres.
  - El contacto nativo también auto-estampa su Vendedor si el form no lo manda,
    igual que el camino real — sin eso quedaría invisible hasta para quien lo
    acaba de crear.
  - `nativeDisplayText` ahora resuelve las dos relaciones que el portal sabe
    seguir en su propio mirror (Oportunidad→Contacto y Contacto→Institución),
    en vez de solo la primera. Es la que alimenta el espejo "Institución" que
    `checkCosteo` exige.
  - **Guard nuevo, encontrado al diseñar esto**: un board_relation que apunta a
    un registro nativo no puede vivir en un item REAL — Monday recibiría un id
    que allá no existe y el enlace quedaría roto en silencio. `assertNoNativeLink`
    (worker/lib/nativeItems.ts) lo ataja con un mensaje legible en los dos
    caminos, creación y escritura. Anclado en test.

## 2026-08-18

- Los comentarios sí llegan al portal (notificación por cada update). Efraín:
  "los comentarios que ponen los vendedores no llegan al nuevo portal, ahorita
  entré y no hay ninguno; solo llegan las notificaciones cuando validan, paso a
  costeo y así. Esto es vital".
  - **Causa (verificada, no inferida).** Dos huecos encadenados: (1) Monday
    nunca avisaba — los webhooks registrados eran solo `create_item`,
    `change_name`, `item_deleted` (+ subitems); `create_update` NO existía en
    ninguno de los 5 boards (consultado en vivo con la query `webhooks`), así
    que un comentario escrito dentro de monday.com era invisible para el Worker.
    (2) El único emisor de notificaciones por comentario vivía inline en
    `POST /api/boards/:slug/items/:id/updates` y solo cubría menciones @ hechas
    DESDE el portal. Resultado en producción: 540 + 201 filas `stage_change` y
    apenas 14 `mention` en toda la vida de la tabla, cero por comentario. El
    feed del drawer sí los mostraba (lectura viva de Monday) — lo que faltaba
    era el aviso, y ahí es donde se perdían: comentarios reales del equipo
    ("Me piden modificar la cantidad de 53 a 52", "@Livia aquí les dejo el
    archivo", "BUENAS TARDES") sin que nadie se enterara.
  - **Ruteo (decisión de Efraín, 2026-08-18):** vendedor dueño + comprador(es)
    asignado(s) al item + los mencionados; nunca el autor. Bandeja
    **Importantes** (un comentario pide respuesta; en Actualizaciones se perdería
    entre los cientos de cambios de etapa) y **sin WhatsApp**, salvo mención @
    directa, que sí lo dispara como siempre.
  - `worker/lib/updateNotify.ts` (nuevo) — emisor compartido por los dos
    caminos, para que un comentario rutee igual venga del portal o de
    monday.com. Filtra los updates de MÁQUINA por contenido, no por autor (los
    reportes de cmp-tallas salen con creator = dueño del token, así que filtrar
    por creator no servía): encabezados `**…`/`⚠️`/`✅` y los avisos de flujo
    ("ha solicitado el costeo", "…la validación del costeo", "…confirmación de
    tallas", "El costeo fué validado", "Se intentó generar…"). Sin ese filtro
    cada "Cotización generada" duplicaría el aviso de etapa. Lee además las
    menciones NATIVAS de Monday del HTML del update
    (`data-mention-type="User" data-mention-id="…"`), que hasta hoy el portal
    ignoraba por completo.
  - `worker/sync/webhook.ts` — rama `create_update`: notifica y sale sin tocar
    el mirror (un comentario no cambia columnas, no hay nada que refetchear).
    Se salta lo que ya notificó el portal por la firma "vía Portal CMP", y
    deja rastro en `sync_log` cuando se salta algo por no reconocer al autor o
    por no tener el item en el mirror.
  - `worker/routes/boards.ts` — el POST de updates ya no emite menciones inline:
    delega en `notifyItemComment`, así el comentario del portal también avisa al
    vendedor y al comprador (antes solo a los mencionados). Misma `dedupe_key`
    `mention:<updateId>:<email>` de siempre, así que si el mismo comentario
    llega por los dos caminos el `INSERT OR IGNORE` deja una sola fila.
  - `worker/lib/notify.ts` — `wa?: boolean` en `NotifyInput`: permite
    'importante' SIN WhatsApp (default sin cambios, se sigue mandando).
  - `scripts/create-webhooks.mjs` — `create_update` en `BASE_EVENTS` + flags
    `--events=` / `--boards=` para registrar solo lo nuevo (Monday no de-duplica
    webhooks; re-correr el script completo habría duplicado los 13 ya existentes).
  - `src/components/notifications/NotificationCenter.tsx` — badge del kind
    `update_comment`.
  - Pruebas: `worker/lib/updateNotify.test.ts` (9) con los textos reales del feed
    de Oportunidades/Proyectos — si cmp-tallas cambia sus mensajes, ese archivo
    es el que hay que mover.
  - **Webhooks registrados en vivo** (5 boards de primer nivel, ids 624824923 /
    624824943 / 624824951 / 624824962 / 624824976) apuntando a
    `portal.mexicanadeproteccion.com/api/sync/webhook/<token>`.
  - **Verificado en producción, no asumido:** dos comentarios de prueba escritos
    directo en Monday (fuera del portal) sobre OPP-0903 → webhook 200 sin
    excepciones (`wrangler tail`) y dos filas `update_comment` en `notifications`
    para el vendedor dueño. Comentarios y filas borrados después.
  - Al verificar salió un detalle real del roster: un `monday_user_id` puede
    tener 2-3 filas de `identity` (login de trabajo + gmail + otra), así que
    excluir solo el correo con el que se comentó dejaba al autor auto-notificado
    en su otro buzón. `actorEmailsFor` excluye TODOS sus correos activos.

- Los espejos de Monday, resueltos localmente para items nativos
  (`worker/lib/nativeMirrors.ts`, nuevo). Salió de correr el END-TO-END REAL EN
  PRODUCCIÓN que pidió Efraín: copiar una oportunidad compleja (OPP-0870, 42
  líneas, 2 proveedores) como oportunidad nativa de Zona Efrain y llevarla hasta
  logística. Llegó — cotización ($171,656.80), Proyecto, 14 tallas, 2 OC con PDF
  real y captura de logística con guía en R2 — pero se atoró en 4 puntos, todos
  con la MISMA raíz: un item nativo no existe en Monday, así que el motor de
  columnas ESPEJO (`lookup_*`) nunca corre para él y medio pipeline las lee como
  si fueran datos propios.
  - **Institución** (`lookup_mm1bs976`, espejo del Contacto): `checkCosteo` la
    exige, así que "Mandar a costeo" era IMPOSIBLE en la zona. Ahora se resuelve
    al ligar el contacto (en la creación y en el write path), siguiendo la misma
    cadena que Monday: Oportunidad → `deal_contact` → Contacto →
    `contact_account` → Institución. De paso también el puesto.
  - **Nombre de la línea**: en Monday una automatización la renombra al elegir
    el producto; una línea nativa se quedaba en "Nueva línea" para siempre, y
    `checkTodoCuadra` cruza tallas POR NOMBRE — el resultado era
    "Nueva línea: cotizado 80, asignado 0" junto a "Camisa Administrativa:
    cotizado 0, asignado 45", o sea que confirmar tallas nunca cuadraba. Ahora
    ligar el producto copia nombre + SKU + ficha comercial + colores
    disponibles + tallas + moneda + unidad + proveedor (el bloque de ficha que
    ya existía era justo este problema, resuelto para UNA columna).
  - **Status guardado como TEXTO en vez de `{index}`** (`nativeStatusValue`,
    `worker/lib/nativeItems.ts`): el merge nativo solo tenía el caso especial de
    `deal_stage`. Todo lo demás que agrupa o filtra lee `.index`, así que cuando
    `confirmTallasNativeD1` regresó el `project_status` al fallar el gate, el
    Proyecto **desapareció de todos los boards** — el tab de Zona Efrain marcaba
    "0 proyectos" con el Proyecto ahí. Ahora cualquier columna `status` nativa se
    escribe con su índice real de `shared/column-meta.gen.ts`. Anclado en test.
  - **La OC salía a nombre de un número**: `PROVEEDOR`/`RAZÓN SOCIAL` imprimían
    "11643361506" y los folios "—". La línea de talla nativa ahora guarda el
    NOMBRE del proveedor (no su id) y copia la razón social; el Proyecto nativo
    nace con folio propio (su id sintético, el mismo fallback que ya usaba
    `oc.ts`). Método y condiciones de pago llegaban por request pero el PDF los
    lee de las columnas del Proyecto — se estampan antes de generar.
  - **Cuarta pasada (UI):** el tab Tallas del PROYECTO ofrecía solo el flujo del
    Google Sheet ("Crear archivo de tallas" / "Importar tallas a Monday", con el
    texto "Aún no hay tallas importadas en Monday"), que en un proyecto nativo no
    aplica — ese proyecto no existe en Monday y el desglose se captura por boxes
    desde la Oportunidad. Efraín: "escóndelo para que no confunda". Ahora en
    proyectos nativos solo queda "Validar tallas", que además deja de exigir el
    archivo del Sheet (nunca va a existir ahí), y el mensaje vacío manda a la
    pestaña correcta.
  - **Tercera pasada, encontrada CLICANDO la app en producción** (Efraín pidió la
    prueba de UI completa antes de mandar): subir la imagen de referencia de una
    posición de embellecimiento tronaba en una línea nativa — la UI mostraba
    "Error — reintentar" — porque `uploadZoneImage` iba directo a
    `addFileToColumn` de Monday. Ahora tiene rama nativa: el archivo va a R2 y se
    estampa el marcador en el mirror, igual que la OC del cliente y las guías de
    Logística.
  - Segunda pasada (misma sesión, tras re-correr el E2E): faltaban los tres
    espejos "(auto)" del catálogo — Costo (`lookup_mm5ck4b3`), Descuento y
    Gastos %. De ahí sale el SNAPSHOT que congela "Mandar a costeo"
    (`computeSnapshot`), así que sin ellos el snapshot nativo escribía 0, borraba
    el costo capturado y la OC salía en $0.
  - Lo que NO se tocó porque no es del flujo nativo: `validacion-check` marcó 2
    de 6 líneas con "descripción y tallas sin confirmar", y es condición real
    del catálogo para esos dos productos (`checkValidacion` lee el board
    Productos, no un espejo).
  - **Resultado final: 23/23 pasos verdes en producción** — Nueva oportunidad →
    Mandar a costeo → Compras costea → Validación → Cotización ($263,876.80) →
    Ganar → Proyecto → 14 tallas → Confirmar tallas (PDF de relación) → 3 OC a
    proveedor con PDF real (5.11 Tactical / UNIMX / SWA, con razón social,
    folios, método y condiciones de pago, unidades y el descuento del catálogo)
    → captura de logística con guía en R2 y descarga de vuelta. El PDF de la
    OC-12 se revisó visualmente.
  - Los dos scripts quedaron en el repo (`scripts/e2e-zona-efrain.mjs` y su
    `-limpiar.mjs`) para poder repetirlo. Todo lo que crearon las 6 corridas se
    borró después: 133 filas nativas, y los dos tabs de Zona Efrain quedaron
    limpios. Lo único que NO se pudo revertir es el contador global
    `oc_folios.seq` (llegó a 14): el token de `.env` es de SOLO LECTURA para D1
    (`code: 7500`), así que la próxima OC real saldrá OC-15 salvo que se
    regrese a mano. Antes de esta prueba la tabla no existía — nunca se había
    emitido una OC nativa en producción.

## 2026-08-18

- **Botón "Validar costeo" en Validación Costeo (etapa 7 → 9 "Costeo
  Confirmado")** — pedido de Efraín por WhatsApp mientras revisaba OPP-0913:
  "agrega botón de VALIDAR costeo, no generar cotización YA; es súper
  importante poder validar el costeo antes de mandar la cotización". El drawer
  saltaba de "Costeo en validación" directo a "Generar cotización": no existía
  el paso donde dirección aprueba el precio, y la etapa 9 nunca se usaba desde
  el portal (la cotización manda el stage a 6 por su cuenta).
  - `confirmarCosteo` (`worker/lib/costeo.ts`) + `POST
    /api/oportunidades/:id/validar-costeo`: exige etapa 7 y **Precio de Venta
    C/U > 0 en TODAS las líneas** (422 nombrando los renglones que faltan —
    validar un costeo con una línea en $0 siempre es error de captura y la
    cotización saldría mal). Escribe `deal_stage` directo, igual que 15→7: no
    hay endpoint de cmp-tallas para este paso. **Solo admin** (403 al resto):
    lo que se aprueba aquí es Precio de Venta, la única columna con
    `w: ['admin']` (`shared/visibility.ts`). Deja rastro como Update de Monday
    ("Costeo validado por X"), best-effort.
  - **Notificación a Compras, severidad `importante`** (Efraín: "cuando eso
    pase manda una notificación al de compras, es una notificación
    importante"). Hallazgo al cablearla: `STAGE_NOTIFY['Costeo Confirmado']`
    ya existía con `['owner','comprador']`, pero **un cambio de etapa hecho
    desde el portal no lo dispara** — el merge optimista de `outbox.ts` deja la
    etapa nueva en el mirror, así que cuando llega el echo de Monday
    `maybeEmitStageChange` compara viejo == nuevo y calla. Nuevo
    `emitStageNotification` (`worker/lib/notify.ts`) la emite a mano con el
    MISMO `dedupe_key` que el camino automático (si algún día los dos
    coinciden, el `INSERT OR IGNORE` deja una sola). `importante` ⇒ además sale
    WhatsApp de inmediato.
  - **UI** (`OpportunityDrawer.tsx`): en etapa 7 ya NO aparece "Generar
    cotización" — solo "Validar costeo" (Efraín: "el botón de generar
    cotización no debe aparecer ahí; ya después se genera la cotización"), y
    "Generar cotización" se movió a la etapa 9, que el board Validación ya
    mostraba. Etapa optimista + `uxAction('drawer:validar-costeo')` para que la
    fricción del paso quede medida como el resto.


## 2026-08-17

- Zona Efrain también del lado de PROYECTOS (pedido de Efraín: "necesito ZONA
  EFRAIN en los proyectos igual"). Ventas ya tenía su tab privado y el flujo
  nativo completo (Pasos 1-8, "salir de Monday"); el post-venta se quedó a
  medias — una oportunidad nativa que se GANA crea un Proyecto en D1 y de ahí
  para adelante varias cosas seguían hablándole a Monday con un id que allá no
  existe. Dos frentes en el mismo cambio: el tab nuevo y cerrar los huecos.
  - **Tab "Zona Efrain" en el grupo Proyectos del sidebar**
    (`projectStages.ts` `zona_efrain_proy`, `Sidebar.tsx`, `App.tsx`,
    `routing.ts`): espejo del de Ventas — TODAS las etapas del post-venta
    (`PROJECT_STATUS_ORDER`), acotado a los proyectos del CEO
    (`vendedorNames: ['Efrain Ponce']`, mismo criterio que
    `STAGE_BOARDS.zona_efrain`) y visible solo a la whitelist
    (`me.zonaEfrainAccess`). El filtro por vendedor es de CONVENIENCIA: la
    privacidad real ya la hacía `dal.ts hidden_owner_ids`, que desde 2026-08-12
    cubre `proyectos`/`proyectos_sub`.
  - **Bug real encontrado al probarlo: un Proyecto nativo era INVISIBLE en todo
    el sidebar.** `ganarOportunidadNativeD1` nunca estampaba `project_status`
    (en un Proyecto real lo pone Monday sola, es el default del board) y los 4
    accesos de Proyectos filtran por esa columna — un item sin valor no cae en
    ningún grupo. Ahora nace en "Desglose de tallas" (index 5), como el real.
  - **Comentarios nativos** (`worker/lib/nativeUpdates.ts` + tabla
    `native_updates`, lazy): un item nativo no existe en Monday, así que
    `create_update` tronaba y `updates` salía vacío — se perdía en silencio
    TODO comentario, tanto el del composer como los automáticos (cotización,
    OC, costeo, tallas, seguimiento, divergencia de costo, producto propuesto).
    `postUpdate`/`listUpdates` eligen el lado por el id y devuelven el mismo
    shape `MondayUpdate`, así que los 12 emisores solo cambiaron de función.
    Los ids son numéricos (no uuid) a propósito: las rutas validan `/^\d+$/`,
    los "ojitos" viven en `update_seen` y `seguimientos.monday_update_id` es
    INTEGER. Adjuntos: los bytes van a R2 y el proxy de descarga los sirve de
    ahí, acotados al item ya validado (un assetId adivinado da 404).
  - **Línea manual del Proyecto** (`POST /api/proyectos/:id/lineas`) y
    **archivos de Logística** (`POST /api/proyectos_sub/:id/logistica/:field`)
    ganaron rama nativa. Lo común con el flujo de tallas se extrajo a
    `worker/lib/nativeItems.ts` (`toNativeColumns`, `insertNativeSubitem`,
    `stampNativeFileMarker`) en vez de una tercera copia; el test nuevo ancla
    que `board_relation` guarda `linked_item_ids` como STRING — el bug de
    2026-08-13 que rompía el PDF de la OC.
  - **De paso, un hueco que NO era de la zona:** el tab Logística del
    `ProyectoDrawer` seguía siendo el placeholder "próximamente". La captura de
    recolección se construyó ayer para el drawer de la Oportunidad y este se
    quedó atrás — o sea que el board del sidebar que se LLAMA Logística no
    servía para capturar logística. Se conecta el mismo `LogisticaSection`
    (mismos permisos, el server revalida). Efraín: si preferías dejarlo como
    estaba en el board normal, se revierte solo esa parte.
  - Límite conocido, sin cambiar: en un item nativo las @menciones son texto
    plano (no hay update de Monday que notifique) — quien avisa de verdad es la
    notificación del portal, que esos emisores ya mandan aparte. Y
    `tallas-regenerar`/`tallas-importar` siguen en cmp-tallas: dependen del
    Google Sheet que Efraín ya sacó del alcance.
  - Verificado en vivo contra los dev servers, con una oportunidad nativa creada
    y ganada de verdad: el Proyecto aparece en el tab (1 proyecto, grupo
    "Desglose de tallas"), línea manual creada en D1, guía subida y descargada
    de R2 desde el detalle de Logística, comentario nativo + adjunto + "visto
    por" en Actualizaciones, adjunto de otro item da 404, PAM no ve el tab
    (`zonaEfrainAccess:false`) y Elisa sí, y los 4 accesos normales siguen
    listando todo (20 proyectos en Documentación y Tallas).

- Tablero "Análisis" (admin): embudo de conversión, tiempo de costeo y montos,
  cortados por Zona o Vendedor. Pedido de Efraín — "empieza por algo super
  básico", y todo D1 driven ("si faltan datos hay que resolverlo").
  - **No hizo falta instrumentar nada ni esperar a juntar historia.** El board
    de Oportunidades ya estampa los hitos con fecha y el mirror los tiene:
    `pulse_log_mkzm4v99` (creación), `date_mm094kzf` (solicitud de costeo),
    `date_mm0mc3dj` (validación), `date_mm09mv5b` (cotización). O sea que el
    tablero nace con toda la historia, no desde el día que se prende.
  - El tiempo de costeo sale del `changed_at` que traen esas columnas dentro de
    `value`, no del `date`: con el día pelón, "mismo día" salía cero. Hoy la
    mediana real es 21 h con p90 de 6 d — el promedio (2.6 d) lo mueven unos
    pocos costeos olvidados, por eso mandan la mediana y el p90.
  - Los montos NO pueden salir del padre: los mirrors de dinero de la
    Oportunidad (`lookup_mm00p07m` y compañía) llegan VACÍOS en las 630 filas.
    Se suman de las líneas, donde las fórmulas sí traen texto (2,964 de 2,964):
    `formula_mkznmjh6` (Subtotal) y `formula_mkznry25` (Utilidad Total).
  - Zona = el dropdown `dropdown_mm03g067` de la propia oportunidad, NO las
    `zonas` de ventas del portal (esas son equipos para permisos).
  - La consulta pasa por `scopeFor()` de dal.ts: un admin fuera de la whitelist
    de la Zona privada "Efrain" tampoco la ve aquí, ni sumada dentro de un
    total. Un agregado también filtra.
  - Embudo MONOTÓNICO por construcción (un hito posterior prueba el anterior;
    la etapa actual prueba lo que quedó atrás, salvo Perdida/Cancelada, que se
    pueden dar en cualquier punto). Sin esa regla el embudo se ensanchaba a la
    mitad con los datos sucios que sí existen — Sureste tenía 86 costeos
    validados contra 80 solicitudes.
  - **"Datos por resolver"**, que es la otra mitad de la feature: lo que se
    rellena por inferencia no se esconde, se lista con link al drawer. Hoy son
    ~98 renglones: 48 sin zona, 21 con etapa avanzada sin fecha, 12 con fechas
    invertidas, 11 validados sin solicitud, 7 cotizados sin monto, 4 cotizados
    sin validación, 1 sin vendedor.
  - Lo que destapó ese panel: **43 oportunidades son registros de prueba**
    (TEST/SMOKE/DEBUG/"borrar"), 7% del board, contando como ventas reales —
    inflan "creadas" y bajan la tasa de cierre. Se reportan aparte pero SIGUEN
    contando: decidir que un renglón no es una venta es decisión de Efraín, no
    de un regex, y una exclusión silenciosa sería un número que nadie puede
    auditar después.
  - UI: tiles arriba, embudo en medio, huecos abajo. Los números del embudo van
    FUERA de la barra — dentro caían unas veces sobre el relleno y otras sobre
    el riel según el largo del escalón, y en móvil el monto quedaba ilegible
    (visto en pantalla con Playwright, no supuesto). La tasa de cierre lleva su
    denominador: "100% (1/1)" no es lo mismo que "100%".
  - Sin polling a propósito: la consulta barre las 630 oportunidades con sus
    2,964 líneas (317 ms end-to-end); repetirla cada 30 s sería quemar CPU del
    Worker para redibujar el mismo número.

- Corrección de la atribución portal-vs-Monday tras verificar en PRODUCCIÓN (el
  commit anterior salió con el mecanismo incompleto). Verificado con Chromium
  contra prod + consultas a la D1 real; la receta quedó en memoria.
  - Lo que se vio: `atribucion.portal` daba 0 de 588 ediciones. No era falta de
    uso — el mecanismo no alcanzaba. Tres causas, todas reales:
    1. **Los items nativos no pasan por `outbox`**: `worker/lib/outbox.ts`
       retorna antes y escribe `activity_log` directo con `recordDirectChanges`.
       Con solo el cruce de outbox quedaban etiquetados como Monday siendo
       100% del portal.
    2. **`outbox` y `activity_log` no se traslapaban ni un minuto**: outbox
       terminaba el 2026-08-14T16:17 y activity_log empieza el 22:15 del mismo
       día. Cero coincidencias posibles, aunque el SQL fuera correcto.
    3. Faltaba el rastro más fuerte y más barato: `recordDirectChanges` escribe
       `dedupe_key` como `native:<uuid>`, mientras el delta sync usa
       `board:item:evento:columna:tick`. Es una marca EXACTA de "esta fila la
       escribió el portal", sin ventanas de tiempo ni joins.
  - La atribución ahora son CUATRO rastros en OR, por orden de certeza:
    dedupe_key `native:` → item nativo por id → `ux_event` kind='edit' (que
    emite `patchItem`, el único write path del front) → `outbox`. Lo que no deja
    ningún rastro es, por eliminación, Monday nativo.
  - **Las automatizaciones de Monday quedan fuera.** Monday usa `user_id`
    NEGATIVO para sus automatizaciones e integraciones — verificado en vivo: 67
    de 588 ediciones (11%) venían de `user_id = -4/-6` con dedupe_key de delta
    sync normal, o sea no eran personas. Contarlas inflaba la re-edición (un bot
    reescribiendo la misma columna se ve igual que alguien corrigiéndose) y
    metía robots en la adopción semanal. Se reportan aparte en
    `atribucion.automatizaciones` en vez de esconderse. **La línea base de
    Monday tiene que excluirlas igual**, o la comparación queda chueca — esto se
    suma al pendiente de la whitelist.
  - **Retención partida en dos**: el grueso (click/ack/nav/error) sigue a 90
    días, pero los `edit` viven 400. No es "guardemos más por si acaso": los
    `edit` son el rastro con que se atribuye cada fila de `activity_log`, y
    `activity_log` NO se poda. Borrarlos a los 90 días haría que las ediciones
    viejas del portal se contaran como Monday solas y en silencio — un análisis
    hecho en feb-2027 sobre sep-2026 vería la herramienta equivocada. Son de
    bajo volumen (uno por columna escrita), así que 400 días no pesan.
  - Todo esto quedó anclado en `worker/lib/uxMetrics.test.ts` (12 casos): item
    nativo sin outbox, marcador `native:` bastando solo, rastro de `ux_event`
    sin outbox, y exclusión de bots.
  - Nota de operación: `outbox` no recibe una fila desde el 2026-08-14T16:17.
    Puede ser normal (el equipo edita en Monday.com y usa el portal para ver y
    cotizar) o puede ser que algo del write path a Monday dejó de usarse. No lo
    toqué porque no es de este cambio, pero vale revisarlo.

- Instrumentación de fricción de uso del portal (`ux_event`), pedido de Efraín
  para la renovación de Monday de feb-2027: hoy todo lo que sabemos de fricción
  sale de los activity_logs de Monday (138,794 eventos, mar–ago 2026) y no hay
  NADA comparable del portal. Esto es el otro lado de esa tabla, calculado igual
  para poder compararse sin asteriscos.
  - **El problema real no era medir, era DISTINGUIR** (lo que cambió el diseño):
    el portal escribe a Monday, así que una edición hecha en el portal viaja
    outbox → Monday → activity_logs → delta sync y cae en `activity_log`
    IDÉNTICA a una hecha a mano en Monday.com — mismo user_id, misma columna.
    Medir re-edición sobre `activity_log` tal cual habría comparado Monday
    contra (Monday + portal). La atribución NO es heurística: `outbox` nunca se
    poda, tiene un solo escritor y guarda board+item+cols+autor+fecha, así que
    cada fila se etiqueta cruzando las cuatro cosas (columna dentro del JSON de
    `cols`, autor vía identity.monday_user_id) dentro de la ventana en que el
    write pudo llegar a Monday. El único falso positivo posible —la misma
    persona tocando la misma celda en las dos herramientas— se cuenta aparte en
    `atribucion.ambiguos` en vez de esconderse.
  - Tabla `ux_event` en D1 (lazy-create, como `activity_log`), SEPARADA de
    `activity_log` a propósito: esa espeja lo que Monday registró, esta guarda
    lo que el servidor no puede saber solo — qué intentó la persona, cuánto
    esperó, si repitió el clic.
  - Dos columnas que no estaban en la propuesta original y sin las cuales las
    métricas no salen: **`corr`** (correlación clic↔acuse — sin ella el
    emparejamiento sería "el clic más cercano anterior", que se vuelve ambiguo
    justo cuando hay dos clics seguidos, o sea el caso que se está midiendo) y
    **`role`** (denormalizado, para que el reporte agregado POR ROL sea el
    camino fácil y el desglose por persona el que cueste trabajo).
  - **Guardarraíl ejecutable, no convención**: `shared/telemetry.ts` valida
    `target` contra un regex que no acepta mayúsculas, espacios ni arroba, y
    sanea `meta` a number/boolean/slug corto descartando todo lo demás — un
    nombre de cliente no pasa. Verificado en vivo: de un lote con
    `target: "Hospital General de México"`, `meta: {cliente: "..."}` y un
    `user_id: 99999` falsificado, entraron 7 de 9 eventos, cero fugas, y todo
    atribuido al identity del SERVIDOR.
  - **Bug encontrado antes de salir**, y es el motivo de
    `worker/lib/uxMetrics.test.ts`: la clasificación de clic-sin-acuse comparaba
    contra el acuse del clic inmediatamente anterior en vez de contra la primera
    señal que hubiera llegado. Un tercer clic quedaba como "el sistema no dio
    ninguna señal" aunque el acuse del primero ya estuviera en pantalla —
    inflaba el 58% a costa del 42%, o sea justo el número a comparar. El SQL vive
    en constantes exportadas para poder correrlo tal cual contra sqlite
    (`node:sqlite`, sin dependencias nuevas); el typecheck no puede ver un bug
    dentro de un string.
  - Trampas ya conocidas, pagadas: `user_id` siempre del servidor (el del
    payload ni se lee); INSERT troceado a 7 filas = 84 binds (D1 truena arriba
    de ~100) en UN solo `batch()`; el POST responde 204 antes de tocar D1 y el
    insert va en `waitUntil`; nada sale por evento, todo en lote; retención de
    90 días colgada del cron semanal que ya existía.
  - Trampa nueva encontrada: la lista poletea cada 5s (`src/lib/api.ts`), así que
    medir latencia en TODOS los GET habría metido ~86k filas/día (~7.8M a 90
    días). Las mutaciones se miden completas y los GET van al 2% — ~480k filas a
    90 días, y p50/p90 siguen sobrando.
  - Otra que habría dado un número bonito y falso: si un botón se deshabilita
    mientras carga, el segundo clic nunca ocurre y el portal reportaría 0% de
    clics repetidos — no por no tenerlos, sino por no poder verlos. De ahí
    `uxClickBusy` y el `meta.busy` de `uxAction`.
  - Suplantación: mientras un admin ve el portal "como" alguien más no se graba
    nada (filtrado en el cliente Y en el worker). Sus clics se le atribuirían a
    esa persona y ensuciarían adopción y tiempo por tarea.
  - Instrumentado en el único punto de paso de cada cosa, no sembrado por la UI:
    latencia en `apiFetch`, ediciones en `patchItem` (una fila por columna, solo
    ids, nunca el valor), `drawer:open` y las 4 acciones de etapa del drawer.
  - `GET /api/telemetry/report` (solo admin) devuelve las 5 métricas ya con el
    corte portal-vs-Monday y con los parámetros de comparabilidad explícitos
    (ventana de repetición 30s, cortes de 1 y 5 min) — tienen que ser los MISMOS
    con que se recalcule la línea base en cmp-analisis.
  - PENDIENTE de Efraín: la línea base del 73% se calculó sobre los
    activity_logs CRUDOS de Monday, pero `activity_log` está filtrado por la
    whitelist de ruido de `worker/lib/activityLog.ts` (3 boards, ~55 columnas).
    Para comparar sin asterisco hay que re-correr esa línea base con la misma
    whitelist aplicada (es un filtro sobre datos que ya existen, cero código
    aquí). Sin eso, el número del portal saldría inflado.

- OC a proveedor (PDF): el bloque de totales cambia el renglón vacío por
  "Unidades" con la suma de cantidades de todas las líneas
  (`fmtNumMx`) — el proveedor ve de un vistazo cuántas piezas son sin
  sumar renglón por renglón.

- Anuncios del portal (pantalla nueva `/anuncios`, pedido de Efraín): Elisa y
  el CEO —los dos admin— pueden publicar comunicados para todo el equipo sin
  pasar por Monday ni por WhatsApp a mano. Nativo en D1 (`anuncios` +
  `anuncio_visto`, lazy-create como documents/zonas): no hay board detrás, no
  toca el mirror ni el outbox. Leer es de cualquier rol, escribir SOLO admin
  (`worker/routes/anuncios.ts` lo revalida; la UI solo refleja).
  - **Audiencia = roles Y zonas** (decisión de Efraín al arrancar): cada lista
    vacía significa "todos" en su dimensión, y las dos se cumplen a la vez —
    `{roles:[vendedor], zonaIds:[3]}` es "los vendedores DE la zona 3", no
    "vendedores o zona 3". Es la única regla de alcance que tiene la feature,
    así que quedó anclada en `worker/lib/anuncios.test.ts`. La pertenencia a
    zona se resuelve por `monday_user_id` y no por email, por la gente con dos
    filas de identity (login de trabajo + gmail personal).
  - **WhatsApp solo con casilla explícita** (lo otro que decidió Efraín): la
    severidad "Importante" NO manda nada por su cuenta — el admin marca
    "Avisar también por WhatsApp" al publicar. Sale en `waitUntil` (N
    subrequests a Meta, el admin no espera), tope de 50 destinatarios, y usa
    el mismo template `portal_notificacion` con `urlSuffix: 'anuncios'`.
  - Un admin ve TODOS los anuncios (es quien los administra) pero el badge de
    no leídos solo cuenta los que de verdad van dirigidos a él. El "visto" se
    asienta cuando la tarjeta estuvo ~1.2s en pantalla (IntersectionObserver),
    no al abrir la vista: con 8 anuncios y 2 leídos, el badge debe seguir
    marcando 6. Se archiva en vez de borrar para no perder quién dijo qué.
  - `useAnuncios` guarda el estado a nivel módulo (patrón de `useMe`): la
    pantalla y el badge del sidebar están montados a la vez y con un `useState`
    por hook el badge se quedaba pegado hasta el siguiente poll — bug visto en
    verificación, no en teoría. Un solo poll ETag de 60s para ambos.
  - `NavItem` acepta `badge` (pill con el número; punto cuando el sidebar está
    colapsado). Los chips de la tarjeta usan `color-mix` y no `color + '1a'`:
    los colores llegan como `var(--token)` y concatenarles el alfa en hex
    produce CSS inválido que el navegador tira (se vio en el screenshot).
  - Verificado en vivo con Playwright contra los dev servers: publicar, editar,
    audiencia por rol, badge que sube y baja, 304 del ETag y layout a 390px.

- Tab "Logística" del Proyecto (`LogisticaSection.tsx`, nuevo): Compras
  mandó capturas de su vista de recolección en Monday y agregó columnas
  nuevas a `proyectos_sub` (re-introspección con
  `scripts/introspect-boards.mjs`, `shared/column-meta.gen.ts` actualizado).
  El pill "Logística" ya existía en el drawer (`BoardTabsBar.tsx`) pero
  renderizaba un "próximamente" — ahora muestra tarjetas por producto+color
  (mismo agrupado que Ejecución/Tallas): fila compacta con Talla/Cantidad/
  Estado/Producción/Unidad visible a todos, y para Compras/Admin un detalle
  expandible con Encargado, # de recolección, guías, comentarios,
  confirmación de tallas y fecha — `shared/visibility.ts` les agregó `w: AC`
  (antes eran de solo lectura incluso para Compras). "# Guía - empresa" y
  "Evidencia recolección" (columnas file) tienen subida real nueva:
  `POST /api/proyectos_sub/:id/logistica/:field` (mismo dual-write a R2 que
  `/proyectos/:id/documento`, con rama nueva en `portalFiles.ts` para
  resolverlos de vuelta). Verificado en vivo con Playwright (dev servers):
  edición de texto persiste (outbox + reload), upload sube y se descarga de
  vuelta por `/api/files/...`, layout responsive a 390px.

- Ícono 📋 "Ver actividad" por renglón de cotización (`QuoteRow.tsx`,
  `MobileQuoteRow.tsx`): Efraín pidió separar la actividad de producto de la
  de la oportunidad — la pestaña "Actividad" del drawer ya mezcla item padre +
  todas las líneas (`worker/routes/boards.ts`), sin forma de ver solo un
  renglón. El backend ya soportaba esto: `oportunidades_sub` es un `BoardSlug`
  propio con su whitelist en `activityLog.ts`, así que el nuevo botón solo
  reusa `ActividadTab` vía `ProductoActividadDrawer` (antes hardcodeado a
  `slug="productos"`, ahora acepta `slug`/`title`) pidiendo
  `GET /api/boards/oportunidades_sub/items/:id/activity` — mismo scoping de
  lectura, sin cambios de permisos. El encabezado del drawer no puede usar
  `producto.name`: en una línea ese campo es el índice de Monday ("1", "2"…),
  no el producto elegido (vive en otra columna) — se pasa `displayProducto()`
  ya computado en el callback en vez de recalcularlo aparte. Verificado en
  vivo con Playwright (dev servers) contra una oportunidad real: el ícono
  aparece junto a ▸/✎, pide el slug correcto y el título muestra el producto.

## 2026-08-15

- Pausa temporal de las alertas WA de errores (`worker/lib/errorAlerts.ts`):
  Efraín pidió parar el envío por WhatsApp cada 15 min mientras el canal
  siga siendo ruido. El cron `*/15 * * * *` sigue corriendo igual (también
  dispara `deltaSync`) y el conteo + limpieza de `sync_log` (retención 90
  días) se sigue ejecutando; solo se deshabilitó el `sendTemplate` con un
  `if (false && ...)` comentado para reactivarlo fácil cuando se decida.

## 2026-08-14

- Fix (misma sesión de mantenimiento): el backup semanal D1→R2 tronaba en su
  primera corrida real — y de paso se descubrió que corre en SÁBADO, no
  domingo. A las 03:00 UTC del sábado 2026-08-15 el cron "0 3 * * 7" disparó
  (la numeración de Cloudflare es 1=domingo…7=sábado, no la de Unix — el
  commit 8a3b141 asumió 7=domingo) y `buildDump` falló completo con "access
  to _cf_KV.key is prohibited: SQLITE_AUTH": `sqlite_master` lista la tabla
  interna `_cf_KV` de D1, y leerla está prohibido. Fix: excluir `_cf_%` del
  dump (con ESCAPE — `_` es comodín de LIKE; query verificada contra D1
  remoto: salen las 29 tablas reales). Se deja en sábado a propósito: lo que
  importa es que sea semanal. La alerta WA de las 03:15 sobre `backup: 1` es
  este fallo — ya arreglado. Detalle afortunado: el canal de alertas se
  revivió HOY mismo (ver abajo); una semana antes este fallo habría sido
  invisible, igual que todo lo demás desde el 08-05.

- Fix (misma sesión de mantenimiento, hallazgos de un subagente revisando los
  12 commits recientes — 4 bugs, todos verificados contra el código):
  - **El log de actividad fugaba costos a vendedor/almacén.** La WHITELIST de
    `worker/lib/activityLog.ts` es "de ruido, no de permisos" (así está
    documentada), pero el GET `.../activity` serializaba las filas SIN pasar
    por `shared/visibility.ts`: un vendedor abría el tab Actividad (o el
    drawer de Productos, también almacén) y leía "X cambió Costo Distribuidor
    de 50 a 60" en columnas `vis: AC` (Costo Distr., Techo, Margen Gob,
    Historial precios…) — contra la regla dura "Ventas: cero costos y cero
    proveedores" (2026-07-30). Ahora el endpoint filtra con el mismo `canRead`
    que ya filtra los DTOs de items (`listActivity` regresa board_id/column_id
    para poder hacerlo); create_pulse/update_name pasan siempre.
  - **Auto-versionado antes de validar el write.** Un PATCH de línea con
    columna no escribible por el rol moría en 403 dentro de `submitWrite`…
    pero `autoVersionLineaCosteada` ya había corrido: versión archivada, Etapa
    Costeo reseteada en TODAS las líneas y notificación "creó V_n" enviada,
    sin ningún cambio aplicado. El PATCH ahora corre la MISMA validación
    `canWrite` por columna antes de auto-versionar. (El caso análogo en
    DELETE — deleteItem a Monday truena DESPUÉS de versionar — queda anotado,
    no arreglado: reordenarlo cambia semántica de qué snapshot se archiva y el
    fallo es transitorio.)
  - **Tope de ~100 parámetros ligados de D1.** `seenByFor` (un bind por update
    del feed — que trae 50 updates MÁS replies) y `listActivity` (2 binds por
    línea — una oportunidad de 50+ líneas) explotaban la query y tiraban el
    feed/tab completo con 500. Ambos van ahora en lotes de ≤90 binds.
  - **`notifyNuevaVersion` era el único eslabón no best-effort** del camino de
    versionado: un throw ahí (vendedor_ids no parseable) respondía 500 con la
    versión ya archivada. Envuelto en try/catch como sus vecinos.
  - Hallazgos que son DECISIÓN DE EFRAÍN, no se tocaron: (1) compras
    capturando embellecimiento desde Costeo sobre una vigente a media costear
    dispara auto-versión y le resetea su propio avance de Etapa Costeo
    (`LINE_DEFINING_COLS` incluye las columnas de embellecimiento); (2) un
    líder de zona puede COMENTAR (updates) en items de su equipo aunque nunca
    los edita — el composer usa scope de lectura a propósito.

- Fix (misma sesión de mantenimiento): adjuntar archivo a un update no
  verificaba que el `updateId` perteneciera al item validado. El endpoint
  `POST /api/boards/:slug/items/:id/updates/:updateId/attachment`
  (`worker/routes/boards.ts`) validaba el ITEM con `getItem(viewer)` pero
  luego pasaba el `updateId` del cliente directo a `addFileToUpdate` — con un
  id numérico de update de CUALQUIER item de todo Monday (visible para el
  usuario o no), el archivo se adjuntaba ahí. Encontrado en auditoría de la
  regla "todo endpoint que muta pide scope 'own'" (subagente revisó los 7
  routes + helpers; el resto de los endpoints que mutan sí cumplen). Fix:
  `fetchUpdates(itemId)` (la misma call que ya usa el GET del feed) y 404 si
  el update no está entre los del item (incluye replies). Nota para Efraín,
  sin cambiar: `POST .../updates` (comentar) usa scope de LECTURA a
  propósito del composer — un líder de zona puede comentar en items de su
  equipo aunque "nunca edita"; si eso no se quiere, es cambio de una línea.

- Fix (sesión de mantenimiento "revisar que todo esté bien"): las alertas de
  error por WhatsApp llevaban MUDAS desde el 2026-08-05 — 879 fallos en
  `sync_log`, uno cada 15 min, y ni una alerta real entregada en 10 días.
  Dos causas encadenadas en `worker/lib/errorAlerts.ts`:
  - El template `portal_notificacion` tiene botón URL con parámetro dinámico y
    Meta rechaza el parámetro vacío (#100 "Parameter 'text' is mandatory ...
    cannot be empty") — `sendAlert` mandaba `urlSuffix: ''`. Ahora manda
    `'oportunidades'` (link a la lista, ruta válida del portal).
  - Loop autoperpetuante: el fallo del propio envío se loggea como `ok=0`, el
    siguiente cron lo contaba como "error nuevo" y reintentaba → fallaba →
    re-loggeaba, para siempre. El conteo ahora excluye `detail LIKE
    'error-alert:%'` — un envío fallido ya no se realimenta.

- Fix: el refetch del delta sync no tenía tope — una ráfaga grande de eventos
  (el backlog de 3 días tras el fix de ayer, cmp-tallas reescribiendo
  subitems) agotaba el presupuesto de subrequests de la invocación y tronaba
  TODOS los refetches restantes con "Too many subrequests" (270 fallos el
  08-14 ~17h, 28 más el 08-15 ~00h; los items quedaban stale hasta el
  reconcile de 12h). `worker/sync/delta.ts`:
  - Tope de 50 refetches por corrida, procesados en orden cronológico del
    primer evento que tocó cada item.
  - Checkpoint parcial: si quedaron pendientes (por tope o por presupuesto
    agotado), `delta_last_polled_at` avanza solo hasta 1ms antes del primer
    evento no procesado — la siguiente corrida (15 min) continúa desde ahí,
    sin perder nada (refetch y activity_log son idempotentes). Antes el
    checkpoint saltaba a `to` aunque la mitad hubiera tronado.
  - Si un refetch truena con "Too many subrequests" se corta el loop ahí
    mismo (los intentos restantes fallarían igual y cada log de fallo también
    gasta presupuesto); esos items quedan cubiertos por el checkpoint parcial.
  - `npm run typecheck`, `npm run lint` y `npm test` (268) limpios. Verificado
    contra prod (D1 remoto) antes y después: sync_log, outbox, board_state y
    monday_api_usage sanos por lo demás.

- Feat: versionar cotización ahora funciona en Ganada/Perdida + notifica a la
  otra parte. Efraín, sobre el fix anterior de "+ Nueva versión": confirmó que
  Ganada/Perdida SÍ deben poder modificarse (hay casos reales de cambios tras
  ganar) y pidió avisar a Compras cuando Ventas versiona, y a Ventas cuando
  Compras (o admin) lo hace.
  - `worker/lib/quoteVersions.ts`: quita el candado de stage 1/2 en
    `duplicateVersion`/`restoreVersion` (antes tiraban 422 "Ganada o Perdida
    — no se pueden editar sus líneas"). `worker/routes/oportunidades.ts`
    (crear línea) y el comentario de `autoVersionLineaCosteada`
    (`worker/routes/boards.ts`) igual — ya no hay ruta que distinga Ganada/
    Perdida del resto de las etapas para versionar.
  - `OpportunityDrawer.tsx`: `canVersion` ya no excluye stage 1/2; `editable`
    de `CotizacionTab` pasa de `stage !== '1' && stage !== '2' && !ajena` a
    `!ajena` (igual que `EmbellecimientosTab` ya tenía) — si no, el borrador
    que crea "+ Nueva versión" quedaba sin poder editarse inline en una
    oportunidad cerrada.
  - Notificación nueva (`kind: 'nueva_version'`, severidad `importante` — sí
    dispara WhatsApp): un solo punto en `duplicateVersion` (cubre los 4
    disparadores — botón explícito, auto-versionado al editar/borrar/crear
    línea, y "ajustar línea"→eliminar) resuelve comprador/vendedor asignados
    de la oportunidad (`vendedor_ids` + columna people "Compras",
    `multiple_person_mm03qyw9`) y usa `resolveRecipients`/`emitNotification`
    ya existentes (`worker/lib/notify.ts`) — mismo patrón que
    `costoDivergencia.ts`. Sin selector de rol nuevo: si el actor es
    vendedor avisa a `comprador`, si no (compras/admin) avisa a `owner`.
  - `npm run typecheck`, `npm run lint` y `npm test` (268 tests) limpios. No
    verificado en vivo contra Monday (cambio de reglas de negocio, pendiente
    que Efraín lo confirme con un caso real).

- Fix: "+ Nueva versión"/"Restaurar versión" no aparecían al abrir una
  oportunidad ya costeada desde el board Costeo. Reportado por Efraín con
  captura (OPP-0907, V1 vigente con PDFs ya generados, stage "En costeo"):
  "ya tiene cotización y no puedo crear una V2 es absurdo".
  - Causa: `OpportunityDrawer.tsx` gateaba ambos chips con `noLineEdits`
    (`readOnlyCosteo || isValidacion || ajena`) — la misma bandera que
    bloquea la edición INLINE de producto/color/cantidad desde Costeo
    (trabajo de Ventas, intencional). Pero versionar es una acción de
    archivo aparte: `worker/lib/quoteVersions.ts` (`duplicateVersion`/
    `restoreVersion`) no tiene ni ha tenido candado de `boardKey`, solo
    bloquea Ganada/Perdida — el chip desaparecía sin respaldo del server,
    dejando una vigente ya costeada sin ninguna vía de cambio si el item se
    abría desde Costeo en vez de Oportunidades.
  - Fix: nueva condición `canVersion` (stage no Ganada/Perdida, no
    Validación, no ajena) separada de `noLineEdits` — Validación se queda
    bloqueada (ahí lo único editable es Precio de Venta), Costeo ya no.
    `noLineEdits` se queda igual para todo lo demás (edición inline, tab
    Nuevos productos).
  - `npm run typecheck`, `npm run lint` y `npm test` (268 tests) limpios.

- Fix: el delta sync (cron cada 15 min, `worker/sync/delta.ts`) llevaba 3 días
  mudo — 0 filas en `sync_log` desde 2026-08-11 21:31, ni éxito ni fallo.
  Reportado por Elizabeth: OPP-0904 "CHAMARRAS LA PAZ" creada directo en
  Monday, invisible en el portal 40+ min después (mismo patrón que OPP-0504,
  el caso que originó el delta sync). Causa: el loop de refetch por item no
  tenía try/catch — un solo item que truene (fetch/D1/ficha) aborta la
  función ANTES de mover el checkpoint (`sync_state`) y ANTES del log final,
  así que la siguiente corrida vuelve a tocar el mismo item y truena igual —
  mudo para siempre, sin dejar rastro (ni la alerta de WhatsApp lo detecta,
  porque no hay fila que revisar). Fix: try/catch por item, loggea el fallo y
  sigue; el checkpoint y el resumen ahora siempre se escriben. Confirmado que
  el cron SÍ estaba bien registrado en Cloudflare (API de schedules) — no es
  el bug del cron del backup semanal (commit 8a3b141); los webhooks de
  `create_item` también están bien registrados (`scripts/create-webhooks.mjs`).

- Feature: "Duplicar" ahora pregunta a qué etapa se manda el clon (Efraín,
  tras el backfill manual de OPP-0899: "en las siguientes, duplicar pregunta
  a que estado se manda").
  - `duplicateOportunidad.ts` acepta `etapaDestino` (una de las 6 etapas del
    pipeline — `DUPLICAR_ETAPAS_VALIDAS` en `shared/dealStages.ts`), default
    "Nueva oportunidad" si se omite (mismo comportamiento que antes).
  - `DuplicarOportunidadModal.tsx` (nuevo): selector de etapa antes de
    duplicar. Fuera de "Nueva oportunidad" muestra un aviso — el clon SOLO
    copia la etiqueta de la etapa, no genera el Proyecto de "Ganada" ni los
    PDFs de costeo/validación que esa etapa normalmente implica (mismo
    criterio que el backfill manual: nunca forjar artefactos de un proceso
    que no ocurrió).
  - Probado en vivo con Playwright contra el board real (OPP-0512): las 6
    etapas listan bien, el aviso aparece/desaparece correctamente. No se
    ejecutó la duplicación de verdad para no crear un item de prueba en
    Monday producción.

- Fix: dos tarjetas "CANCELADA" en el board de Oportunidades (reporte de
  Efraín con captura). Causa: `groupByColumn` (`src/lib/groupBy.ts`) agrupaba
  por el índice crudo de la columna status, no por el texto visible — mismo
  patrón ya documentado ayer para "En Negociación" (índice 10 duplicado del
  3), pero para "Cancelada" (índice archivado/huérfano cuyo texto coincide
  con el índice 5 vigente, no visible en `settings_str` porque Monday no
  devuelve opciones archivadas). Fix: tras agrupar por índice, se fusionan
  los grupos cuyo label normalizado (sin acentos/mayúsculas) coincide,
  promoviendo el key/color del índice "oficial" (el que aparece en
  `DEAL_STAGE_ORDER`/`PROJECT_STATUS_ORDER`) para que la tarjeta fusionada
  ordene y coloree como la etapa real. Cubre de paso el caso pendiente de
  "En Negociación" sin tener que tocar Monday ni esperar la decisión de
  negocio sobre cuál índice borrar.

- Feat: "ojitos" (visto por) en Actualizaciones — Elizabeth: "en el nuevo
  sistema no se puede poner el ojito, para ver que si persona ya vio los
  comentarios". El feed de Actualizaciones lee `item.updates` de Monday en
  vivo y nunca se mirror-ea; el `viewers` nativo de Monday solo se llena
  cuando alguien ve el update DENTRO de Monday.com, nunca por una lectura vía
  API (que es como el portal sirve el feed) — Efraín confirmó que el "visto"
  del portal hay que llevarlo aparte, en D1, como mínimo.
  - Tabla nueva `update_seen` (`worker/schema.sql`, lazy-create en
    `worker/lib/updateSeen.ts`, mismo patrón que `zonas`): quién vio cada
    update/reply desde el portal.
  - `GET .../updates` fusiona esa tabla con el `viewers` nativo de Monday
    (agregado a `UPDATE_FIELDS`/`REPLY_FIELDS` en `monday.ts`) — el indicador
    cubre a quien vio el comentario en Monday.com o en el portal, cualquiera
    de los dos. Nuevo `UpdateDTO.seenBy`.
  - Nuevo `POST .../updates/seen`: el front (`ActualizacionesTab.tsx`) lo
    llama tras cada carga del feed, marcando lo que acaba de traer.
    Best-effort, nunca bloquea la lectura.

- Fix: cotización congelada tras duplicar/versionar — Elizabeth (WhatsApp):
  "el clon que hice, se borraron todos los datos" y "no me deja modificar la
  cant, se quedo congelado". Efraín aclaró el modelo correcto: "TODO es
  modificable... el objetivo de las versiones es que sean 'detrás' no que
  impidas modificar algo" y "duplicado es duplicado todo debe estar igual".
  - `worker/lib/duplicateOportunidad.ts` ("Duplicar"): copiaba solo un
    subconjunto de columnas por línea (producto/color/cantidad/comentarios/
    embellecimiento/precio) — el clon nacía sin costeo, con costos y P. venta
    en blanco. Ahora copia también Etapa Costeo, moneda, IVA%, Margen Gob% y
    todos los costos base (Costo distr., Desc.%, Conversión, Gastos%, Costo
    embell., Techo) — Monday recalcula solas las columnas `formula_*` a partir
    de esos mismos inputs. La etapa de la oportunidad sigue reseteando a
    "Nueva oportunidad" (nunca se forja `deal_stage` a otro valor — dispara
    automations de Monday/cmp-tallas fuera de control del portal).
  - `CotizacionTab.tsx`: `lineEdits` (producto/color/cantidad/embellecimiento
    editables inline) dependía de estar en "Nueva oportunidad" o en un
    borrador sin costear — por eso una línea ya costeada, vista fuera de esos
    dos casos, se pintaba de solo lectura ("congelada"). Ya no depende de eso:
    solo de que el board/rol lo permitan.
  - Como contraparte, el server ahora versiona en automático al primer edit
    de línea (producto/color/cantidad/embellecimiento, `LINE_DEFINING_COLS` en
    `quoteVersions.ts`) sobre una vigente ya costeada: archiva la vigente en
    D1 y resetea Etapa Costeo a "No iniciado" (mismo mecanismo que
    "+ Nueva versión", `duplicateVersion`), sin que el vendedor tenga que
    pedirlo — PATCH/DELETE de línea en `worker/routes/boards.ts`
    (`autoVersionLineaCosteada`) y "Agregar línea" en
    `worker/routes/oportunidades.ts`.

- Fix: "Ganar" mandaba el Proyecto a la zona equivocada; y faltaba el botón en
  Costeo Confirmado
  - Efraín: "la parte de pasar a ganada una oportunidad no sirve, necesito que
    se cree el proyecto... eso es una automatización de Monday pero debería
    estar aquí igual". El portal **ya lo hacía** desde el 2026-08-05
    (`worker/lib/ganarOportunidad.ts`, réplica de la automatización nativa) —
    él no lo sabía, así que se probó end-to-end contra producción para ver qué
    fallaba de verdad.
  - **Bug real encontrado en la prueba en vivo**: la Zona del Proyecto salía
    equivocada. Se copiaba el `value` crudo del dropdown (`{ids:[3]}`), pero los
    ids de label son propios de cada columna y NO coinciden entre boards:
    Oportunidades 3="Centro" vs Proyectos 3="Sur". El mapeo real que producía:
    Noroeste→Bajío, Centro→Sur, Bajío→Centro, Golfo→Noroeste, Sureste→Golfo,
    Sur→id inexistente; solo "Norte" caía bien, por casualidad. Ahora se copia
    por **label** (`{labels:[texto]}`, mismo shape que `columnEncode.ts`).
    Impacto en datos viejos: ninguno — el outbox muestra que "Ganar" del portal
    se había usado una sola vez desde el 2026-07-20, y esa oportunidad ya tenía
    Proyecto (camino idempotente); los 69 Proyectos ligados existentes los creó
    la automatización nativa de Monday, que sí mapea bien.
  - Hueco cerrado: el botón "Ganar" aparecía desde `stageAtOrAfter(stage,'6')`,
    y Monday ordena "Cotización" **después** de "Costeo Confirmado" — o sea que
    las oportunidades ya costeadas y confirmadas se quedaban sin botón (4 hoy en
    producción). Umbral movido a '9' (Costeo Confirmado).
  - Verificado en vivo (Playwright + sesión real de producción,
    `scripts/prod-login.mjs`): oportunidad de prueba OPP-0901, etapa Cotización
    → botón "Ganar" → `200 {"ok":true,"proyectoId":...}`. En Monday quedó el
    Proyecto en el grupo "Etapa 1: Subir Tallas y Documentos", con Vendedor,
    Compras, Elaborado por y Carpeta Drive copiados, link bidireccional en
    ambos lados y la Oportunidad en "Ganada" dentro del grupo "Oportunidades
    Ganadas". Todo correcto salvo la Zona — de ahí el fix. Re-verificado con una
    segunda oportunidad de prueba ya con el fix desplegado; ambas se borraron de
    Monday al terminar.
  - Detalle menor observado, sin tocar: en "Nueva oportunidad" el campo
    **Compras** no está marcado con `*`, pero el server lo exige y responde 400
    "Compras es obligatorio" al crear.
  - typecheck limpio y 250 tests en verde. No se tocó el camino nativo
    (`ganarOportunidadNativeD1`, Zona Efrain) — ahí el Proyecto vive en D1 y la
    UI lee el `text`, así que la zona se ve bien; pero si algún día ese item
    viaja a Monday, arrastra el mismo `{ids:[...]}` de origen.

- Fix (2/2): la ficha también en la ventana optimista — encontrado verificando
  en producción
  - El fix de abajo cubría los caminos de SYNC, y en local se veía perfecto. En
    producción se cayó: se ligó el producto a una línea de prueba por el portal
    y 40 s después el espejo D1 seguía sin ficha (el mirror de Monday se calculó
    a los 3.3 s; la línea solo sanó cuando llegó un sync posterior).
  - Causa del hueco: `submitWrite` parchea en D1 **solo la columna escrita**
    (merge optimista atómico) y la respuesta de la mutación no trae mirrors
    recalculados, así que entre "elegí el producto" y el eco/webhook la línea
    vive sin ficha. Esa ventana es EXACTAMENTE el instante de la captura de
    Efraín — por eso el aviso se veía con la descripción impresa abajo.
  - Ahora ligar el producto arrastra su ficha en el MISMO merge optimista
    (`worker/lib/outbox.ts`, con `productoIdDeWrite` para leer el id tanto del
    string pelón que manda la grid como del `{item_ids:[…]}` interno).
  - Verificado en producción con una oportunidad de prueba desechable
    (12805019767, borrada al terminar): antes del fix, D1 vacío a los 40 s;
    después, la ficha aparece en el espejo apenas responde el PATCH, con el
    mirror de Monday todavía vacío — o sea que salió del catálogo.
  - Lección para la próxima: en este repo un dato "del mirror" tiene TRES
    caminos de entrada a D1 (sync, eco del outbox y merge optimista); cubrir
    solo el sync se ve bien en local y falla en la mano del usuario.

- Fix: "Falta descripción" en líneas que SÍ tienen descripción
  - Efraín mandó la captura: la línea "12380 - Fast-Tac 6 Boot" marcada en rojo
    con "⚠️ Falta descripción" y, dos centímetros abajo, la descripción y las
    tallas del producto impresas en el panel de detalle.
  - Causa: el aviso (y el gate de "Mandar a costeo") leen el mirror de la línea
    `lookup_mm0xw8p7`. Monday lo recalcula **asíncrono** después de ligar el
    producto y esa recalculación **no dispara webhook**, así que la línea recién
    creada se queda con el mirror vacío. El panel de detalle no se veía afectado
    porque ya tenía su propio fallback al catálogo (`getItem('productos', id)`)
    — por eso la descripción se veía y el aviso decía lo contrario.
  - Fix (`worker/lib/ficha.ts`, nuevo): la ficha se resuelve desde la tabla de
    Productos en D1 (`long_text_mm0xse7v`) y **se guarda ya resuelta en la línea
    del mirror**, en el camino de ESCRITURA — no en cada lectura. Efraín pidió
    exactamente eso: "quiero que sea D1, necesito rapidez; el dato derivado es
    normal, eso lo traemos de Monday igual". Así ningún consumidor —drawer,
    `checkCosteo`, PDFs de solicitud de costeo y cotización, documentos, bot—
    paga una consulta extra ni tiene que acordarse de rellenarla.
  - Enganchado en los tres caminos por los que una línea entra a D1:
    `upsertItem` (webhook / echo del outbox / creación y duplicado de líneas),
    `reconcileBoard` (una consulta por página) y `refetchItemTree` (todas las
    líneas de la oportunidad de un jalón, al abrir el drawer con `?fresh=1`).
  - Clave: el relleno corre **antes** de calcular `content_hash`. Con eso una
    línea vieja guardada sin ficha se repara sola en su próximo sync (si el hash
    se calculara del crudo, se saltaría por "igual a lo que hay"), y cuando el
    mirror de Monday por fin trae el mismo texto no se reescribe nada — que es
    lo que mantiene válidos los ETags de las listas (ver 2026-08-13).
  - `runCosteoNative` lo llama aparte: valida contra la lectura FRESCA de Monday
    (no pasa por el mirror) y hubiera rechazado + revertido la etapa por la
    misma columna.
  - Si el producto de catálogo de verdad no trae descripción, el aviso sigue
    saliendo: es un aviso real (Compras no ha subido la ficha).
  - `worker/lib/ficha.test.ts`: 6 casos (toma la ficha del producto, agrega la
    columna si falta, no pisa el mirror bueno, sin producto no inventa, producto
    sin ficha sigue faltando, un solo query para líneas del mismo producto).
    typecheck + 251 tests en verde.

- Reporte de Proyectos: la etapa del proyecto ahora se ve en cada renglón
  - Efraín: "la etapa de proyecto terminado DEBE ESTAR en el reporte de
    proyectos". Verificado antes de tocar nada, contra producción con
    `scripts/prod-login.mjs` + Playwright: los proyectos en "Proyecto
    Terminado" **sí** salían listados (86 renglones, entre ellos CHALECOS
    JAGUAR MOVILIDAD, GEOS QUINTANA ROO, Zapato Charol Negro, BOTAS PC SAN
    PEDRO) — el filtro de status ya se había quitado en `47b9455`.
  - Lo que faltaba era poder **leer** la etapa: este acceso agrupa por Zona (no
    por `project_status`, a diferencia de Documentación y Tallas / Órdenes de
    Compra), y el renglón solo mostraba la batería de estado de productos. Un
    proyecto terminado se veía idéntico a uno en Ejecución.
  - Ahora el renglón trae el chip de `project_status` con el color de la
    etiqueta de Monday (`chipFor`, sin inventar colores), solo en este acceso
    (`statusCol` se le pasa a `Row` únicamente cuando `config.key === 'ejecucion'`;
    los otros boards siguen agrupando por etapa, ahí sería redundante). Ancho
    fijo en desktop para que los chips queden alineados en columna; en mobile
    va en la fila de chips.
  - Verificado con `npm run typecheck` y en el navegador (1440px y 390px)
    contra el worker local.

- Fix: las líneas de cotización se mostraban en orden alfabético, ignorando
  cómo las acomodó el vendedor en Monday (Efraín, capturas de OPP-0893: "no
  estan en el orden como lo acomodo el vendedor"). `childrenOf`
  (`worker/lib/dal.ts`) siempre hacía `ORDER BY name` — nunca respetó el orden
  de Monday, que además no tiene un campo `position` formal para subitems: el
  orden real es implícito en el array que regresa su API.
  - Nueva tabla lazy `item_order` (`worker/lib/itemOrder.ts`, mismo patrón que
    `lineaAjustes.ts` — nunca se altera `items`), con `monday_order` y
    `manual_order` (esta última sin usar todavía: queda lista para una Fase 2
    futura de reacomodo manual dentro del portal, decidida con Efraín pero no
    implementada aún — cuando llegue, gana siempre sobre el bloqueo de edición
    de la grid, por ser preferencia visual y no dato de negocio).
  - Se captura en `refetchItemTree` (`worker/sync/refetch.ts`), la única
    relectura que trae las líneas de UN padre en el orden real de Monday
    (`upsertItem`/`reconcileBoard` procesan items sueltos o páginas de board
    sin contexto de hermanos, así que no sirven para esto). Se guarda siempre,
    aunque ninguna línea cambie de valor — un reacomodo puro en Monday no
    mueve `content_hash`.
  - `childrenOf` ahora ordena `COALESCE(manual_order, monday_order, alfabético)`
    — líneas nunca releídas en árbol completo (previas a este cambio) caen al
    alfabético de antes hasta su próxima apertura.

- Feature: log de actividad en Oportunidades y Productos (pedido de Efraín).
  Verificado en vivo con MCP monday.com contra Oportunidades antes de
  construir: `activity_logs` de Monday trae `column_id`/`previous_textual_value`/
  `textual_value`/`user_id` por evento — pero es MUY ruidoso (820 eventos/día
  en Oportunidades, 590 de ellos `update_column_value`, la mayoría archivos de
  cotización que sube una automatización, no ediciones humanas) y su
  `created_at` no es ISO ni epoch: son ticks de 100ns desde epoch Unix
  (confirmado dividiendo entre 10,000 contra la fecha real de un evento).
  - `worker/lib/activityLog.ts` (nuevo): whitelist propia por board — columnas
    "PROPOSED", mismo trato que `shared/visibility.ts` pero para RUIDO, no
    permisos (incluye `numeric_mkzneg3d` Precio de Venta C/U a propósito,
    la columna "solo admin escribe"). `create_pulse`/`update_name` siempre se
    registran; el resto solo si la columna está en la whitelist del board.
    `ticksToIso` convierte con BigInt (Number pierde precisión pasado 2^53).
    Dedupe propio (`board+item+evento+columna+tick`): `action_record_uuid` de
    Monday NO siempre viene en la respuesta, no sirve como UNIQUE.
  - `worker/lib/monday.ts`: `fetchActivityLogs` ahora también pide
    `event`/`user_id`/`created_at` (antes solo `entity data` — el delta sync
    los tiraba tras usar solo `pulse_id`).
  - `worker/sync/delta.ts` persiste vía `persistActivityEntries` en la misma
    corrida de 15 min que ya jalaba `activity_logs` — sin llamada extra a
    Monday.
  - Tabla nueva `activity_log` (`worker/schema.sql`, lazy-create).
  - `GET /api/boards/:slug/items/:id/activity` (`worker/routes/boards.ts`):
    para `oportunidades` incluye también las líneas (`oportunidades_sub`) —
    un cambio de precio vive ahí, no en el item padre.
  - Frontend: pestaña "Actividad" nueva en el drawer de Oportunidades
    (`ActividadTab.tsx`, mismo componente reusado). Productos no tenía
    detalle de renglón — se agregó `ProductoActividadDrawer.tsx`, un drawer
    lateral mínimo a propósito (solo esta pestaña por ahora).
  - Probado en vivo contra Monday real: se disparó el cron del delta sync a
    mano (`/cdn-cgi/handler/scheduled`) contra el worker local, confirmado en
    D1 (`activity_log`) y en el navegador — el feed de Actividad de una
    oportunidad real mostró correctamente quién cambió qué columna y cuándo.

- Feature: PDF automático "Costeo — Validación" al mandar a Validación de
  costeo (Efraín: "ESTO SOLO LO VEN compras y admin... es automático").
  - `worker/lib/pdf/layout.ts`: soporte de página apaisada (`DocumentMeta.landscape`)
    y tamaño de fuente configurable en `wrapTable` — antes todo el motor asumía
    carta vertical vía constantes de módulo; ahora las mide una vez por
    documento (`metricsFor`) y las pasa a cada `draw*`. Sin cambio de
    comportamiento para las plantillas existentes (verificado con render de
    muestra: solicitud de costeo y OC a Proveedor salen idénticas).
  - Nueva plantilla `validacion-costeo` (`shared/documents.ts`): `create` y,
    algo nuevo, `view` restringidos a `['compras','admin']` — las demás
    plantillas dejan ver el documento a quien vea la oportunidad fuente, pero
    esta trae costos/utilidad que el vendedor nunca ve. El gate se aplica en
    `worker/lib/documents.ts` (`assertTemplateViewable`, en `rowOf` y
    `listDocuments`) — 404, nunca 403, mismo criterio que el resto de scoping.
  - `costeoValidacionData` (worker/lib/documents.ts) captura TODAS las
    columnas de Costeo en el snapshot JSON (`documents.data`), pero el PDF
    (`costeoValidacionBlocks`, pdf/templates.ts) solo IMPRIME las de decisión
    (costo real/total, precio, subtotal/IVA/total, márgenes) en horizontal —
    se probó primero con las ~24 columnas completas y los importes salían
    cortados con elipsis, inservible para validar. Apaisado + fuente 8pt
    alcanza para las 14 columnas que sí se imprimen.
  - Se dispara solo (best-effort, como la solicitud de costeo) al final de
    `POST /api/oportunidades/:id/enviar-validacion`, con acuse automático
    (sin ceremonia de firma) — mismo patrón que `solicitud-costeo`.
  - Frontend: nuevo cuadro "Validación" en la barra de archivos de cotización
    (`CotizacionPdfRow.tsx`), montado solo para compras/admin; busca el
    documento por metadata (`GET /api/documents`, no los bytes del PDF) igual
    que el resto de la fila.
  - De paso: la barra de archivos de cotización no tenía `flexWrap` — con 5-6
    cuadros de 108px se desbordaba en mobile (390px) en vez de bajar de línea,
    mismo bug que Efraín reportó ("en mobil la barra de archivos esta un poco
    rota"). Se agregó `flexWrap: 'wrap'`, mismo criterio que el resto del board.

- Feature: el log de actividad (commit anterior de hoy) no cubría items
  nativos de Zona Efrain ("salir de Monday") — Efraín preguntó explícitamente
  ("funciona para items solo D1? como zona Efrain?") y aclaró el criterio:
  "no quiero duplicar info, cuando está en Monday es solo Monday". Un item
  nativo (`shared/nativeId.ts`, id sintético ≥900,000,000,000) nunca toca
  Monday — no genera `activity_logs` que el delta sync pueda jalar, así que
  el log se quedaba vacío para siempre en Zona Efrain, sin aviso.
  - `worker/lib/activityLog.ts`: `recordDirectChanges` (nuevo) — mismo shape/
    tabla/whitelist que el camino de Monday, pero escrito DIRECTO en el
    momento del write en vez de leído de un activity_log ajeno. Un item real
    de Monday nunca pasa por aquí; uno nativo nunca pasa por
    `persistActivityEntries` — nunca los dos orígenes para el mismo item.
  - `worker/lib/outbox.ts` (`submitWrite`, rama nativa) y `worker/lib/
    createRecord.ts` (`submitCreateNative`) llaman a `recordDirectChanges` con
    el valor previo (leído de `row`, el snapshot de ANTES del merge
    optimista) y el actor (`viewer.monday_user_id`, ya en mano — sin query
    extra). `worker/routes/oportunidades.ts` (alta de "Nueva línea" nativa)
    igual, para que una línea recién agregada no aparezca sin rastro de
    creación.
  - Gap que casi se cuela: `viewer.monday_user_id` de un usuario NATIVO del
    portal (alta sin Monday, `worker/lib/dal.ts`) es un id sintético
    NEGATIVO — nunca aparece en el roster de Monday que el endpoint de
    lectura ya usaba para resolver nombres. `GET .../activity`
    (`worker/routes/boards.ts`) ahora también consulta `identity` por esos
    ids y la usa como fallback/complemento del roster.
  - Probado en vivo contra el worker local con `X-Dev-Email`: creé una
    oportunidad nativa real en Zona Efrain, la edité (nombre + etapa),
    agregué una línea, confirmé el feed completo en el navegador (creación +
    ediciones, orden correcto, nombre del actor resuelto) y borré todo el
    rastro de prueba (item + filas de `activity_log`) al terminar.

## 2026-08-13

- Fix + perf: en producción, un fallo de API mostraba oportunidades INVENTADAS
  - Salió analizando qué hay dentro del bundle de entrada (sourcemap): 15 KB de
    él eran `src/data/oportunidades.ts` + `src/lib/mockFallback.ts`, o sea el
    fixture del prototipo de diseño, que `usePoll` usaba como fallback cuando el
    fetch falla. El comentario del archivo dice "offline demo", pero el guard
    era ninguno: aplicaba igual en producción.
  - **Lo grave no es el peso**: `offlineMock` se marcaba en el hook pero **no se
    pinta en ninguna parte de la UI**. Si la API fallaba, la gente veía una
    lista de oportunidades falsas —con clientes y montos inventados— sin ningún
    aviso de que no eran reales.
  - Ahora los mocks están detrás de `import.meta.env.DEV`: en dev siguen igual
    (el board demuestra con el worker apagado) y en producción se muestra el
    estado de error que ya existía. Verificado en navegador con la API
    bloqueada: sale "No se pudo conectar", cero oportunidades falsas, cero
    errores de consola. El bundler además saca los 15 KB del build (confirmado
    buscando cadenas del fixture en el JS: ya no están).
  - Dos cosas que se arreglaron al descubrirlas por este cambio:
    - El mensaje decía "Verifica que el worker esté corriendo" — lenguaje para
      quien programa. Como ahora sí lo va a ver la gente, quedó "No se pudo
      conectar. Revisa tu conexión e intenta de nuevo."
    - La precarga de `index.html` guardaba promesas que, con la API caída, se
      rechazaban sin handler y salían como "Unhandled promise rejection" en
      consola. Se les cuelga un `catch` vacío que sólo marca el rechazo como
      manejado; la promesa guardada sigue rechazando para quien la consuma.
  - Bundle de entrada: 250.1 → 240.0 KB (75.6 → 72.6 KB gz).

- Perf: Costeo abre sin esperar el catálogo, y el logo deja de pesar 15.8 KB
  - Efraín señaló que **Costeo y Proyectos son lo más importante**, así que se
    midieron esos dos flujos completos en producción (red 1.5 Mbps, CPU 4x,
    caché fría) en vez de seguir con la carga genérica:
    | | lista usable | abrir registro |
    |---|---|---|
    | Costeo | 2314 ms / 199 KB | 1271 ms / 213 KB |
    | Proyectos (Doc y Tallas) | 1769 ms / 140 KB | 77 ms / 118 KB |
    - Proyectos ya abría prácticamente instantáneo (77 ms). El costo estaba en
      Costeo.
  - **El catálogo se precarga mientras se ve la lista** (`StageBoard.tsx`): en
    Costeo/Validación el drawer SIEMPRE carga el catálogo de Productos, y
    medido, ese request no arrancaba hasta 0.5 s DESPUÉS del clic — antes tiene
    que montar el drawer. Son 89 KB en el camino de abrir cada oportunidad.
    Ahora se pide en idle, cuando la lista ya pintó (mismo gate que el chunk del
    drawer). Verificado: se pide a los 2.66 s y termina a los 3.67 s, o sea
    mucho antes de cualquier clic.
    - Sólo en esos dos boards: son los únicos donde el catálogo se carga sí o
      sí. En el resto sería bajar 89 KB que quizá nadie use.
  - **Logo**: era de 256×256 (15.8 KB) y se pinta a 28 px. Se agregó
    `src/assets/logo-64.webp` (2.9 KB) para el sidebar Y para el favicon —que
    el navegador pide en CADA carga, dentro de la ventana crítica—. El de 256
    se queda sólo para `apple-touch-icon`, que sólo se descarga al agregar a la
    pantalla de inicio. Verificado en navegador: se ve nítido a 28 px y se pide
    un solo archivo de 2892 B.
  - Nota sobre las fuentes: aparecen en la ventana de "abrir registro" de los
    dos flujos (69.6 KB entre Inter y JetBrains Mono), pero es sólo porque cada
    medición limpia la caché — están con `max-age` de un año, así que es costo
    de primera visita, no de cada apertura. No se tocaron.

- Perf: el catálogo de Productos viaja proyectado — 260 → 72 KB (-72%)
  - Quedaba pendiente de la ronda anterior: el catálogo se cacheaba por sesión
    pero seguía trayendo las 19 columnas del board. Efraín pidió hacerlo, y con
    auditoría: si falta una columna que el código sí lee, NADA truena — el campo
    llega vacío y se ve como dato malo en Monday (checkbox desmarcado, "Sin
    proveedor" donde sí hay, selector de Color sin opciones).
  - **Auditoría programática, no a ojo**: se recorre el cierre de imports desde
    la grid de cotización y el picker (44 archivos) y se cruza toda cadena
    literal contra las llaves del board `productos` en `column-meta.gen.ts`.
    - Dos iteraciones antes de confiar en el resultado: (1) la primera pasada
      sólo miró una lista de archivos escrita a mano y se perdió
      `src/lib/productSearch.ts`, que lee SKU/marca/nombre corto; (2) la segunda
      usó un regex con la "forma" de los ids y se comió
      `product_and_service_sku`, porque termina en un segmento corto — sin eso
      se habría roto la búsqueda por SKU del picker. La versión final no supone
      ninguna forma: compara contra las llaves reales.
    - Resultado: 7 columnas de 19. `name` no cuenta (campo propio del item).
  - **`long_text_mm0xse7v` (Descripción cotización) sale del catálogo**: medida
    columna por columna, pesaba 115 KB de los 188 — el 61%. Y se usa en UN solo
    lugar (`LineDetailPanel`), como fallback, sólo para la línea que alguien
    expande y sólo mientras el mirror del subitem no se pobló. Ahora se pide del
    producto puntual con `getItem('productos', id)`: **1.7 KB en vez de 115**.
    El caso común (mirror poblado) no cambia en nada.
  - `catalogoCols.test.ts` rehace la auditoría en cada corrida y falla si
    aparece una columna que no esté en `CATALOGO_COLS` ni en
    `COLS_BAJO_DEMANDA` (la lista de "esta se trae aparte a propósito"), para
    poder distinguir un olvido de una decisión. Verificado que el test falla —
    con el nombre de la columna y el archivo — al quitar una a mano.
  - Verificado en navegador sobre una oportunidad real de Costeo con 31 líneas:
    grid completa, panel de detalle con Descripción, Tallas, **Proveedor
    ("5.11 Tactical", que viene del catálogo)** e Historial de precios, sin
    errores de JS y sin ningún "Sin proveedor asignado" espurio.
  - Medido: abrir 3 oportunidades en Costeo pasa de 259 KB de catálogo (ya
    cacheado) a **72 KB una sola vez por sesión**. Contra el estado ANTES de
    todo este trabajo (2 descargas por apertura, sin caché ni proyección), esas
    3 aperturas eran ~1,554 KB.
  - **Error propio, corregido**: al crear el test nuevo sobrescribí
    `src/lib/productSearch.test.ts`, que ya existía con 11 tests de búsqueda
    (searchProductos/exactProducto/normalización). Se detectó porque el total
    de tests bajó de 238 a 230 con el mismo número de archivos. Se restauró
    desde git intacto y los tests nuevos viven en `catalogoCols.test.ts`.

- Perf (3a ronda): precarga de datos desde el HTML, drawers diferidos y
  catálogo de Productos cacheado
  - Efraín pidió "sé un loco de la optimización sin perder usabilidad". Se midió
    primero la CASCADA de requests (no los bytes) contra producción con caché
    fría, red 1.5 Mbps y CPU 4x — de ahí salieron los tres cambios.
  - Cascada de partida (prod, fría, 3.6 s hasta ver datos): HTML 0.75 s →
    `index.js` hasta 1.51 → tanda de chunks+fuente hasta 2.60 → **`/items` recién
    arrancaba a los 2.50**. O sea: el request que de verdad importa esperaba a
    que bajara y se ejecutara todo el bundle.
  - **Precarga desde index.html** (`index.html`, `src/lib/apiPreload.ts`,
    `apiClient.ts`): un `<script>` inline (no `type=module`, que se difiere)
    dispara `/api/me`, `/api/boards` y la lista/detalle que corresponda a la
    ruta, ANTES de que exista el bundle. `apiFetch` las recoge. Medido local:
    `/items` pasa de arrancar en 2.13 s a 0.33 s.
    - Sólo se usa una precarga si coincide el path exacto, es GET, no lleva
      headers que cambien la respuesta (If-None-Match sobre todo) y **no hay
      suplantación activa** — la precarga no puede mandar `X-Impersonate-Email`,
      así que bajo "ver como" devolvería la data del admin. Si algo no cuadra,
      `apiFetch` hace el request normal.
    - En un deep link (`/oportunidades/123`) la lista NI se monta, así que se
      precarga el detalle, no la lista.
    - **Bug propio, atrapado midiendo**: `URLSearchParams` escapa las comas a
      `%2C`, así que la URL de la app no coincidía con la precargada y la lista
      se bajaba DOS veces — la "optimización" salía peor que no hacer nada
      (3.10 s vs 2.77 s). Se cambió por `queryLista()` y hay test que compara la
      URL completa carácter por carácter, no sólo el set de columnas.
    - `src/lib/apiPreload.test.ts` ancla que las columnas del HTML y las de
      `LIST_COLS` no se separen: si se separan, la precarga nunca coincide y la
      optimización se apaga en silencio (nada falla, sólo vuelve a estar lento).
      Verificado que el test falla si se desvía una columna.
  - **Drawers diferidos con precarga en idle** (`src/lib/lazyPrefetch.ts` +
    los 3 wrappers de board): `OpportunityDrawer`/`ProyectoDrawer` se importaban
    estáticos, así que sus ~50 KB bajaban antes de ver la lista, para UI que
    quizá nunca se abre. Ahora son `lazy()` y se precargan cuando el navegador
    está ocioso, así el clic sigue siendo instantáneo.
    - Detalle que costó una medición: `requestIdleCallback` mide el HILO
      PRINCIPAL, no la red. Mientras se espera `/items` el hilo está libre, así
      que la precarga disparaba a los 1.8 s, justo encima del request que se
      quería proteger. Se gatea con `onReady` de la lista (dispara cuando ya
      hay datos pintados).
  - **Catálogo de Productos cacheado por sesión** (`apiClient.ts`,
    `CotizacionTab.tsx`): la pestaña Cotización pedía `listItems('productos')`
    —1247 productos con 19 columnas, **259 KB gz**— en cada montaje y DOS veces
    por montaje (las deps del efecto cambian al cargar el item). Abrir 3
    oportunidades en Costeo eran ~1,554 KB de puro catálogo. Ahora es una sola
    descarga por sesión (verificado: 3 aperturas → 259 KB una vez), y se
    invalida en cualquier `patchItem('productos', …)` para no revivir datos
    viejos tras editar.
  - **Medido (red lenta, CPU 4x), contra la ronda anterior**:
    | | antes | después |
    |---|---|---|
    | Bytes de carga inicial | 269.0 KB | 163.1 KB (-39%) |
    | Contenido en pantalla (LCP) | 2060 ms | 1532 ms (-26%) |
    | Datos en pantalla | 3015 ms | 2452 ms (-19%) |
    | 2a visita (caché tibia) | 1595 ms | 1277 ms (-20%) |
    | Catálogo por apertura en Costeo | 518 KB | 0 KB (tras la 1a) |
    - El FCP sube de 1180 a 1532 ms y es real, no ruido: antes se pintaba un
      cascarón vacío a los 1180 y la lista hasta los 2060; ahora, con los datos
      ya disponibles cuando React monta, el PRIMER pintado ya trae la lista
      (por eso FCP y LCP coinciden). Se cambió un parpadeo intermedio por
      contenido real medio segundo antes.
  - **Dos cosas que se probaron y se DESCARTARON por no comprarse con datos**:
    - `priority: 'low'` en los fetch de precarga (para que el bundle ganara el
      ancho de banda): FCP 1532 → 1560 ms, ruido. Revertido.
    - Fusionar los ~11 chunks de ~1 KB (`codeSplitting.minSize` de Rolldown):
      los ~350 ms que costaban se midieron contra `wrangler dev`, que habla
      HTTP/1.1. Producción va por HTTP/3 multiplexado y ahí esos requests no
      eran el cuello. Queda anotado en `vite.config.ts` para que no se reintente
      sin medir contra prod.

- Tooling: verificación contra PRODUCCIÓN (`scripts/prod-login.mjs`,
  `scripts/prod-smoke.mjs`)
  - Efraín preguntó si había forma de que yo pudiera entrar a producción para
    confirmar que lo desplegado funciona. El portal está tras Cloudflare Access,
    así que anónimo solo se ve un 302 al login.
  - **Por qué NO un service token de Access** (que sería lo obvio): el worker
    exige el claim `email` del JWT (`worker/mw/access.ts:75`) y un service token
    trae `common_name`, no `email` — pasaría Access y el portal contestaría 401.
    Darle soporte significaría abrir una vía de entrada a producción que no pasa
    por SSO; se descartó por eso, no por dificultad.
  - En su lugar: perfil de Chrome persistente con login real (`prod-login.mjs`).
    Usa la identidad de quien entra, así que el portal se comporta igual que
    para esa persona (rol, zonas, permisos) y no crea ninguna credencial nueva
    de servicio. Usa Chrome del sistema (`channel: 'chrome'`), no el Chromium de
    Playwright: Google bloquea el login en navegadores que detecta automatizados.
  - `scripts/.prod-profile` está en `.gitignore` y **es una credencial** mientras
    la sesión de Access no expire: no sale de la máquina; para cerrarla,
    `rm -rf scripts/.prod-profile`.
  - `prod-smoke.mjs` NO es un banco de performance (los tiempos serían de la red
    de esta máquina, no la de la gente en campo) — responde "¿lo desplegado hace
    lo que debía?". Resultado del primer corrida contra prod, **10/10**:
    - fuente propia servida y cacheada a un año; assets con hash `immutable`
    - lista de Oportunidades proyectada: 74.2 KB para 751 items
    - **abrir una oportunidad baja 0 bytes de PDFs** (antes 1.83 MB)
    - "sincronizado hace unos segundos" — confirma que el cambio de `synced_at`
      /ETag no rompió el indicador del drawer, que era el riesgo de ese cambio
    - picker de productos: 47.4 KB para 1330 productos

- Feat: renombrar la oportunidad (los 6 boards) y el proyecto desde el drawer
  - Efraín: "que todos puedan cambiar el nombre de una oportunidad — admin,
    vendedor y compras; al abrirla en CUALQUIER board, y lo mismo en Proyectos".
    Lápiz junto al título → input inline (Enter guarda, Esc cancela); el nombre
    nuevo se pinta de inmediato (el espejo tarda en confirmar el echo) y también
    se corrige en el cache de sesión del drawer.
  - `name` NO es una columna de Monday, es el nombre del item, así que entra a
    la whitelist como pseudo-columna (`shared/visibility.ts`, `w: V` en
    `oportunidades` y `proyectos` — almacén no, y el resto de los boards se
    quedan de solo lectura; anclado en `visibility.test.ts`). Se verificó EN
    VIVO contra la API 2025-04 que `change_multiple_column_values` acepta la
    llave `name` (no está inventado: se probó con un rename no-op).
  - Tres casos especiales en el write path, por lo mismo:
    - `worker/lib/outbox.ts` — el espejo lo guarda en `items.name`, no en el
      blob de columnas (ahí no existe tal columna); valida vacío y >255.
    - `worker/sync/echo.ts` — el nombre no viaja en `column_values`, así que el
      echo lo compara aparte contra `item.name`. Sin esto CADA rename quedaba
      marcado `conflict` en el outbox aunque Monday lo hubiera aplicado bien.
    - `columnEncode` ya mandaba string pelón para el default (text/long_text/name).
  - Probado de punta a punta contra el worker local + Monday real (item de
    prueba OPP-0892): PATCH → `items.name` actualizado → Monday renombrado →
    `outbox -> confirmed`; nombre restaurado al terminar. Nombre vacío = 400.
  - Un líder de zona sigue sin poder renombrar lo de su equipo (el PATCH pide
    scope `'own'`, y el lápiz se oculta con `ownedByViewer === false`).

- Fix: el typecheck no revisaba nada — se cierra el hueco y se arreglan los 2
  errores que tapaba (`package.json`, `deploy.yml`, `CLAUDE.md`, `admin.ts`,
  `boards.ts`)
  - Salió al corregir un import en la ronda de performance: `npx tsc --noEmit`
    (el comando que documentaba CLAUDE.md y que corría CI) devolvía 0 con un
    símbolo inexistente en el código. Causa: `tsconfig.json` es solo un archivo
    solución (`"files": []` + `references`), así que ese comando no compila
    NADA. Y encima el worker ni siquiera está en las references, o sea que ni
    `tsc -b` ni `npm run build` lo cubrían: los cambios al worker se venían
    yendo a producción sin verificación de tipos.
  - Nuevo `npm run typecheck` = `tsc -b && tsc -p tsconfig.worker.json
    --noEmit`. CI y CLAUDE.md apuntan ahí. Comprobado que YA NO es vacío:
    inyectando un error de tipo en el worker sale exit 2; limpio, exit 0.
  - Los 2 errores preexistentes que el comando vacío escondía:
    - `admin.ts:87` — `Identity.active` está tipado `boolean` pero la columna
      guarda 0/1 y `upsertIdentity` pide `number`. El código pasaba
      `existing?.active ?? 1` directo a `.bind()`. Con un boolean de verdad eso
      revienta (D1 no soporta booleanos: `D1_TYPE_ERROR`); no estallaba solo
      porque D1 devuelve 0/1. Ahora se convierte explícito. Verificado caso por
      caso que el resultado es idéntico para todos los valores que D1 puede
      devolver (undefined / 0 / 1) y para el body explícito.
    - `boards.ts:42` — `c.req.param('slug')` es `string | undefined` e
      `isBoardSlug` pedía `string`. Se amplía la firma y se chequea undefined
      explícito; el resultado ya era `false` por coerción, así que no cambia
      comportamiento.
  - No se tocaron las `references` de `tsconfig.json` (meter el worker ahí
    exigiría volverlo `composite`, que choca con su `noEmit`); el script cubre
    lo mismo sin ese enredo.

- Perf (2a ronda): selectores de catálogo, ETag compartido y relectura más barata
  - Efraín pidió "qué más optimizaciones quieres" y eligió las tres que salieron
    de medir los boards restantes.
  - **Selectores de catálogo bajaban el board ENTERO** (`NewMovementTab`,
    `CreateRecordModal`, `EditContactoModal`, `EditClienteModal`,
    `AgregarLineaModal`, `LineDetailPanel`): todos arrancan con búsqueda vacía y
    pedían todo, re-pidiéndolo cada 5 s mientras el modal estuviera abierto.
    Medido: Productos 1.86 MB / 260 KB gz por 1247 items, Instituciones 3.2 MB /
    139 KB por 3129. Y los seis solo pintan `item.name`, que es campo propio del
    item, no una columna. Ahora piden `SOLO_NOMBRE` (cero columnas):
    **Productos 260 → 41.8 KB (-84%)**, Instituciones 139 → 52.8 KB (-62%),
    Contactos 53.5 → 15.3 KB (-71%). Verificado en navegador: 1247 opciones,
    nombres correctos.
    - Hubo que distinguir `?cols=` AUSENTE (todas las columnas, lo que necesitan
      las vistas genéricas) de `?cols=` VACÍO (ninguna). Se compara contra
      `undefined`, no por verdadero/falso, y lo mismo en `etagFor` — si la
      cadena vacía cayera en el ETag de la respuesta completa, un 304 le
      entregaría al selector la forma con todas las columnas. Anclado en
      `serialize.test.ts`.
  - **Abrir una oportunidad invalidaba la lista de TODOS** (`refetch.ts`,
    `boards.ts`): el ETag de las listas cuelga de `MAX(synced_at)` del board, y
    `refetchItemTree` reescribía `synced_at` del item y de sus 30+ líneas aunque
    Monday no hubiera cambiado nada. O sea: cada vez que cualquiera abría
    cualquier oportunidad, todos los demás re-bajaban el board completo en su
    siguiente poll. Comprobado con curl antes/después. Ahora refetch usa
    `skipIfUnchanged` (lo que reconcile ya hacía), así que `synced_at` solo se
    mueve cuando el contenido cambió de verdad. Los cambios en columnas mirror
    quedan cubiertos: entran en `content_hash`, no en el `updated_at` de Monday.
    - Se verificó que `reconcile` y `refetch` calculan el MISMO hash (mismo
      `COL_FIELDS`/`normalizeCols`, y `rawHash` ordena por id) — si difirieran se
      pisarían mutuamente y el arreglo no serviría de nada.
    - Efecto secundario atendido: `synced_at` pasa a significar "último cambio
      real", pero el drawer rotula "sincronizado hace …", que es cuándo se
      VERIFICÓ. `pullFromMonday` ahora devuelve si de verdad leyó Monday y la
      ruta reporta esa hora — si no, diría "sincronizado hace 3 días" un segundo
      después de releer. No entra en el ETag del detalle (lo ignora), así que no
      provoca 200s de más.
    - Comportamiento observado: la PRIMERA apertura de cada item tras el cambio
      escribe una vez y de ahí queda estable (2a pasada sobre las mismas 3
      oportunidades: ETag idéntico).
  - **Relectura más barata** (`refetch.ts`): `skipIfUnchanged` por sí solo
    cambiaba 31 escrituras por 31 SELECTs secuenciales a D1. Ahora los hashes de
    todas las líneas se leen en UNA consulta y solo se escribe lo que cambió —
    el mismo patrón de reconcile. (No pude medir la ganancia real: en local D1 es
    un archivo y no representa el round-trip de producción.)
  - **Hallazgo aparte, importante: `npx tsc --noEmit` no revisa NADA.**
    `tsconfig.json` tiene `"files": []` y solo `references`, así que ese comando
    (el que documenta CLAUDE.md) sale 0 siempre. Los typechecks que reporté en la
    ronda anterior eran vacíos. Lo real es `tsc -b` (app+node) y
    `tsc -p tsconfig.worker.json` — y **el worker no está en las references**, o
    sea que ni el build ni CI lo typechequean. Al correrlo salieron 2 errores
    PREEXISTENTES (`admin.ts:87`, `boards.ts:42`, idénticos en HEAD, no de estos
    cambios) y un error mío de import que el comando vacío había dejado pasar.
    Queda pendiente decidir con Efraín si se agrega el worker a las references y
    se arreglan esos dos.

- Perf: portal mucho más liviano en máquinas lentas y conexiones malas
  (banco de medición + 5 arreglos)
  - Efraín reportó que la gente se queja de que el portal va lento, sobre todo
    en equipos modestos y con mala conexión, y que "el problema está dentro de
    oportunidades o proyectos, no solo en los boards". Preguntó primero **cómo
    lo iba a MEDIR** antes de aceptar cambios — así que lo primero fue el banco.
  - **`scripts/perf-bench.mjs`** (nuevo): mide el build de producción servido
    por `wrangler dev`, con CPU a 4x y red estrangulada (1.5 Mbps, 300 ms de
    latencia) vía CDP. Saca FCP/LCP, tiempo hasta tener datos en pantalla,
    bytes reales sobre el cable, hilo principal bloqueado, nodos DOM, heap,
    costo de ABRIR una oportunidad, tráfico en reposo y segunda visita con
    caché tibia. Guarda cada corrida en `scripts/perf-results/` (gitignored)
    y compara con `--compare antes despues`.
    - Tres artefactos de medición que hubo que corregir antes de creerle al
      banco, anotados en el propio archivo: (1) contar solo en
      `loadingFinished` hacía invisibles los 304 del poll (no dispara para
      304); (2) registrar el recurso en `responseReceived` con `bytes: 0` y
      rellenarlos después atribuía a la ventana de reposo respuestas grandes
      pedidas ANTES — inventaba "3.6 MB/min" que no existían, ahora se filtra
      por `finAt` dentro de la ventana; (3) el drawer se medía abriendo el
      primer renglón, que es una oportunidad de prueba vacía — ahora se fija
      con `--folio` (OPP-0264, 31 líneas) para que antes/después comparen lo
      mismo.
  - **Hallazgo principal — 1.83 MB de PDFs por cada apertura**
    (`CotizacionPdfRow.tsx`): al montar, precargaba los TRES PDFs completos
    (`arrayBuffer`) de la oportunidad para que el clic en "Ver" fuera
    instantáneo. Pero la miniatura es un ícono SVG (`PdfIcon`), no un render
    del PDF: se pagaban 1.83 MB y ~10 s de red lenta para dibujar tres
    íconos, y quien nunca daba clic los bajaba igual. Decisión de Efraín:
    bajar al hacer clic. `PdfCanvasPreview` ya sabía bajar por `url` cuando no
    recibe `data`, así que fue quitar el prefetch. Verificado en navegador:
    0 PDFs al abrir, 1 (solo el pedido) al dar clic, canvas renderiza igual.
  - **Relectura de Monday: se conserva, pero deja de costar bytes**
    (`boards.ts`, `serialize.ts`, `apiClient.ts`): abrir una oportunidad hace
    dos GETs al detalle (espejo + `?fresh=1`) y los dos devolvían ~138 KB
    idénticos — 276 KB para abrir UNA. Se le puso ETag de contenido
    (`itemDetailEtag`) que **ignora `syncedAt`**, porque ese campo cambia en
    cada relectura aunque el dato sea el mismo y si entrara en la llave nunca
    habría 304. La hora real viaja en `X-Synced-At` para que el "sincronizado
    hace …" no se quede viejo. Medido: el segundo GET pasa de 138 KB a 0.
    - Efraín fue explícito: **la relectura se queda** ("a veces hacen ráfagas
      de cambios, imagínate tener data stale aparte de lento"). No se tocó
      `FRESH_WINDOW_MS` ni se condicionó por etapa. De paso se verificó que
      `syncing` sólo cambia el texto del indicador — no bloquea ningún botón,
      así que la UI ya no estaba "trabada" durante esos segundos.
  - **Listas: `?cols=`** (`boards.ts`, `dal.ts`, `serialize.ts`, `api.ts`,
    `StageBoardList.tsx`): el board Oportunidades manda ~34 columnas por item
    y la lista pinta 8 → 2.15 MB (158 KB gz) por 628 items, re-bajados cada
    vez que CUALQUIER item se sincroniza (el ETag va sobre `MAX(synced_at)`).
    Ahora la vista declara sus columnas y el worker manda sólo esas: **2.06 MB
    → 0.63 MB, 158.6 → 64.6 KB gz**. Es sólo transporte: `toItemDTO`
    intersecta contra `shared/visibility.ts`, nunca amplía — anclado en
    `worker/lib/serialize.test.ts` (pedir por `?cols=` una columna admin-only
    siendo vendedor no la devuelve). La proyección entra en el ETag
    (`etagFor(..., variant)`) para que dos clientes con formas distintas no
    compartan llave y un 304 le sirva a uno la forma del otro.
  - **Caché de assets** (`public/_headers`, nuevo): Workers Assets servía
    `max-age=0, must-revalidate` para TODO, aunque Vite ya le pone hash de
    contenido al nombre — o sea 21 revalidaciones antes del primer render en
    cada visita. Ahora `/assets/*` es `immutable` a un año (el HTML sigue sin
    cachear, si no un deploy nuevo no se vería). Aislado midiendo la misma
    build con y sin el archivo: **2a visita 2297 → 1595 ms (-31%)**, aciertos
    de caché 2 → 17 de 22 requests.
  - **Fuentes propias** (`scripts/fetch-fonts.mjs`, `public/fonts/`,
    `src/tokens/fonts.css`): el `@import` a fonts.googleapis.com dentro del
    CSS es el peor caso — bloquea el render y encadena DNS+TLS a dos orígenes
    ajenos antes de pintar texto. Ahora se sirven del propio origen. Inter y
    JetBrains Mono son fuentes VARIABLES: Google devuelve el mismo woff2 para
    todos los pesos (mismo md5), así que se baja UNO por familia con
    `font-weight: 400 800` — 72 KB en 2 archivos en vez de 7 peticiones.
    Sólo subset latin (cubre español completo) y sólo los pesos en uso.
    - Se probó `<link rel="preload">` de la fuente y se QUITÓ: en red lenta
      empeoraba el FCP (1140 → 1420 ms) porque le pelea ancho de banda al JS,
      y como el portal renderiza en cliente no hay nada que pintar hasta que
      llega el JS. Con `font-display: swap` el preload no compraba nada
      visible. Queda comentado en `index.html` para que no se vuelva a
      intentar.
  - **Render de la lista** (`StageBoardList.tsx`): la cadena de filtros corría
    sobre los 628 items en CADA render y devolvía un array nuevo, lo que
    además rompía los tres `useMemo` de opciones de filtro (lo tenían como
    dependencia, así que nunca acertaban) y re-renderizaba los 628 renglones
    en cada poll. Se memoizó la cadena (`stageItems` → `items` → `groups`) y
    `Row` pasó a `memo()`, recibiendo `onOpen` en vez de una arrow nueva por
    renglón.
  - **Topes de caché en memoria** (`OpportunityDrawer.tsx`, `apiClient.ts`):
    `detailCache`/`versionsCache` eran Maps sin límite a nivel módulo (~138 KB
    + ~31 KB por oportunidad visitada) — una jornada recorriendo el pipeline
    dejaba varios MB retenidos en equipos que ya andan justos de RAM. Ahora
    LRU de 6.
  - **Resultado medido** (red lenta 1.5 Mbps / 300 ms, CPU 4x, board
    Oportunidades con 628 items, abriendo OPP-0264):
    | | antes | después |
    |---|---|---|
    | Bytes de carga inicial | 364.1 KB | 269.0 KB (-26%) |
    | └ de API | 166.5 KB | 72.2 KB (-57%) |
    | Datos en pantalla | 3475 ms | 3015 ms (-13%) |
    | Abrir oportunidad | 414.2 KB | 290.9 KB (-30%) |
    | Con la oportunidad abierta | 3660 KB/min | 2.2 KB/min |
    | Heap JS | 11.3 MB | 9.5 MB (-16%) |
    | 2a visita (caché tibia) | 2297 ms | 1595 ms (-31%) |
    - FCP/LCP quedan igual dentro del ruido entre corridas (baseline osciló
      1128–1196 ms); lo que se movió son bytes, memoria y el costo de trabajar
      dentro de una oportunidad. El "reconciliado" del drawer sigue mandado
      por la latencia de la API de Monday, que por sí sola varía 1.9–6.7 s
      entre llamadas — no depende de nada de este cambio.
  - Pendiente deliberado, no hecho: virtualizar la lista (628 renglones son
    7156 nodos DOM). Cambia el scroll y rompe el Ctrl+F del navegador, así que
    es decisión de Efraín; hoy el costo por poll ya se atacó con memoización.
    Tampoco se tocó el `warmPdfWorker` de `ActualizacionesTab.tsx` (baja el
    chunk de pdf.js al ver un adjunto PDF): ese archivo lo estaba editando
    otra sesión en paralelo.

- Fix: pestaña "Actualizaciones" del drawer se quedaba en "Cargando…" para
  siempre en mobile (`ActualizacionesTab.tsx`)
  - Efraín reportó que a Ricardo no le cargaba esa pestaña en el celular. Se
    descartó permisos de fila/rol como causa: si `dal.ts` le niega el item a
    un viewer, el worker responde 404 limpio y el tab cae al estado de error,
    no al de loading.
  - Causa real: `apiFetch` puede devolver una promesa que nunca resuelve ni
    rechaza cuando la sesión de Cloudflare Access expiró y el redirect de
    recuperación (`recoverFromAccessSession`, `apiClient.ts`) no completa —
    fragilidad ya documentada en este repo con el logout de Access/Google.
    `ActualizacionesTab` no tenía ningún timeout, así que el `then`/`catch`
    de `getUpdates` nunca disparaba y el "Cargando…" quedaba pegado sin
    error ni forma de reintentar.
  - Fix defensivo: timeout de 15s en `load()` — si `getUpdates` no resuelve a
    tiempo, cae al mismo estado de error que ya existía ("No se pudieron
    cargar las actualizaciones."). Un `loadTokenRef` descarta una
    respuesta/timeout tardío si el usuario ya cambió de tab/item mientras
    tanto.
  - Nota de concurrencia: el working tree traía cambios sueltos de otra
    sesión (`CotizacionPdfRow.tsx`, `worker/routes/boards.ts`,
    `scripts/perf-bench.mjs` + `scripts/perf-results/`) — se dejaron sin
    commitear, solo se stageó el archivo propio de este fix.

- Feat: "salir de Monday" — Paso 8, OC nativa a proveedor
  (`worker/lib/oc.ts`, `worker/routes/oportunidades.ts`)
  - `generarOcNativeD1`: agrupa por proveedor con `groupSubitemsByProveedor`/
    `groupTotals` (funciones puras ya existentes, reusadas tal cual sobre
    filas de D1 envueltas en el shape mínimo de `MondayItem` que necesitan) y
    el mismo folio global "OC-n" (`nextOcFolio`, ya 100% D1). El PDF no sale
    de Eledo: sale de `generarOcProveedorPdf`
    (`worker/lib/ocProveedorPdf.ts`) — un generador que YA corría en paralelo
    como preview 100% D1 desde el mismo 2026-08-13 (`GET /api/proyectos/:id/
    oc-nativa/:proveedorId/pdf`), sin folio ni firma. Esta fase lo vuelve el
    flujo OFICIAL para proyectos nativos: mintea folio, genera con ese mismo
    motor, guarda en R2 (mismo patrón `oportunidadFileKey`). Sin DocuSeal ni
    Drive.
  - Bug real encontrado y corregido, con blast radius más amplio que solo
    OC: `linked_item_ids` de un board_relation escrito por código nativo
    guardaba los ids como NÚMERO — verificado contra un board_relation real
    del mirror (`deal_contact` de una oportunidad real: `["12017028945"]`,
    string) que Monday los manda como STRING. `ocProveedorPdf.ts` compara
    por `===` contra un string y nunca hacía match con un número. Corregido
    en las tres fuentes: `boardRelationValue` (`outbox.ts`, Paso 6),
    `nativeTallaColumns` (`proyectoTallas.ts`, Paso 7) y, uno nuevo
    encontrado de paso, `submitCreateNative` (`createRecord.ts`, Paso 1) —
    que además tenía un bug más grave todavía: para columnas board_relation
    en la CREACIÓN de una oportunidad (ej. `deal_contact`) usaba
    `encodeColumnValue`, que da el shape de ESCRITURA (`{item_ids}`, la
    clave que espera la mutación) en vez del shape de LECTURA
    (`{linked_item_ids}`) — un contacto elegido al crear una oportunidad
    nativa habría quedado guardado bajo una clave que nadie busca.
  - Probado en local end-to-end: preview existente (`oc-nativa/:id/pdf`,
    sanity check de que seguía funcionando) → "Generar OC" oficial sobre el
    Proyecto de los Pasos 6-7 → PDF real verificado VISUALMENTE (folio OC-2,
    proveedor, razón social, tabla de línea con costo/desc. real del
    snapshot de costeo, subtotal $450 + IVA $72 = total $522 — verificado a
    mano —, importe en letras, firmantes Elaborado/Revisado/Autorizado con
    nombres reales). Outbox en cero.

- Feat: "salir de Monday" — Paso 7, tallas nativas (captura + confirmación,
  100% en el portal) (`worker/lib/proyectoTallas.ts`,
  `worker/routes/oportunidades.ts`)
  - Confirmado por Efraín: en el portal las tallas se capturan directo (por
    boxes), sin archivo ni Google Sheet — que es justo lo que `capturarTallas`
    ya hacía para items reales (el Sheet/"Importar tallas" es un camino
    PARALELO de Compras, no lo que se está reemplazando aquí).
  - `capturarTallas` gana rama nativa: crear = fila nueva en `items` (mismo
    espacio de ids sintéticos); actualizar = merge directo del `columns` JSON
    en vez de `change_multiple_column_values`. El enriquecimiento de costeo
    (`fetchCosteoEnrichment`, cruza contra el snapshot que congeló "Mandar a
    costeo") y el cruce contra lo cotizado (`checkTodoCuadra`) ya eran 100%
    D1 — funcionaron sin tocarlos.
  - `confirmTallasNativeD1`: mismo gate (`checkTodoCuadra`) y mismo PDF
    (`relacionTallasBlocks`, función pura reusada tal cual) que el flujo
    real, pero el PDF va a R2 (mismo patrón `oportunidadFileKey` que ya usa
    la subida de documento) en vez de a una columna de Monday; el rechazo
    mueve el status con `submitWrite` nativo en vez de `gql` directo. Sin
    DocuSeal ni Drive.
  - Gap encontrado de paso: `POST /api/proyectos/:id/documento` (sube la OC/
    cotización firmada del cliente, gate previo obligatorio de
    `checkOcCliente`) llamaba `addFileToColumn` (Monday) sin condición —
    hubiera fallado duro contra un Proyecto nativo. Ahora, para un id nativo,
    el archivo va solo a R2 y se estampa un marcador de texto en
    `items.columns` (`stampNativeFileMarker`) para que `checkOcCliente` lo
    encuentre, igual que encontraría el mirror de una columna file real.
  - Probado en local end-to-end sobre el Proyecto del Paso 6: capturar talla
    (creó el subitem con costo/moneda/descuento correctos, cruzados desde el
    snapshot de costeo real) → subir documento (marcador nativo) → confirmar
    tallas (cotizado 5 = asignado 5, aceptó) → PDF real verificado
    VISUALMENTE (Read del PDF: tabla producto/SKU/color/talla/cantidad
    correcta). Outbox en cero en todo momento.

- Feat: "salir de Monday" — Paso 6, "Ganar" → Proyecto nativo
  (`worker/lib/ganarOportunidad.ts`, `worker/lib/outbox.ts`)
  - `ganarOportunidadNativeD1`: crea el Proyecto como fila de `items` (mismo
    espacio de ids sintéticos), sin `create_item`/`move_to_group` en Monday.
    Copia compras/vendedor/zona VERBATIM del `RawCol` de la oportunidad —
    esas columnas ya traen el shape real de Monday desde que se creó
    (`submitCreateNative` usa `encodeColumnValue`), así que copiarlas es
    correcto y no hay que reconstruirlas. Sin `copyFiles` (no hay cotización
    firmada vía DocuSeal que copiar en este flujo nativo). La idempotencia
    (`proyectoForOportunidad`, doble click no duplica) ya era 100% D1 y
    funcionó sin tocarla.
  - Gap real encontrado y corregido en `worker/lib/outbox.ts` (afecta a
    CUALQUIER escritura futura de una columna board_relation en un item
    nativo, no solo a "Ganar"): el bypass de outbox para nativos escribía
    board_relation con el `value` genérico de `canonValue` (string plano),
    pero `dal.ts` (`linkedItemId`/`proyectoForOportunidad`) espera
    `{linked_item_ids:[...]}` — sin el fix, la relación Oportunidad↔Proyecto
    quedaba guardada pero invisible/inencontrable para ese lookup. Mismo
    patrón que el fix de `deal_stage`/`.index` del Paso 4: `boardRelationValue`
    nueva, exportada, reusada también en la creación del Proyecto.
  - Probado en local end-to-end: "Ganar" sobre la oportunidad de prueba →
    Proyecto nativo creado con el link bidireccional correcto en ambos
    sentidos (verificado con consulta directa a D1: Proyecto→Oportunidad vía
    `board_relation_mm0hf0y3` legible en la API; Oportunidad→Proyecto vía
    `board_relation_mm0hw8ew` con el shape correcto en D1, aunque invisible
    en la API por un gap de whitelist PREEXISTENTE — esa columna nunca tuvo
    entrada en `shared/visibility.ts`, ni para oportunidades reales de
    Monday; no se toca sin que Efraín decida). Etapa "Ganada" con índice
    correcto, personas/zona copiadas con nombre y shape correctos, doble
    click confirmado idempotente (mismo proyectoId, no duplica), outbox en
    cero en todo momento.

- Feat: "salir de Monday" — Paso 5, cotización nativa (PDF al cliente, sin
  Eledo/Monday/DocuSeal) (`shared/documents.ts`, `worker/lib/pdf/templates.ts`,
  `worker/lib/documents.ts`, `worker/lib/cotizacion.ts`,
  `worker/routes/oportunidades.ts`)
  - Confirmado por Efraín: los documentos (costeo y cotización) se generan
    desde el portal desde el arranque, no vía Eledo. `solicitud-costeo` ya
    era así; cotización (el PDF con precio para el cliente) hoy pasaba por
    Eledo + subida a columna de Monday + DocuSeal — ninguno de los tres
    aplica a un item nativo.
  - Nueva plantilla `cotizacion` en el motor propio de PDFs
    (`worker/lib/pdf/templates.ts`: `CotizacionData`/`cotizacionBlocks`,
    mismo `wrapTable` que ya usa solicitud-costeo/OC a proveedor) — tabla de
    líneas CON precio e importe, subtotal/IVA/total e importe en letras
    (`importeEnLetras`, ya existía). Registrada en `shared/documents.ts`
    (`DOC_TEMPLATES.cotizacion`, `autoAcuse: true` — mismo criterio simple
    que solicitud-costeo, sin ceremonia de firma en este primer corte).
  - `cotizacionData` (`worker/lib/documents.ts`) arma las líneas leyendo SOLO
    D1 (mismo patrón que `solicitudCosteoData`, respeta `canRead`) — a
    diferencia de la solicitud, sí lee precio (`numeric_mkzneg3d`).
  - `generarCotizacionNativeD1` (`worker/lib/cotizacion.ts`): mismos dos
    checks de skip que el flujo real (sin líneas / sin ningún precio), mintea
    folio propio (`cotizacion_folios`, ya existía), genera el documento vía
    `createDocument` (R2 + tabla `documents`, reuso total) y mueve la etapa a
    "Cotización" con el mismo `submitWrite` nativo. Sin Drive, sin DocuSeal,
    sin posts de update a Monday.
  - Dos bugs reales encontrados y corregidos en la prueba (no específicos de
    "nativo" — cualquier plantilla nueva los habría disparado):
    `signatureLabels()` no tenía caso para `'cotizacion'` (undefined[0] al
    armar el acuse) y el cálculo de `folio` en `createDocument` tenía su
    propio switch manual (distinto de `folioOf` en templates.ts) que tampoco
    cubría la plantilla nueva — el folio se generaba pero nunca se guardaba.
  - Probado en local end-to-end con verificación VISUAL del PDF (Read del PDF
    real generado): folio, institución, vendedor, tabla de producto con
    color/cantidad/precio/importe, subtotal $750 + IVA $120 = total $870
    (5 × $150 + 16%, verificado a mano), importe en letras correcto,
    membrete CMP correcto. Etapa movida a "Cotización" (índice 6), outbox en
    cero, folio persistido y verificado en la tabla `documents` tras
    regenerar (incrementa correctamente).

- Feat: "salir de Monday" — Paso 4, "Mandar a costeo" nativo simplificado
  (`worker/lib/costeo.ts`, `worker/routes/oportunidades.ts`)
  - Efraín: los checks elaborados del flujo real (`runCosteoNative` —
    reparación automática de embellecimiento, mover de grupo en Monday, posts
    al feed de "Actualizaciones") compensaban no tener otra forma de validar
    antes de tener `checkCosteo`; con `checkCosteo` ya validando en D1 antes
    de llegar aquí, no hace falta repetir esa complejidad para un item
    nativo. `runCosteoNativeD1` solo hace lo que sí es dato real: congela el
    snapshot de costo/precio por línea (`computeSnapshot`, función pura
    reusada tal cual — mismo cálculo, cero cambios) escribiéndolo directo en
    D1 (`writeNativeLineCols`, read-modify-write simple), y mueve la etapa
    4→15 reusando el mismo `submitWrite` que ya bypassea Monday para ids
    nativos (desde el Paso 1+2).
  - `enviarACosteo` gana un parámetro `ctx: ExecutionContext` (lo necesita
    `submitWrite`) — mismo patrón que ya tenía `enviarAValidacion`.
  - La solicitud de costeo en PDF (`generarSolicitudCosteo`,
    `worker/lib/documents.ts`) YA era 100% D1 (lee el mirror vía `canRead`,
    renderiza con el motor propio del portal) — funcionó sin ningún cambio;
    solo se le agregó el guard para saltar el upload extra a la columna de
    Monday (`file_mm10k65a`, solo aplicaba con `COSTEO_NATIVE=1`) cuando el
    item es nativo.
  - `enviarAValidacion` (15→7) ya solo usaba `submitWrite` — funciona sin
    tocarlo, confirmado en la prueba.
  - Probado en local end-to-end: pre-chequeo → "Mandar a costeo" → etapa
    "En costeo" (índice 15) con el snapshot financiero correcto (costo=100,
    desc=10%, gastos=5%, TC=1, precio=122.85 — fórmula real verificada a
    mano), cero outbox, PDF generado y asentado en la tabla `documents`.
    "Enviar a validación" confirmado sin cambios: rechazó por una regla de
    negocio real (producto de catálogo no vinculado) sin tocar Monday.

- Feat: "salir de Monday" — Paso 3, líneas de cotización nativas
  (`worker/routes/oportunidades.ts`, `worker/routes/boards.ts`,
  `shared/dealStages.ts`, `worker/lib/createRecord.ts`, `worker/lib/outbox.ts`)
  - Crear línea (`POST /api/oportunidades/:id/productos`): si el padre es
    nativo, se salta `createSubitem` (Monday) y se inserta la fila directo en
    `items` (board `oportunidades_sub`, `parent_item_id` = el id del padre,
    mismo `reserveNativeId` — un solo espacio de ids para toda entidad
    nativa). `oportunidades_sub` no tiene authzCols (se scopea por el dueño
    del padre, `worker/lib/dal.ts`), así que no hace falta el shape
    estructurado que sí necesitan las columnas de personas.
  - Borrar línea (`DELETE /api/boards/:slug/items/:id`, genérico): si el id es
    nativo se salta `deleteItem` (Monday) y borra solo en D1.
  - Hallazgo importante en la investigación: TODO el pipeline (crear línea,
    `quoteVersions.ts`, `notify.ts`) decide la etapa leyendo `.index` dentro
    del `value` crudo de `deal_stage` — NUNCA el label de texto. Mi creación
    nativa original solo guardaba `{label}` (vía `encodeColumnValue`), así que
    el gate "solo se crean líneas en stage 4" siempre fallaba para una
    oportunidad nativa recién creada. Fix: `shared/dealStages.ts` gana
    `dealStageValue(label)` → `{label, index}`; se usa tanto al crear
    (`submitCreateNative`) como al editar `deal_stage` de un item nativo
    (`submitWrite`, que nunca recibe el echo de Monday que normalmente lo
    rellena).
  - Probado en local end-to-end: crear oportunidad nativa → crear línea →
    editar cantidad/color (sin encolar outbox) → borrar línea → mover de
    etapa (el índice se actualiza correctamente, verificado "En costeo"→15) →
    intentar crear línea fuera de stage 4 correctamente rechazado.

- Fix: ids nativos aleatorios de verdad, no un contador (`nativeSeq.ts`)
  - Efraín: los ids sintéticos deben ser random (Web Crypto, no `Math.random`
    ni un contador secuencial) — igual que los de Monday, que se ven como
    números grandes sin patrón. Un contador delataría cuántos registros
    nativos existen y en qué orden nacieron. `reserveNativeId` ahora sortea un
    offset de 32 bits sobre `NATIVE_ID_FLOOR` y verifica unicidad contra TODA
    la tabla `items` (global, como Monday) antes de devolverlo, con reintento.
  - Una sola función para toda entidad nativa futura (línea, proyecto...): al
    compartir piso y rango, el largo en dígitos siempre sale igual (12),
    nunca varía por tipo de registro — pedido explícito de Efraín.
  - Probado en local: tres creaciones seguidas dieron ids de 12 dígitos sin
    patrón secuencial (903480448515, 903668866508, 902736970730).

- Feat: "salir de Monday" — Paso 1+2, oportunidades nativas de Zona Efrain
  (`shared/nativeId.ts`, `worker/lib/nativeSeq.ts`, `worker/lib/createRecord.ts`,
  `worker/lib/outbox.ts`, `worker/sync/reconcile.ts`, `worker/sync/refetch.ts`,
  `worker/routes/boards.ts`, `CreateOportunidadModal.tsx`, `StageBoard.tsx`)
  - Objetivo del branch (Efraín): las oportunidades de Zona Efrain (CEO) siguen
    siendo items reales de Monday hoy — cualquier admin con acceso directo al
    board las ve, porque restringir eso a nivel Monday.com no es viable. La
    única forma de que sean invisibles de verdad es que nunca existan en
    Monday. Primer corte, chico y probado, no la capa genérica de 8 entidades
    que se había diseñado antes (Efraín: "no cambio súper drástico", "IDs como
    hacía Monday", reusar las tablas actuales) — un item nativo es una fila
    más de `items` (mismo shape de columnas, mismo scoping de `dal.ts`/
    `visibility.ts`) con un `item_id` sintético (`shared/nativeId.ts`,
    NATIVE_ID_FLOOR = 900_000_000_000) que nunca se manda a Monday.
  - Crear (`submitCreateNative`): gateado a la whitelist de Zona Efrain
    (`isZonaPrivadaAdminPermitido`), solo board Oportunidades. El texto de
    display de columnas people/contacto (que Monday resuelve del otro lado) se
    resuelve local con el roster cacheado (`cachedFetchUsers`) o el mirror de
    Contactos — no hay a quién más preguntarle.
  - Editar (`submitWrite`/outbox.ts): el merge optimista a D1 YA es la
    escritura real para un id nativo — se salta el INSERT a `outbox` y el
    flush a Monday, devuelve `pending:false` de una vez. Gap conocido y
    aceptado: si el patch toca una authzCol (vendedor), `vendedor_ids` no se
    recalcula ahí, solo en la creación.
  - Blindaje crítico encontrado en la investigación: `reconcile.ts` (cron) y
    `refetch.ts` (lecturas `?fresh=1`) borran de `items` cualquier fila que no
    encuentran en la respuesta de Monday — sin guard, un item nativo se
    autodestruye en el próximo reconcile o en la próxima apertura "fresh" del
    drawer. Ambos ahora ignoran ids >= NATIVE_ID_FLOOR.
  - Probado en local (`wrangler dev --local`, D1 sqlite local, roster real vía
    Monday): crear, leer (list+detail, texto/vendedor_ids correctos), editar
    sin encolar outbox, `?fresh=1` y un reconcile COMPLETO contra Monday real
    (743 items reales) — la fila nativa sobrevivió los tres.
  - Incidente durante la prueba: el primer intento pegó por error al
    `wrangler dev` de OTRO checkout (`~/Documents/dev/cmp-portal`, otra sesión
    concurrente, código de `main` sin este cambio) y creó un item real de
    prueba en Monday.com de producción ("TEST NATIVO — no borrar",
    id 12798144299) — se borró de inmediato vía la integración de Monday.
    Lección: puertos 5173/8787 pueden pertenecer a OTRO checkout, no solo a
    otra sesión en el mismo — confirmar `cwd` del proceso antes de dar por
    buena una prueba local.
  - Frontend: `CreateOportunidadModal` acepta `native?: boolean`;
    `StageBoard.tsx` lo prende solo para `boardKey === 'zona_efrain'`. El resto
    de los flujos de creación (Oportunidades, Costeo) no cambian.
  - Siguiente paso propuesto (no implementado aún): líneas de cotización
    nativas (subitems) — pendiente de que Efraín confirme para seguir.

- Feat: botón "Reabrir" para oportunidades Ganada/Perdida/Cancelada
  (`OpportunityDrawer.tsx`)
  - Efraín pidió habilitar "descancelar"/reabrir una oportunidad, disponible
    para vendedor, compras y admin (los tres roles con acceso a Oportunidades).
  - No hace falta endpoint nuevo ni cambio de whitelist: `deal_stage` ya es
    `w: ['vendedor','compras','admin']` en `shared/visibility.ts`, así que
    `onReabrirOportunidad` reusa el mismo PATCH genérico que ya usan
    Cancelar/Perder/Archivar.
  - No hay historial de la etapa previa en el mirror (ni D1 ni Monday guardan
    de dónde venía al cerrarse), así que Reabrir siempre manda a "Nueva
    oportunidad" (stage `4`) — mismo destino sin importar si venía de Ganada,
    Perdida o Cancelada. El botón aparece cuando `stage` es una de esas tres
    y la oportunidad no es ajena (mismo guard que el resto de las acciones).

- Fix: "Editar/Dividir" en Proyecto → Cotización no escribía a Monday
  (`proyectoCotizacionVirtual.ts`, `lineaAjustes.ts`, `dal.ts`)
  - Pam reportó (con captura) que al editar cantidades de dos líneas del
    Proyecto UNIFORMES PC NL - OPP-0487 (12446: 2→4, 12471: 12→10) el guardado
    "no funcionó" — el tab mostraba los cambios como exitosos ("Editada" +
    Total recalculado), pero Tallas seguía viendo las cantidades viejas.
    Causa: esa pestaña (construida 2026-08-10) era una capa 100% D1 a
    propósito, que nunca tocaba Monday — Tallas importa/genera su desglose de
    subitems reales, así que la edición nunca llegaba ahí. Efraín pidió
    explícitamente que sí escriba a Monday.
  - En vez de reimplementar la escritura, se reusa el motor real de "Ajustar
    línea" de Oportunidades (`worker/lib/lineaAjustes.ts`, ya diseñado para
    funcionar incluso con la Oportunidad Ganada): se extrajo `applyAjusteLinea`
    (la escritura real, ya autorizada) de `ajustarLinea` (el chequeo de scope +
    la escritura). El endpoint del Proyecto sigue autorizando contra el dueño
    del PROYECTO (`project_owner`, no la Compras de la Oportunidad
    `multiple_person_mm03qyw9` — son columnas distintas que solo se copian una
    vez al Ganar y pueden divergir después) y solo reusa `applyAjusteLinea`
    para el write real, vía el nuevo `getItemTrusted` en `dal.ts` (fetch sin
    scope, solo para un llamador que ya autorizó por otra vía).
  - `getVirtualLines` deja de mantener su propia tabla de merge
    (`proyecto_cotizacion_ajustes`, ahora sin uso) y en su lugar lee las líneas
    reales (`childrenOf`) + el log de ajustes compartido con Oportunidades
    (`cotizacion_ajustes`, el mismo que alimenta los pills "V{n}.{m}" de
    `VersionChips`) — nueva función pura `labelLines` reconstruye el badge
    "Editada"/"Dividida" por línea a partir de ese log (reemplaza
    `proyectoCotizacionVirtual.test.ts`, que testeaba el merge que se elimina).
  - Verificado en vivo contra Monday real (Monday MCP + `wrangler dev` local):
    las dos líneas reales de Pam (12613285876/12446, 12460005988/12471) ahora
    tienen `numeric_mkzm6399` = 4 y 10 en el board real de subitems, confirmado
    también desde la Oportunidad ligada (Ventas) y desde el tab Cotización del
    Proyecto (badges "Editada" reconstruidos correctamente desde el log
    compartido). `tsc --noEmit`, `oxlint` y `npm test` (222 tests) limpios.

- Fix: columna Producto (sticky) del grid de cotización/costeo dejaba ver una
  franja del <select> vecino al hacer scroll horizontal (`gridMeta.tsx`)
  - El grid de cada fila usa `alignItems: 'center'`, así que la celda sticky de
    Producto solo medía el alto de su texto (una línea) mientras celdas vecinas
    más altas (el `<select>` de Etapa Costeo, con padding) quedaban centradas en
    la fila y se asomaban por arriba/abajo de la celda sticky al scrollear —
    se veía como una franja translúcida/rosa rodeando el nombre del producto.
    `STICKY_PRODUCTO_STYLE` ahora fuerza `alignSelf: 'stretch'` + `height: 100%`
    para que la celda cubra todo el alto de la fila.

- Fix: tab "Zona Efrain" solo muestra líneas del CEO (`dealStages.ts`)
  - `vendedorNames` filtraba por 'Efrain Ponce' y 'Elisa Vallado'; Elisa solo
    tiene acceso de whitelist a la zona (crea oportunidades ahí para el CEO)
    pero sus propias líneas no debían contar como parte de la zona. Ahora solo
    'Efrain Ponce'.

- Feat: acceso "Ejecución" del sidebar renombrado a "Reporte de Proyectos" y
  sin filtro de status (`projectStages.ts`, `Sidebar.tsx`)
  - Antes solo mostraba proyectos con `project_status = Ejecución` (id `3`);
    ahora `statuses: PROJECT_STATUS_ORDER` incluye las 6 etapas, así que
    aparecen todos los proyectos sin importar su estado. Sigue agrupado por
    Zona y con la batería de avance (comportamiento ligado a `key ===
    'ejecucion'`, sin cambios).

- Feat: columna Techo (`numeric_mkznpn83`) editable en la grid de Costeo para
  compras y admin
  - Estaba en la whitelist como solo lectura (`vis: AC`, grupo de columnas
    mirror/fórmula) y nunca se pintaba como input aunque ya se mostraba en la
    grid desde el 2026-08-10. Se le dio su propia entrada `w: WAC` en
    `shared/visibility.ts` y se agregó a `inlineEditableCols` en `gridMeta.tsx`
    — mismo patrón que Costo embell. C/U, que tuvo el mismo bug.

- Fix: chip de talla en Ejecución ahora deja claro que ahí se modifica el
  estado (`EjecucionSection.tsx`)
  - Pam (compras) no lograba cambiar el color/estatus de una talla porque el
    chip solo mostraba color + talla + cantidad, sin ningún indicio de que
    era clickeable ni de qué estado tenía. Se agregó el texto del estado
    dentro del chip, un ícono de lápiz cuando el usuario puede editar, tooltip
    explícito ("toca para cambiar el estado") y un hint arriba de las
    tarjetas para quien tiene permiso de edición.

- Feat: Solicitud de costeo y Cotización (vista previa) usan el template de la
  OC a Proveedor + fix de PDFs multipágina que solo mostraban la página 1
  - Efraín: el PDF de la OC a Proveedor (`worker/lib/pdf/ordenCompraProveedor.ts`,
    naranja de marca en el header de tabla, membrete, desglose Subtotal/IVA/Total)
    "está genial, usa ese mismo template" — pidió lo mismo para Solicitud de
    costeo y para una vista previa de Cotización (aclaró que esta última es
    SOLO vista previa dentro del portal, la cotización oficial al cliente
    sigue saliendo de Eledo).
  - `CMP_ORANGE` se movió de `ordenCompraProveedor.ts` a `worker/lib/pdf/logo.ts`
    (junto al logo) para que las plantillas nuevas lo reutilicen sin duplicar
    el literal. `solicitudBlocks` (`worker/lib/pdf/templates.ts`) ahora usa
    `wrapTable` con el header naranja en vez de la tabla gris genérica, y las
    3 plantillas de `documents.ts` (solicitud/remisión/constancia) ganan el
    membrete real (antes caían al texto "MEXICANA DE PROTECCIÓN" — el `meta`
    nunca mandaba `logo`).
  - Cotización vista previa es nueva y nativa, mismo patrón que la OC a
    Proveedor: `worker/lib/pdf/cotizacionPreview.ts` (bloques puros) +
    `worker/lib/cotizacionPreviewPdf.ts` (arma los datos desde las líneas
    vigentes de la Oportunidad — el mirror siempre es la vigente, ver
    `quoteVersions.ts`) + `GET /api/oportunidades/:id/cotizacion-preview/pdf`.
    No pasa por `documents.ts` (D1) — se genera al vuelo y se descarta al
    cerrar el preview, igual que `oc-nativa/:proveedorId/pdf`. Botón "Vista
    previa" nuevo en `CotizacionPdfRow.tsx`, junto a los thumbnails de Costeo/
    Sin firmar/Firmada.
  - Fix reportado aparte: el modal de preview de PDF (`PdfCanvasPreview.tsx`)
    solo renderizaba `getPage(1)` — con cualquier PDF de más de una página
    (la mayoría de las OC/cotizaciones con varias líneas) solo se veía la
    primera. Ahora itera `doc.numPages` y apila un `<canvas>` por página
    dentro de un contenedor (antes un solo `<canvas>` fijo).
  - De paso: `worker/lib/ocProveedorPdf.ts` tenía imports rotos desde su
    commit original (`../shared/types`/`./env` en vez de `../../shared/types`/
    `../env` — `worker/shared/` no existe) que rompían `tsc --noEmit` sobre
    `tsconfig.worker.json`; se corrigió al tocar el archivo hermano
    (`cotizacionPreviewPdf.ts` copia el mismo patrón). No se tocaron los otros
    2 errores preexistentes de `tsc` (`admin.ts`, `boards.ts`) — no relacionados
    con este trabajo.
  - Verificado generando ambos PDFs con datos de prueba y renderizando con
    `qlmanage -t` (motor de PDF real de macOS) para revisar el layout a ojo;
    conteo de páginas de un PDF de prueba de 5 páginas confirmado con
    `pdfjs-dist` en Node (antes del fix del preview solo se habría visto 1).
  - `npx tsc --noEmit` (3 tsconfigs) y `npm run lint` limpios. Un test de
    `writer.test.ts` empezó a fallar tras agregarle el membrete a la solicitud
    de costeo: la aserción "el PDF no debe traer ningún `$`" decodificaba el
    archivo completo, incluido el JPEG binario del logo, y sus bytes
    coincidían por azar con el patrón — se ajustó el test para excluir el
    stream de la imagen antes de decodificar texto, no para debilitar la
    aserción real.
  - Nota de concurrencia: había otra sesión con cambios sueltos sin commitear
    en archivos que este trabajo también tocó (`worker/routes/oportunidades.ts`
    principalmente, feature de Tallas/Género M/F) — se aislaron los hunks
    propios y se dejó el resto del working tree intacto.

- Feat: Tallas del catálogo se sincronizan Portal→Airtable ("Tallas Portal") +
  checkbox "Género M/F"
  - Efraín reportó que Compras corrige "Tallas" (text_mm5v6jhj, catálogo
    Productos) desde el portal, pero Airtable sigue mandando su propio valor
    cada ~8h vía Make ("001. Productos - Sync Airtable to Monday" →
    cmp-tallas `sync_producto.py`) y lo pisa. Investigado el mecanismo real
    con Make MCP + introspección directa de la API de Airtable: los campos
    "Tallas"/"Tallas de ficha comercial (ai)" en Airtable son **AI fields**
    (confirmado con un PATCH real: `INVALID_VALUE_FOR_COLUMN`, no es cuestión
    de payload) — Airtable nunca los va a aceptar por API, así que no hay
    forma de que el portal "gane" escribiendo ahí. Efraín creó un campo nuevo
    de texto plano "Tallas Portal" (`fldaxxCo1hD26cb7d`) para que el portal
    escriba ahí en vez.
  - `worker/lib/airtable.ts`: `buildTallasPortalValue` (pura, testeada) +
    `updateTallasPortal` (PATCH a Airtable, best-effort/silencioso como
    `fetchAirtableImageUrl`) + `syncTallasPortal` (junta Tallas + género +
    airtable_id del mirror y dispara el push). Hook en `submitWrite`
    (`worker/lib/outbox.ts`) cuando se edita `text_mm5v6jhj` en `productos`.
  - Género M/F (nuevo, mismo pedido): Efraín quiere que al marcar el
    checkbox, "Tallas Portal" salga con la lista repetida con prefijo M-/F-
    por talla (mismas tallas para ambos géneros) en vez de la lista simple.
    Vive **solo en D1** (`worker/lib/productoGenero.ts`, tabla
    `producto_genero`) — "no vale la pena" una columna de Monday para esto
    (Efraín). Endpoints nuevos `GET/PATCH /api/productos/genero` (gate WAC,
    mismo grupo que Tallas). Checkbox nuevo en `LineDetailPanel.tsx` junto a
    Tallas, mismo patrón optimista que el resto del panel, prop-drilling por
    `QuoteRow`/`MobileQuoteRow`/`CotizacionTab`.
  - `npx tsc -b`, `npm test` (223 tests, incluye 4 nuevos de
    `buildTallasPortalValue`) y `npm run lint` limpios.

- Fix: "Eliminar línea" tardaba muchísimo (hasta 10s+) en reflejarse
  - Efraín probó el borrado directo (Nueva oportunidad) y la línea seguía
    apareciendo un buen rato después de "borrada". Causa: `DELETE
    /api/boards/:slug/items/:id` (worker/routes/boards.ts) solo borraba en
    Monday (`deleteItem`) y devolvía `ok`, sin tocar el mirror D1 — la fila
    solo desaparecía cuando llegaba el webhook `subitem_deleted`
    (worker/sync/webhook.ts), que tiene `DEBOUNCE_MS = 10_000` más la
    latencia real de entrega de Monday. El refetch del drawer tras borrar
    (`onSaved` → `load()`) lee el mirror, así que mostraba la línea "viva"
    todo ese rato.
  - Fix (propuesto por Efraín: "empieza por D1 solo, para de verdad no
    mostrarla"): la ruta ahora borra la fila de D1 en el momento
    (`DELETE FROM items WHERE board_id=? AND item_id=?`, mismo query que usa
    el webhook) justo después de que Monday confirma el borrado, antes de
    responder. Si el webhook llega después, es un DELETE sobre una fila que
    ya no existe — no-op inofensivo. La ruta de "Eliminar línea" vía versión
    nueva (`/api/oportunidades/lineas/:id/ajustar`, modo eliminar) no tenía
    este problema — ya hace `refetchItemTree` (lectura fresca de Monday)
    antes de responder.
  - Verificado en vivo (Playwright + Monday real, dev local) cronometrando
    clic→desaparición: ~1.8s, dominado por la latencia propia de la mutación
    `delete_item` de Monday, ya no por el debounce del webhook.
  - `tsc --noEmit`, `npm test` (219 tests) y `npm run lint` limpios.

- Fix: "Eliminar línea" — corrige el diseño del commit anterior (mismo día) tras
  probarlo en vivo con Efraín
  - Efraín probó el commit anterior (`cd23558`) y corrigió dos cosas en vivo:
    (1) el ícono de eliminar debía ir en su propia columna al final de la fila,
    no pegado al chevron/✎ al inicio — ahora es 🗑 en una columna fija de 32px
    al final de `QuoteRow`/`MobileQuoteRow` (y el header/`TotalsRow` la
    replican para que todo siga alineado, gateada por el mismo `canAddLines`).
    (2) más importante: "cuando NO ESTÁ en Nueva oportunidad se crea una
    versión nueva" — el diseño original metía 'eliminar' como tercer modo de
    `ajustarLinea` (worker/lib/lineaAjustes.ts), igual que editar/dividir, es
    decir SIN versión y funcionando incluso en Ganada. Eso está mal: borrar
    una línea completa cambia el total de la cotización (a diferencia de
    editar/dividir, que preservan el mismo valor) y Efraín quiere que eso
    fuerce un regreso a costeo, igual que "+ Nueva versión".
  - Revertido el modo 'eliminar' de `lineaAjustes.ts` (queda como estaba,
    solo editar/dividir, sin versión, funciona en Ganada). El modo 'eliminar'
    ahora se maneja en la ruta (`worker/routes/oportunidades.ts`,
    `POST /api/oportunidades/lineas/:id/ajustar`): llama `duplicateVersion`
    (archiva la vigente como versión nueva, resetea Etapa Costeo — mismo
    mecanismo y mismo guard de Ganada/Perdida que "+ Nueva versión") y LUEGO
    `deleteItem` sobre la línea. `AjustarLineaResponse` ahora trae
    `versions?` para que el modal se lo pase al drawer vía el nuevo prop
    `onVersioned` (`CotizacionTab`→`OpportunityDrawer`) y el chip "V{n} ·
    vigente" quede correcto sin depender de que `onSaved` (que solo relee el
    item) también reincluyera versiones en cada tecla. El modo "Eliminar
    línea" del modal se oculta cuando `!editable` (Ganada/Perdida) en vez de
    dejar que el usuario lo intente y se tope con el error del server.
  - Verificado en vivo contra Monday real (dev local, token real) usando
    OPP-0842 ("PRUEBA CLAUDE 3 - borrar", oportunidad de prueba desechable):
    el ✕ directo de Nueva oportunidad (el bug de ruta rota del commit
    anterior) ya borra la línea correctamente end-to-end — confirmado con
    Playwright viendo el DELETE devolver 200 y la línea desaparecer. El flujo
    nuevo (eliminar fuera de Nueva oportunidad → nueva versión) quedó
    verificado por tipos/tests/lint pero NO probado en vivo contra Monday en
    esta sesión — las únicas oportunidades de prueba disponibles seguían en
    Nueva oportunidad; pendiente que Efraín lo prueba en una ya costeada.
  - `tsc --noEmit` (3 tsconfigs), `npm test` (219 tests) y `npm run lint`
    limpios.

- Feat: "Eliminar línea" en cotizaciones — Costeo y Oportunidad post-costeo
  - Efraín pidió poder borrar una línea completa al editar la cotización en
    Costeo y en Oportunidades (no solo cambiar SKU/color/cantidad). Se agregó
    como tercer modo del modal "Ajustar línea" (`AjustarLineaModal.tsx`) junto
    a "Editar"/"Dividir" — mismo acceso (Costeo compras/admin, Oportunidades
    post-stage-4 vendedor/compras/admin), mismo endpoint
    `POST /api/oportunidades/lineas/:id/ajustar` con `modo: 'eliminar'`
    (`worker/lib/lineaAjustes.ts`): llama `deleteItem` de Monday y registra el
    ajuste en `cotizacion_ajustes` con resumen "Línea eliminada"; el mirror D1
    se limpia solo vía el webhook `subitem_deleted` (mismo camino que borrar
    directo en Monday, commit `b98f823`).
  - De paso, encontré y arreglé un bug real preexistente: el botón "✕" de
    eliminar línea en Nueva oportunidad/borrador (`CotizacionTab.tsx`,
    commit `d739b3d`) llamaba a `/oportunidades_sub/${id}` con DELETE, una
    ruta que nunca existió — la ruta real es
    `/api/boards/oportunidades_sub/items/:id`. El botón llevaba desde el 18 de
    julio devolviendo 404 en silencio (el catch solo hace `console.error`).
  - `tsc --noEmit` (3 tsconfigs), `npm test` (219 tests) y `npm run lint`
    limpios. No se pudo probar en vivo contra Monday en esta sesión (sin
    credenciales de Access a mano); pendiente que Efraín lo pruebe en Costeo
    y en una Oportunidad ya costeada.

- Chore: limpieza de código muerto/duplicado en `worker/` (auditoría, "clean
  old code") + mensaje de error más claro al crear un registro.
  - `shared/quoteTerms.ts` (`QUOTE_TERMS_BOARD`) y `shared/documents.ts`
    (`DOC_TEMPLATE_IDS`): sin ningún importador, verificado con grep antes de
    borrar.
  - `worker/lib/pdf/ordenCompraProveedor.ts` reimplementaba el algoritmo
    completo de `importeEnLetras` (tablas ONES/VEINTI/TENS/HUNDREDS +
    tresCifras/numeroAPalabras) en vez de importar el de
    `worker/lib/importeEnLetras.ts` (ya compartido por oc.ts/cotizacion.ts, ya
    testeado) — ~55 líneas menos, mismo output.
  - `cvText`/`cvNum` (columna→texto/número de un `MondayCol[]` en vivo) y
    `firstPersonId` (primer id de una columna people) vivían duplicados
    idénticos en `cotizacion.ts`, `oc.ts`, `proyectoTallas.ts` y/o `costeo.ts`
    — movidos a `worker/lib/monday.ts` (dueño del tipo `MondayCol`) y
    exportados desde ahí. `firstLinkedId` (oc.ts vs proyectoTallas.ts) se dejó
    intacto — regresan tipos distintos (string vs number), no es fusión
    mecánica.
  - `NUM` (formato es-MX con `Intl.NumberFormat`) duplicado en
    `proyectoTallas.ts` y `pdf/templates.ts` — movido a `importeEnLetras.ts`
    como `fmtNumMx` (mismo tema: formatear números para documentos).
  - `worker/lib/createRecord.ts`: el error "falta un campo requerido" al crear
    un registro mostraba el id crudo de la columna de Monday
    (`"multiple_person_mm03qyw9 is required"`) en vez de su nombre — lo
    encontré probando la creación de una Oportunidad real (pedido de Efraín,
    "verify everything... creating an opportunity"): Compras es obligatorio
    desde 2026-08-10 pero el modal no lo marca con `*` ni el server decía cuál
    campo era en español. Ahora usa `COLUMN_META[slug][id].title` ("Comprador
    es obligatorio").
  - Sin cambios de comportamiento salvo el texto del error — verificado con
    `tsc -b`, `npm test` (219 tests), `npm run build`, y en el navegador
    (Playwright) recorriendo Tallas/Órdenes de compra/Ejecución de un Proyecto
    real sin errores de consola.

- Chore: limpieza de código muerto encontrada por auditoría (pedido de Efraín,
  "clean old code") + refresca `docs/code-index.md` con ~33 archivos que
  faltaban desde el último refresh (2026-07-21) y corrige su descripción de
  `src/data/oportunidades.ts` (no es mockup muerto — `src/lib/mockFallback.ts`
  la usa como fallback offline real, activo en producción si el Worker falla).
  - `src/data/oportunidades.ts`: quita ~10 exports sin ningún importador
    (`quoteVersionsByOpp`, `documentsByOpp`, `newProductsByOpp`,
    `productCatalog`, `vendedores`, etc.) — 246 → 128 líneas. Verificado con
    grep de un solo importador (`mockFallback.ts`) antes de tocar nada.
  - `src/components/forms/SearchableSelect.tsx`: su `norm()` local era
    idéntico a `normalizeText` de `lib/textMatch.ts` — reemplazado por el
    import, mismo comportamiento.
  - `src/boards/oportunidades/tabs/cotizacion/{QuoteRow,MobileQuoteRow}.tsx`:
    el cálculo del banner de avisos de línea era código duplicado
    byte-idéntico entre las dos (confirmado con diff) — extraído a
    `computeLineBanner` en `gridMeta.tsx`, sin cambio de comportamiento.
  - Sin cambios de comportamiento en ningún caso — verificado con `tsc -b`,
    `npm test` (219 tests) y `npm run build`.

- Refactor: divide `ProyectoSection.tsx` (1196 líneas, el archivo más grande
  del repo) en `src/boards/oportunidades/proyecto/` — `shared.tsx` (consts de
  columna, `ProyectoState`/`useProyecto`, `ProyectoActionBar`/`ProyectoLinks`/
  `FileList`/`Shell`), `TallasSection.tsx`, `OrdenesSection.tsx`,
  `EjecucionSection.tsx` — uno por tab del Proyecto. Pedido de Efraín
  ("optimize... more modular"): ningún import site tuvo que cambiar,
  `ProyectoSection.tsx` queda como barrel de 10 líneas que re-exporta lo
  mismo que ya exportaba. Sin cambios de comportamiento — extracción mecánica,
  verificada con `tsc -b`, `npm test` (219 tests) y `npm run build`.

- Fix: re-introspección de boards (`scripts/introspect-boards.mjs` contra Monday
  real, pedido de Efraín — "check everything using monday api") reveló que
  `color_mm0hqf79` ("Estado del producto", proyectos_sub) renombró su label
  índice 5 de "OC Proveedor lista" a "Enviado con el" en Monday — nuestras
  copias locales del texto (obligadas, el worker no puede importar
  `column-meta.gen.ts` como fuente de labels de negocio) seguían con el texto
  viejo en `shared/notifications.ts` (`PRODUCT_STATUS_LABELS`),
  `src/lib/estadoProductoBuckets.ts` (`LABEL_TO_BUCKET`/`ESTADO_PRODUCTO_ORDER`)
  y `ProyectoSection.tsx` (`ESTADO_PRODUCTO_COLORS`). Bug real y activo: el
  picker "cambiar estado" del tab Ejecución seguía ofreciendo el label viejo,
  que ya no existe en Monday — un intento de guardarlo habría fallado o hecho
  que Monday asignara una etiqueta arbitraria; además `estado_producto_historial`
  (D1) habría quedado registrando texto obsoleto en el historial permanente.
  Las 4 copias ahora dicen "Enviado con el" (mismo índice, mismo bucket
  `por_surtir`, mismo color, misma posición en el orden — la conducta no
  cambia, solo el texto que ya no coincidía con Monday). `column-meta.gen.ts`
  también recogió una opción nueva de "Color" (`dropdown_mkztty4b`, "MARRON")
  sin impacto en código.
  - **Pendiente de decisión de Efraín** (no toqué nada): la introspección
    también reveló que `deal_stage` (Oportunidades) ahora tiene un índice 10
    con label "En Negociación" (con acento) ADEMÁS del índice 3 existente
    "En Negociacion" (sin acento) — dos opciones de Monday que normalizan al
    mismo texto. `shared/dealStages.ts` (`DEAL_STAGE_LABELS`/`DEAL_STAGE_ORDER`)
    no conoce el índice 10. Si es un duplicado accidental en Monday, se debería
    borrar ahí; si es una etapa nueva intencional, hay que agregarla a
    `dealStages.ts` (posición en el pipeline, notificaciones, etc.) — decisión
    de negocio, dejo ambas opciones intactas hasta que Efraín confirme cuál es.
- Fix: 2 constantes muertas (`SUB_PRECIO`, `SUB_ETAPA_COSTEO`) en
  `worker/lib/lineaAjustes.ts` — declaradas pero nunca leídas (el copiado de
  "dividir línea" ya las cubre por tipo de columna vía `COPY_COL_TYPES`, no
  por estas constantes). Sin efecto en comportamiento.

- Fix: descuento de Proyecto se guardaba como % entero, `generar-oc` lo leía
  como fracción — montos de OC negativos
  - Encontrado corriendo, por pedido de Efraín, una prueba end-to-end real de
    las 4 fases nativas (Costeo/Cotización/Tallas/OC) contra una Oportunidad y
    Proyecto de prueba reales (levanté un segundo `wrangler dev` en :8790 con
    `.dev.vars` propio —flags `*_NATIVE=1`, sin tocar el server que ya corría
    en :8787 de otra sesión— y un D1 local aparte poblado con `seed-identity.mjs`
    + `hydrate.mjs` contra Monday real). Costeo, Cotización y Tallas nativos
    pasaron limpio con matemática verificada a mano en cada paso (incluido un
    DocuSeal real por cada uno, a Efraín como vendedor de la prueba).
  - OC nativo dio un monto de **-$151,980**. Causa: `capturarTallas`
    (`worker/lib/proyectoTallas.ts`, Fase 3) copiaba `OPP_SUB_DESCUENTO`
    (`numeric_mkzn2q51`, el % ENTERO que escribe `costeo.ts`'s
    `computeSnapshot` — "18" = 18%) directo a `SUB_DESCUENTO` del Proyecto
    (`numeric_mm1dmsaz`), que `oc.ts` lee como fracción 0-1
    (`1 - descuento`): con "18" sin convertir, `(1 - 18) = -17`. El Python
    real (`import_tallas.py:374`) sí hace `descuento_raw * 0.01` en el punto
    equivalente — nuestro puerto de Fase 3 se la saltó.
  - Fix: nueva `pctTextToFraction` en `fetchCosteoEnrichment` (divide entre
    100 antes de copiar). Test de regresión (`proyectoTallas.test.ts`).
    `tsc -b`, `npm test` (219 tests) y `npm run lint` limpios.
  - Costo real: la OC-1 con el monto malo ya había subido su PDF a un
    Proyecto de prueba real en Monday y creado una submission DocuSeal real
    (`10164844`) pidiendo firma a Pam (`compras@`) y Elisa
    (`administracion@mexicanadeproteccion.com`) — Efraín decidió avisarles
    él directamente en vez de que el portal intente cancelar nada. Con el fix
    ya aplicado, regeneré la OC (`tallas-capturar` reconcilió el `0.18`
    correcto en el subitem existente, luego `generar-oc` de nuevo): OC-2 dio
    **$7,330.80** (3 × 2,980 × 0.82, exacto). El item de prueba
    ("PRUEBA NATIVA FASE5 - borrar (Claude)") queda marcado para borrar.

- Feat: "salir de Monday" Fase 5 — carpetas de Drive nativas + depósito de PDFs
  - Antes de escribir código, encontré que la creación de carpeta+subcarpetas
    hoy NO la hace cmp-tallas sola: la orquesta el escenario 100 de Make
    (crea la carpeta raíz con su propio módulo de Drive, padre
    `1UuhMjK1HrNaOyC_yhD9zB7FswisZpGff` en la unidad compartida
    `0ALj_2-Dlrb72Uk9PVA`) y LUEGO llama a `create_subfolders` de cmp-tallas
    para las 12 subcarpetas — disparado por el webhook nativo `create_item` de
    Monday, no por ningún botón del portal. Le pregunté a Efraín el alcance:
    eligió el reemplazo completo (carpeta+subcarpetas+depósito de PDFs), no
    solo el depósito.
  - `worker/lib/googleAuth.ts`: primer patrón de firma criptográfica del repo —
    JWT RS256 con Web Crypto (`crypto.subtle.importKey('pkcs8',...)` +
    `sign`), sin librería `googleapis` (no existe para Workers). Verificado EN
    VIVO con el código EXACTO (no una aproximación con `node:crypto`) contra la
    API real de Google: intercambio de token + GET de la carpeta padre real,
    ambos 200 antes de construir encima.
  - `worker/lib/drive.ts`: cliente Drive REST delgado —
    `ensureOportunidadFolder` (mirror de Make-100 + create_subfolders.py,
    idempotente: busca por nombre exacto antes de crear, tanto la carpeta raíz
    como cada subcarpeta), `uploadPdfToDrive` (metadata + PATCH de media, sin
    construir un body multipart a mano), `getOrCreateDriveFolder`/
    `getOrCreateDriveFolderForOportunidad` (cache en D1 `drive_folders` —
    evita relistar Drive en cada depósito). Nombre de carpeta raíz confirmado
    EN VIVO contra carpetas reales que ya creó Make: `"{FOLIO} - {nombre}"`
    (ej. `"OPP-0881 - WEB - secretaria de..."`), mismas 12 subcarpetas
    exactas que `create_subfolders.py`.
  - Hook en `worker/sync/webhook.ts`: evento `create_item` sobre Oportunidades
    → `createOportunidadFolderOnCreate` (crea carpeta+subcarpetas, escribe
    `link_mm468m26`), best-effort (nunca tumba el refetch del mirror), gateado
    por `DRIVE_NATIVE`. Mejora nueva sobre lo que hacía cmp-tallas (nunca
    depositaba nada): cotización→"10. COT FINAL", tallas→"09. RELACION DE
    TALLAS", OC→"08. ODC PROVEEDOR" (mapeo confirmado con Efraín; el PDF de
    costeo, Fase 1, es interno y no se deposita). Cada depósito es
    best-effort — el PDF ya quedó en Monday aunque Drive falle.
  - Descarté el riesgo de "reintento de Monday duplica la carpeta" que había
    anotado al terminar: confirmé contra la documentación oficial
    (developer.monday.com/api-reference/reference/webhooks) que Monday SOLO
    reintenta cuando la respuesta NO es 200 (timeout de 3 min, luego 1
    reintento/min por 30 min) — nunca por lentitud si ya respondiste 200. El
    bloque de Drive en `webhook.ts` está en `try/catch` y SIEMPRE deja que el
    handler responda 200 así falle Drive, así que Monday nunca tiene motivo
    para reintentar este evento. El único riesgo real de carpeta raíz
    duplicada sería que Monday entregara el mismo `create_item` dos veces
    simultáneas (bug de entrega a nivel plataforma) — genérico de cualquier
    webhook "at-least-once", no algo que esta implementación empeore. Las 12
    subcarpetas ya son autocurables ante cualquier reintento parcial
    (`ensureOportunidadFolder` lista las existentes antes de crear).
  - **Pendiente antes de encender `DRIVE_NATIVE`:** Efraín debe desactivar el
    escenario 100 de Make, si no cada Oportunidad nueva termina con DOS
    carpetas raíz (una de Make, una nativa).
  - `worker/lib/drive.test.ts` (2 tests: nombre de carpeta raíz, las 12
    subcarpetas exactas — el resto es I/O real, verificado en vivo arriba, no
    en el suite). `tsc -b`, `npm test` (218 tests) y `npm run lint` limpios.
  - Con esto quedan nativas 5 de las 7 automatizaciones del plan. Pendiente:
    Fase 6 (catálogo Airtable↔Monday, integración aparte — decidir con Efraín
    webhook de Airtable vs. polling por cron antes de construir).

- Feat: miniatura de la última OC (PDF) junto al nombre del proveedor en la tab
  Órdenes de compra (`ProveedorCard`, `ProyectoSection.tsx`)
  - Efraín pidió que las OC generadas por proveedor no quedaran solo en el listado
    plano hasta abajo de la pestaña, sino visibles como miniatura junto a la
    tarjeta de cada proveedor.
  - cmp-tallas sube los PDFs a `file_mm0hj9pn` (Proyecto) como
    `orden_compra_<nombre proveedor>.pdf`, sin id que los ligue al proveedor —
    verificado contra datos reales en D1 (`wrangler d1 execute --remote`).
    `findLatestOcFile` empareja por nombre normalizado (sin acentos/mayúsculas)
    contra la razón social Y el texto crudo del item de Proveedores (pueden
    diferir), y toma el último match (el arreglo conserva orden de subida). Sin
    match no se renderiza nada — no hay forma de saber si un proveedor fue
    renombrado después de generar su OC.
  - Reutiliza el patrón de `CotizacionPdfRow` (ícono PDF exportado, preview
    embebido con pdf.js vía `PdfCanvasPreview`/`Modal`) en vez de inventar uno
    nuevo. Se quitó el `FileList` de "Órdenes de compra (PDF)" al fondo de la
    pestaña (redundante con la miniatura por tarjeta); el de tallas se mantiene.

## 2026-08-12

- Feat: "salir de Monday" Fase 4 — "Generar OC" nativo (Eledo/DocuSeal directo)
  - Reimplementé `api/generate_oc.py` 1:1 en `worker/lib/oc.ts`: agrupa los
    subitems del Proyecto por proveedor ligado (los sin proveedor se saltan),
    calcula subtotal por línea (cantidad·precio·(1-descuento)) y monto por
    proveedor, genera un PDF por proveedor vía Eledo directo (template
    `69b3b936c38adc73cf462f2f`, ya agregado en Fase 0) con `importe_en_letras`
    calculado sobre monto+IVA(16%) — no sobre el subtotal, regla exacta del
    Python —, sube cada PDF a Monday y pide firma DocuSeal de 3 firmantes en
    orden (Elaborado→Revisado→Autorizado, via `order`). Revisado/Autorizado
    siguen hardcodeados a Pam/Elisa (mismos valores que cmp-tallas — evita que
    una columna de Monday vacía tumbe la firma); Elaborado se lee de Monday y
    cae a Pam si está vacía. Sin filtro de "saltar proveedores con OC vigente":
    Efraín lo revirtió el 2026-08-10 a propósito, no se reintrodujo.
  - Folio **global** `OC-n` en D1 (`oc_folios`, una sola fila — a diferencia de
    costeo/cotización/tallas que son por item): reemplaza el ledger de Google
    Sheets que contaba TODAS las filas de TODOS los proyectos/proveedores.
  - Gateado por `OC_NATIVE` (sin definir = cmp-tallas de siempre), wireado en la
    misma ruta genérica `/api/proyectos/:id/:action` junto a `TALLAS_NATIVE`.
    `worker/lib/oc.test.ts` (7 tests: agrupación por proveedor, totales,
    payload de Eledo). Ids de columna verificados contra
    `shared/column-meta.gen.ts` — `board_relation_mm1cfgv5` (Proveedor) ya
    estaba probado en producción por la Fase 3. `tsc -b`, `npm test` (216
    tests) y `npm run lint` limpios.
  - Con esto quedan nativas 4 de las 7 automatizaciones del plan (costeo,
    cotización, tallas, OC). Pendientes: Fase 5 (Drive — necesita firmar JWT
    RS256 del service account de Google desde el Worker con Web Crypto, sin
    librería `googleapis` disponible en Workers) y Fase 6 (catálogo
    Airtable↔Monday, integración aparte).

- Feat: "salir de Monday" Fase 3 — "Confirmar tallas" nativo, sin Google Sheet
  - Efraín: "quizás en D1 no necesitamos el Excel, no lo intentes generar" — cambió
    el alcance de esta fase respecto al plan original: en vez de portar el Google
    Sheet de cmp-tallas (con sus fórmulas y el gate "TODO CUADRA" en una celda),
    ese Sheet se retira por completo y la fuente de verdad pasa a ser 100%
    D1/mirror de Monday.
  - `checkTodoCuadra` (nuevo, `worker/lib/proyectoTallas.ts`): agrega, por
    producto+color, lo cotizado en la Oportunidad contra lo asignado en el
    Proyecto y exige coincidencia EXACTA en ambas direcciones (falta o sobra
    cuentan) — generaliza a TODAS las líneas a la vez el mismo cruce que ya hacía
    `reportarTallasIncorrectas` (2026-08-05) para una sola.
  - `capturarTallas` pasó de solo-alta a reconciliación real por identidad
    (producto+sku+color+talla), mirror del criterio de `import_tallas.py`: una
    fila que ya existe pero con cantidad/costeo distinto se ACTUALIZA en vez de
    omitirse (`needsUpdate`/`normValue`, mismo criterio de normalización que
    `_needs_update`/`_norm` del Python — "20"≠"20.0" no cuenta como cambio, ids de
    board_relation se comparan sin importar el orden). No borra: a diferencia de
    `import_tallas.py` esto es siempre aditivo/correctivo, nunca una fuente que
    reemplaza el Proyecto completo. `CapturarTallasResponse` suma `updated`
    (`shared/dto.ts`, `TallasTab.tsx` ya lo muestra).
  - `confirmTallasNative`: corre el gate; si no cuadra revierte
    `project_status`→"Desglose de tallas" + postea el mismo mensaje que
    cmp-tallas (`NO_CUADRA_MSG`, con el detalle de qué no cuadró). Si cuadra,
    genera el PDF de "Relación de tallas" con el escritor propio del portal
    (`worker/lib/pdf`, ya no Eledo), lo sube a Monday (`file_mm0hcrtz` — verificado
    en vivo contra Proyectos reales: aunque Monday hoy lo titula "OC interna", los
    archivos ahí se llaman literalmente `tallas_PRO-0054_2.pdf`, confirmando que
    es la columna real que usa cmp-tallas en producción) y pide firma del
    vendedor vía DocuSeal directo — la firma SIGUE siendo DocuSeal, no se migra a
    la electrónica propia del portal (decisión ya tomada). Folio propio en D1
    (`tallas_folios`, mismo patrón que costeo/cotización).
  - Gateado por `TALLAS_NATIVE` (sin definir = cmp-tallas de siempre). Nuevos
    tests: `needsUpdate` (8 casos: ruido de formato numérico, comparación de
    board_relation por conjunto de ids, columna ausente vs. valor vacío).
    `tsc -b`, `npm test` (209 tests) y `npm run lint` limpios.

- Feat: "salir de Monday" Fase 2 — cotización nativa (Eledo/DocuSeal directo)
  - Efraín agregó `ELEDO_API_KEY`/`DOCUSEAL_API_KEY`/`AIRTABLE_API_KEY` (+ service
    account de Google, para fases futuras) a `.env`; los copié a `.dev.vars` (nunca
    se usa `.env` con wrangler — regla dura del repo) y verifiqué los 3 en vivo
    contra las APIs reales ANTES de construir encima: Airtable (auth + shape exacto
    de `Imagen producto`/`thumbnails.full.url` contra un record real), Eledo (un
    render real con el template de cotización — `69a0eb3d6345ea9ffcaf7e62` — devolvió
    un PDF válido), DocuSeal (auth de solo lectura, sin crear ninguna submission).
  - Reimplementé `api/generate_cotizacion.py` 1:1 en `worker/lib/cotizacion.ts`:
    arma las líneas desde subitems en vivo (salta "Embellecimiento"), resuelve el
    vendedor (nombre+email) vía Monday, imagen de producto vía Airtable
    (degradación silenciosa si falla), totales (IVA 16%), folio propio en D1
    (`cotizacion_folios`, mismo patrón que `costeo_folios` — reemplaza el ledger de
    Google Sheets), PDF con/sin precio vía Eledo directo (`worker/lib/eledo.ts`),
    sube ambos a Monday, DocuSeal SOLO para la versión con precio (firma del
    vendedor), stage→"Cotización"+grupo, update de auditoría (sin total ni link,
    mismo criterio de privacidad que cmp-tallas). Casos "skip" preservados: sin
    líneas de producto, o ninguna con precio (notifica a compras vía Monday
    nativo — `create_notification`, nueva primitiva en `monday.ts` junto con
    `fetchUserById`).
  - `worker/lib/importeEnLetras.ts`: puerto EXACTO del conversor número→letras en
    español de cmp-tallas (para "TotalPalabras" de la plantilla Eledo) — 28 casos de
    test generados corriendo el Python REAL como referencia (no inventados),
    incluida su rareza gramatical a propósito ("UN PESOS", no "UN PESO").
  - Gateado por `COTIZACION_NATIVE` (sin definir = cmp-tallas de siempre), mismo
    criterio de fallback vivo que Fase 1. El camino de escritura (subir PDF a
    Monday + crear la submission real de DocuSeal, que le manda correo de firma a
    un vendedor real) se dejó sin probar en vivo a propósito — verificar eso ya
    implica un efecto real sobre una persona real; queda para cuando Efraín elija
    una oportunidad de prueba y encienda el flag.
  - Nuevos tests: `worker/lib/cotizacion.test.ts` (líneas desde subitems, totales,
    payload de Eledo con/sin precio) y `worker/lib/importeEnLetras.test.ts`.
    `tsc -b`, `npm test` (202 tests) y `npm run lint` limpios.

- Feat: "salir de Monday" Fase 0 — cimientos (Eledo/DocuSeal/Airtable)
  - Clientes delgados, mismo estilo que `worker/lib/automations.ts`, para que las
    fases siguientes del plan (cotización/OC) llamen a Eledo y DocuSeal DIRECTO en
    vez de que cmp-tallas sea el intermediario: `worker/lib/eledo.ts`
    (`renderEledoPdf` — un solo endpoint/auth para toda plantilla, ids reales de
    cotización `69a0eb3d6345ea9ffcaf7e62` y OC `69b3b936c38adc73cf462f2f`,
    verificados contra `api/generate_cotizacion.py`/`api/generate_oc.py` del repo
    `cmp-tallas`), `worker/lib/docuseal.ts` (`createDocuSealSubmission` — sirve
    tanto la firma única de cotización como las 3 en orden de la OC vía `order`),
    `worker/lib/airtable.ts` (`fetchAirtableImageUrl` — imagen de producto,
    degradación silenciosa si falta la API key o falla la call, igual que hoy).
  - `Env` (`worker/env.ts`) suma `ELEDO_API_KEY`/`DOCUSEAL_API_KEY`/
    `AIRTABLE_API_KEY`, ninguno con valor todavía en ningún ambiente — son
    cimientos sin wiring: nada los llama todavía (Fase 2 cotización es el
    siguiente paso, y necesita además el service account de Google para Drive,
    que tampoco está configurado). El sync de catálogo Airtable↔Monday (Fase 6)
    es una integración aparte, más grande, que no vive en `airtable.ts` todavía.
  - `tsc -b`, `npm test` (165 tests) y `npm run lint` limpios (archivos nuevos sin
    call sites, cero riesgo de romper nada en producción).

- Feat: "salir de Monday" Fase 1 — validar_costeo nativo (branch `feat/zona-efrain-board`)
  - Arranque del plan grande que reemplaza, fase por fase, las 7 automatizaciones de
    cmp-tallas (Vercel/Python) por lógica nativa del Worker sin perder funcionalidad ni
    dejar de escribir a Monday. Leí `validar_costeo.py` completo (repo hermano
    `cmp-tallas`) como fuente de verdad y reimplementé su flujo 1:1 en
    `worker/lib/costeo.ts`: snapshot de costo/descuento/gastos/TC/precio por línea
    (precio = (1+gastos%)·(costo·(1-desc%))·TC·1.3, TC=18 si Moneda=USD, 1 si no),
    reparación automática de embellecimiento cuando falta alguna de las 8 zonas de
    plantilla pero ya hay al menos una capturada, validación por línea (cantidad, color
    contra la lista del producto, ficha comercial, embellecimiento), reject (revierte
    deal_stage a "Nueva oportunidad" + postea el update) o accept (deal_stage="En
    costeo" + mueve de grupo). Todos los ids de columna verificados contra
    `shared/column-meta.gen.ts` antes de usarlos (regla dura del repo) — ninguno
    inventado.
  - Ya NO se llama a Eledo para el PDF: el PDF propio del portal
    (`worker/lib/documents.ts`, plantilla `solicitud-costeo`, ya existía desde
    2026-07-26) pasa a ser el oficial también en Monday — `generarSolicitudCosteo`
    (`worker/routes/oportunidades.ts`) ahora, en modo nativo, sube esos mismos bytes a
    `file_mm10k65a` con el folio de `nextCosteoSeq` (contador propio en D1,
    `costeo_folios`, reemplaza el conteo-de-archivos-en-Monday frágil/racy que hacía
    cmp-tallas).
  - Reparé de paso una inconsistencia preexistente: el mirror solo se refrescaba
    (`refetchItemTree`) cuando "Mandar a costeo" quedaba `ok:true`, pero un rechazo
    (nativo o cmp-tallas) también escribe a Monday (revierte stage) — nuevo campo
    `EnviarCosteoResult.mutated` distingue "el pre-chequeo local bloqueó, nunca tocó
    Monday" (no refresca, caso más frecuente) de "sí se mutó" (sí refresca), en vez de
    volver el refetch incondicional.
  - Fallback vivo a propósito, como pidió Efraín para todo este plan: gateado por
    `env.COSTEO_NATIVE` (sin definir = cmp-tallas de siempre, sin cambios). Se enciende
    cuando se quiera correr en paralelo contra oportunidades reales y comparar
    resultado/PDF antes de cortar el cable a cmp-tallas — nadie lo prendió todavía en
    ningún ambiente.
  - Nuevos tests: `worker/lib/costeo.test.ts` (fórmula de precio con MXN/USD, las 4
    reglas de validación por línea, acumulación de varios errores) y
    `shared/embellecimiento.test.ts` (repairEmbellecimiento/embellecimientoTemplateError
    — separador `"\n,,"` exacto, distinto del serializador de edición manual). `tsc -b`,
    `npm test` (165 tests) y `npm run lint` limpios.
  - Pendiente (mismo plan, fases siguientes): cotización/tallas/OC/Drive/catálogo
    siguen en cmp-tallas — Fase 0 (clientes delgados Eledo/DocuSeal/Drive/Airtable +
    contadores D1) es el siguiente paso, sin secrets nuevos configurados todavía
    (`ELEDO_API_KEY`/`DOCUSEAL_API_KEY`/`AIRTABLE_API_KEY`/cuenta de servicio de Google
    no están en `.dev.vars` ni en producción — hacen falta antes de poder probar esas
    fases en vivo).

- Feat: OC a proveedor (`ordenCompraProveedor.ts`, `ocProveedorPdf.ts`) muestra
  la Zona/Tipo de cada embellecimiento (Frente derecho, Etiqueta nombre,
  Otros…), tomada del nombre del subitem de Embellecimientos en Monday —
  Efraín: "no sale que es etiqueta y eso", antes solo se veía la descripción
  larga sin indicar a qué posición/tipo correspondía. De paso, `wrapTable`
  (`layout.ts`) ahora soporta envolver varias columnas (`wrapCols: number[]`
  en vez de `wrapCol: number`) para que Zona/Tipo tampoco se trunque con "…".

- Fix: rediseño de Subtotal/IVA/Total en la OC a proveedor — el encabezado de
  la tabla ahora usa el naranja de marca de CMP (sacado a pixel del logo,
  `headerFill`/`headerTextColor` opcional agregado a `wrapTable`) en vez de
  gris genérico; se quitó el "Subtotal" duplicado/truncado del pie de tabla;
  Método/Condiciones de pago quedan alineados renglón por renglón con
  Subtotal/IVA/Total en vez de un cuadro suelto aparte (Efraín: "tiene que
  quedar todo super claro").

- Fix: "Elaborado por" en la OC a proveedor siempre es el comprador
  (`project_owner`) del Proyecto, no quien genera el PDF desde el portal.

- Fix: quita la línea "Generado por el portal CMP · fecha · Doc id" del pie
  de la OC a proveedor (`hideGeneratedByLine` en `DocumentMeta`) — solo para
  esta plantilla; los documentos con firma electrónica la conservan porque
  ahí sí es su referencia de auditoría verificable.

- Fix: los controles del header de la tarjeta de proveedor (Método/Condiciones
  de pago, "Ver OC (portal)", "Generar OC") no medían lo mismo de alto —
  `CARD_INPUT_STYLE` (inputs y botón "Ver OC") traía padding vertical 5px +
  borde de 1px, contra el padding vertical 9px sin borde del `Button` primario
  de "Generar OC". Se subió el padding vertical de `CARD_INPUT_STYLE` a 8px
  (8+8+1+1 = 18, igual a 9+9+0 del botón) para que las cuatro alturas calcen.

- Fix: la columna "Producto" de la tarjeta de proveedor en la tab Órdenes de
  Compra (`ProveedorLineaRow` en `ProyectoSection.tsx`) rompía el ancho de la
  tarjeta completa cuando el texto era largo y sin espacios (descripciones de
  embellecimiento tipo GDL Tactical, todo mayúsculas pegado) — el renglón usa
  CSS Grid con columnas `fr`, cuyo mínimo implícito es el ancho de contenido
  (`min-content`) de la celda, no 0. Se agregó `minWidth: 0` +
  `overflowWrap: 'anywhere'` a esa celda para que el texto envuelva dentro de
  su columna en vez de forzar el grid a desbordarse.

- Feat: tab "Embellecimientos" en Proyecto (post-venta) — Efraín pidió ver ahí
  lo mismo que en Oportunidades, incluyendo precio. Nuevo
  `EmbellecimientosVirtualTab` (`src/boards/proyectos/`) reusa el mismo
  endpoint de la cotización virtual (`GET /api/proyectos/:id/cotizacion-virtual`,
  ya existente) para leer las líneas vigentes de la Oportunidad ligada +
  ajustes del Proyecto, y el mismo `ZoneImage` de
  `oportunidades/tabs/EmbellecimientosTab.tsx` (se exportó) para las miniaturas
  de referencia por zona. A diferencia de Oportunidades, es de SOLO LECTURA
  (decisión de Efraín: capturar zonas/subir imágenes se queda exclusivo de la
  Oportunidad) y sí muestra Cantidad/Precio/Subtotal por línea (gateado a
  vendedor/compras/admin, igual que Cotización). La tab (y Cotización) ahora
  aparece en los 4 accesos de Proyecto, no solo en Documentación y Tallas /
  Órdenes de Compra.

- Feat: OC a Proveedor generada nativa por el portal (`worker/lib/pdf/ordenCompraProveedor.ts`,
  `worker/lib/ocProveedorPdf.ts`, `worker/lib/pdf/logo.ts`, ruta nueva
  `GET /api/proyectos/:id/oc-nativa/:proveedorId/pdf`, botón "Ver OC (portal)"
  en `ProyectoSection.tsx`) — Efraín reportó la OC de GDL Tactical (OC-202,
  OPP-0879) saliendo sin Precio/Cantidad/Descuento/Subtotal. Diagnóstico
  bisectando el payload real contra la API de Eledo directamente: los datos
  llegaban correctos (el total ya cuadraba a la centavo), pero la plantilla de
  Eledo pierde esas columnas Y el pie de firmas cuando el texto de "Producto"
  es largo y se envuelve a varias líneas — algo que pasa siempre con las
  descripciones de embellecimiento de GDL Tactical. Se agregó un bloque
  `wrapTable` a `worker/lib/pdf/layout.ts` (el renglón crece con el texto en
  vez de desalojar a las columnas vecinas) y se generó la OC con el escritor
  de PDF propio del portal en vez de depender de Eledo. Logo de CMP embebido
  (patrón tomado de `janing/worker/lib/pdf/logo.ts`, solo eso). v1 a propósito
  simple (Efraín, "como la de janing"): sin folio propio (pendiente conectar
  el ledger de Sheets de cmp-tallas) y sin firma electrónica — deja el espacio
  de firma FÍSICA (línea + nombre precargado) para Elaborado/Revisado/
  Autorizado. Convive con el botón "Generar OC" existente (Eledo/DocuSeal)
  mientras se prueba en paralelo. Verificado con datos reales end-to-end
  (curl + Playwright contra el dev server).

- Fix: OC a Proveedor (`ordenCompraProveedor.ts`, ver arriba) ahora muestra
  Subtotal/IVA (16%)/Total en números, no solo el importe en letras — Efraín
  pidió poder verificar el total contra su hoja de costeo de embellecimientos.
  De paso: diagnosticado con esa hoja que la OC de GDL Tactical (OPP-0879)
  cuadra $2,692.00 por debajo de lo esperado porque falta capturar un renglón
  de 673 piezas (Etiqueta de propiedad + Código de barras, pantalón, color sin
  identificar) en la pestaña Embellecimientos del Proyecto — dato faltante en
  Monday, no bug del PDF (el portal suma correctamente lo que existe).

- Fix: cron del backup semanal a R2 (`worker/index.ts`, `wrangler.jsonc`) nunca
  se registraba en Cloudflare — el commit de "backup semanal del mirror D1 a
  R2" usó `"0 3 * * 0"` para domingo, pero la API de Workers rechaza `0` como
  día-de-semana (a diferencia del cron estándar de Unix): quiere `1-7` (o
  `SUN`...`SAT`). Cada deploy desde entonces subía bien el Worker+assets pero
  fallaba en silencio al actualizar los cron triggers (Action en rojo, sin
  bloquear producción) y el backup nunca corrió ni una vez. Cambiado a `7`.
  Corregido también en vivo vía API contra la cuenta real mientras se
  investigaba (Efraín preguntó "¿está en prod?" tras un push en rojo).

- Fix: el board Costeo (`src/lib/dealStages.ts`) ya no oculta ninguna etapa —
  antes traía un `excludeStages` (Seguimiento/Negociación/Ganada/Perdida,
  decisión de Efraín de 2026-07-20) que dejaba fuera oportunidades que él
  quería seguir viendo ahí. Efraín pidió ver TODAS las oportunidades de
  TODAS las etapas en Costeo, Ganadas incluidas — se revierte ese filtro.

- Fix: la miniatura de la última OC (`ProyectoSection.tsx`, commit `5848fe4`
  de hoy mismo) nunca matcheaba nada — el regex esperaba nombres de archivo
  `orden_compra_<proveedor>.pdf`, pero cmp-tallas los sube como
  `OC_<folio>_<proveedor>.pdf` (confirmado contra datos reales de Monday,
  item 12707529897: `OC_OC-125_ABRAHAM FARID GORDILLO KANAN.pdf`). Como esa
  misma versión quitó el listado plano de respaldo, el resultado era que
  ninguna OC generada se veía en el portal (reportado por Efraín).

- Fix: previews de PDF borrosos en pantallas retina (`PdfCanvasPreview.tsx`) —
  el canvas se dibujaba a resolución CSS sin multiplicar por
  `devicePixelRatio`, así que el navegador estiraba esos píxeles al mostrarlo.
  Ahora el backing store del canvas se escala por `devicePixelRatio` (capado
  a 3x) mientras el tamaño CSS se fija aparte, mismo patrón que ya usaba
  `SignaturePad.tsx`. Afecta a los 4 puntos que comparten el componente:
  OC, cotizaciones, documentos de firma y adjuntos de Actualizaciones
  (reportado por Efraín).

- Fix: tab Embellecimientos ahora muestra el Color de la línea junto al SKU, y
  agrega un ícono de lápiz junto a cada posición capturada (`EmbellecimientosTab.tsx`)
  - Efraín pidió mostrar el color (no solo SKU) y hacer obvio que las posiciones
    ya capturadas son clicables para editarlas — el click-to-edit ya existía
    (commit `4d17ba2`) pero no tenía ninguna señal visual.
  - Color viene de `text_mm07s2mg` (Oportunidades subitems, ver
    `docs/monday-column-map.md`).
  - De paso se quitó el chip de estado "Con Embellecimiento" del encabezado de
    cada línea — es redundante en esta tab, ya que solo se listan ahí las
    líneas que lo tienen (Efraín, en la misma sesión).

- Fix: "elegir vendedor" no mostraba a Rodrigo (picker de Contacto y contacto huérfano)
  - Ricardo Rivera reportó por WhatsApp (captura) que un vendedor nuevo, Rodrigo (sin
    cuenta propia en Monday), no aparecía en "elegir vendedor" al crear una oportunidad;
    en la misma sesión dieron de alta un contacto ("GEMA") que tampoco apareció en el
    picker de Contacto (cliente).
  - El caso del contacto no era bug: quedó sin columna Vendedor asignada (creado directo
    en Monday, no desde el portal, donde ese campo es obligatorio) — dato huérfano, el
    portal esconde cualquier contacto sin Vendedor a todo vendedor. El segundo intento
    ("Gema Rivera") sí quedó tageado a Ricardo y ya funciona.
  - Causa raíz del vendedor: `identity` de Rodrigo comparte `monday_user_id` con Efraín
    (98389537) vía "Actuar en Monday como" (`createNativeIdentity` — Rodrigo no tiene
    asiento propio en Monday; intencional, sus oportunidades se escriben a nombre de
    Efraín ahí). `listVendedores` (`worker/lib/dal.ts`) agrupaba solo por
    `monday_user_id` (pensado para colapsar el caso "mismo login, dos cuentas de
    portal"), así que las dos identidades se fusionaban en una sola fila y "Rodrigo"
    nunca sobrevivía al `GROUP BY`.
  - Fix: `listVendedores` agrupa por `(monday_user_id, nombre)` — colapsa duplicados
    reales (mismo nombre, dos logins) pero mantiene separadas a personas distintas que
    comparten id por proxy. `VendedorDTO` suma `email` (único por fila de identity);
    nuevo `vendedorKey`/`vendedorIdFromKey` (`src/lib/apiClient.ts`) codifica `id::email`
    como `value` del picker (único por persona) y lo decodifica a solo el id numérico
    justo antes del write a Monday. Aplicado en los 3 pickers de Vendedor:
    `CreateOportunidadModal.tsx` (Vendedor + Vendedor secundario), `FormField.tsx` /
    `CreateRecordModal.tsx` (columna Vendedor de Contactos/Instituciones),
    `EditPersonaModal.tsx` (reasignar Vendedor/Comprador de una oportunidad existente).
  - Verificado con Playwright contra dev local (sembrando una identity de prueba que
    comparte id con otra existente): aparece como opción distinta y seleccionarla no
    recae visualmente en el otro nombre (el bug que tenía el `value` compartido).
  - Pendiente, a decisión de Efraín: qué hacer con el contacto huérfano "GEMA" original
    (duplicado de "Gema Rivera", sin vendedor) — no se tocó en este cambio.
  - `tsc --noEmit`, `npm test` (145 tests) y `npm run lint` limpios.

- Feat: tab "Zona Efrain" en el sidebar (branch `feat/zona-efrain-board`)
  - Efraín pidió un board en el sidebar "igual a Costeo" pero llamado "Zona Efrain", con TODAS las etapas del pipeline (no una sola, a diferencia de Costeo/Validación) y visible solo para la misma whitelist de 3 personas de la zona privada (ver entrada de abajo) — responde también a "¿cómo crea Elisa una oportunidad para mi papá?": desde este tab, con el botón "Nueva oportunidad" (mismo modal de siempre, Vendedor = "Efrain Ponce" ya aparece en el picker por ser admin).
  - Evalué construirla 100% portal-only (sin tocar Monday) — investigué la capa nativa dormida (branch `native/salir-de-monday`, nunca mergeada a main, ~30-40% de un flujo mínimo, sin motor de cálculo de totales ni UI) y confirmé que "Mandar a costeo"/cotización/tallas/OC son automatizaciones EXTERNAS de cmp-tallas (Vercel) que dependen del ID real de Monday — no hay forma de que "funcionen igual" sin que la oportunidad exista en Monday. Efraín decidió: sigue siendo un item real de Monday (conserva todo el flujo), la privacidad ya la da el portal (ver zona privada abajo); restringirla también dentro de Monday.com mismo queda pendiente, fuera de este repo.
  - `src/lib/dealStages.ts`: nuevo `StageBoardKey` `'zona_efrain'`, sin `stages` (pipeline completo) y `vendedorNames: ['Efrain Ponce', 'Elisa Vallado']` (config nueva `vendedorNames` en `StageBoardConfig`). `StageBoardList.tsx` filtra con `vendedorNamesMatch` contra Vendedor Y Vendedor secundario (mismas dos columnas que cuentan como "dueño" en `shared/boards.ts authzCols`/`dal.ts`) — filtro de conveniencia en el cliente, la protección real ya la hace el server sin importar esto.
  - Visibilidad del tab es POR-USUARIO, no por rol (a diferencia de `shared/boardAccess.ts`, donde admin siempre ve todo): `MeDTO.zonaEfrainAccess` nuevo (`worker/routes/boards.ts /api/me`, vía `isZonaPrivadaAdminPermitido`), `Sidebar.tsx` solo agrega el nav item (ícono `IconLock` nuevo) cuando `me.zonaEfrainAccess` es cierto.
  - `StageBoard.tsx`: `canCreate` ahora también `boardKey === 'zona_efrain'` (mismo patrón que Costeo) para el botón "Nueva oportunidad" ahí. `App.tsx`/`routing.ts` wireados para el nuevo `boardKey`.
  - Verificado con Playwright contra dev local (`X-Dev-Email`): Elisa ve el tab con candado, la lista filtrada y el picker de Vendedor con "Efrain Ponce"/"Efrain Ponce Salinas" disponibles; `/api/me` de Pam confirma `zonaEfrainAccess:false`.
  - `tsc --noEmit` y `npm test` (145 tests) limpios. **No mergeado a main** — feature grande, a petición de Efraín queda en su branch.

- Feat: editar/borrar posiciones ya capturadas en Embellecimientos
  - Efraín (admin) reportó que en `EmbellecimientosTab` solo se podía AGREGAR una
    zona vacía (Espalda, Frente, etc.) — una vez que ya tenía texto, no había forma
    de editarla ni borrarla, solo se veía como texto plano. El servidor ya permitía
    escribir esa columna (`shared/visibility.ts`, `w` incluye vendedor/compras/admin);
    el candado era puramente de UI.
  - Click en el texto de una zona llenada abre el mismo form de captura con la
    descripción precargada y la zona fija (sin selector) — "Guardar cambios"
    sobreescribe solo esa zona vía `upsertEmbellZone` (`shared/embellecimiento.ts`,
    ya soportaba overwrite, solo no se usaba para editar). Ícono de basura junto a
    cada zona borra la posición (con `window.confirm`) dejando las demás intactas.
  - Mismos permisos que ya existían para posición/imagen (vendedor/compras/admin) —
    sin gate nuevo de rol, a pedido explícito de Efraín.
  - `tsc --noEmit` y `npm run lint` limpios.

- Fix: Embellecimientos ya no se bloquea en Ganada/Perdida
  - Efraín y Elisa (ambos admin, en la whitelist de la zona privada) reportaron "no podemos modificar nada" en Embellecimientos, en ambos boards (Oportunidades y Costeo) — descartado por permisos de rol (server ya confirma `w:true` para admin en `long_text_mm1bj4pt`/`file_mm5akjy5`/`color_mm1b34bg`, verificado en vivo) y por la zona privada (ambos están en la whitelist). La causa real: `editable` en `EmbellecimientosTab` heredaba el mismo candado que `CotizacionTab` (`stage !== '1' && stage !== '2'`), así que en Ganada/Perdida se apagaba para TODOS los roles, no solo admin.
  - A diferencia de Cotización (que sí debe congelarse al cerrar), Efraín pidió que Embellecimientos siga editable después de Ganada/Perdida — la captura de posiciones/imágenes de zona es trabajo de producción que sigue después del cierre comercial. `OpportunityDrawer.tsx`: `editable={!ajena}` (ya no depende de `stage`) al pasarlo a `EmbellecimientosTab`; sigue de solo lectura en Validación Costeo y oportunidad ajena (`embellReadOnly` sin cambios).
  - `tsc --noEmit` limpio.

- Fix: zona privada "Efrain" — agregar a Efrain Ponce Salinas a la whitelist
  - Efraín (el usuario, hijo del CEO, mantiene el portal) pidió poder ver la zona "Efrain" también, "por si hay errores" — la whitelist original solo tenía a su papá (CEO) y a Elisa.
  - `ZONA_PRIVADA_ADMINS_PERMITIDOS` (`worker/lib/zonas.ts`) suma su monday_user_id (98389537, `efrain.ponces@gmail.com`). Solo whitelist de lectura — no se agregó como miembro/dueño de la zona.
  - `tsc --noEmit` y `npm test` (145 tests) limpios.

- Feat: zona privada "Efrain" — invisible para todo admin salvo dos
  - Efraín pidió una zona "Efrain" que NADIE pueda ver, ni siquiera Pam (admin, Compras) — solo Elisa (administración) y su papá (CEO). Hasta ahora `admin: everything, always` (`worker/lib/dal.ts scopeFor`) era una regla sin excepciones; los tres son `role='admin'` en el roster, así que hacía falta un mecanismo nuevo, no solo una zona más.
  - Caso especial hardcodeado (no un flag genérico de "zona privada" — decisión explícita de Efraín): `worker/lib/zonas.ts` fija por nombre `'Efrain'` y una whitelist de 2 `monday_user_id` (papá — mismo id en sus dos filas de identity, `efrainponce@` / `efrain.ponce@mexicanadeproteccion.com` — y Elisa `administracion@mexicanadeproteccion.com`). `hiddenOwnerIdsFor(env, viewer)` resuelve, una vez por request en `mw/identity.ts` (y en `wa/store.ts` para el bot), qué `monday_user_id` debe ocultar ESTE viewer si es admin fuera de la whitelist — lo cuelga de `Identity.hidden_owner_ids` (`shared/types.ts`).
  - `dal.ts scopeFor` consume esa lista con un `NOT EXISTS` sobre `vendedor_ids` (mismo patrón que el `EXISTS` de siempre, negado) SOLO en Oportunidades/Proyectos + sus subitems (`ZONA_PRIVADA_BOARDS`) — el resto de boards no cambia. Aplica igual en modo `'own'` (escritura): un admin bloqueado recibe 404 al intentar escribir, nunca 403. `etagFor` también distingue esta llave de scope para no servirle a un admin bloqueado la respuesta cacheada de uno sin restricción (y viceversa).
  - `notify.ts`: el selector `'role:admin'` (usado hoy solo en `STAGE_NOTIFY['Costeo en validación']`) ahora excluye a los admins fuera de la whitelist cuando el vendedor del item es miembro de la zona — si no, la notificación de cambio de etapa filtraba justo lo que se quería ocultar.
  - Zona creada en D1 (`INSERT INTO zonas/zona_miembros`, prod) con las 3 filas de identity de los dos permitidos como miembros — son las oportunidades/proyectos que quedan ocultas, no una whitelist de lectura (esa vive hardcodeada en código).
  - **Límite fuera de este cambio**: esto solo controla la vista del portal (mirror D1). Monday.com en sí mismo no se tocó — si Pam u otro admin tiene acceso directo al board de Oportunidades/Proyectos en Monday, ahí sigue viendo lo que Monday le permita; habría que restringir el item o el board a nivel Monday aparte.
  - `worker/lib/dal.test.ts`: 5 tests nuevos para `scopeFor` con `hidden_owner_ids` (bloqueo en Oportunidades y su subitem, no-aplica fuera de esos boards, aplica igual en modo escritura). `tsc --noEmit` y `npm test` (145 tests) limpios.

- Feat: backup semanal del mirror D1 a R2
  - Efraín preguntó cómo recuperar oportunidades borradas por error una vez que Monday ya no exista — D1 Time Travel (30 días, gratis) ya cubre el "oops" del día a día, pero no retención más larga ni el desastre de perder D1 mismo.
  - `worker/lib/backup.ts` nuevo: cron domingo 3am UTC (`BACKUP_CRON` en `worker/index.ts`, 4to string agregado a `triggers.crons` en `wrangler.jsonc`) vuelca TODAS las tablas vía `sqlite_master` (no lista hardcodeada, así no se desincroniza de las que se crean lazy en runtime) a un `.sql` plano subido a `FILES` bajo `backups/d1/YYYY-MM-DD.sql`. Filas paginadas (500/página) para no pegarle a límites de tamaño de respuesta de D1.
  - Nuevo kind `'backup'` en `sync_log` (`worker/sync/log.ts`) — si el export falla, el cron de alertas cada 15 min (`errorAlerts.ts`) ya lo detecta y avisa por WhatsApp sin código nuevo.
  - `tsc --noEmit` y `npm test` (140 tests) limpios.

- Feat: Compras puede editar Embellecimientos desde el board Costeo
  - Efraín pidió que Compras también pudiera modificar embellecimientos en Costeo — hasta ahora la tab Embellecimientos (agregar posición/descripción de zona + subir imagen de referencia) era de solo lectura ahí ("trabajo de Ventas en Oportunidades", 2026-07-16) y `shared/visibility.ts` solo dejaba escribir `long_text_mm1bj4pt`/`file_mm5akjy5` a vendedor/admin.
  - `long_text_mm1bj4pt` y `file_mm5akjy5` pasan de `w: WV` a `w: V` (suma compras). En `OpportunityDrawer.tsx`, la tab Embellecimientos ya no hereda `readOnlyCosteo` (nuevo `embellReadOnly = isValidacion || ajena`) — sigue de solo lectura en Validación Costeo y en oportunidad ajena, igual que antes.
  - `tsc -b` y `npm test` (140 tests) limpios.

- Fix: Actualizaciones no mostraba las respuestas a un comentario
  - Elizabeth reportó (captura de WhatsApp) que Jose Iván había respondido su comentario en OPP-0870 pero no se reflejaba en el portal — `fetchUpdates` (`worker/lib/monday.ts`) solo pedía `updates(limit:50){...}` sin `replies`, y Monday anida las respuestas dentro de su comentario padre en vez de mandarlas como updates de primer nivel, así que nunca llegaban al feed.
  - `fetchUpdates` ahora también pide `replies{...}` (mismos campos que un update, confirmado contra el schema real de Monday — `Reply` trae `id text_body created_at creator assets`, igual que `Update`). El endpoint GET `/api/boards/:slug/items/:id/updates` (`worker/routes/boards.ts`) aplana updates + replies en una sola lista y la reordena por fecha, así las respuestas salen como comentario normal (sin UI de hilo), tal como pidió Efraín.
  - `tsc --noEmit` y `npm test` (140 tests) limpios.

## 2026-08-11

- Actualizaciones: firma del autor como @mention real cuando tiene cuenta Monday
  - Pam reportó (captura de WhatsApp) que las actualizaciones mandadas desde el portal salían "posteadas por Efraín" en Monday sin importar quién las escribiera — Monday atribuye el `creator` al dueño del `MONDAY_API_KEY` compartido, no hay parámetro en `create_update` para spoofearlo. Ya existía un workaround de texto plano (`— Nombre vía Portal CMP`).
  - Mejora: cuando `viewer.monday_user_id > 0` (cuenta real de Monday), la firma ahora se manda dentro del arreglo `mentions` de `createUpdate` (`worker/routes/boards.ts`) — se reusa `buildUpdateBody` (`worker/lib/monday.ts`), que ya arma el mismo `<a class="user_mention_editor"...>` que usa el composer para etiquetar compañeros, así que el autor sale como mention clickeable de verdad. Usuarios nativos sin cuenta Monday (id sintético ≤ 0) se quedan con el texto plano de siempre, no hay a quién apuntar el mention.
  - `tsc -p tsconfig.worker.json --noEmit` limpio (mismos 2 errores preexistentes en `admin.ts`/línea no tocada de `boards.ts`, ya documentados en la entrada del reconcile más abajo, no introducidos aquí).

- Fix: "Ajustar línea" (dividir) perdía Costo Distr. C/U y demás datos de Compras en la línea nueva
  - Pam reportó por WhatsApp que al dividir una línea ya costeada, la línea nueva salía con "Costo Distr. C/U —" en el Proyecto (Órdenes de compra) — `ajustarLinea` (`worker/lib/lineaAjustes.ts`) solo copiaba precio y Etapa Costeo a la línea hermana, nunca `numeric_mm0bph99`/`numeric_mkzn2q51`.
  - En vez de seguir enumerando columnas a mano, `copyRemainingCols` copia genéricamente TODA columna "de captura" (`numbers`/`text`/`long_text`/`status`) de la línea origen salvo las que ya tienen manejo explícito (producto/color/cantidad/embellecimiento, con override de `input`) — cubre Costo Distr., Descuento, Recosteo?, SKU manual, Comentarios Ventas, Gastos %, Techo, IVA, Moneda (línea), etc. sin depender de que alguien recuerde agregar la siguiente columna nueva. Mirror/formula (Moneda, Unidad, los `formula_*`) se saltan a propósito — se recalculan solos. `copyEmbellecimientoImage` agregado también (mismo patrón que `duplicateOportunidad.ts`) para que la imagen de embellecimiento no se quede en la línea origen.
  - `tsc --noEmit` y `npm test` (140 tests) limpios.

- Cotización: color al dropdown editable de "Etapa Costeo"
  - Elizabeth preguntó por WhatsApp si se le podían poner colores a los estados de costeo — el `<select>` editable (writable) salía en blanco/negro plano; el badge de solo lectura ya usaba color (`ETAPA_COSTEO_COLORS`), solo el control editable se había quedado plano.
  - `etapaCosteoSelectStyle` nuevo en `gridMeta.tsx`, reusa la misma paleta real de Monday (`ETAPA_COSTEO_COLORS`, ya documentada como no-inventada); pinta el `<select>` cerrado (fondo/tinte + borde) según el valor elegido y cada `<option>` de la lista. Aplicado en `QuoteRow.tsx` y `MobileQuoteRow.tsx` — mismos dos sitios que ya tenían el `<select>` plano.
  - `tsc --noEmit` limpio.

- Cotización: "Historial de Precios" en el panel expandible de la línea (Costeo/Validación)
  - Elizabeth pidió por WhatsApp poder ver el historial de precios de una línea sin salir del portal — la columna ya existe en Monday (`lookup_mm1tjv9n`, mirror), solo faltaba pintarla.
  - Agregado a `LineDetailPanel.tsx` (compartido por `QuoteRow` desktop y `MobileQuoteRow`), junto a Proveedor/Embellecimiento, solo en `variant === 'costeo'` — la columna ya estaba whitelisteada para compras/admin (`AC`) en `shared/visibility.ts`, no para vendedor.
  - `tsc --noEmit` limpio.

- Cotización/Proyecto: label "Dividida"/"Editada" al final de la línea tras usar "Ajustar línea"
  - Efraín pidió poder distinguir a simple vista, en la grid, qué líneas vienen de un split o de una edición vía "Ajustar línea" — antes la línea nueva/editada se veía igual que cualquier otra.
  - `AjusteDTO` (`shared/dto.ts`) ahora expone `lineaId`/`lineaOrigenId` (ya vivían en las tablas `cotizacion_ajustes`/`proyecto_cotizacion_ajustes`, solo no se mandaban al front). En Oportunidades, `CotizacionTab` arma un `Map` por línea a partir de los ajustes de la vigente (`versions.find(v => v.status === 'vigente').ajustes`) y lo pasa a `QuoteRow`/`MobileQuoteRow`; en el Proyecto, `QuoteLineSnapshot.ajusteLabel` se calcula server-side al reproducir el log (`applyAjustesVirtuales`, `worker/lib/proyectoCotizacionVirtual.ts`) — la línea origen y la hermana nueva quedan 'Dividida', una edición en el sitio queda 'Editada'; 'Dividida' siempre gana si la línea participó en ambas.
  - Badge nuevo y compartido `AjusteLabelBadge` (`src/components/core/Badges.tsx`), usado en `QuoteRow`, `MobileQuoteRow` y `CotizacionVirtualTab`.
  - `tsc --noEmit`, `npm test` (140 tests) y `npm run lint` limpios.

- Fix: tallas del Proyecto — orden de las cajitas por talla + "Cotizado" desactualizado tras dividir una línea
  - Pam reportó por WhatsApp que las tallas salían en orden aleatorio en las tarjetas de `ProyectoSection.tsx` (en vez de S, M, L, XL…) y que, tras dividir una línea de la cotización virtual del Proyecto (multicam 150 → 75 multicam + 75 Ranger Green), el color nuevo salía "sin línea de cotización para comparar" y el original seguía mostrando el total de antes de dividir.
  - Orden: `groupByProductoColor` ahora ordena `group.rows` por un catálogo canónico de tallas (`SIZE_ORDER` + soporte `NXL`, ej. "2XL" == XXL); tallas fuera del catálogo (numéricas u otras) caen al final, alfabético.
  - "Cotizado" desactualizado: causa raíz era que `cotizadoMapsFrom` leía los subitems reales de la Oportunidad (`getItem('oportunidades', oppId).children`), pero "Editar/Dividir" en la Cotización virtual del Proyecto (`worker/lib/proyectoCotizacionVirtual.ts`, 2026-08-10) por diseño NUNCA toca Monday — el split solo vive en D1. Cambiado a `getCotizacionVirtual(proyectoId)` (misma fuente que ya usa el tab de Cotización del Proyecto), que sí reproduce los ajustes encima de las líneas reales; sin ajustes la vista es idéntica a la real, así que no cambia nada para el caso común.
  - `tsc --noEmit`, `npm test` (140 tests) y `npm run lint` limpios.

- Fix de fondo: el reconcile llevaba 12 días muriendo a medias, además de un delta sync nuevo para que lo de hoy no espere al reconcile
  - Efraín reportó que el proyecto de OPP-0504 (board Proyectos, `12768908725`) no aparecía en el portal con el status real de Monday ("Tallas Confirmadas"). Diagnóstico con `wrangler d1 execute --remote` (token correcto: `CF_ZT_TOKEN`, el `CLOUDFLARE_API_TOKEN` del `.env` no tiene permisos de D1) contra `sync_log`: desde el 2026-07-30 el reconcile de 6h **solo terminaba el primer board de cada grupo** (`oportunidades` en un grupo, nada en el otro) y moría sin excepción ni log en el resto — exactamente el bug ya diagnosticado el 2026-08-04 (ver entrada de esa fecha), pero regresó porque `oportunidades_sub` creció a 3584 items. Causa raíz real: `reconcileBoard`/`upsertItem` hacían 1-2 queries D1 **por item** (SELECT de skip-check + SELECT de prevColumns) — cualquier board de más de ~500 items revienta el límite de ~1000 subrequests por invocación de Workers, y el runtime mata la invocación sin dejar rastro. `oportunidades_sub`, `proyectos`, `proyectos_sub`, y las 4 boards de catálogo llevaban así 12 días sin un reconcile real, dependiendo solo de los webhooks angostos (`create_item`/`change_name`/`item_deleted`, sin `change_column_value` desde el 2026-07-31) para no quedarse stale. Arreglé el mirror de OPP-0504 a mano (mismo hash/shape que `upsertItem`, vía script puntual) mientras se desplegaba el fix real.
  - **Batching** (`worker/sync/reconcile.ts`): `reconcileBoard` ahora hace UNA sola `SELECT item_id, content_hash` para todo el board, diffea en memoria contra lo que trae Monday, y escribe los cambios con `env.DB.batch()` en lotes de 100 — de miles de subrequests a un puñado por board. El diff de prevColumns (para las notificaciones de cambio de etapa/status, `worker/lib/notify.ts`) también pasa a una SELECT por lotes (`IN (...)`) en vez de una por item. `worker/sync/upsert.ts` expone `extractVendedorIds`/`toRawColumns`/`emitItemSideEffects`/`NEEDS_PREV_COLUMNS`, compartidos entre el upsert de un solo item (webhook/refresh, sin cambios de comportamiento) y el reconcile por lote.
  - **Delta sync** (`worker/sync/delta.ts`, nuevo): Efraín señaló que lo de HOY (una oportunidad creada en el día) es mucho más urgente que lo viejo, y que esperar al reconcile completo no es aceptable. Cada 15 min (mismo cron que las alertas de `errorAlerts.ts`, `worker/index.ts`), UNA sola call a `activity_logs` de Monday cubre las 8 boards a la vez (`fetchActivityLogs`, `worker/lib/monday.ts`) y refetchea solo los `pulse_id` que aparecen en la ventana desde el último poll (checkpoint en tabla nueva `sync_state`). El reconcile completo (cada 12h ahora, antes 6h — bajado porque el delta ya cubre lo reciente) queda como red de seguridad, no como única fuente de verdad.
  - **Presupuesto de Monday**: Efraín preguntó si esto quema el tope diario de calls del plan (~25K). Antes no había ni un número real. Contador nuevo (`monday_api_usage`, incrementado en cada `gql()` de `worker/lib/monday.ts`, best-effort/nunca bloquea la call real) + `GET /api/admin/monday-usage` (admin-only, últimos 14 días). Estimado a mano: full reconcile con batching ≈ mismas ~490 calls/día que ya estaban presupuestadas desde el diseño original (el batching no agrega calls a Monday, solo evita que D1 truene) partido a la mitad por el cambio a 12h; delta sync ≈ 100-500 calls/día. Total estimado <1000/día, <5% del tope — el contador nuevo lo confirma con datos reales de aquí en adelante.
  - `wrangler.jsonc`/`worker/index.ts`: los 2 cron de reconcile pasan de `0 */6 * * *`/`0 3,9,15,21 * * *` a `0 0,12 * * *`/`0 6,18 * * *`. El cron de 15 min ahora también dispara `deltaSync` junto con `checkErrorsAndAlert`.
  - `tsc -p tsconfig.worker.json --noEmit` (limpio salvo los mismos 2 errores preexistentes en `admin.ts`/`boards.ts` de otra sesión, no tocados), `npm test` (140 tests) y `npm run lint` limpios. `src/boards/oportunidades/ProyectoSection.tsx` traía cambios sin commitear de la sesión concurrente — se dejó fuera de este commit.

- Proyectos: vendedor y compras ahora tienen su propio board, igual que en Oportunidades/Costeo
  - Efraín: los vendedores en Proyectos solo deben ver "Documentación y Tallas" (nada más les toca); Compras, en cambio, ya no debe ver "Documentación y Tallas" — su vista es "Órdenes de Compra", pero ampliada a TODAS las etapas antes de (e incluyendo) "Órdenes de compra listas", no solo el tramo final.
  - `src/lib/projectStages.ts`: `ordenescompra.statuses` pasa de `['0','2']` a `['5','0','4','2']` (Desglose de tallas → En confirmación → Tallas Confirmadas → OC listas) — Compras se queda sin "Documentación y Tallas" así que este board es ahora su única ventana al Proyecto.
  - `shared/boardAccess.ts` (`DEFAULT_BOARD_ACCESS`) + seed de `worker/schema.sql`: vendedor pierde `ordenescompra`/`ejecucion`/`logistica`; compras pierde `doctallas`.
  - Aplicado también en vivo sobre `role_board_access` en D1 de producción (no solo el seed, que no reescribe filas existentes): `DELETE` selectivo de esas 4 filas vía `wrangler d1 execute --remote`.
  - Fix: a Compras le faltaba `ejecucion` en D1 desde antes de este cambio (no la había quitado yo) — la agregué también vía `wrangler d1 execute --remote`.
  - Fix: tabs de `ProyectoDrawer.tsx` con padding `12px 4px` vs `9px 4px` de `BoardTabsBar.tsx` (Oportunidades) — mismo `font-size` (11.5px) en ambos pero la barra se veía más alta/con letras más grandes en Proyectos; igualado el padding.
- Cotización virtual del Proyecto: el botón de ajustar línea era solo un ícono de lápiz (✎) sin etiqueta — poco claro. `CotizacionVirtualTab.tsx`: se reemplaza por texto "Editar/Dividir" (mismo `onClick`/modal), ensanchando la columna de acción de 28px a 110px en header/body/footer.

## 2026-08-10

- Cotización: "líneas hermanas" (dividir por género/color) ahora avisan a Compras si el costo distribuidor diverge, y llegan también al drawer del Proyecto como capa D1-only
  - Efraín pidió retomar "Ajustar línea"/"dividir" (`worker/lib/lineaAjustes.ts`, 2026-07-31) con dos pedidos encima: (1) que dividir/editar una línea con cambio de producto compare el Costo Distribuidor del catálogo entre el SKU viejo y el nuevo, y si diverge mucho no bloquee — solo avise a Compras; (2) que la misma capacidad de "versiones intermedias" (V1.1, V1.2…) exista también desde el drawer del Proyecto (post-venta), que hoy solo enlazaba a la Oportunidad ("Ver Oportunidad ligada ↗"). Confirmado con Efraín: en Oportunidades el modo `dividir` sigue creando el subitem real en Monday igual que hoy (el bug de la automatización `7917410100` que regresaba la Etapa a "En costeo" ya lo ajustó él a mano en Monday); en Proyectos, en cambio, la cotización NUNCA debe tocar Monday — ahí solo se permiten ajustes menores (1.x), nunca "+ Nueva versión" (no se puede pasar de 1 a 2).
  - Nuevo `worker/lib/costoDivergencia.ts`, compartido por ambas superficies: compara "Costo Distribuidor" (catálogo Productos, `numeric_mkzpx7eb`, siempre oculto) del producto anterior vs el nuevo; si la diferencia pasa ±10% (`computeDivergencia`, función pura con test de borde exacto), resuelve el/los comprador(es) de la columna "Compras" de la Oportunidad y publica un update de Monday con @mención (mismo patrón que `notifyComprador` en `productosPropuestos.ts`) + `emitNotification` en la bandeja "Importantes" del portal. Todo best-effort — nunca bloquea el guardado del ajuste. `AjustarLineaResponse` (`shared/dto.ts`) trae ahora `costoDivergente?: CostoDivergenciaDTO`; el aviso se ve como banner discreto en `AjustarLineaModal.tsx`.
  - Nuevo `worker/lib/proyectoCotizacionVirtual.ts`: tabla D1 `proyecto_cotizacion_ajustes` que NO es una copia congelada de las líneas — es un log de operaciones (`editar`/`dividir`) que se reproduce en caliente sobre las líneas vigentes reales de la Oportunidad ligada (`applyAjustesVirtuales`, función pura con tests, incl. dividir una línea que ya era virtual). Mientras nadie ajusta nada ahí la vista es siempre el mirror real tal cual; en cuanto se aplica el primer ajuste, esa línea vive solo en D1 de ahí en adelante. Líneas virtuales usan id negativo (mismo esquema que los `monday_user_id` sintéticos de usuarios nativos del portal, `dal.ts`) — nunca escribe nada a Monday. Nuevo tab "Cotización" en `ProyectoDrawer.tsx` (`CotizacionVirtualTab.tsx` + `AjustarLineaVirtualModal.tsx`, grid propio — no reusa `CotizacionTab`/`QuoteRow`, que están duros a `ItemDTO` y escrituras directas a Monday), oculto para rol `almacen` (mismo criterio que oculta Precio de Venta en todos lados).
  - Dos rutas nuevas: `GET /api/proyectos/:id/cotizacion-virtual` y `POST /api/proyectos/:id/cotizacion-virtual/lineas/:lineaId/ajustar` (`worker/routes/oportunidades.ts`), reusando el mismo contrato `AjustarLineaRequest`/`AjustarLineaResponse` que la ruta real.
  - `tsc --noEmit` (3 tsconfigs, salvo los 2 errores preexistentes en `admin.ts`/`boards.ts` de otra sesión, no tocados aquí), `npm test` (140 tests, incluye los 11 nuevos de `costoDivergencia.test.ts`/`proyectoCotizacionVirtual.test.ts`) y `npm run lint` limpios. Pendiente: verificación end-to-end contra Monday real (confirmar que dividir en Proyecto no deja ningún rastro en Monday, y que el aviso de divergencia sí llega como update+mención).

- Nueva pantalla "Inicio": pendientes accionables por rol en tarjetas
  - Efraín pidió una landing porque Compras no entendía el portal (llegaba a Oportunidades sin saber qué le tocaba revisar). Nueva ruta `/api/home` (`worker/lib/home.ts` + `worker/routes/home.ts`) que arma "pendientes" con una definición distinta por rol: Compras = oportunidades en "En costeo" que aún no pasan `checkValidacion` (mismo check que ya bloquea el botón "Enviar a validación", sin reinventar la regla); vendedor = sus propias oportunidades abiertas sin movimiento hace ≥14 días (`monday_updated_at` del mirror); admin = ambas cosas (supervisión org-wide + costeo atorado). Almacén no tiene sección — su trabajo es reactivo, así que ni se le muestra el ítem de sidebar.
  - Front: `HomeView.tsx` (tarjetas con saludo + conteo de pendientes) + `homeApi.ts` (polling ETag cada 30s, clonado de `notificationsApi.ts`). `App.tsx` aterriza ahí por default en `/` para todos salvo almacén (que sigue yendo a Inventario); deep links explícitos no pasan por ese redirect.
  - Extra pedido junto con la pantalla: "seguimiento" — el vendedor puede mandar un mensaje corto sobre una oportunidad stale directo desde la tarjeta. Se postea como Update REAL de Monday (`createUpdate`, visible para cualquiera que abra el item ahí) y se guarda ligado por `monday_update_id` en tabla nueva `seguimientos` (D1, creada lazy en runtime igual que `estado_producto_historial`) — nunca un texto suelto desconectado del Update. Endpoint `POST /api/oportunidades/:id/seguimiento` usa `getItem(..., 'own')`.
  - Feature completa desde otra sesión, se quedó sin commitear varios commits seguidos porque cada uno tocaba en paralelo los mismos archivos (`worker/routes/oportunidades.ts`, `shared/dto.ts`, etc.) y se fue aislando por hunks para no mezclar — ver notas en las entradas de abajo. Confirmado hoy que ya no hay overlap pendiente: `tsc --noEmit`, `npm test` (129 tests) y `npm run lint` limpios.

- Corrección: el upload de Inventario va junto a los PDFs de cotización (Costeo/Sin firmar/Firmada), no en Documentación
  - Efraín mandó captura: buscaba el archivo de Inventario en la fila de miniaturas PDF (`CotizacionPdfRow.tsx`, arriba del tab Cotización — "Costeo · Sin firmar · Firmada") y no en la pestaña Documentación, donde lo había puesto en el commit anterior. "El mismo template" del pedido original se refería a esa fila de miniaturas, no a las secciones de `DocSection`.
  - Movido: `InventarioSection`/upload de `DocumentacionTab.tsx` → nuevo `InventarioThumb` en `CotizacionPdfRow.tsx`, mismo cuadro 108×92 que los otros 3 (`PdfThumb`), pero es upload real (no preview de pdf.js — Inventario no siempre es PDF) y el cuadro vacío ES el dropzone para compras/admin. Nuevo helper `inventarioFiles(item)` (`DocumentacionTab.tsx`, exportado) para no duplicar el parseo de la columna.
  - La fila entera solo se ocultaba cuando no había NINGÚN PDF (`!hasSolicitud && !hasSinFirmar && !hasFirmada`) — eso escondía el cuadro de Inventario en una oportunidad recién creada, exactamente el caso que Efraín reportó. Ahora también se muestra si el viewer puede subir inventario (compras/admin) o si ya hay un archivo.
  - `tsc --noEmit`, `npm test` (129 tests) y `npm run lint` limpios.
  - Compras pidió aparte "Costeo filtrado a solo mis costeos como comprador" — Efraín aclaró que ya se está resolviendo en otra sesión (terminó siendo el mismo `comprasScopeFor` de la entrada de abajo), así que no se tocó nada aquí.
  - Mismo working tree con la sesión activa de "Home" (ver detalle de aislamiento en la entrada de abajo) — se REDESCUBRIÓ el mismo problema (un `git add`/escritura de la otra sesión pisó una edición ya aplicada de este commit sobre `DocumentacionTab.tsx` a media edición, visible como reversión momentánea); se re-aplicó y se verificó con un `Read` fresco antes de continuar. Se stageó únicamente `OpportunityDrawer.tsx`, `tabs/CotizacionTab.tsx`, `tabs/DocumentacionTab.tsx`, `tabs/cotizacion/CotizacionPdfRow.tsx` + este log; `worker/routes/oportunidades.ts` (endpoint `/seguimiento` ajeno, sin tocar por mí en este commit) se dejó fuera por completo.

- Feedback sección Proyectos: tab Actualizaciones, scoping de Compras, font-size de tabs, OC del cliente obligatoria
  - Efraín reportó 4 puntos de feedback sobre la sección Proyectos (Documentación/Tallas, Órdenes de Compra, Ejecución, Logística):
  - **Actualizaciones faltante en Documentación/Tallas y Órdenes de Compra**: `TABS_BY_BOARD` (`ProyectoDrawer.tsx`) whitelisteaba los tabs de cada acceso del sidebar (2026-08-05) y se quedó fuera por error, no a propósito — se agregó `'actualizaciones'` a ambos.
  - **Compras solo ve sus propios proyectos/oportunidades**: `scopeFor` (`worker/lib/dal.ts`) le daba a `compras` el mismo `1=1` que a `admin` en todo board. Nuevo `comprasScopeFor`, aplicado en Oportunidades (columna "Compras" `multiple_person_mm03qyw9`) y Proyectos (`project_owner`) — scoping "solo lo propio" igual que vendedor, pero por la columna Compras. Sin agregar columna nueva a `items` (evita una migración `ALTER TABLE` que el pipeline de deploy no corre): lee directo el JSON de `columns` con el mismo patrón de `json_each` anidado que ya usa la búsqueda. `etagFor` ajustado para no compartir ETag entre dos personas de Compras en esos boards. Catálogos (productos/instituciones/contactos/proveedores) siguen abiertos para Compras. Tests nuevos en `dal.test.ts`.
  - **Font-size de los tabs de Proyectos no cuadraba con los de Oportunidades**: 13px → 11.5px en `ProyectoDrawer.tsx`, igual que `BoardTabsBar`.
  - **OC/cotización/contrato del cliente obligatoria antes de validar tallas**: warning visible en el tab Documentación cuando falta el archivo (asterisco + borde rojo + aviso), botón "Validar tallas (vendedor)" deshabilitado sin él, y gate real del lado del servidor (`checkOcCliente`, nuevo en `worker/lib/proyectoTallas.ts`) en `POST /api/proyectos/:id/tallas-confirmar` — no se puede saltar llamando la API directo.
  - `tsc --noEmit` y `npm test` (129 tests) limpios. Working tree traía cambios sueltos de OTRA SESIÓN ACTIVA EN VIVO durante esta misma revisión (refactor de Inventario moviendo `InventarioSection`/`inventarioFiles` de `DocumentacionTab.tsx` a `CotizacionPdfRow.tsx`, más la feature "Home" sin terminar: `shared/dto.ts`, `src/App.tsx`, `src/app/Sidebar.tsx`, `src/components/icons.tsx`, `src/lib/routing.ts`, `worker/index.ts`, `worker/schema.sql`, `src/boards/oportunidades/OpportunityDrawer.tsx`, `src/boards/oportunidades/tabs/CotizacionTab.tsx`, `src/boards/oportunidades/tabs/cotizacion/CotizacionPdfRow.tsx`, `worker/lib/home.ts`/`worker/routes/home.ts`/`src/app/HomeView.tsx`/`src/lib/homeApi.ts`) — `DocumentacionTab.tsx` y `worker/routes/oportunidades.ts` tenían ambos cambios intercalados en el mismo archivo; se aisló el commit con `git apply --cached` sobre parches de solo los hunks propios, verificado en limpio con `git stash push --keep-index -u` antes de restaurar el working tree combinado. El resto se dejó sin commitear.

- Feedback board Costeo: bug de traducción, Color/Techo en la grid, upload de Inventario, Compras pierde Oportunidades pero puede crear
  - Efraín reportó 6 puntos de feedback sobre el board Costeo:
  - **"Numero poder" en vez de "Cant."** (captura): no era bug de datos — `index.html` declaraba `<html lang="en">` con toda la app en español, así que Chrome ofrecía/aplicaba traducción automática y leía la abreviatura "Cant." como el contracción inglesa "can't", traduciéndola a "No poder.". Fix de raíz: `lang="es"` + `translate="no"` + meta `google: notranslate`, no depende de que cada usuario apague su traductor.
  - **Color y Techo en la tabla de Costeo**: `Color` (`text_mm07s2mg`) ya era V/WV pero solo se pintaba en la vista de Venta; `Techo` (`numeric_mkznpn83`) ya era visible AC pero nunca se agregó como columna. Ambas agregadas a `GRID_COLS_COSTEO` (`gridMeta.tsx`) — sin cambios de permisos, ya estaban en `visibility.ts`.
  - **Archivo Inventario junto a la cotización firmada**: `file_mm0hpefr` ("Inventario Actual (Imagen)") ya existía en Monday (introspección) pero no estaba en `visibility.ts` ni tenía UI/endpoint. Agregado `vis: V, w: WAC` (Compras/admin suben, vendedor ve) + `POST /api/oportunidades/:id/inventario` (mismo patrón dual-write R2 que `/proyectos/:id/documento`) + nueva sección `InventarioSection` en `DocumentacionTab.tsx`, mismo template visual que las demás, al lado de "Firmadas por vendedor" (grid pasó de 2 a `auto-fit` columnas).
  - **Compras ya no ve Oportunidades / Oportunidades Web**: no era cambio de código — `role_board_access` (D1) ya soporta esto desde Settings. Confirmado con Efraín, aplicado directo en producción: `DELETE FROM role_board_access WHERE role='compras' AND board_key IN ('oportunidades','oportunidades_web')`.
  - **Compras puede crear oportunidad y elegir cualquier vendedor**: el modal (`CreateOportunidadModal.tsx`) ya cargaba la lista completa de vendedores sin restricción — lo que faltaba era el punto de entrada, ya que Compras pierde el board Oportunidades (punto anterior). `StageBoard.tsx` ahora repite el botón/modal "Nueva oportunidad" de `OportunidadesBoard.tsx` cuando `boardKey==='costeo'`.
  - `tsc --noEmit`, `npm test` (126 tests) y `npm run lint` limpios. Working tree traía cambios sueltos de otra sesión concurrente (feature "Home": `shared/dto.ts`, `src/App.tsx`, `src/app/Sidebar.tsx`, `src/components/icons.tsx`, `src/lib/routing.ts`, `worker/index.ts`, `worker/lib/dal.ts`, `worker/schema.sql`, archivos nuevos de Home) — no se tocaron; `worker/routes/oportunidades.ts` traía además un endpoint ajeno (`/seguimiento`) en el mismo archivo, se stageó por hunks (`git add -p`) para dejar solo el endpoint `/inventario` propio.

- WhatsApp: Compras solo recibe avisos de SUS oportunidades/proyectos, no de todo el equipo
  - Efraín reportó que a Compras le llegaban por WhatsApp los avisos de TODAS las oportunidades/proyectos, no solo los suyos: `STAGE_NOTIFY`/`PROJECT_STATUS_NOTIFY`/`PRODUCT_STATUS_NOTIFY` (`shared/notifications.ts`) usaban el selector `role:compras`, que resuelve a TODAS las identidades activas de ese rol sin importar si el item es suyo.
  - Nuevo selector `'comprador'` (`worker/lib/notify.ts` `resolveRecipients`): resuelve solo a la(s) persona(s) asignada(s) en la columna "Compras" de ESE item (`multiple_person_mm03qyw9` en Oportunidades, `project_owner` en Proyectos — se copia de la Oportunidad al ganar, ver `ganarOportunidad.ts`), igual que `'owner'` ya hacía con Vendedor. Nueva `personIdsFromColumns()` parsea esa columna desde el blob `columns` del mirror; `maybeEmitStatusChange` la usa vía el nuevo `compradorColId` (pasado por `maybeEmitStageChange`/`maybeEmitProjectStatusChange`); `estadoProducto.ts` (nivel subitem, sin columna propia de Compras) resuelve el comprador del Proyecto padre con una query nueva (`compradorIdsOfProyecto`).
  - Reemplacé `role:compras` por `comprador` en las 5 entradas que lo usaban: `STAGE_NOTIFY['En costeo']`, `['Costeo en validación']`, `PROJECT_STATUS_NOTIFY['Tallas Confirmadas']`, `['Proyecto Terminado']`, `PRODUCT_STATUS_NOTIFY['Incidencia/Retraso']`. `role:admin` no se tocó (no tiene dueño por item).
  - Como la columna "Compras" de Oportunidades no era obligatoria al crear, quedaba vacía a veces y con el cambio nadie de Compras se enteraría — Efraín confirmó (preguntado) que debía volverse obligatoria: `shared/createFields.ts` `multiple_person_mm03qyw9` ahora `required: true` en `CREATE_FIELDS.oportunidades`.
  - Segundo pedido de Efraín: avisar a Compras (no solo al vendedor) cuando una oportunidad llega a "Costeo Confirmado". `STAGE_NOTIFY['Costeo Confirmado']` pasa de `{selectors:['owner']}` a `{selectors:['owner','comprador'], severity:'importante'}` (confirmado con Efraín: por WhatsApp, no solo portal).
  - `tsc --noEmit` y `npm test` (126 tests) limpios. Working tree ajeno de otra sesión concurrente (`shared/dto.ts`, `src/App.tsx`, `src/app/Sidebar.tsx`, `src/components/icons.tsx`, `src/lib/routing.ts`, `worker/index.ts`, `worker/lib/dal.ts`, `worker/routes/oportunidades.ts`, `worker/schema.sql`, `worker/lib/home.ts`/`worker/routes/home.ts`/`src/app/HomeView.tsx`/`src/lib/homeApi.ts`) sin tocar — solo se stageó `shared/createFields.ts`, `shared/notifications.ts`, `worker/lib/notify.ts`, `worker/lib/estadoProducto.ts` + este log.

- "En confirmación de tallas" también visible en Órdenes de Compra
  - Efraín reportó (captura) que un proyecto en estado "En confirmacion de tallas" (project_status '0') solo aparecía en el acceso "Documentación y Tallas" y pidió que apareciera igual en "Órdenes de Compra".
  - `src/lib/projectStages.ts`: `PROJECT_BOARDS.ordenescompra.statuses` pasa de `['2']` a `['0', '2']` — el mismo proyecto ahora cae en ambos accesos mientras está en tallas, hasta pasar a "Ordenes de compra listas". `doctallas` no cambia (sigue con `['5', '0', '4']`), así que el status queda duplicado a propósito entre ambos boards.
  - `tsc --noEmit` limpio. Working tree ajeno de otra sesión concurrente (`shared/dto.ts`, `worker/index.ts`, `worker/lib/dal.ts`, `worker/routes/oportunidades.ts`, `worker/schema.sql`, `worker/lib/home.ts`/`worker/routes/home.ts`/`src/app/HomeView.tsx`/`src/lib/homeApi.ts`) sin tocar — solo se stageó `projectStages.ts` + este log.

- Compras puede mandar a costeo una Nueva oportunidad, igual que Ventas
  - Efraín pidió que Compras pueda pasar una oportunidad de "Nueva oportunidad" a "En costeo" desde su propio board Costeo, sin depender de que Ventas lo haga primero.
  - `OpportunityDrawer.tsx`: `readOnlyCosteo` (que bloquea líneas/botón "Mandar a costeo" en el board Costeo) pasa de ser fijo por `boardKey==='costeo'` a excluir la etapa 4 (`boardKey==='costeo' && stage!=='4'`) — en Nueva oportunidad, Compras queda igual que Ventas en Oportunidades: edición inline de líneas y botón "Mandar a costeo" habilitados. El pre-chequeo `checkCosteo` (antes solo corría fuera del board Costeo) se ajustó igual para que el botón no se quede deshabilitado en ese caso. El backend (`worker/lib/costeo.ts`) ya no tenía gate de rol — la restricción era solo de UI.
  - No afecta etapa 15 (En costeo): ahí Compras sigue en solo-lectura de producto/color/cantidad y solo captura costos, sin cambios.
  - `tsc --noEmit`, `npm test` (126 tests) y `npm run lint` limpios. El working tree traía cambios sueltos de otra sesión (`shared/dto.ts`, `worker/index.ts`, `worker/lib/dal.ts`, `worker/routes/oportunidades.ts`, `worker/schema.sql`, `worker/lib/home.ts`/`worker/routes/home.ts` nuevos) — se dejaron sin commitear, solo se stageó `OpportunityDrawer.tsx` + este log.

- Aviso visible cuando "Mandar a costeo" está deshabilitado por falta de institución/cliente
  - Efraín reportó (captura) una Nueva oportunidad con el botón "Mandar a costeo" deshabilitado sin ninguna pista visible — ni banner ⚠ en la línea (esa parte estaba completa) ni nada en el header. Causa: `checkCosteo` (`worker/lib/costeo.ts`) exige Institución (mirror de Cliente — `lookup_mm1bs976`), un error de la OPORTUNIDAD, no de una línea; pero en etapa 4 el tooltip del botón mostraba siempre el mensaje genérico "revisa los avisos ⚠ en cada línea", que no aplica cuando el problema no es de ninguna línea.
  - `OpportunityDrawer.tsx`: nuevo `costeoItemErrors` separa los errores de `checkCosteo` que son de la oportunidad (institución, sin líneas, etc.) de los de línea (prefijo `#1 "..."`, ya cubiertos por el banner ⚠ de `QuoteRow`). Banner nuevo debajo del header, mismo estilo que el aviso de "oportunidad ajena", listando esos errores de oportunidad cuando el botón está deshabilitado por ellos; el tooltip del botón también los prioriza en vez del mensaje genérico.
  - `tsc --noEmit`, `npm test` (126 tests) y `npm run lint` limpios. Mismo working tree ajeno de la entrada anterior, sin tocar.

- Cotización: la columna Producto no tapaba del todo la columna siguiente al hacer scroll
  - Efraín reportó (captura) que al mover la tabla de Cotización horizontalmente se veía "raro" — un pedazo de la caja de la columna contigua se asomaba pegado a la columna Producto (fija/`sticky` al hacer scroll horizontal).
  - Causa: las tres vistas que comparten `STICKY_PRODUCTO_STYLE` (header, filas `QuoteRow`, `TotalsRow` — `gridMeta.tsx`) usan `gap: 6` entre columnas del grid; ese hueco de 6px a la derecha de la celda pegajosa no tenía fondo propio, así que dejaba ver el borde de la columna siguiente mientras esta se deslizaba por debajo.
  - Fix: `marginRight: -6` en `STICKY_PRODUCTO_STYLE` (mismo valor que el `gap`) estira la celda sobre ese hueco — corrige las 3 vistas a la vez al vivir en el único punto compartido.
  - Verificado con Playwright contra el dev server local (Costeo, OPP-0512): comparé capturas antes/después del fix haciendo scroll horizontal de la grid — la cobertura de Producto crece los 6px esperados y deja de asomarse el contenido de la columna vecina. `tsc --noEmit` y `npm run lint` limpios.

## 2026-08-06

- Ejecución: un solo popover abierto a la vez + resumen libre por producto
  - Efraín reportó (captura) que los popovers de estado por talla no se cerraban entre sí — cada `EstadoChip` tenía su propio estado local, así que abrir uno nunca cerraba los demás y se apilaban varios a la vez. Pidió también agregar un texto libre de resumen por producto (dejando el comentario por talla intacto) y "que puedan seleccionar"; aclaró que solo se refería a que un popover cierre al abrir otro, no a selección múltiple de tallas.
  - `ProyectoSection.tsx`: `openPopover` (un solo string) sube a `EjecucionSection` y baja a chips/historial/resumen — abrir cualquiera cierra el que estuviera abierto; un backdrop `position: fixed` de página completa lo cierra al hacer click fuera.
  - Nuevo bloque "Resumen" en cada tarjeta de `EjecucionCard`, siempre visible, mismo patrón textarea+Cancelar/Guardar, editable solo compras/admin. El grupo producto+color no es una columna de Monday (es agrupado del cliente sobre subitems de talla), así que el resumen vive nativo en D1 — mismo patrón lazy-create que `estado_producto_historial` (`worker/lib/productoResumen.ts`, tabla `producto_resumen`, rutas `GET/PATCH /api/proyectos/:id/resumen-producto` en `worker/routes/oportunidades.ts`).
  - Verificado: `npx tsc --noEmit`, `npm run lint`, `npm test` (126 tests) limpios; rutas nuevas probadas con curl contra el Worker local (mismo comportamiento 404 "not found" sin auth que la ruta ya existente `estado-historial`, confirma el wiring). Sin verificación visual en navegador — dev servers ya en uso por otra sesión y sin credenciales de login a mano.

- Notificaciones: WhatsApp al llegar a Cotización y a Ganada
  - Efraín pidió que las opps disparen WhatsApp (severidad "importante") al llegar a la etapa "Cotización" (cuando ya se generó y se le puede mandar al cliente) y también al "Ganada". `STAGE_NOTIFY` (`shared/notifications.ts`) no tenía entrada para "Cotización"; se agregó con `selectors: ['owner']`. "Ganada" ya notificaba (solo Centro de Notificaciones, sin WA) a `owner + role:compras`; a petición explícita de Efraín se cambió a `owner` + Elisa/administración específicamente, no todo Compras.
  - Elisa (`administracion@mexicanadeproteccion.com`) es `role: 'vendedor'` en `identity`, no `admin` — no hay selector de rol que la capture sola. Se agregó un nuevo tipo de selector `email:<addr>` (destinatario fijo, no depende de rol) en `RecipientSelector` y su resolución en `worker/lib/notify.ts` (`resolveRecipients`).
  - Verificado: `npx tsc --noEmit` y `npm test` limpios. Sin verificación en vivo del envío real de WhatsApp — depende de que la fila de `identity` del destinatario tenga `phone` poblado en D1 (`worker/wa/notify.ts` se traga el envío en silencio si no).

- Configuración: "Actuar en Monday como" para usuarios del portal
  - Efraín, sobre lo de abajo: un vendedor que acaba de dar de alta SÍ necesita poder crear oportunidades ya, no solo quedar como directorio — pidió poder asignarlo temporalmente a su propio nombre de Monday mientras no tenga cuenta propia, "para que esté la info en los dos lados".
  - `dal.createNativeIdentity` acepta `mondayUserId` opcional: si se manda, se usa ese id real en vez del sintético negativo (validado contra el roster en `worker/routes/admin.ts` vía nuevo `dal.mondayUserIdExists`, 400 si no existe). Con un id real positivo, las oportunidades que cree ese usuario quedan en Monday a nombre de la persona elegida — los guards/filtros de la entrada de abajo (picker de Vendedor, @mentions, bloqueo de creación) siguen aplicando tal cual porque solo miran el signo del id.
  - `AddUserModal` (alta) suma el campo "Actuar en Monday como (opcional)"; `IdentityRow` suma un control inline "Vincular a Monday" para usuarios ya creados como solo-directorio (mismo `PUT /api/admin/identities/:email` que ya aceptaba `mondayUserId`, sin cambios de backend ahí).
  - Verificado: `npx tsc --noEmit`/`npm test` limpios. Manual con Playwright + curl contra el dev server: usuario con proxy sí crea una oportunidad real (`POST /boards/oportunidades/items` con `deal_owner` del proxy) y aparece en `/api/vendedores`; usuario sin proxy sigue bloqueado con 403; proxy con id inexistente da 400; vincular después de creado cambia el badge Portal→Monday y dispara el toast correcto (bug encontrado y corregido en el camino: reusaba el toast de "teléfono actualizado").

- Configuración: alta de usuarios del portal sin pasar por Monday
  - Efraín pidió poder agregar usuarios (nombre, correo, teléfono, rol, zona) independientes de Monday, como primer paso para soltar esa dependencia — confirmado con él: por ahora es directorio funcional (rol + zona reales), el login sigue siendo 100% Cloudflare Access, no se toca ese mecanismo.
  - `identity.monday_user_id` es `NOT NULL` y se usa en todo el codebase tanto para scoping local en D1 como para escribir/mencionar personas reales en Monday. En vez de migrar el esquema (la tabla ya vive en producción con datos reales), a los usuarios creados desde el portal se les asigna un id sintético **negativo** (`MIN(monday_user_id) - 1`) — los ids reales de Monday siempre son positivos, así que `monday_user_id > 0` es la señal "persona real de Monday". `worker/lib/dal.ts` (`createNativeIdentity`, filtro en `listVendedores`) y `worker/lib/proyectoTallas.ts` (mención de compras) ya excluyen a estos usuarios de cualquier sitio que escriba/mencione en Monday; `createOportunidad.ts`/`createRecord.ts` bloquean con 403 si un usuario portal (id negativo) intenta crear un registro que se autoestamparía como Vendedor.
  - Nueva ruta `POST /api/admin/identities` (admin-only, 409 si el email ya existe) y botón "+ Agregar usuario" en `SettingsPage.tsx` (modal reusando `components/core/Modal.tsx`) con nombre/correo/teléfono/rol/zona; columna "Origen" (Portal/Monday) nueva en la tabla de Usuarios del portal para distinguir de un vistazo.
  - Verificado: `npx tsc --noEmit`, `npm run lint`, `npm test` limpios. Manual end-to-end con Playwright contra el dev server (zona nueva + usuario nuevo asignado a ella, badge "Portal", ausente del picker de Vendedor en "Nueva oportunidad", 409/400 en email duplicado/inválido vía curl) — datos de prueba limpiados de la D1 local al terminar.

- Proyecto/Tallas: tarjetas coloreadas por estado + cruce contra la Oportunidad más robusto
  - Efraín reportó una tarjeta de tallas real que no cruzaba ("sin línea de cotización para comparar") y pidió color: gris cuando no se ha capturado nada, verde claro cuando cuadra contra lo cotizado, rojo cuando no cuadra (`TallaBoxCard`, `ProyectoSection.tsx`).
  - Causa del cruce roto: `cotizadoMapFrom`/`reportarTallasIncorrectas` solo comparaban por nombre de producto + color exactos contra la línea de cotización de la Oportunidad — "Importar tallas" (cmp-tallas) puede reescribir ese nombre al copiarlo al Proyecto. Se agregó un respaldo por SKU+color (más estable que el nombre) tanto en el frontend (`cotizadoMapsFrom`/`lookupCotizado`) como en el backend (`worker/lib/proyectoTallas.ts`), sin agregar columnas nuevas en Monday — el cruce ya vivía 100% en D1.
  - Verificado: `npx tsc --noEmit`, `npm run lint`, `npm test` limpios. Sin verificación visual en vivo (servidores de dev ya en uso por otra sesión, sin credenciales de login a mano en esta sesión).

## 2026-08-05

- Proyectos: tabs recortados por acceso + Fecha de entrega obligatoria en Documentación
  - Efraín pidió que "Documentación y Tallas" solo muestre Documentación/Tallas (sin Actualizaciones/Órdenes de compra/Ejecución/Logística) y que "Órdenes de Compra" solo muestre Documentación/Tallas/Órdenes de compra (sin Ejecución/Logística). Ejecución y Logística se dejan con el set completo de tabs — no se pidió lo mismo para esos accesos.
  - `ProyectoDrawer.tsx`: nuevo `TABS_BY_BOARD` (por `ProjectBoardKey`) que filtra la barra de tabs; `ProyectoBoard.tsx` ahora le pasa `boardKey`.
  - Fecha Entrega (`date_mm0m1vfv`, Proyectos) pasa de solo-lectura (`vis: V`, sin `w`) a escribible por vendedor/admin (`w: WV`) en `shared/visibility.ts` — la captura vendedor, compras solo la ve. Nuevo campo `FechaEntregaField` (`DocumentacionTab.tsx`, reusado por `ProyectoDrawer` y por el tab Documentación del lado Oportunidad) con asterisco de obligatorio y aviso en rojo mientras esté vacío; guarda con `patchItem('proyectos', ...)` al cambiar el date picker.
  - Verificado con Playwright en local: PRO-0039 (UNIFORMES COTAXTLA, acceso Documentación y Tallas) solo trae 2 tabs y el campo de fecha precargado editable; PRO-0064 (acceso Órdenes de Compra) trae 3 tabs. `npx tsc --noEmit` y `npm test` (shared/visibility.test.ts, worker/lib/columnEncode.test.ts) limpios.

- Proyecto: quitar título "Proyecto {nombre}" y la línea divisoria del tab Tallas
  - Efraín (captura): pidió quitar la línea horizontal entre la barra de tabs (Actualizaciones/Documentación/Tallas/Órdenes de compra/Logística) y el contenido, y quitar el nombre del proyecto repetido ahí — ya está arriba en el header del drawer — dejando solo los links ("Abrir archivo de tallas", "Carpeta Drive") y los botones de acción.
  - `ProyectoTallasSection` (`src/boards/oportunidades/ProyectoSection.tsx`): se quita el `div` de título+subtítulo y el `borderTop` del contenedor; cambio acotado a este tab (no es un wrapper compartido con Documentación/Órdenes de compra/Logística).
  - Verificado con Playwright en local contra PRO-0039 (UNIFORMES COTAXTLA). `npx tsc --noEmit` limpio; no corrí `npm test` — cambio de UI puro, no toca write path ni `shared/visibility.ts`.

- Oportunidades: aviso de "Vendedor secundario" en filas/filtro + campo en "Nueva oportunidad"
  - Efraín reportó (con captura), viendo el portal como Ricardo Rivera Rodríguez (líder de zona) vía "Ver como", que el filtro de Vendedor mostraba nombres fuera de su zona — sospecha de fuga de permisos, "problema grave". Investigación con Playwright + queries directas contra D1 remota confirmó que el scoping (`worker/lib/dal.ts` + `worker/lib/zonas.ts`) es correcto: esos nombres aparecen porque Ricardo está marcado como "Vendedor secundario" (`multiple_person_mm0wt53c`, segundo `authzCol` de Oportunidades junto a `deal_owner`) en oportunidades ajenas — comportamiento intencional; Efraín lo confirmó tras revisarlo ("si lo asigno como vendedor secundario esta perfect").
  - Como el origen no era obvio ("yo no entendí eso"), se agregó un badge "S" en el avatar de Vendedor (`PersonAvatar`/`PersonPair`) cuando el viewer ve una oportunidad solo por ser secundario ahí — esquina superior-izquierda del avatar, la inferior-derecha quedaba tapada por el avatar de Compras que se traslapa encima. El dropdown de filtro Vendedor etiqueta esas mismas opciones con "(secundario)" (`vendedorOptionsFromItems`, nuevo en `StageBoardList.tsx`).
  - A petición de Efraín, se agregó "Vendedor secundario" al formulario "Nueva oportunidad" (`CreateOportunidadModal.tsx`) — dropdown simple de un solo vendedor, mismo patrón y lista que "Vendedor"/"Compras". Whitelisteado en `shared/createFields.ts` (`multiple_person_mm0wt53c`) para que el server lo acepte al crear.
  - Verificado en vivo con Playwright impersonando a Ricardo (D1 local con datos reales sincronizados): 114/172 oportunidades quedan correctamente etiquetadas "(secundario)" en el filtro, badge visible en la fila sin taparse con Compras.
  - `npx tsc --noEmit` (app + worker) y `npm test` (119/119) limpios.

- Contactos: combobox de Institución más claro + "+ Nueva" abre modal en vez de panel inline
  - Efraín: no quedaba claro qué institución estaba elegida (buscador seguía mostrando el texto tecleado, la selección solo se reflejaba en una leyenda gris chiquita arriba). Pidió que la institución elegida se muestre directamente en el campo y que crear una nueva se mueva a un botón que abra su propia modal.
  - `CreateRecordModal.tsx`: el campo Institución ahora alterna entre buscador (sin selección) y una caja con el nombre elegido + botón "✕" para volver a buscar — ya no convive el buscador con la leyenda "elegida: X". El panel inline de Tipo/Estado ("+ Crear institución") se quitó: un botón "+ Nueva" junto al campo abre `CreateRecordModal` anidado con `slug="instituciones"` (mismo componente, reusado por recursión — ya traía el form completo con sus opcionales). `onCreated` gana un parámetro opcional `{id, name}` para autoseleccionar la institución recién creada; `GenericBoardView` (única otra llamada) sigue pasando `refetch` sin cambios, un callback con menos parámetros sigue siendo asignable.
  - Verificado con Playwright en local: buscar "efra" y elegir "TEST EFRA" la deja escrita en el campo (con ✕ para cambiarla); "+ Nueva" abre la modal de institución apilada encima con Nombre/Tipo/Estado.
  - `npx tsc --noEmit` y `npm run lint` limpios. No corrí `npm test` — cambio de UI únicamente, no toca write path ni `shared/visibility.ts`.

- Tallas del Proyecto: cajitas por talla + cruce con lo cotizado + "Reportar tallas incorrectas"
  - Segunda vuelta sobre el cambio de Tallas de este mismo día: Efraín pidió que el grid se pareciera más a la captura de tallas del vendedor (TallasTab.tsx) — una tarjeta por producto+color con una cajita por talla, en vez de las filas planas de la iteración anterior. `TallasGrid`/`TallaBoxCard` (`src/boards/oportunidades/ProyectoSection.tsx`) se reescriben con ese estilo; el agrupado pasa de solo-producto a producto+color (dos colores del mismo producto = dos tarjetas), igual que ya hacía `TallaBoxesCapture`.
  - Nuevo: cada tarjeta muestra "Cotizado: N" y compara contra lo asignado ("Faltan X" / "cuadra" / "Sobran X"). Efraín: "que coincida con la opp, si se puede todo en D1 mejor" — el cruce lee las líneas de cotización de la Oportunidad ligada vía `getItem('oportunidades', oppId)` (mirror D1, sin round-trip a Monday) y empareja por nombre+color normalizados con las líneas ya importadas del Proyecto. Sin match, la tarjeta no compara (no hay falso "no cuadra" cuando simplemente no hay con qué cruzar).
  - Nuevo botón "Reportar tallas incorrectas" por tarjeta: Efraín pidió que taggeara a Compras y (aparte) que fuera "error importante" con WhatsApp. `worker/lib/proyectoTallas.ts` (`reportarTallasIncorrectas`) + `POST /api/proyectos/:id/tallas-reportar` (registrada antes del wildcard, mismo motivo que `/lineas`/`/tallas-capturar`): recalcula asignadas/cotizado en el servidor (nunca confía en el número que mandó el cliente), postea un update en Monday @mencionando a todo `identity` con `role='compras'` (mismo patrón que `productosPropuestos.ts` `notifyComprador`) y emite una notificación `severity: 'importante'` por cada uno (dispara WhatsApp vía `emitNotification`, `worker/lib/notify.ts`).
  - Se quitó el botón "+ Agregar línea manual" de la tab Tallas del Proyecto (`ProyectoDrawer.tsx`): Efraín — "eso no lo podemos hacer, se tendría que hacer en Cotización por lo pronto". Se dejó `AgregarLineaModal.tsx` y el endpoint `POST /api/proyectos/:id/lineas` intactos (nadie más los usa, pero es una decisión "por ahora", no definitiva) — solo se quitó el punto de entrada desde esta pantalla.
  - Verificado con Playwright en local contra UNIFORMES COTAXTLA (PRO-0039, proyecto de prueba): "Ridge Pant" se parte correctamente en dos tarjetas (DARK NAVY / KANGAROO); todas las tarjetas muestran "sin línea de cotización para comparar" porque las líneas de cotización de ESTE proyecto de prueba tienen nombres placeholder ("Subelemento", "Nombre del elemento") — confirmado inspeccionando la respuesta cruda del mirror, no es bug del match. Edición de cantidad (blur→PATCH) probada de nuevo en el estilo de cajitas, revertida al terminar. NO se probó el botón "Reportar tallas incorrectas" con clicks reales — dispara WhatsApp real y un update permanente en Monday a Compras, efectos que no son reversibles como un PATCH de cantidad.
  - `npx tsc --noEmit` y `npm run lint` limpios (solo warnings preexistentes de `only-export-components`, mismo patrón ya presente antes en este archivo). `npm test` 119/119 (sin tests nuevos — este cambio es de UI + un endpoint de notificación best-effort, no toca la whitelist).

- Contactos: 3 bugs en "Nuevo contacto" + campos obligatorios
  - Efraín reportó que el combobox de Institución no dejaba seleccionar (al buscar y hacer click parecía no pasar nada), que el toggle "Más campos (opcional)" no se podía volver a colapsar, y que el dropdown de Vendedor salía vacío. Pidió además que todos los campos del form sean obligatorios excepto Comentarios.
  - `CreateRecordModal.tsx`: el click en un resultado de Institución hacía `setInstQ('')` en el mismo evento que guardaba el id — eso disparaba un refetch de `usePoll('instituciones', '')` (trae el catálogo completo) justo después de seleccionar, dando la sensación de que la selección no pegó. Se quitó el reset del query (mismo patrón, sin reset, que ya usaba `EditContactoModal`).
  - El botón "Más campos (opcional)" solo se renderizaba con `!showMore`, sin ningún botón de vuelta cuando `showMore` era `true` — se unificó en un solo botón que alterna `setShowMore(v => !v)` y cambia texto/ícono ("Más campos (opcional)" ↔ "Menos campos").
  - El fetch de vendedores estaba condicionado a que `allCols` (derivado de `useBoards()`, async) ya tuviera un campo `people` — en el primer render `allCols` siempre viene vacío, así que la condición nunca era cierta y `getVendedores()` jamás se llamaba. Se quitó la condición (mismo patrón sin condicionar que ya usaba `EditContactoModal`).
  - `shared/createFields.ts`: `contact_account`, `contact_email`, `contact_phone`, `text_mm0dz8yj` (Cargo) y `multiple_person_mm03vqwx` (Vendedor) pasan a `required: true`; `long_text4` (Comentarios) se queda opcional. Institución vive fuera del loop genérico de `requiredFields` (es un board_relation con su propio bloque de búsqueda), así que se agregó su validación a mano en `onSubmit` + `*` en el label.
  - Verificado con Playwright en local: selección de institución por búsqueda queda reflejada ("— elegida: X") sin resetear el buscador, el toggle colapsa/expande correctamente, y el `<select>` de Vendedor trae los 18 vendedores activos.
  - `npx tsc --noEmit` limpio. No corrí `npm test` — no toqué write path a Monday ni la whitelist de escritura (`shared/visibility.ts`), solo validación de required en cliente.

- Cotización: columna Producto congelada al hacer scroll + avisos unificados en un solo banner
  - Efraín pidió congelar la columna Producto en la grid de Costeo/Validación de costeo al mover la tabla horizontalmente, y quitar la columna "Avisos" al final — quería el error "súper claro arriba del producto como costeo", generalizando el banner que hasta ahora solo cubría "HAY QUE CONFIRMAR TALLAS Y PROVEEDOR".
  - `gridMeta.tsx`: nuevo `STICKY_PRODUCTO_STYLE` (`position: sticky; left: 0`) en la celda Producto de header/`QuoteRow`/`TotalsRow`. A propósito no se fija también "#" — al no ser sticky se desliza fuera de vista con el resto, así Producto termina pegado al borde izquierdo sin dejar un hueco donde "#" solía estar. `colsTemplate` pierde la pista fija `WARNINGS_COL_WIDTH` que reservaba la columna Avisos.
  - `QuoteRow.tsx`/`MobileQuoteRow.tsx`: el banner que antes solo cubría "Sin confirmar"/"Sin tallas"/"Sin proveedor" ahora concatena TODOS los avisos de la línea (`getLineWarnings`) en un solo renglón rojo arriba del producto — ya no hay `StatusBadge` aparte al final de la fila. Mismo componente en Costeo y Validación (`precioOnly`), así que el único aviso posible en Validación ("Falta precio") sale con idéntico tratamiento visual al de Costeo.
  - Verificado con Playwright en local: scroll horizontal en Costeo con Producto fijo (header, filas y TOTAL manteniendo su tinte/fondo), banner combinando 2-3 avisos por línea en una sola oración.
  - `npx tsc --noEmit`, `npm run lint` y `npm test` (119/119) limpios.

- Tallas del Proyecto: grid simplificado + cantidad editable inline
  - Efraín reportó que la pantalla de tallas (tab "Tallas" del Proyecto) estaba "horriblemente complicada" — pills anidados por producto, sin poder corregir nada sin ir al Sheet/Monday. `TallasGrid` (`src/boards/oportunidades/ProyectoSection.tsx`) pasa de pills envueltos a filas planas (Talla · Color · Cantidad) por producto.
  - Cantidad ahora es editable inline (input numérico, guarda en blur/Enter contra `PATCH /api/boards/proyectos_sub/items/:id`) para vendedor, compras y admin (decisión de Efraín: los tres corrigen, no solo vendedor). Talla y color se quedan de solo lectura a propósito — son texto libre que viene del catálogo de cmp-tallas, un typo aquí no calzaría con el Sheet.
  - `shared/visibility.ts`: `numeric_mm0hj2q4` (Cantidad, proyectos_sub) sale del bloque read-only y gana `w: V` (vendedor/compras/admin). Anclado en `shared/visibility.test.ts` (2 tests nuevos: cantidad escribible por los 3 roles + talla/color siguen sin `w`).
  - Riesgo aceptado y documentado en comentario: esta cantidad vive en el mirror de Monday, no en el Google Sheet que audita "Validar tallas" — un "Importar tallas a Monday" posterior la vuelve a pisar (import_tallas borra y recrea los subitems). Es una corrección rápida post-import, no reemplaza el flujo del Sheet.
  - Verificado con Playwright en local contra un proyecto real (UNIFORMES COTAXTLA, PRO-0039): el PATCH devuelve 200/`pending:true` (encolado en outbox) y el total del grupo se recalcula al vuelo. La edición de prueba se revirtió a su valor original en el mismo proyecto real.
  - `npx tsc --noEmit` limpio, `npm test` 119/119 (antes 117, +2 nuevos de visibility).

- Alertas de errores por WhatsApp cada 15 min + retención de 90 días en `sync_log`
  - Efraín pidió algo simple para enterarse de errores de producción sin ir a buscar logs a mano: nada de tabla/pipeline nuevo — reusa `sync_log` (ya alimentado por reconcile/webhook/outbox/notify/wa vía `logSync`). Nuevo tercer cron trigger (`*/15 * * * *`, `wrangler.jsonc`) despachado en `worker/index.ts` `scheduled()` con un branch explícito ANTES del lookup en `CRON_GROUPS` — sin eso, un cron no reconocido caía al fallback de "todos los boards" y hubiera disparado un reconcile completo cada 15 min por error.
  - `worker/lib/errorAlerts.ts` (`checkErrorsAndAlert`): revisa `sync_log WHERE ok=0 AND at > now-16min` (16 = colchón de 1 min sobre el intervalo; sin tabla de cursor — a lo mucho reporta una fila dos veces si una corrida se atrasa, nunca la pierde) y manda WhatsApp vía `sendTemplate` (mismo template aprobado `portal_notificacion` que ya usa `notifyPortalWa`, garantiza entrega fuera de la ventana de 24h). Poda `sync_log` a 90 días en cada corrida (no existía ninguna retención antes — la tabla crecía para siempre).
  - Nuevo `app.onError` global en `worker/index.ts`: hoy una excepción no capturada por los try/catch específicos por ruta (`AutomationError`, `QuoteVersionError`, etc.) no dejaba NINGÚN rastro — ahora cae a `sync_log` (`kind: 'http'`, nuevo valor en el union de `worker/sync/log.ts`) antes de responder 500.
  - Destinatario: secret nuevo `ADMIN_ALERT_PHONE` (no `identity.phone` — las dos filas admin lo tienen NULL hoy, y mezclar "tu número de chat con el bot" con "a quién avisar de errores del sistema" se puede romper en silencio si tu fila de identity cambia).
  - Deliberadamente sin tabla D1 nueva: evita el problema ya documentado abajo con `role_board_access` (un `CREATE TABLE` que nunca se aplicó a D1 remoto y rompió producción en silencio 3 días).
  - Verificado: `npx tsc --noEmit` limpio, `npm run lint` sin errores nuevos. La query de `checkErrorsAndAlert` y la poda de 90 días se probaron contra un D1 local aislado (`--persist-to` en un directorio temporal, fuera del estado de cualquier sesión concurrente) insertando una fila `ok=0` de prueba — el SELECT la agrupa por `kind` correctamente y el DELETE de poda no la toca (no tiene 90 días). El disparo end-to-end vía `/__scheduled` de `wrangler dev --test-scheduled` no funcionó en local (la config de `assets.run_worker_first` — solo `/api/*` y `/wa/*` — hace que ese path caiga al fallback SPA antes de llegar al Worker); la lógica de despacho en `scheduled()` es la misma estructura ya probada en producción para los otros dos crons, así que no se bloqueó por esto.

- Frontend: pantalla en blanco al hacer push mientras la app está abierta
  - Efraín reportó que la página se ponía en blanco al hacer commit/push. Causa: cada push a `main` dispara el deploy automático (`deploy.yml`), que reemplaza por completo los assets servidos por Cloudflare Workers; `App.tsx` carga cada vista con `React.lazy` (un chunk por board), y si el navegador ya tenía la app abierta y disparaba un `import()` justo después del deploy, el chunk viejo ya no existía (404) — sin ningún `ErrorBoundary` en el árbol, React se caía en silencio.
  - Nuevo `src/app/ChunkReloadBoundary.tsx`: `ErrorBoundary` envolviendo `<App />` en `main.tsx` que detecta errores de chunk (regex sobre el mensaje del error) y recarga la página una sola vez (guard por `sessionStorage`, sin loop si el deploy sigue roto por otra razón); cualquier otro error de render cae en un fallback con botón "Recargar" en vez de blanco puro. También listener del evento nativo de Vite `vite:preloadError` para el caso de falla en el preload del módulo.
  - Verificado con Playwright en local: carga normal sin regresión (sin errores de consola) y el disparo manual del evento `vite:preloadError` sí provoca la recarga (confirmado vía `sessionStorage` y `framenavigated`); el escenario real de chunk 404 post-deploy solo se puede confirmar en producción tras el próximo push.
  - `npx tsc --noEmit` limpio.

- Costeo: el input de Tallas en el panel de línea se veía como placeholder estático
  - Efraín reportó (con captura) que el campo Tallas del chevron de detalle "no es texto editable, solo un placeholder". Ya era un `<input>` real y funcional (confirmado en vivo con Playwright — escribir y guardar funcionan) — el problema era puramente de contraste: usaba `border: 1px solid var(--border)` (`#e2ded3`) sobre un fondo casi idéntico (`--bg-sunken` `#efeae0`), así que se veía plano en vez de como caja editable. `LineDetailPanel.tsx`: mismo tratamiento que ya usan los demás campos editables de la grid (`gridMeta.tsx` `inputStyle`) — borde `var(--accent)` sobre fondo blanco.
  - `npx tsc --noEmit` limpio (cambio de estilo puro, no toca write path).

- Notificaciones: "En costeo" ahora dispara WhatsApp además del portal
  - Efraín reportó que no le llegaba ningún WhatsApp de sus oportunidades. Causa: `STAGE_NOTIFY` emitía TODOS los cambios de etapa con `severity: 'actualizacion'` (worker/lib/notify.ts), y `notifyPortalWa` solo manda WhatsApp para `'importante'` — decisión de alcance previa (2026-07-31). Además, verificado en D1 remoto: su identidad (`efrain.ponces@gmail.com`) y la mayoría de `compras` no tienen `phone` cargado, así que aunque cambiara la severidad no habría a dónde mandar el WA.
  - `shared/notifications.ts`: `STAGE_NOTIFY`/`PROJECT_STATUS_NOTIFY` cambian de `Record<string, RecipientSelector[]>` a `Record<string, StageNotifyEntry>` (`{ selectors, severity? }`) — permite marcar severidad por etapa en vez de todo fijo a `'actualizacion'`. Se marca `'En costeo'` como `importante` (Compras necesita enterarse de inmediato).
  - `worker/lib/notify.ts` (`maybeEmitStatusChange`): usa `entry.selectors`/`entry.severity ?? 'actualizacion'`.
  - Pendiente que NO se resuelve con este cambio: la mayoría de las identidades de `compras` (`cotizaciones3/4/6`, `logistica`) siguen sin `phone` en D1 — hay que darlos de alta en Admin → usuarios para que efectivamente reciban el WhatsApp.
  - `npx tsc --noEmit` y `npm test` (117/117) limpios.

- Configuración: el dropdown "Rol a asignar" en Importar desde Monday siempre arrancaba en "Ventas"
  - Efraín reportó (con captura) que era confuso — el default no reflejaba el equipo real del usuario en Monday (ej. alguien de Admin o Compras aparecía con "Ventas" preseleccionado).
  - `SettingsPage.tsx`: nuevo `inferRoleFromTeams()` que adivina el rol inicial por prefijo case-insensitive sobre `user.teams` (admin/compras/almac/ventas), con `vendedor` como fallback; `MondayUserRow` inicializa `role` con esto en vez de un literal fijo. Sigue siendo editable, solo cambia el valor de arranque.
  - `npx tsc --noEmit` limpio (cambio de UI puro, no toca write path ni visibility).

- Cotización: separación entre la tabla de líneas/totales y "Condiciones de la cotización"
  - Efraín (captura): el bloque de condiciones quedaba pegado justo debajo del renglón TOTAL, sin aire visual entre ambos.
  - `CondicionesCotizacion.tsx`: se agrega `marginTop: 20` al contenedor del bloque.

- Costeo: "Asignar" Proveedor pegado al texto, ya no al otro extremo de la fila
  - Con el fix de ancho anterior "Asignar" ya era visible, pero seguía separado del texto por `justify-content:space-between` — Efraín: "no es nada claro". `LineDetailPanel.tsx` (`ProveedorField`): se quita el space-between (queda `flex-start` con gap 10) y el link gana subrayado para que se note que es clickeable.

- Costeo: el link "Asignar" de Proveedor en el panel de línea quedaba fuera de la pantalla
  - Efraín seguía reportando (con captura) no poder elegir Proveedor pese a ya ser admin sin identidad fantasma. Causa real, no de permisos: `QuoteRow.tsx`, el wrapper exterior de cada fila reutilizaba `gridWrapStyle` (`width: fit-content`) — pensado para que la grid de 16 columnas de Costeo mida exactamente sus columnas y dispare scroll horizontal (`colsTemplate`, ver comentario en `gridMeta.tsx`). Pero `LineDetailPanel` (el panel del chevron ⌄) es hijo de ESE mismo wrapper, así que heredaba el mismo ancho ~2255px. Con `justify-content:space-between` en `ProveedorField`, el span "Asignar"/"Cambiar" terminaba a ~2488px en un viewport de 1280 — visible solo scrolleando horizontalmente casi 1200px, invisible en la práctica. Confirmado con Playwright (`getBoundingClientRect`) antes y después del fix.
  - Fix: el wrapper exterior de la fila ya no lleva `gridWrapStyle` — solo el grid interno (las 16 columnas) lo conserva, con el mismo tinte de warnings replicado ahí para que siga cubriendo toda la fila al scrollear. El exterior ahora mide el ancho visible real, así que `LineDetailPanel` (Descripción/Tallas/Proveedor/Embellecimiento) queda acotado a lo que se ve sin scroll.
  - Verificado en vivo con Playwright contra el worker local (que sí pega a Monday real, `.dev.vars` trae token real): asignar "Kampak" como proveedor de un producto real (BE PICKUP - BALIZAMIENTO Y EQUIPO, item 11633958462) funcionó de punta a punta (buscador, guardado, badge de advertencia bajando de "TALLAS Y PROVEEDOR" a solo "TALLAS") — y se revirtió de inmediato a `board_relation_mm1cwqky: ""` confirmando con lectura fresca (`?fresh=1`) que el producto quedó sin proveedor otra vez, sin dejar el dato de prueba en producción.
  - `npx tsc --noEmit` y `oxlint` limpios (sin tests nuevos — cambio de layout puro, no toca write path a Monday ni `visibility.ts`).

- Configuración: tarjeta "Cuenta" fija arriba con nombre editable y correo de la sesión activa
  - Efraín reportó no poder elegir Proveedor en el tab Cotización de Costeo pese a ser admin; causa real: D1 producción tenía dos filas de `identity` para él con distinto `monday_user_id` (`salinasefrain@mexicanadeproteccion.com` admin y `poncesalinasefrain@gmail.com` vendedor, esta última un usuario de prueba "Ventas EP") — coincide con el límite ya conocido de Cloudflare Access/Google quedándose pegado a la sesión equivocada cuando el navegador tiene varias cuentas abiertas. Se confirmó sin referencias en `zona_miembros`/`zonas`/`notifications` y se borró la fila fantasma de D1 remoto (`DELETE FROM identity WHERE email = 'poncesalinasefrain@gmail.com'`).
  - A petición de Efraín, para que sea obvio con qué cuenta se está entrando cuando hay más de una disponible: nueva sección `MyAccountSection` hasta arriba de Configuración (`SettingsPage.tsx`) con el nombre de la sesión activa (editable, `PUT /api/admin/identities/:email` ya existente) y su correo (solo lectura — no se puede cambiar, es el login real). Guardar dispara `refreshMe()` para que el chip del sidebar y el resto de la UI se actualicen sin recargar.
  - Verificado en vivo con Playwright contra el worker local: editar el nombre, guardar, confirmar que se refleja en la tarjeta, en la fila de "Usuarios del portal" y en el chip del sidebar, y revertirlo al valor original.
  - `npx tsc --noEmit` y `oxlint` limpios (sin tests nuevos — no toca write path a Monday ni `visibility.ts`).

- Cotización: editar Cantidad justo después de elegir Producto lo limpiaba en pantalla
  - Reportado por Efraín como "bug super horrible para crear una cotización". `onEdit` (CotizacionTab.tsx) recalcula el preview local con `previewRow()` en cada tecleo de un campo numérico (Cantidad, Costo Distr., etc.) y REEMPLAZABA entero `state.preview` con el resultado — pero `previewRow()` solo devuelve columnas de fórmula (costos/subtotal/IVA…), nunca Producto/Color/Embellecimiento. Si el usuario acababa de elegir Producto (`onProductoPick`), ese preview local vive únicamente en `state.preview` mientras el mirror real de Monday sigue en vuelo (outbox async) — y tocar Cantidad justo después lo borraba, cayendo `displayProducto` al mirror de Monday todavía vacío.
  - Fix de una línea: mezclar (`{ ...state.preview, ...previewRow(...) }`) en vez de reemplazar. `previewRow()` solo trae ids `formula_*`, así que no colisiona con Producto/Color/Embellecimiento.
  - Verificado en vivo contra el worker local (Playwright, item de prueba real en stage "Nueva oportunidad" vía API de creación): elegir producto → editar Cantidad → el nombre del producto se mantiene visible antes y después del guardado.
  - `npx tsc --noEmit` y `npm test` (117/117) limpios.

- Oportunidades: badge de Etapa (deal_stage) al lado del título en el drawer
  - Pedido por Efraín. `OpportunityDrawer.tsx`: nuevo `StatusBadge` junto a `item.name`
    con el label/color reales de Monday para `deal_stage` (mismo `chipFor()` que ya
    usa `StageBoardList` para Etapa Costeo — reusa `oppCols` para los colores por
    label, no hardcodea nada).
  - Verificado en vivo: "Nueva oportunidad" (gris) y "Ganada" (verde) muestran el
    color que trae Monday para cada etapa.
  - `npx tsc --noEmit` y `npm test` (117/117) limpios.

- Contactos: tabla acomodada a solo Nombre, Cargo e Institución
  - Pedido por Efraín. El board traía visibles Vendedor/Comentarios/Prioridad/
    Calificación/Ciudad/Estado y una columna "Cargo" duplicada sin uso en el
    código (`text_mm562a0m`) — la tabla se veía saturada. `GenericBoardView.tsx`:
    nuevo `LIST_COLS` (allow-list explícita y ordenada por board, hoy solo
    contactos) que reemplaza el `HIDDEN_LIST_COLS` de antes; no se tocó
    `shared/visibility.ts` — las columnas siguen legibles/escribibles igual
    que antes, solo cambia qué se pinta en esta tabla.
  - Verificado en vivo: encabezados quedan Nombre · Cargo · Institución.
  - `npx tsc --noEmit` y `npm test` (117/117) limpios.
  - Mismo día, a pedido de Efraín: se agrega Vendedor a la tabla (Nombre ·
    Cargo · Institución · Vendedor).

- Contactos: se puede ligar Institución al crear (antes solo después, vía el modal
  de edición) + banner de "créala primero" si no existe
  - Pedido por Efraín: "no es obligatorio pero es mejor" — `contact_account` se
    agrega a `CREATE_FIELDS.contactos` sin `required`. Es un `board_relation`
    (necesita buscar en vivo sobre el board `instituciones`, no un `<select>`
    con opciones fijas), así que en vez de forzarlo por el `FormField` genérico
    se le da su propio bloque siempre visible en `CreateRecordModal.tsx`
    (mismo patrón de búsqueda + `PickerRow` que ya usaba `EditContactoModal`
    para reasignarla después de creado). Banner fijo debajo del buscador:
    "¿No aparece la institución que buscas? Créala primero en 'Instituciones'…".
  - Verificado en vivo contra Monday real (no solo el mirror): contacto
    "CLAUDE TEST CONTACTO - borrar" creado con `contact_account` →
    `linked_item_ids: ["12533829842"]` ("TEST — borrar (cmp-portal create)").
  - `npx tsc --noEmit` (3 tsconfigs, mismos 2 errores preexistentes de
    `worker/routes/{admin,boards}.ts` intactos) y `npm test` (117/117) limpios.
  - Mismo día, a pedido de Efraín ("¿se podría crear la institución desde el
    formulario, fácil?"): quick-create inline — si lo tecleado en el buscador
    de Institución no matchea ninguna existente, aparece un bloque con Tipo +
    Estado (los dos únicos campos `required` de `CREATE_FIELDS.instituciones`
    además de Nombre — no se aflojó ese requisito, se piden ahí mismo) y un
    botón "+ Crear institución" que la crea y la liga al contacto sin salir
    del modal. El banner cambia de "créala primero en Instituciones" a
    "créala aquí mismo". Verificado en vivo contra Monday real: institución
    nueva con Tipo "Socio Comercial" / Estado "Nuevo León", contacto ligado
    (`contact_account.value.linked_item_ids`) al id real devuelto.

- Proyectos: nuevo acceso "Ejecución" (post-OC a proveedor) — batería + estado por producto/talla, agrupado por Zona
  - Efraín: quería una "visión de cómo va avanzando la entrega" tras generarse las OC a proveedor, con estado por producto+talla y fecha de cambio ("no necesito una columna por cada una"), dividido por Zona, y un resumen de batería por proyecto "así como en Monday". Introspección en vivo de Monday confirmó que el modelo de datos ya existía casi completo (etapa `project_status`="Ejecución", Zona `dropdown_mm0hnyv`, mirror `lookup_mm20g4n6` con `sumType:allStatuses` = la batería nativa del screenshot, y `proyectos_sub.color_mm0hqf79` con los 11 estados del flujo logístico) — lo que faltaba era la UI del portal: el tab `logistica` del drawer era un placeholder vacío y la lista no agrupaba por Zona.
  - Acceso propio "Ejecución" en el sidebar (separado de "Proyecto Terminado", que se queda en "Logística"): `shared/boardAccess.ts`, `src/app/Sidebar.tsx` (+ ícono nuevo `IconEjecucion`), `src/lib/projectStages.ts` (`PROJECT_BOARDS.ejecucion`, statuses `['3']`), `src/App.tsx`, y **`src/lib/routing.ts`** — su propio `VALID_BOARDS` (deep-link parsing) es una lista separada del `BoardKey` de Sidebar.tsx; sin agregar `'ejecucion'` ahí, un reload directo en `/ejecucion` caía silenciosamente a Oportunidades (bug real atrapado con Playwright durante la verificación, no solo teórico).
  - Historial de cambios de estado SIN agregar columnas de fecha: nueva tabla D1 `estado_producto_historial` (`worker/schema.sql`, creada lazy por `worker/lib/estadoProducto.ts`, mismo patrón que `zonas`/`documents`). Se generaliza el mecanismo que ya usaba `maybeEmitProjectStatusChange` (diff de status por `index`, `worker/sync/upsert.ts`) para `proyectos_sub`, y además — porque el merge optimista de `worker/lib/outbox.ts` deja en D1 un `value` sin `.index` tras un PATCH del portal (verificado contra `canon.ts`, no asumido) — se agrega un segundo camino síncrono en `submitWrite` que compara labels directo usando la fila pre-merge, atribuyendo `changed_by`. Los dos no se duplican: tras un write del portal, el diff por índice de `upsertItem` ya no encuentra `.index` que parsear y se sale solo.
  - Escritura desde el portal: `color_mm0hqf79`/`text_mm20gzsb` (Estado del producto / Comentario) pasan a escribibles por compras/admin (`shared/visibility.ts`, grupo `AC` — vendedor sigue solo viendo). Si el nuevo estado es "Incidencia/Retraso" el comentario es obligatorio y se notifica a Compras + vendedor dueño (`PRODUCT_STATUS_NOTIFY`, `shared/notifications.ts`), mismo mecanismo que el resto del centro de notificaciones.
  - UI (pedido explícito de Efraín, "que no sea solo una tabla"): `ProgressBattery` (`src/components/board/ProgressBattery.tsx` + `src/lib/estadoProductoBuckets.ts`, lógica pura testeada) agrupa los 11 estados en 6 buckets de avance + Incidencia como segmento rojo propio, ponderado por piezas (Cantidad) en el tab del drawer y por número de líneas en la fila compacta de la lista (el mirror de lista no trae subitems). El nuevo tab "Ejecución" (`EjecucionSection`, `src/boards/oportunidades/ProyectoSection.tsx`, montado en `ProyectoDrawer.tsx` y `OpportunityDrawer.tsx`/`BoardTabsBar.tsx`) muestra tarjetas por producto+color con un chip de estado por talla (coloreado, editable en popover) e ícono de historial por línea.
  - Verificado con Playwright en local contra PRO-0026 (real, con datos de Monday): navegación completa Ejecución→Zona→proyecto→tab; cambio de estado a "Incidencia/Retraso" sin comentario bloqueado correctamente; con comentario, guarda, la batería se recalcula al vuelo y el historial lo muestra con fecha+autor. Encontrado y corregido en el camino: el panel de historial se posicionaba con `right:0` y se salía de la pantalla para chips cerca del borde izquierdo (cambiado a `left:0`). Los cambios de prueba sobre PRO-0026 (Monday real, no un mock) se revirtieron al estado original tras verificar.
  - `npx tsc --noEmit` (3 tsconfigs — los 2 errores preexistentes en `admin.ts`/`boards.ts` ya estaban en `main` antes de este cambio, confirmado con `git stash`) y `npm test` (126/126, incl. `shared/visibility.test.ts` y el nuevo `estadoProductoBuckets.test.ts`) limpios. `npm run lint` sin warnings nuevos.
  - Pendiente para Efraín: el seed de `role_board_access` en D1 de producción no se re-aplica solo (`worker/schema.sql` solo documenta el `INSERT OR IGNORE`, ya corrido una vez en remoto) — admin ya ve "Ejecución" sin nada más (bypass hardcoded), pero vendedor/compras necesitan que alguien confirme/reaplique el seed o lo active manual en Configuración. Confirmar también si `almacen` debe poder escribir el estado (hoy solo compras/admin).

## 2026-08-04

- Oportunidades: "Ganar" ahora crea el Proyecto ligado — antes solo cambiaba la Etapa
  - Hallazgo real haciendo la prueba end-to-end pedida por Efraín (creación → OC de proveedor, dos oportunidades de prueba, todo en el portal): al llegar a "Ganada" el Proyecto (donde viven tallas y OC — `worker/lib/proyectoTallas.ts`, `ProyectoSection.tsx`) nunca aparecía. Inspeccionado vía Monday MCP (`get_automation_runs`/`list_automations` sobre el board Oportunidades): la automatización real que crea el Proyecto vive enganchada a un **botón nativo** de Monday (`button_mm09vr1h`, recipe 531581433), no al cambio de valor de `deal_stage` — "Ganar" desde el portal jamás la disparaba. No estaba documentado en ningún doc del repo.
  - Nuevo `worker/lib/ganarOportunidad.ts` (`POST /api/oportunidades/:id/ganar`, reemplaza el PATCH genérico de `deal_stage` que hacía antes el botón "Ganar" del drawer): replica el mapeo exacto de esa automatización — crea el Proyecto en el grupo real (`new_group29179`, "Etapa 1: Subir Tallas y Documentos") con Vendedor/Compras/Elaborado por/Zona/Carpeta Drive copiados de la Oportunidad, liga ambos lados (`board_relation_mm0hf0y3` en el Proyecto nuevo + `board_relation_mm0hw8ew` en la Oportunidad), copia el archivo de cotización firmada, y mueve la Oportunidad al grupo "Oportunidades Ganadas". Idempotente: si ya existe un Proyecto ligado (reintento/doble click) no duplica, solo reafirma la Etapa.
  - Nuevos helpers en `worker/lib/monday.ts`: `createItem` acepta `groupId` opcional, nuevo `moveItemToGroup`.
  - **Hallazgo aparte #1, dejado fuera a propósito**: "Fecha Creación Proyecto" (`date_mm09wqah`) sí llega a Monday en la mutación (confirmado en `sync_log`), pero la confirmación de echo del outbox para columnas tipo `date` nunca cuadra y deja la fila en estado `conflict` — bug preexistente del outbox, no de este flujo. Se omitió esa columna (es solo informativa, sin ningún lector en el código) en vez de arriesgar que ese conflicto afecte la confirmación de `deal_stage`/el link al Proyecto.
  - **Hallazgo aparte #2, sí corregido**: mandar `deal_stage` combinado con OTRA columna (aunque sea board_relation, no date) en el mismo `submitWrite` también deja el outbox en `conflict` — probado con la SEGUNDA oportunidad de prueba real, ahí ni siquiera se escribió `deal_stage` en Monday (solo el link al Proyecto sí llegó), a diferencia de la primera prueba donde `deal_stage` sí pegó. Nada confiable al combinar. Fix: dos `submitWrite` separados (uno para `deal_stage`, otro para el link al Proyecto) en vez de uno combinado — cada write aislado sí es 100% confiable, verificado en ambas oportunidades de prueba tras el cambio.
  - Pendiente que alguien con más tiempo audite `confirmOutboxEcho`/`canon.ts`: combinar `deal_stage` (columna `status`) con cualquier otra columna en el mismo `change_multiple_column_values` parece no ser confiable en general, no solo con columnas `date`.
  - Verificado en vivo contra Monday real con las DOS oportunidades de prueba: `OPP-0838 - OPP-E2E-TEST-5PROD` (creó Proyecto `12720948160`) y `OPP-0840 - OPP-E2E-TEST-10PROD` (creó Proyecto `12721021425`) — grupo, campos y link correctos en ambas (confirmado con query GraphQL directa a Monday, no solo el mirror local).
  - `npx tsc --noEmit` (3 tsconfigs, mismos 2 errores preexistentes intactos), `npm test` (117/117) y `npm run lint` limpios.

- Costeo: Proveedor pasa a ser requerido, como Tallas — Compras lo asigna en Costeo, no en Monday
  - Encontrado haciendo la prueba end-to-end pedida por Efraín (creación → OC de proveedor, todo en el portal): la captura de tallas por boxes (2026-08-02) deja el Proveedor del subitem del Proyecto sin asignar a propósito, y no había ninguna forma en el portal de asignarlo después — "Generar OC" no podía agrupar esas líneas. Efraín, consultado: "la línea de proveedor la debe llenar compras en costeo, y no puede pasar si no tiene proveedor" — mismo tratamiento que Tallas (2026-08-03), no un fix aislado del síntoma.
  - `shared/visibility.ts`: `board_relation_mm1cwqky` (Proveedor, Productos) pasa de solo-lectura (AC) a escribible por compras/admin (`w: WAC`) — no lo era desde el portal hasta hoy, Compras lo asignaba directo en Monday. Sigue sin ser visible para ventas ("cero proveedores", 2026-07-30).
  - `worker/lib/costeo.ts` `checkValidacion`: nuevo requisito, el producto de catálogo debe traer Proveedor ligado antes de "Mandar a Validación de costeo" — mismo patrón que la confirmación/tallas ya existentes, cacheado por producto.
  - Nuevo picker de Proveedor en `LineDetailPanel.tsx` (chevron de la línea, board Costeo): buscar/asignar sobre el catálogo, mismo componente de búsqueda que ya usa `AgregarLineaModal.tsx` (Proyectos). Guarda con `onEditProveedor` en `CotizacionTab.tsx`, mismo patrón optimista que `onEditTallas`.
  - `gridMeta.tsx`: `productoProveedorOk()` + aviso de línea "Sin proveedor"; el banner rojo "HAY QUE CONFIRMAR TALLAS" ahora dice "...Y PROVEEDOR" cuando también falta (`QuoteRow.tsx`/`MobileQuoteRow.tsx`).
  - `worker/lib/proyectoTallas.ts` `capturarTallas`: al crear los subitems de tallas del Proyecto, copia el Proveedor del catálogo (`board_relation_mm1cwqky` → `board_relation_mm1cfgv5`) — ya no queda sin asignar. Cacheado por producto (igual que el costeo que ya copiaba).
  - `npx tsc --noEmit` (3 tsconfigs, sin nuevos errores — los 2 preexistentes de otra sesión en `admin.ts`/`boards.ts` intactos), `npm test` (117/117, incluye 2 casos nuevos de `buildTallaColumns` con/sin proveedor) y `npm run lint` limpios.

- Costeo: aviso explícito "HAY QUE CONFIRMAR TALLAS" arriba a la izquierda de cada línea sin confirmar
  - El botón "Mandar a Validación de costeo" quedaba deshabilitado por falta de confirmación/tallas de Compras, pero el único indicio era un badge genérico ("Sin confirmar • Sin tallas") al fondo de la fila (desktop, fuera de la vista sin scroll horizontal) o mezclado con otros warnings (mobile) — Efraín: "no dice porque no lo puedes mandar a costeo".
  - Nuevo `needsConfirmarTallas()` en `gridMeta.tsx` (variant costeo + falta `productoConfirmado` o `productoTallasOk`); `QuoteRow.tsx` y `MobileQuoteRow.tsx` pintan el texto en rojo justo encima del nombre del producto cuando aplica, y el badge de warnings restante ya no repite "Sin confirmar"/"Sin tallas".
  - `npx tsc --noEmit` y `npm test` (moneda.test.ts, avisos de línea) limpios.

- Proyectos: fixes de la lista de pendientes de Efraín por WhatsApp (Compras)
  - Notificaciones generales para Proyectos: extiende el centro de notificaciones (ya usado para `deal_stage` de Oportunidades) a `project_status` — reemplaza las notificaciones nativas de Monday por-elemento, que Compras reportó que no les llegan. `PROJECT_STATUS_NOTIFY`/`PROJECT_STATUS_LABELS`/`PROJECT_STATUS_BOARD_KEY` en `shared/notifications.ts`, `maybeEmitProjectStatusChange` en `worker/lib/notify.ts` (generalizado de `maybeEmitStageChange`), rama `isProyectos` en `worker/sync/upsert.ts`.
  - Bug real encontrado verificando en vivo: el `dedupe_key` no incluía el destinatario, así que un cambio con VARIOS destinatarios (ej. `['owner', 'role:compras']`) solo notificaba al primero — el `INSERT OR IGNORE` (dedupe_key UNIQUE) descartaba al resto en silencio. Afectaba también las notificaciones de etapa de Oportunidades ya en producción, no solo lo nuevo. Corregido en `worker/lib/notify.ts` incluyendo `recipientEmail` en la llave.
  - Botones que había que apretar varias veces ("Mandar a costeo"/"Generar cotización"/tallas/OC): `TIMEOUT_MS` en `worker/lib/automations.ts` de 120s a 280s — el Portal abortaba antes de que cmp-tallas terminara (el propio comentario del archivo ya documentaba el cap real de Vercel en 300s). Más aviso "puede tardar unos minutos" en los botones lentos.
  - Órdenes de Compra por proveedor, del lado `cmp-tallas` (`~/Documents/dev/cmp-tallas/api/generate_oc.py`, repo separado, decisión de Efraín: parchar ahí en vez de reconstruir nativo en el Portal):
    - Condiciones/Método de pago ahora aceptan override opcional por proveedor (antes: un solo valor a nivel Proyecto aplicado a todos) — inputs nuevos en la tarjeta de cada proveedor (`ProveedorCard`, `ProyectoSection.tsx`), enviados solo junto con `onlyProveedor`.
    - El botón masivo "Generar todas las OC pendientes" ya no re-emite (ni re-manda a firma) proveedores con una OC vigente en el ledger de Sheets — antes regeneraba TODOS cada vez, aunque el nombre dijera "pendientes". Verificado con un caso real de producción con OC duplicada (PRO-0126/Intelico, OC-113 y OC-114 el mismo día).
    - El nombre del Proyecto (`item.name`, ya existía, solo no llegaba al PDF) ahora viaja al payload de Eledo (`nombre_proyecto`) — confirmado visualmente en un PDF de prueba tras que Efraín agregara el campo a la plantilla de Eledo.
    - Bug propio encontrado verificando: el filtro de "no regenerar ya emitidas" quedaba desactivado durante `dry_run`, así que el preview no reflejaba lo que pasaría de verdad. Corregido.
  - Sync de costo de Productos (Airtable → Monday) no llegaba: causa encontrada inspeccionando Make vía API — dos automatizaciones activas al mismo tiempo (`4078999`, legacy, viviendo en "Archive" pero corriendo cada 5 min, y `5413086`, la vigente) escribían la misma columna, carrera last-writer-wins. Desactivado `4078999` (con OK de Efraín) vía Make MCP.
  - Verificado en vivo contra datos reales de producción (todo lectura/`dry_run`, sin escrituras): navegador impersonando compras (campana + deep-link + inputs de la tarjeta de proveedor con payload interceptado), servidor HTTP local corriendo el `handler` real de `generate_oc.py`, y D1 local con notificaciones reales insertadas/verificadas.
  - `npx tsc --noEmit`, `npm test` (115/115) y `npm run lint` limpios en cmp-portal; `python3 -m py_compile` limpio en cmp-tallas.

- Board Proveedores vacío — causa raíz: `reconcileAll` (cron cada 6h) se cortaba a medias en producción
  - Efraín reportó que el board Proveedores salía vacío. Confirmado en `sync_log` de producción (vía `wrangler d1 execute --remote`, ocultando temporalmente `.env` para no ser secuestrado por su token de CF viejo): el board id (`18397474806`) es correcto y Monday sí devuelve sus items — no era un problema de visibilidad, board privado ni id inventado. La causa real: `reconcileAll` procesa los 8 boards en una sola invocación de cron, y esa invocación se corta siempre después de 3 boards (visto en logs: `oportunidades` → `oportunidades_sub` (falla) → `proyectos`, y ahí muere sin excepción ni log) — probablemente un límite de CPU/subrequests de Cloudflare. `productos`/`instituciones`/`contactos` "funcionan" solo porque los webhooks de Monday los van poblando item por item con cada edición; Proveedores casi no se edita, así que nunca recibió ni webhook ni su turno de reconcile desde que se agregó (2026-07-17) — mirror permanentemente vacío.
  - `worker/sync/reconcile.ts`: `reconcileAll` acepta ahora un subconjunto opcional de `slugs` (antes siempre `Object.keys(BOARDS)`). `worker/index.ts`: dos cron triggers en vez de uno (`wrangler.jsonc`, `"0 */6 * * *"` + `"0 3,9,15,21 * * *"`), cada uno con su grupo de boards (`oportunidades`/`oportunidades_sub`/`proyectos`/`proyectos_sub` vs `productos`/`instituciones`/`contactos`/`proveedores`) — así ninguna invocación individual vuelve a cargar los 8 boards de un jalón.
  - Nuevo `POST /api/admin/sync/:slug` (`worker/routes/admin.ts`, admin-only): fuerza el reconcile de un board bajo demanda — no existía ninguna forma de disparar un resync sin esperar el cron. Usado para el backfill inicial de Proveedores en producción tras el deploy.
  - Nota de concurrencia: el working tree traía cambios sueltos y sin relación de otra sesión (`OpportunityDrawer.tsx`, `apiClient.ts`, `worker/lib/monday.ts`, `worker/routes/oportunidades.ts`, `worker/lib/ganarOportunidad.ts` nuevo, entre otros) — se dejaron sin commitear, solo se stagearon los 4 archivos propios de este fix.
  - `npx tsc --noEmit` y `npm test` (117/117) limpios.

## 2026-08-03

- Tallas: migración al campo simplificado de Productos (`text_mm5v6jhj`), en línea con el cambio ya desplegado en cmp-tallas (el archivo de tallas por Oportunidad dejó de separar por género y ahora usa una lista plana)
  - `text_mm5v6jhj` ("Tallas", texto simple: `"S,M,XL"` / `"unitalla"` / `"error"`/vacío) reemplaza `long_text_mm174q0j` ("Tallas JSON", el JSON viejo por género) en el catálogo de Productos; su mirror en las líneas de Oportunidad es `lookup_mm5v1qb` (reemplaza `lookup_mm19c0b6`). `scripts/introspect-boards.mjs` re-corrido para traer ambas columnas nuevas a `shared/column-meta.gen.ts`.
  - `shared/visibility.ts`: `text_mm5v6jhj` ahora escribible por compras/admin (`w: WAC`) — el JSON viejo nunca lo fue (solo se editaba directo en Monday).
  - Compras puede editar Tallas desde el portal, en el panel de detalle de la línea (chevron) del board Costeo — mismo lugar donde ya confirmaba "Descripción y tallas confirmadas" (`LineDetailPanel.tsx` + `onEditTallas` en `CotizacionTab.tsx`, guarda sobre el catálogo por SKU, no por línea).
  - `worker/lib/costeo.ts` `checkValidacion`: además del checkbox de confirmación, ahora exige que el catálogo traiga Tallas no vacías y distintas de `"error"` antes de dejar pasar "Mandar a Validación de costeo" — antes Compras podía marcar el checkbox sin que el campo tuviera nada útil. Reflejado también como aviso de línea en el front (`getLineWarnings`/`productoTallasOk`, gridMeta.tsx).
  - `worker/lib/pdf/templates.ts` `formatTallas()`: simplificado — ya no parsea JSON con fences, solo limpia espacios y trata `"unitalla"`/`"error"`/vacío como casos especiales (usado en el PDF de solicitud de costeo que genera el portal).
  - `npx tsc --noEmit`, `npm test` (115/115) y `npm run lint` limpios.

## 2026-08-02

- Tallas: captura por boxes (vendedor) — subitems del Proyecto directo, sin pasar por cmp-tallas
  - Efraín pidió una alternativa simple al Google Sheet de tallas: por cada producto de la cotización ganada, boxes horizontales de talla+cantidad ("10 XL, 2 S") que se guardan directo como subitems del Proyecto — el link al Sheet se queda arriba tal cual, sigue siendo la herramienta vigente, esto no la reemplaza.
  - Evaluadas dos rutas: tocar el endpoint `import_tallas` de cmp-tallas (otro repo, motor de reconciliación con historial de bugs de datos duplicados/perdidos que justifican su complejidad) vs. generalizar el patrón ya en producción de `POST /api/proyectos/:id/lineas` (`createSubitem` directo, sin cmp-tallas) a un alta en lote. Efraín eligió la segunda opción tras verla comparada: 100% self-contained en cmp-portal.
  - Nuevo `worker/lib/proyectoTallas.ts` (`capturarTallas`): resuelve la Oportunidad ligada, copia costo/moneda/descuento/unidad de la línea de cotización ganadora (leídos del mirror crudo — esos campos están redactados para el vendedor en `shared/visibility.ts`, así que el enriquecimiento vive en el Worker, nunca confía en lo que mande el cliente) y omite (no duplica ni actualiza) filas cuya identidad producto+sku+color+talla ya existe en el Proyecto. Proveedor se deja sin asignar, igual que ya hace `/lineas` hoy — Compras lo pone en Monday antes de la OC.
  - `POST /api/proyectos/:id/tallas-capturar` (rol vendedor/admin, scope `'own'`) + UI nueva en `TallasTab.tsx`: una card por producto de la cotización con boxes XS–3XL más "+ talla" libre, contador en vivo (verde cuando cuadra con la cantidad vendida) y botón "Guardar tallas".
  - Verificado en vivo contra Monday real con el item de pruebas `OPP-0703 - TEST PORTAL E2E — borrar` (Proyecto PRO-0090): guardé XL·8 + S·2, luego XXL·10 — las 3 líneas aparecieron correctas en el `TallasGrid` ya existente de Compras (`ProyectoTallasSection`, sin tocarlo). Reenviar la misma talla (XL·8) devolvió `created:0, omitted:1` — el guard antiduplicados funciona. `tsc -b`, 9 tests nuevos de `worker/lib/proyectoTallas.test.ts` (identityKey/filterWanted/buildTallaColumns, la parte pura) + 116 tests totales, y `npm run lint` limpios.

## 2026-07-31

- Monday: borrados los webhooks agresivos que estaban agotando la cuota de acciones de la cuenta ("Tu cuenta alcanzó el límite máximo de acciones", 25,134/25,000)
  - Efraín reportó (captura del panel "Uso de acciones" de Monday) que la cuota mensual se había agotado, con riesgo de romper automatizaciones reales del negocio (stage triggers, botones de cmp-tallas) que comparten esa misma cuota de cuenta.
  - Diagnóstico: el 96.6% del consumo salía de webhooks propios (`scripts/create-webhooks.mjs`, ver `docs/morning-report-2026-07-14.md`) suscritos a `change_column_value`/`change_subitem_column_value` — CUALQUIER cambio de columna en Oportunidades/Proyectos/Productos/Instituciones/Contactos disparaba una acción, y `change_subitem_column_value` en Oportunidades (líneas de cotización) solo ya era el 40.5%. Nada de esto era de Make — se confirmó comparando ids/config de `webhooks(board_id)` contra el script: los renglones caros coinciden 1:1 con los eventos que el script registra; las automatizaciones de negocio son `change_specific_column_value` con `columnId` (deal_stage/project_status/botones), intactas.
  - Esos webhooks resultaron innecesarios para lo que el portal ya hace: toda mutación/automatización que el portal dispara ya llama `refetchItem`/`refetchItemTree` inmediatamente después (`worker/routes/oportunidades.ts`), sin depender del webhook. Solo servían para detectar ediciones hechas directo en Monday (fuera del portal) — cubierto ahora por `?fresh=1` al abrir el drawer (inmediato) y `reconcileAll` (cron cada 6h, `wrangler.jsonc`), a costa de hasta 6h de staleness en la lista para ediciones directas en Monday.
  - Borrados 7 webhooks vía API (`delete_webhook`): `change_column_value` en oportunidades/proyectos/productos/instituciones/contactos + `change_subitem_column_value` en oportunidades/proyectos. `scripts/create-webhooks.mjs` actualizado para no volver a crearlos si se re-corre.
  - Encontrado de paso (no tocado, fuera de alcance): `create_item` duplicado en oportunidades y proyectos (dos webhook ids por board, probablemente de una re-corrida vieja del script) — consume 2x acciones por alta de item; pendiente que Efraín confirme si limpiarlo.

- Notificaciones "importantes" (menciones, costeo incompleto, producto propuesto, documento firmado) ahora se reenvían por WhatsApp con link directo a la oportunidad
  - Pedido de Efraín: que las notificaciones del portal también le lleguen por WhatsApp, con un link que abra la app directo en la oportunidad en cuestión.
  - `emitNotification()` (`worker/lib/notify.ts`) dispara `notifyPortalWa()` (`worker/wa/notify.ts`, nuevo) solo cuando el `INSERT OR IGNORE` insertó fila nueva (no en replays con el mismo `dedupe_key`) y solo severidad `importante` — cambios de etapa (`actualizacion`, `STAGE_NOTIFY`) quedan fuera, decisión de alcance de Efraín. `sendTemplate()` nuevo en `worker/wa/send.ts` reusa los secrets de WhatsApp ya configurados, sin secrets nuevos.
  - Requiere el template `portal_notificacion` aprobado por Meta Business Manager (mensaje proactivo, fuera de la ventana de 24h del bot) — Efraín lo dio de alta y lo probó en vivo con el "Send test message" de Meta a su propio número (`5554369433`, ya registrado en su identidad admin) antes de este deploy. Detalle del template en `docs/whatsapp-bot.md`.
  - No se pudo probar el pipeline completo (`emitNotification` → `notifyPortalWa`) desde este entorno: los secrets `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` solo existen como secrets de Cloudflare en producción, no accesibles desde `wrangler dev` local en este sandbox, y el modo `--remote` de wrangler quedó bloqueado por Cloudflare Access en el dominio de preview. Verificado sí `tsc -b`, `npm run lint` y los 107 tests de vitest; la prueba end-to-end real queda pendiente en producción (próxima mención/costeo-incompleto real hacia un usuario con teléfono).

- Notificaciones por WhatsApp: verificado `sendTemplate()` end-to-end contra Meta real (post-deploy)
  - Efraín copió `WHATSAPP_TOKEN`/`WA_APP_SECRET` (ya en su `.env` de Vercel) y `WHATSAPP_PHONE_NUMBER_ID` a `.dev.vars` local (gitignoreado) para poder probar `sendTemplate()` sin pasar por Cloudflare Access. Se agregó temporalmente una ruta `/wa/dev-notify-test` (dev-only, igual patrón que `/wa/dev-chat`) para invocarla directo, y se quitó del código en cuanto terminó la prueba — no quedó rastro en el diff.
  - Primer intento falló con `(#132018) Param text cannot have new-line/tab characters`: error del payload de prueba (metí saltos de línea en la variable `{{1}}` a mano), no del código — en producción `n.title` siempre es de una línea. Segundo intento con un `urlSuffix` mal armado (folio `oportunidades/0822` en vez del item id real) abrió la app pero el drawer no pudo cargar el detalle (error genérico de `OpportunityDrawer.tsx`) — confirmado con una consulta de solo lectura a D1 remoto que el item id real de "OPP-0822 - TEST" es `12688539547`, no `0822`. Con el id correcto (`oportunidades/12688539547`) llegó el WhatsApp con el template aprobado y el botón abrió el detalle correcto en el portal — Efraín confirmó en vivo. Sin cambios de código a partir de este hallazgo: `notifyPortalWa()` ya arma el link con `n.itemId` (el id real), nunca con el folio.

- Cotización: "Ajustar línea" — cambiar producto (género)/color/embellecimiento/cantidad sin versión ni costeo, incluso Ganada
  - Origen: chat de WhatsApp de Efraín con Ricardo y Pam. Caso real de Ricardo: un cliente pidió tallas de "dama" que en realidad correspondían a caballero (mismo modelo, SKU y precio distintos por género) — pero para corregirlo con la Oportunidad ya Ganada no había forma en el portal más que "reiniciar el pipeline" a mano. Pam sumó el mismo problema con color (reparto de una cantidad ya cotizada entre dos colores) y Ricardo con embellecimiento (un subconjunto de piezas lleva un bordado distinto). Conclusión de Efraín: "todo lo que no cambie el precio debe ser modificable fácilmente... en un click", sin pasar por costeo ni versión, con el historial de esos retoques visible como sub-versiones (`V1.1`, `V1.2`...) que NO son una versión real.
  - Nuevo endpoint angosto `POST /api/oportunidades/lineas/:id/ajustar` (`worker/lib/lineaAjustes.ts`), sin guard de `deal_stage` — excepción explícita a la regla "Ganada = no editable". Rol propio (vendedor/compras/admin, chequeo dentro del endpoint, sin ampliar el whitelist general de `visibility.ts`). Dos modos: `editar` (PATCH en el sitio) y `dividir` (crea línea hermana con parte de la cantidad, copiando producto/color/embellecimiento/precio/Etapa Costeo de la origen salvo lo que cambió). Nunca escribe `numeric_mkzneg3d` (precio) — el catálogo de Productos no tiene columna de precio, así que no hace falta "validar" que el SKU nuevo cueste igual, basta con no tocar ese campo. Cada ajuste se registra en `cotizacion_ajustes` (D1 nativa, lazy) como `V{mayor}.{n}`; `listVersions` la adjunta a la vigente y `VersionChips.tsx` la pinta como chips discretos con tooltip. Botón "✎" nuevo en cada línea (`QuoteRow.tsx`/`MobileQuoteRow.tsx`) vía `AjustarLineaModal.tsx` (nuevo, reusa `ProductPicker`).
  - **Bug real encontrado probando en vivo** (Efraín pidió explícitamente crear una oportunidad de prueba y probar end-to-end): la condición inicial `canAjustar = !lineEdits` daba falso negativo en una Oportunidad Ganada cuya línea nunca pasó por costeo real (Etapa Costeo vacía = `esDraftVigente` true) — `lineEdits` por sí solo no basta, hace falta el mismo criterio que ya usa `canAddLines` (`lineEdits && editable`). Corregido a `canAjustar = !canAddLines && rol`.
  - **Hallazgo importante, sin resolver, pendiente decisión de Efraín**: el modo "dividir" crea un subitem nuevo (`createSubitem`), y eso dispara la automatización nativa de Monday `7917410100` ("When a subitem is created, [si Etapa no es 'Nueva oportunidad'] → notificar + mover Etapa a 'En costeo'") — en una prueba real contra OPP-0819 (oportunidad de prueba, Ganada), dividir una línea regresó la Etapa a "En costeo" solos segundos después, sin que el código del portal tocara `deal_stage` en ningún momento (confirmado por `changed_at` de la columna). El modo "editar" (sin crear subitem) NO dispara esto. Pendiente que Efraín decida: ajustar esa automatización de Monday (agregar excepción para Ganada/Perdida), o que el portal reafirme `deal_stage` después de dividir (con el riesgo de carrera contra la automatización), o aceptarlo por ahora.
  - Verificado end-to-end contra Monday real (no solo local): oportunidad de prueba OPP-0819 "PRUEBA Ajustar línea (borrar)" (vendedor y comprador = Efraín, a su pedido), línea real 62070ABR "Camisa Taclite Pro Manga Larga Mujer" (dama) con precio $850 puesto a mano. Con la oportunidad Ganada: (1) modo editar cambió el producto a 72175 "Taclite Pro Long Sleeve Shirt" (caballero) — mismo caso real de Ricardo — precio intacto en $850, sin nueva versión, chip `.1` visible; (2) modo dividir partió la línea en 12+8 con colores distintos, total conservado ($17,000 = $850×20 en ambas líneas), chip `.2` visible; (3) impersonando a Pam (compras@mexicanadeproteccion.com, rol compras real) vía `X-Impersonate-Email`, cambió el color de una línea — el ajuste quedó auditado con SU email, no el del admin que impersonaba, chip `.3`. Precio nunca cambió en ninguno de los tres ajustes. `tsc --noEmit` limpio en los 3 tsconfigs (salvo dos errores preexistentes de otra sesión en `admin.ts`/`boards.ts`, no tocados aquí) y 107 tests de vitest limpios tras el fix. La oportunidad de prueba (OPP-0819) se borró de Monday al terminar, a pedido de Efraín.
  - Sobre el hallazgo de la automatización `7917410100`: Efraín pidió ajustarla directo en Monday, pero las herramientas disponibles (MCP monday.com) solo crean automatizaciones nuevas o activan/desactivan/borran las existentes — no hay forma de editar su condición sin arriesgar duplicar o romper la notificación real que ya usa Compras. Se intentó la vía segura (editar como borrador, sin publicar) y no aplica a este tipo de automatización de board. Queda pendiente que Efraín le agregue a mano la condición "Etapa no es Ganada y no es Perdida" en Monday (Automatizaciones del board Oportunidades) — cambio de 30 segundos en la UI — o que pida el workaround de código (reafirmar `deal_stage` tras dividir, con el riesgo de carrera ya documentado).

- Cotización: aviso "Falta detalle de embellecimiento" cuando la línea está marcada "Con Embellecimiento" sin posiciones capturadas
  - Efraín reportó (con captura de la tab Cotizaciones) que marcar "Con Embellecimiento" en una línea sin tener ninguna posición capturada en la tab Embellecimientos no se avisaba en la grid — el server ya rechaza "Mandar a costeo" en ese caso (`validateLinea`, `worker/lib/costeo.ts`), pero el vendedor solo se enteraba hasta intentar el envío.
  - `getLineWarnings` (`gridMeta.tsx`) ahora replica el mismo check (`explodeEmbellecimiento` sobre `long_text_mm1bj4pt`) para que el aviso ⚠ viva en la línea, mismo patrón que "Falta descripción"/"Falta color". Solo aplica en variant `venta` (mismo alcance que el server).
  - Verificado con casos de vitest (con posiciones / sin posiciones / marcado "Sin Embellecimiento") y `tsc --noEmit` + 107 tests limpios. No se pudo verificar visualmente contra la oportunidad de la captura (OPP-0810) — el buscador del portal solo indexa cliente/vendedor/comprador, no folio.
  - Nota de concurrencia: el working tree traía cambios sueltos de otra sesión activa (`shared/dto.ts`, `CotizacionTab.tsx`, `MobileQuoteRow.tsx`, `QuoteRow.tsx`, `VersionChips.tsx`, `apiClient.ts`, `worker/lib/quoteVersions.ts`, `worker/routes/oportunidades.ts`, `worker/schema.sql`, más `AjustarLineaModal.tsx`/`worker/lib/lineaAjustes.ts` sin trackear) — se dejaron sin commitear, solo se stageó `gridMeta.tsx`.
- Login: los admins ya no quedan encerrados por el gate de teléfono
  - Incidente real minutos después del deploy anterior: `salinasefrain@mexicanadeproteccion.com` (admin) entró a producción, el gate le pidió teléfono, escribió uno que YA estaba guardado en otra cuenta (`identity.phone` es `UNIQUE`) y el 409 lo dejó atorado — sin poder llegar a Configuración, que es la ÚNICA pantalla que puede resolver ese choque. El gate se había diseñado sin salida para ese caso.
  - Fix: `App.tsx` ahora también salta el gate cuando `me.role === 'admin'` (además del caso ya existente de impersonación) — un admin sin teléfono sigue entrando normal y puede capturarlo cuando quiera desde Configuración, donde además ya puede ver qué cuenta tiene cada número. Vendedor/compras/almacén siguen bloqueados hasta capturarlo, que es el objetivo original de Efraín.
  - Pendiente para Efraín, fuera de este fix: identificar y liberar la cuenta que ya tenía guardado `5554369433` (no se pudo consultar D1 de producción desde aquí — el token de Cloudflare del repo no tiene permiso de D1; usar Configuración → Usuarios del portal, ya accesible, para buscarlo).
  - `tsc --noEmit` y 107 tests limpios.
- Configuración: arreglado `PUT /api/admin/identities/:email` — guardar el teléfono de una fila ya existente siempre fallaba
  - Encontrado probando en producción el bug anterior de este mismo día: Efraín entró a Configuración → Usuarios del portal a capturar un teléfono en una fila ya importada y le salió el toast "No se pudo guardar el teléfono" — para CUALQUIER usuario, no solo ese, siempre.
  - Causa: `IdentityRow.save()` (SettingsPage.tsx) manda solo `{ phone }` al editar una fila existente — nunca mandó `mondayUserId`/`role`/`active` (eso lo llena `MondayUserRow` al importar por primera vez). El endpoint trataba el body como el registro completo y exigía `mondayUserId is required` (400) si faltaba, así que ese guardado nunca pudo funcionar. Bug preexistente, no de este commit.
  - Fix: `worker/routes/admin.ts` ahora hace un merge real contra la fila existente (`getIdentityByEmail`, nuevo en `dal.ts`) — cualquier campo ausente en el body conserva su valor en D1 en vez de exigirse o borrarse; solo cuando no hay fila previa (alta nueva) sigue exigiendo `mondayUserId`. De paso corrige que `active` se reactivaba solo por editar el teléfono, aunque el usuario estuviera dado de baja.
  - Probado en vivo contra el worker local (ya corriendo): `PUT` solo con `phone` sobre una fila real conservó `mondayUserId`/`role`/`nombre` intactos; se revirtió el dato de prueba al terminar. `tsc --noEmit` y 107 tests limpios.
- Login: obliga a capturar el teléfono de WhatsApp antes de usar el portal
  - Efraín: quiere que nadie quede logueado sin registrar el celular que usa en WhatsApp — hoy `identity.phone` es opcional y solo un admin lo llena a mano en Configuración, así que cualquiera podía entrar al portal sin quedar ligado al bot (`worker/wa/store.ts` responde 403 a números no registrados).
  - El login en sí es 100% Cloudflare Access (Google, dominio de la empresa) sin ningún formulario propio del portal donde meter un campo — así que el gate va DESPUÉS de Access: `App.tsx` revisa `me.phone` (nuevo campo en `MeDTO`) y, si es `null`, bloquea toda la UI con `PhoneGateScreen.tsx` (pantalla de pantalla completa, sin sidebar ni datos, solo el input) hasta guardarlo. Se salta durante impersonación (`me.impersonatedBy`) — un admin viendo "como" otra cuenta solo está mirando, no tiene por qué llenar el teléfono ajeno.
  - Nuevo endpoint self-service `PUT /api/me/phone` (`worker/routes/boards.ts`): el propio viewer guarda SU teléfono (valida 10 dígitos; solo toca `phone`, nunca rol/activo). `identity.phone` ya era `UNIQUE` en el schema — si el número ya está ligado a otra cuenta, el insert falla y el endpoint responde 409 con mensaje legible en vez de un 500.
  - `useMe.ts` ganó un mini pub/sub (`refreshMe()`) para que, al guardar el teléfono, todo `useMe()` montado (Sidebar, el propio `App.tsx`) se entere sin que cada quien tenga que refetchear por su cuenta.
  - Verificado en vivo con Playwright contra los dev servers ya corriendo: con `phone: null` en dev, el portal muestra el bloqueo de inmediato; al capturar un número válido y guardar, desbloquea y carga la app normal. El teléfono de prueba se revirtió a `null` al terminar para no dejar basura en el D1 local. `tsc --noEmit` y 107 tests de vitest limpios.
- Nueva oportunidad: revertido el borrador local de "+ Agregar línea" — vuelve a crear el subitem de inmediato
  - Efraín, urgente, con screenshot: el borrador local del commit de esta misma mañana (ver bullet de abajo) rompió el flujo por completo. Al elegir producto+color+cantidad la línea se disparaba sola en cuanto quedaba "completa" (justo al escribir la cantidad), lo que además de sorprender al usuario **deshabilitaba los tres campos a la vez** (`disabled = d.saving` en `DraftLineRow`) — "no puedo cambiar la cantidad, se traba". Cuando esa creación automática fallaba, el error genérico ("No se pudo crear la línea", sin detalle — el front descartaba el mensaje real del server) dejaba la fila atorada.
  - Probado en vivo contra el endpoint real (`curl` directo a `POST /oportunidades/:id/productos` con el mismo payload que manda el picker: `productoItemId`+`color`+`cantidad`) — respondió `200 ok` sin problema. El endpoint nunca estuvo roto; el bug estaba en el front disparando el POST en el momento equivocado (justo cuando el usuario todavía estaba interactuando) y escondiendo cualquier error real detrás de un mensaje genérico.
  - Fix: se revirtió `CotizacionTab.tsx`/`worker/routes/oportunidades.ts` a como estaban antes de ese commit — "+ Agregar línea" vuelve a crear el subitem vacío de inmediato (con su fila-esqueleto "Agregando línea…") y producto/color/cantidad se editan como cualquier línea ya existente: PATCH por campo, cantidad solo al perder foco (no por cada tecla), cada campo con su propio `disabled` (nunca los tres a la vez). El fix de fondo que SÍ era correcto de ese mismo commit —`fieldGen` en `RowEditState` (gridMeta.tsx), que evita que un PATCH de producto lento pise un color elegido después mientras seguía en vuelo— se mantuvo intacto: el bug original que motivó el commit ("elijo producto, color y cantidad, se quita el producto y el color") sigue arreglado. Se borraron `DraftLineRow.tsx` y su test por quedar sin uso.
  - Verificado en vivo con Playwright contra una oportunidad real (OPP-0512) que YA tenía líneas a medio llenar del propio Efraín intentando reproducir el bug: se agregó una línea de prueba, se confirmó que el campo de cantidad NO se deshabilita mientras se escribe, se eligió producto+cantidad y ambos persistieron con una sola línea nueva (no dos). La línea de prueba se borró al terminar, dejando las 3 líneas originales del usuario intactas. `tsc --noEmit`, `oxlint` y 107 tests de vitest limpios.
- Nueva oportunidad: "+ Agregar línea" ya no manda nada a Monday hasta que la línea está completa
  - Efraín, tras el fix de reintentos/race de ayer, seguía viendo el bug real: *"cuando eligo un producto el color y la cantidad, de repente se quita el producto y el color"*. Propuso él mismo la solución: no mandar nada a Monday — ni siquiera crear el subitem — hasta que la línea esté "verde" (producto + color + cantidad).
  - **Causa encontrada en el código, no solo suposición.** "+ Agregar línea" creaba un subitem vacío al primer clic y cada campo (producto, color, cantidad) disparaba su propio PATCH + refetch por separado. Si el usuario los llenaba rápido, esas escrituras quedaban concurrentes: `onProductoPick` guarda con `alsoClear:[COLOR_COL]` para limpiar un color que ya no aplica al producto anterior, pero si el usuario elegía un color NUEVO mientras ese PATCH de producto seguía en vuelo, la limpieza llegaba DESPUÉS y borraba el color recién elegido (a veces junto con el producto, si además una respuesta `load()` vieja resolvía tarde y pisaba todo el snapshot — ver abajo).
  - **Fix principal — borrador local sin red (`DraftLineRow.tsx`, nuevo):** "+ Agregar línea" ahora agrega una fila puramente local (sin id de Monday). Producto/color/cantidad se capturan ahí sin ningún PATCH ni POST; un efecto en `CotizacionTab.tsx` dispara UNA sola creación (`POST /oportunidades/:id/productos`, extendido para aceptar producto+color+cantidad juntos) en cuanto la línea queda completa — color solo se exige si el producto tiene colores configurados en el catálogo (si no, se quedaría atorada para siempre). Si la creación falla, el borrador se queda con sus datos y un botón "Reintentar" — antes un error dejaba un subitem vacío huérfano en Monday.
  - **Fix secundario, para líneas YA creadas:** cambiar el producto de una línea existente pasaba por el mismo `alsoClear` peligroso. Nuevo `fieldGen` en `RowEditState` (gridMeta.tsx) — un contador por campo que sube cada vez que el usuario lo edita directamente; `onProductoPick` captura el valor de `fieldGen[COLOR_COL]` antes de guardar y su `alsoClear`/`preview` al terminar solo aplican si nadie tocó el color mientras tanto.
  - **Fix de fondo, independiente:** `load()` en `OpportunityDrawer.tsx` (el refetch tras cada `onSaved`) no tenía ninguna protección contra respuestas de red fuera de orden — con 2-3 GETs en vuelo (uno por campo editado), el más viejo podía resolver DESPUÉS de uno más nuevo y pisar `item` con un snapshot anterior. `loadSeqRef` descarta cualquier respuesta que no sea la del `load()` más reciente.
  - `tsc --noEmit`, `oxlint` y 118 tests de vitest limpios (11 nuevos para `isDraftComplete`/`draftColorOptions`). **Verificado en vivo, no solo en tests**: con los dev servers ya corriendo, se creó una oportunidad de prueba real, se abrió con Playwright y se repitió el flujo reportado (elegir producto, color y cantidad en sucesión rápida) — cero requests hasta que la línea quedó completa, UNA sola llamada de creación con los tres valores correctos, persistidos tras recargar la página. También se probó cancelar un borrador a medias (cero requests) y la vista mobile. La oportunidad y línea de prueba se borraron de Monday al terminar.

## 2026-07-30

- P. venta sugerido (Costeo/Validación): calcularlo siempre en el portal, nunca fiarse de la columna de Monday
  - Efraín, con screenshot: la columna "P. venta sugeri..." salía en `$0` en todas las líneas.
  - Causa: `numeric_mm2qzzbe` es un número interno de cmp-tallas que en la práctica se queda guardado en `0` (no vacío), y el fallback ya existente en el portal (`suggestedPrecio23`) solo se activaba cuando la celda venía **vacía** (`cellValue` devuelve `'—'`) — un `0` guardado nunca disparaba el cálculo propio.
  - Fix: `QuoteRow.tsx`/`MobileQuoteRow.tsx` ya no miran el valor crudo de Monday para esta columna — siempre calculan localmente con `suggestedPrecio23` (`gridMeta.tsx`).
  - La fórmula en sí no cambió: Utilidad% = 1 − MargenGob% − CostoTotalC/U/Precio, despejada para Utilidad% = 23. Se intentó primero simplificarla a "23% de margen total repartido entre utilidad y margen gob" (independiente de Margen Gob), pero Efraín corrigió: Margen Gob cuenta como costo, no se resta del 23% — se revirtió a la fórmula original con `margenGobPct` como input.
  - `tsc --noEmit` y 107 tests de vitest limpios.
- **`04d5765`** — Nuevos productos: persistir propuestas de Ventas y avisar al comprador
  - Efraín reportó (con screenshot) que el tab "Nuevos productos" del drawer de Oportunidad no guardaba nada: al cambiar de tab o refrescar, la lista de propuestas volvía a estar vacía. Causa real: el componente era puro placeholder de UI (`useState` local, comentario propio del archivo lo admitía) — nunca existió tabla, endpoint ni fetch detrás del botón "Agregar producto".
  - Nuevo módulo nativo en D1 (`worker/lib/productosPropuestos.ts`, tabla `producto_propuesto` lazy-create): no hay board de Monday detrás porque nombre+descripción+imagen no encajan en ninguna columna existente, así que no se sincroniza al mirror ni al outbox (mismo patrón que `documents.ts`/Inventario). `GET`/`POST /api/oportunidades/:id/productos-propuestos`, imagen subida a R2. El `POST` exige `scope: 'own'` como cualquier endpoint que muta.
  - A media sesión Efraín pidió, además, que al proponer un producto se avise a Compras "como en Monday": un update que taggea al comprador. Se implementó apuntando al comprador REAL asignado a esa oportunidad (columna "Compras", `multiple_person_mm03qyw9`) y no a todo el rol — `create_update` en Monday @mencionándolo más una notificación en la bandeja "Importantes" del portal; best-effort (nunca tira el guardado) y no-op silencioso si la oportunidad no tiene comprador asignado.
  - Frontend (`NuevosProductosTab.tsx`) reescrito para hacer fetch al montar y `POST` real al guardar, con estado de guardando/error; recibe `oppId` desde `OpportunityDrawer.tsx` (antes no se pasaba, consistente con que nunca hubo intención de cargar datos remotos).
  - Verificado: `tsc --noEmit`, `oxlint` y 107 tests de vitest limpios. Levantados los dev servers y abierto el drawer real (OPP-0795) con Playwright — el tab carga y el `GET` responde `{"productos":[]}` sin errores de consola. No se probó el `POST` contra Monday real para no disparar una mención/notificación real a la compradora asignada (Elizabeth Ocaña Roldan) solo por verificar.
- **`97d0e0b`** — Costeo: bloquear el pre-check si una línea "Con Embellecimiento" no tiene posiciones capturadas
  - Efraín, con screenshot de la tab Embellecimientos: una línea marcada "Con Embellecimiento" sin ninguna posición capturada — pidió que el botón "Mandar a costeo" ni siquiera dejara avanzar, no solo que el envío real lo rechazara después.
  - El envío real (`enviarACosteo` → `validarCosteo`, flujo de cmp-tallas) ya rechazaba este caso — Efraín lo confirmó probándolo ("manda error, excelente"). El hueco era que `checkCosteo`, el pre-check de solo lectura que alimenta `costeoReady` y deshabilita el botón en `OpportunityDrawer.tsx`, no espejaba esa regla — solo validaba producto/cantidad/color/ficha comercial por línea.
  - `validateLinea` (`worker/lib/costeo.ts`) ahora también revisa, por línea: si `color_mm1b34bg` (EMB_STATUS_COL) es "Con Embellecimiento" pero `explodeEmbellecimiento` sobre `long_text_mm1bj4pt` no trae ninguna zona llena, agrega un error con el tag `#N "nombre"` de la línea — mismo patrón que los demás checks de esta función.
  - `tsc --noEmit` (el único error preexistente en `boards.ts` es anterior a este cambio, confirmado con `git stash`) y 107 tests de vitest limpios.

- **`4703d6e`** — Nueva oportunidad: acotar reintentos de creación y evitar que un refresh pise una edición reciente
  - Efraín, con screenshot de una línea recién agregada en "Nueva oportunidad": *"esta super mal la creacion de nuevas oportunidades, cuando hago un cambio se tarda mucho o luego simplemente no se guarda y se regresa"*. Propuso como solución un modelo local-first (todo instantáneo, Monday como "promesa" async) o, alternativa más chica, un botón manual "Sincronizar con Monday".
  - **Se investigó antes de tocar código** (agente Explore): editar un campo de una línea existente YA es instantáneo — pasa por el outbox (`worker/lib/outbox.ts`), que aplica el write al mirror D1 de forma sincrónica y manda la mutación a Monday en `ctx.waitUntil`, sin bloquear la respuesta. Lo lento eran dos cosas que NO pasan por el outbox porque necesitan el id real de Monday de vuelta para que el front navegue: crear la oportunidad (`createRecord.ts`/`createOportunidad.ts` vía `create_item`) y "+ Agregar línea" (`create_subitem`). Un botón manual de sync no arreglaba esto — en el momento de presionarlo seguirías esperando el mismo round-trip, y hacerlo de verdad instantáneo (ids locales temporales + reconciliación) es el trabajo grande y sin terminar de la rama dormida `native/salir-de-monday` (ver `[[native-independence-layer]]`); se descartó por desproporcionado para el bug real.
  - **Causa 1 — lentitud real:** `createItem` (usado por crear oportunidad y "Duplicar") corría con el `maxRetries` default de `gql()` (4, backoff exponencial) — un rate-limit de Monday podía sumar varios segundos a un flujo que el usuario espera en vivo. Se acotó a `maxRetries: 1` en las tres llamadas user-blocking (`createRecord.ts`, `duplicateOportunidad.ts`), mismo criterio ya aplicado a `createSubitem` el 2026-07-20 (nota ya existente en el código: "reported ~15s adds").
  - **Causa 2 — el "se regresa":** `pullFromMonday` (drawer al abrir con `?fresh=1`, botón "Refrescar") solo se protegía con una ventana de 3s sobre `synced_at`. Si el outbox tardaba más que eso en confirmar contra Monday, un refresh podía leer el valor VIEJO de Monday y pisar en el mirror D1 la edición que el usuario acababa de hacer. Nueva `hasPendingWrites()` en `dal.ts`: si el item (o alguna de sus líneas, vía `parent_item_id`) todavía tiene filas `pending`/`sent` en el outbox, `pullFromMonday` se salta el pull — el mirror ya tiene el valor correcto y el outbox lo confirma solo cuando Monday responda.
  - No se tocó el flujo de "+ Agregar línea" en sí (crear subitem sigue siendo una llamada en vivo, ya acotada a 1 reintento desde 2026-07-20) — convertirlo en optimista de verdad exige ids temporales, el mismo trabajo grande de Plan 3.
  - `tsc --noEmit` (3 tsconfigs), `oxlint` y 107 tests de vitest limpios.

- **`9013833`** — Condiciones de cotización: solo Compras en Costeo, movida bajo los productos
  - Efraín, con screenshot del bloque "Condiciones de la cotización" (condiciones comerciales, tiempo de entrega, vigencia): moverlo debajo de las líneas de producto, y que solo esté activo para Compras en el board Costeo — no se ve en Oportunidades.
  - Se preguntó lo que el mensaje no aclaraba: si admin también debía verlo (sí, mismo patrón `compras || admin` ya usado para `canConfirm` en `CotizacionTab`) y qué pasaba en el resto de boards de pipeline como Validación (queda oculto ahí también — solo Costeo).
  - `CondicionesCotizacion` vivía fijo antes de la grid en las dos ramas de `CotizacionTab` (con/sin líneas) y sin ningún gate de board o rol. Se movió al final de ambas ramas (tras el grid/mensaje vacío, mobile y desktop) y se agregó el prop `showCondiciones`, calculado en `OpportunityDrawer.tsx` como `readOnlyCosteo && (role compras || admin)` — reusa `readOnlyCosteo` que ya distingue Costeo de Validación (`COSTEO_VARIANT_BOARDS` los trata igual para la grid, pero no para este bloque).
  - `tsc --noEmit` y `oxlint` limpios (solo warnings preexistentes de fast-refresh sin relación).

- **`f817e4a`** — Cerrar el gate de board: ventas no lista Proveedores
  - Efraín, en corto: *"OJO los vendedores. NO PUEDEN NUNCA ver nada de costos. Por ejemplo en el board productos ven todas las columnas es un error grave. Corrigelo cuanto antes. VENTAS NO PUEDE VER NADA de costeo ni proveedores"*.
  - **El board Productos NO estaba filtrando mal.** Verificado en vivo contra el worker local con `X-Dev-Email` de un vendedor real: `GET /api/boards/productos/items` devuelve 11 columnas (SKU, Marca, Color, Unidad, descripciones, Grupo, Tallas JSON) y **nunca** Costo Distribuidor, Moneda, Gastos de envío/importación, Descuento Distribuidor, Historial de precios, Proveedor, Proveedor ID ni Razón Social Proveedor. Lo que se ve "con todas las columnas" es la sesión local: `.dev.vars` trae `DEV_EMAIL=salinasefrain@…`, que es **admin**. Los 14 vendedores en el D1 remoto tienen rol `vendedor` correcto (se consultó).
  - **La fuga real era otra y sí era grave: el board Proveedores completo.** Cualquier vendedor sacaba los **98 nombres de proveedores** con un solo `GET /api/boards/proveedores/items` — más su detalle, sus updates de Monday y sus adjuntos. El sidebar lo escondía (`role_board_access`), pero eso es solo decluttering del nav; la API no tenía ningún gate.
  - **Causa.** El filtrado era **solo por columna** (`serialize.ts` + `visibility.ts`) y el **`name` del item viaja SIEMPRE en el ItemDTO**. Un board 100% interno para el rol respondía `cols: {}`… con todos los nombres dentro. `dal.scopeFor()` tampoco ayudaba: `proveedores` no tiene `authzCols`, así que cae en `1=1` para todos.
  - **Fix.** `canReadBoard()` en `shared/visibility.ts` — un board sin **una sola** columna legible para el rol es interno — y `boardFor()` en `worker/routes/boards.ts` lo aplica en las **10** rutas `/api/boards/:slug/*` (lista, detalle, crear, PATCH, DELETE, refresh, updates GET/POST, adjuntos POST/GET). Responde **404**, no 403: para ese rol el board no existe.
  - **De paso, un hoyo aparte:** `DELETE /api/boards/:slug/items/:id` era la única ruta de ese archivo que **no miraba al viewer** — cualquier autenticado podía borrar **cualquier** item de Monday sabiendo su id. Lleva el mismo guard de scoping que refresh/updates.
  - **Almacén.** El rol no tenía ninguna columna legible en ningún board, así que el gate le hubiera roto el picker de "Nuevo movimiento" de inventario (usa los nombres de Productos). Se le dieron **solo** `name`, SKU y Nombre Producto del catálogo — ni costos ni proveedor. Es la única línea de whitelist que se movió y queda a revisión de Efraín.
  - **Tests nuevos** en `shared/visibility.test.ts`: `canReadBoard` por rol y board, y un **barrido por TÍTULO** de toda columna legible por vendedor contra `/costo|proveedor|distribuidor|margen gob|utilidad|historial precios/` — si mañana alguien mete una columna de costo al grupo del vendedor, truena aunque el id sea nuevo. Excepciones explícitas y comentadas: "Etapa Costeo" y las fechas de costeo (estado del flujo, no importes) y las fechas de entrega del proveedor en `proyectos_sub` (cuándo llega la mercancía, no quién la surte) — **si Efraín las quiere fuera también, se quitan de la whitelist y se borra el `continue`**.
  - Verificado en vivo, no solo en tests: vendedor → **404** en proveedores (lista, detalle, updates y DELETE), compras → 200 igual que antes, oportunidades/productos del vendedor intactos. Barrido de todas las respuestas del vendedor (detalle de oportunidad, versiones, costeo-check, validación-check, proyecto) buscando los 23 ids de costo/proveedor: **cero**; control con compras: sí aparecen, o sea el barrido detecta. 107 tests, `tsc --noEmit` en los 3 tsconfigs y `oxlint`, todo corriendo **sobre el árbol del commit aislado** (worktree aparte), no sobre el working tree.
  - **Enredo de concurrencia, el peor hasta ahora.** La sesión concurrente estaba editando `worker/routes/boards.ts` al mismo tiempo (zonas de ventas) y **commiteó el archivo completo en `07cc787`, llevándose mis cambios adentro** — pero sin `shared/visibility.ts`, que es donde vive el `canReadBoard` que ese archivo importa: **`07cc787` quedó pushcado a `main` sin compilar**. Este commit cierra eso (por eso el mensaje habla solo del export). Además, mientras se verificaba, esa sesión **reescribió `main` local** (reset a `88e7e24` + su commit de log), así que su `main` local quedó divergido de `origin/main`; este commit se subió como **fast-forward sobre `origin/main`**, sin force y sin tocar sus refs locales. Su `log.md` local (entrada de `88e7e24`) no está en esta versión del archivo: al reconciliar hay que unir las dos.

- **`07cc787`** — Zonas de ventas: el líder ve (solo lectura) lo de su equipo
  - Efraín: *"yo solo pudiera ver mis cotizaciones y las de mi equipo, Mich y las de su equipo, Ray y las de su equipo, Zeus y Zeus por ejemplo… Rich es el jefe de una ZONA entonces hay que poner esta lógica en la parte de configuración"*. Se le presentaron tres modelos (zonas con nombre / jefe directo por persona / cadena recursiva) y eligió **zonas con líder**, porque es como habla del negocio y cambiar de líder no obliga a editar persona por persona.
  - **Las otras dos decisiones también fueron suyas**, preguntadas antes de escribir código: el líder **solo LEE** lo de su equipo (no edita), y las **notificaciones no cambian** — no le llueven avisos de la zona. La alternativa "ve y edita como propias" era de hecho más fácil de implementar (es el scope de siempre, ampliado); se descartó para que un jefe no pise el trabajo de su vendedor por accidente.
  - **Lectura y escritura son dos scopes distintos, y ese es todo el cambio.** `dal.getItem(..., mode)` con `'read'` (lo propio + la zona que lidera) y `'own'` (estrictamente lo propio). Sin esa separación el feature era trivial y peligroso: el write path (`submitWrite`) usa **el mismo `getItem` que las lecturas**, así que ampliar el scope a secas le habría dado al líder permiso de escritura sobre todo su equipo, en silencio.
  - **Lo que pide `'own'`:** el PATCH genérico (outbox), mandar a costeo, mandar a validación, duplicar oportunidad, nueva versión / restaurar versión, generar cotización, crear línea, subir imagen de embellecimiento, generar la solicitud de costeo y las tres acciones de Proyectos. Responden **404, no 403** — la propiedad nunca se filtra. Caso que había que cazar a mano: `enviarACosteo` **no hacía `getItem`**, delegaba en `checkCosteo` (lectura), así que se le puso guard explícito (`ownsItem`); sin él, el líder disparaba el flujo real de cmp-tallas sobre una oportunidad ajena.
  - **La membresía se guarda por email pero se resuelve a `monday_user_id`**, porque una misma persona puede tener dos filas de identity (login de trabajo + gmail personal) con el mismo id de Monday — el mismo caso que ya obligó al `GROUP BY` de `listVendedores`. Así el líder lidera con cualquiera de sus dos logins y el miembro suma con los dos.
  - **El ETag de listas ahora lleva el conjunto de ids visibles** (`u10.22.33`, no `u10`). Con la llave vieja, mover a alguien de zona no invalidaba nada: el líder se quedaba con la lista cacheada hasta que el board cambiara por otro motivo.
  - El scope se resuelve **una vez por request** en `mw/identity.ts` y viaja en el viewer (`Identity.scope_user_ids`), para no pegarle a D1 en cada `getItem`; con impersonación se calcula sobre el **suplantado**. `readableUserIds` **falla cerrado**: si las tablas aún no existen, el viewer se queda con su scope de siempre en vez de tumbar toda la lectura. El bot de WhatsApp arma su viewer aparte (`wa/store.ts`) y recibió el mismo cálculo — si no, la web le mostraba la zona y el bot le contestaba solo con lo suyo.
  - **UI:** tarjeta *Zonas de ventas* en Configuración (crear, líder, miembros con checkboxes, eliminar) y el drawer se abre en solo lectura sobre lo ajeno con un aviso de **de quién es** la oportunidad — sin ese renglón, una oportunidad de la zona se ve idéntica a una propia pero sin botones, y parece que el portal se rompió. El flag viene del server (`ItemDetailDTO.ownedByViewer`), calculado con **el mismo predicado** que usa el write path.
  - **Verificado contra el worker local, no solo con tests**: Rich (director comercial) pasó de **172 → 258** oportunidades al volverse líder de Mich y Ray; Mich (miembro) se quedó en 27 y Zeus (sin zona) en 71, o sea a quien no lidera no le cambió nada. Sobre una oportunidad de Mich: GET 200 con `ownedByViewer: false`, y PATCH / enviar-costeo / DELETE / duplicar → **404**. Nombre de zona repetido → 409, email fuera del roster → 400. Capturas de Configuración a 1440px y 390px. La zona de prueba se borró del D1 local al terminar.
  - 14 tests nuevos (`worker/lib/dal.test.ts`: `ownerIdsFor`, `leadsOthers` y el predicado SQL, incluido que un subitem se scopea por el **padre** y que `'own'` nunca hereda la zona). `tsc` en los 3 tsconfigs y `oxlint` limpios.
  - **Enredo de concurrencia y cómo quedó reconciliado (2026-07-30).** Este trabajo se commiteó **dos veces en paralelo**: `8cc347a` en la sesión local y `07cc787` en la concurrente, que es el que quedó en `origin/main`. El `07cc787` se llevó `worker/routes/boards.ts` completo, arrastrando el `boardFor`/`canReadBoard` en vuelo de la otra sesión **sin** su `shared/visibility.ts`: `main` quedó pushcado sin compilar hasta que `f817e4a` exportó `canReadBoard`. Al reconciliar se descartó la rama local (`8cc347a` + sus dos commits de log) porque `origin/main` ya era **superconjunto**: árbol idéntico al working tree salvo `log.md`. Lo único que se perdía era esta entrada de bitácora, que es la que estás leyendo — reinsertada apuntando al hash que sí existe en `main`. Respaldo de la rama descartada en el tag `respaldo-main-local-20260730`.
  - **Pendiente de aplicar el schema a la D1 remota** (`zonas`, `zona_miembros`) antes de que el feature sirva en producción; mientras tanto, `ensureZonaTables` las crea al primer uso desde Configuración.

- **`88e7e24`** — Moneda editable por línea y apartado de IVA en Costeo
  - Efraín, con screenshot de la grid de Costeo (la columna Moneda con "MXN" subrayado en varias líneas): *"veo que no se puede modificar la 'moneda' en algunos productos ejemplo cosas de bomberos nos pasan el costo en Dolar y otras veces en peso y asi con otros productos. Necesitamos poder modificar moneda en costeo"*, y enseguida: *"Tambien en costeo: no trae el apartado del IVA"*.
  - **Causa de la moneda: no era un bug de UI.** La columna que pintaba la grid (`lookup_mm11t8gj`) es un **mirror** de la Moneda del producto en el catálogo (Productos `text_mkzp59zf`, vía la relación "Producto (auto)") y **Monday no deja escribir espejos**. Por eso la celda salía como chip de solo lectura mientras el resto de la fila sí se editaba, y por eso tampoco servía "hacerla editable": el write habría sido aceptado por el portal y rechazado por Monday.
  - **Decisión de Efraín (se le presentaron las dos opciones):** columna propia por línea, no editar el catálogo. Editar `text_mkzp59zf` desde la línea habría cambiado la moneda de **todas** las cotizaciones que usan ese SKU, incluidas las históricas — el mirror es en vivo. Se creó vía MCP `color_mm5s709s` **"Moneda (línea)"** en Subelementos de Oportunidades (18395657607), status con **MXN/USD/EUR/GBP** (las cuatro que ya existen en el catálogo: 1,247 productos, mayoría MXN, ~20 USD, 2 EUR, 1 GBP). `shared/column-meta.gen.ts` se regeneró con `scripts/introspect-boards.mjs` — de paso entraron labels nuevas que Monday ya tenía ("En tránsito" en Estado del producto, dos colores más en el catálogo).
  - **Herencia, para no migrar nada.** `monedaDe()` devuelve la moneda de la línea si existe y si no la del catálogo, marcada como heredada; el selector la muestra como **"MXN (cat.)"** y elegir del menú la vuelve explícita de esa línea. Las miles de líneas viejas siguen viéndose igual sin tocarles un dato.
  - **La moneda no mueve números por sí sola** — el tipo de cambio es "Valor de Conversión", que compras captura a mano. Efraín eligió dejarlo manual **con aviso**: si la moneda no es MXN y la conversión sigue en 1, la línea levanta **⚠ Falta conversión**. Sin eso, un costo en dólares se multiplica por 1 y toda la cadena (costo total, utilidad, precio sugerido) sale ~19x baja sin que nada lo grite.
  - **IVA: faltaban las columnas y faltaba el input.** `Subtotal`/`IVA`/`Total Con IVA` (`formula_mkznmjh6`/`formula_mm0rtdqp`/`formula_mm00xy0n`) solo estaban en `GRID_COLS_VENTA`; ahora también en `GRID_COLS_COSTEO` (Costeo y Validación) con sus totales en la fila TOTAL. Y el **% de IVA por línea** (`numeric_mm0cg0bm`, 16 en todas) **no estaba en `shared/visibility.ts`**, así que el server lo borraba del DTO: ni se veía ni `previewRow` podía calcular el IVA local (le llegaba 0). Quedó `vis: V` (el vendedor ya ve las tres fórmulas, ocultarle el % no protegía nada) y `w: WAC`.
  - El total de venta colgaba de la columna **"P. venta"** —que es C/U— como sustituto del Subtotal que no existía; se movió a `Subtotal`, su columna real, para no pintar el mismo número en dos celdas contiguas.
  - `onEtapaCosteoChange` se generalizó a **`onStatusChange(product, colId, label)`**, compartido por Etapa Costeo y Moneda en `QuoteRow` y `MobileQuoteRow` (mismo patrón de "guarda al elegir" que Color: un `<select>` no tiene blur de confirmación).
  - **Verificado end-to-end contra Monday** (a diferencia del commit de ProductPicker, aquí sí se ejecutó el write): PATCH desde el portal en la OPP-0714 (EQUIPAMIENTO BOMBEROS ESTADO PUEBLA — justo el caso que citó Efraín) → outbox → la API de Monday devolvió `color_mm5s709s` = `{"index":1}` (USD) → `?fresh=1` → la línea 1 pintó "USD" y apareció "⚠ Sin confirmar • Falta conversión". **El dato de prueba se revirtió** (la línea volvió a heredar MXN del catálogo, confirmado en el mirror). Capturas en desktop 1600px (grid, encabezados y fila TOTAL: $560,780 subtotal · $89,725 IVA · $650,505 con IVA) y móvil 390px.
  - 8 tests nuevos (`moneda.test.ts`: herencia línea→catálogo, preview local, y las cinco ramas del aviso de conversión) + 2 en `visibility.test.ts` que anclan que **el escribible es `color_mm5s709s` y NUNCA el mirror**. `tsc --noEmit` y `oxlint` limpios.
  - Commit selectivo, con el tree más cargado de trabajo ajeno hasta ahora (zonas de embellecimiento, gate de boards internos, SettingsPage, schema): se armó en un **índice temporal** (`GIT_INDEX_FILE` + `git apply --cached` hunk por hunk en `visibility.ts` y `visibility.test.ts`) para no tocar el índice de la otra sesión, que tenía archivos ya staged. El árbol resultante se extrajo aparte y se verificó solo: `tsc` limpio, 89 tests.
- **`15a8e56`** — Condiciones comerciales, tiempo de entrega y vigencia por cotización
  - Efraín: *"no me parece el apartado para agregarle condiciones comerciales, tiempo de entrega y vigencia a la cotizacion. En costeo esto es esencial NO ES POR PRODUCTO es por cotizacion así que agrégalo en un lugar fácil de modificar. Ojo pon la opción de placeholder o sea un texto por defecto después te los paso"*. Y no era que estuviera escondido: **las columnas existían en Monday desde siempre pero no tenían UI en el portal** — se editaban solo entrando a Monday.
  - **Sin columnas nuevas.** "Condiciones comerciales" es `long_text_mm1m416j` (*Comentarios cotización*) — lo aclaró el propio Efraín al responder la pregunta de dónde guardarlas; más `text_mm0gjrrd` (Tiempo de entrega) y `text_mm0gje0` (Vigencia). Las tres son del **item**, no de las líneas, que es justo lo que pedía ("no es por producto").
  - **`shared/quoteTerms.ts`** (nuevo) es el único archivo a tocar para cambiar los textos: id de columna + label + `fallback`. Los defaults los dio él en el chat: el bloque de CONDICIONES COMERCIALES completo, `45 Días hábiles` y `20 Días naturales`. Los asteriscos de `**CONDICIONES COMERCIALES**` se dejaron a propósito — así está capturado hoy en Monday (verificado en OPP-0601), no son formato del mensaje.
  - **El default NO se escribe solo.** Se pinta como `placeholder` gris mientras el campo está vacío y hay un link *"Usar texto por defecto"* que lo inserta y guarda. Se decidió así para no pisar los valores editados a mano, que son la mayoría.
  - **Permisos: compras y admin escriben, el vendedor solo lee** (Efraín, contestando la segunda pregunta: *"compras y admin"*). Estaban como `w: WV` (vendedor+admin) desde el build inicial y nunca se habían ejercido. Anclado en `shared/visibility.test.ts` con el mismo patrón que el candado del precio de venta.
  - **La hipótesis de Efraín sobre los defaults resultó cierta y se midió**: *"como son campos por defecto, creo que monday los escribe así que siempre van a estar puestos (es mi opinion)"*. De las **619 oportunidades** del mirror, solo **13** tienen las condiciones vacías (10 sin tiempo de entrega, 9 sin vigencia) — y de esas 13, cuatro son filas de prueba (`TEST EFRA`, `DEBUG ROW…`) y el resto licitaciones o de las más viejas. O sea el placeholder casi nunca se va a ver; lo que gana el bloque es la edición sin salir del portal. Se le reportó y su respuesta fue *"asi se queda esta perfecto todo libre y que se modifique aqui y se vaya a monday"*.
  - Hallazgo lateral que quedó **sin actuar, a decisión suya**: el tiempo de entrega trae ~8 grafías del mismo valor (`45 Días hábiles` ×195, `45 a 65 Días hábiles` ×60, `45 - 65 Días hábiles` ×46, `45 - 65  Días hábiles` con doble espacio ×20, `45-60 DIAS HABILES`, `45 DIAS HABILES`…). Se ofreció cambiarlo a selector con opciones canónicas y prefirió texto libre.
  - `long_text` viaja sin transformar a Monday (`columnEncode` lo pasa derecho, ya cubierto por test), así que los saltos de línea del bloque se conservan. Verificado con Playwright en OPP-0601 a 1440px y a 390px. `tsc --noEmit` en los 3 tsconfigs y 79 tests **corriendo sobre el árbol del commit aislado**, no sobre el working tree.
  - **Commit selectivo, el más enredado hasta ahora**: la sesión concurrente tenía 23 archivos modificados, **ya stageados en el índice compartido**, y editaba los mismos archivos que este cambio. Se construyó el commit con un `GIT_INDEX_FILE` aparte sobre HEAD para no tocar su índice; de `visibility.ts`, `CotizacionTab.tsx` y `docs/monday-column-map.md` se aplicaron solo los hunks propios, y `OpportunityDrawer.tsx` y `visibility.test.ts` se reconstruyeron a mano desde HEAD porque sus hunks venían fusionados con trabajo ajeno (`!ajena` en el drawer, los tests de Moneda/IVA pegados al final del archivo). Lo suyo quedó intacto en el working tree.

- **`fd92095`** — Bloquear envío a validación de oportunidades sin líneas
  - El cambio ya estaba en el tree sin commitear (sesión concurrente, fechado *"Efraín, 2026-07-24"* en el comentario); se commiteó y deployeó a petición de Efraín — *"eso necesita estar en prod por favor"*— junto con el cambio de sesión de Access.
  - `checkValidacion` (`worker/lib/costeo.ts`) acumula errores **dentro del loop sobre las líneas**: con `lineas.length === 0` el loop no corre nunca, `errors` queda vacío y la función devolvía `ok: true`. O sea una oportunidad **sin una sola línea de producto** pasaba la validación y podía mandarse a "Costeo en validación". Guard de 3 líneas antes del loop: `{ ok: false, errors: ['La oportunidad no tiene líneas de producto.'] }`, que es el mismo shape `EnviarCosteoResult` que ya pinta la UI.
  - 66 tests, `tsc --noEmit` en los 3 tsconfigs y `oxlint` limpios. Deploy por el CI de siempre (push a `main` → `.github/workflows/deploy.yml`), que hace checkout limpio del commit: el WIP grande que la sesión concurrente tenía sin commitear (`shared/quoteTerms.ts`, `CondicionesCotizacion.tsx`, `worker/lib/zonas.ts`, más `schema.sql` y `visibility.ts` modificados) no podía colarse aunque `wrangler.jsonc` sirva los assets del build.
  - Commit selectivo, al revés de las entradas anteriores: aquí lo que se dejó sin tocar fue el WIP de la sesión concurrente, y el `costeo.ts` que ellos venían dejando sin commitear es justo lo que se commiteó.

- **`6f45bab`** — Buscar productos por SKU, nombre o ambos al cotizar
  - Efraín, con screenshot de la cotización en móvil (línea #1 con "72002" tecleado, SKU en "—", "Falta color • Falta descripción • Falta cantidad"): *"hay un problema con el buscador de productos tenemos que poder buscar por SKU nombre o ambos se super flexible"*.
  - **Causa, doble.** El picker era un `<input list="productos-catalogo-cotizacion">` cuyo `<datalist>` solo tenía `name` como valor: (1) el filtrado lo hacía **el navegador**, y en Android prácticamente no filtra — por eso en la captura no ofrecía nada; y (2) `onProductoBlur` resolvía con `catalogIndex(catalog).byName.get(raw.trim().toLowerCase())`, o sea **match exacto contra el nombre completo**. El SKU vive en el nombre del catálogo ("72002 - TDU ® Long Sleeve Shirt"), así que teclear el SKU suelto nunca ligaba y caía al `else`: se guardaba como texto libre en `text_mm0bkm1j`, sin relación → sin SKU, sin descripción y sin colores. Los tres avisos del screenshot son consecuencia de eso, no fallas separadas.
  - **`src/lib/productSearch.ts`** (nuevo, puro, 11 tests): cada palabra del query puede caer en `name`, SKU (`product_and_service_sku`), Nombre Producto (`text_mm0wvga2`) o Marca (`product_and_service_description`) — **AND entre palabras, OR entre campos**, en cualquier orden, sin acentos, sin mayúsculas y sin puntuación (`alnum()` colapsa "5.11 Tactical" y "511tactical", así que `511 bota` encuentra las botas 5.11). Orden por relevancia: SKU exacto → SKU que empieza igual → nombre que empieza igual → palabra del nombre → aparece en algún lado. El índice normalizado se memoiza con `WeakMap` sobre la referencia del catálogo (mismo patrón que `catalogIndex`): 1,247 productos no se re-normalizan en cada tecla.
  - **`src/components/forms/ProductPicker.tsx`** (nuevo): lista en **portal fijo** para que no la recorte el drawer, **se abre hacia arriba** cuando abajo quedan menos de 180px (el teclado del móvil), ancho mínimo de 320px aunque la columna Producto sea angosta, filas de 40px con chip de SKU y marca debajo, navegación con flechas/Enter/Escape. Reemplaza el datalist en `QuoteRow` y `MobileQuoteRow`, que dejaron de recibir `onTextEdit`/`onProductoBlur` a cambio de un solo `onProductoPick`.
  - **La elección ahora es explícita.** Elegir del catálogo escribe la relación real (`board_relation_mkzmafgp`) **por `item_id`**, no por nombre — Monday puebla los mirrors solo. El texto libre sigue existiendo (producto que aún no está en el catálogo) pero ya no ocurre por accidente: aparece como última opción, *"Usar «x» como texto libre"*, y **solo si lo tecleado no es ya un producto real** (`exactProducto` compara nombre completo y SKU). El write path no cambió: mismo `saveCols`, mismas columnas, mismo preview local y mismo limpiado de Color al cambiar de producto.
  - **`worker/lib/dal.ts`**: SKU/Nombre Producto/Marca entraron a `SEARCHABLE_COLS`, y el query dejó de ser **un solo LIKE de la cadena completa** — se parte en palabras (`searchTokens`, tope de 6 porque cada una agrega un `EXISTS`) con AND entre ellas. Esto arregla de paso el buscador del board **Productos** y el de productos en **movimientos de inventario**, donde cualquier query de dos palabras devolvía cero. Verificado contra el worker local: `72002` → 1, `511 bota` y `bota 511` → la misma bota, `tdu shirt` → 5, `5.11 bota` → 5 vía la columna de marca. Ojo: el LIKE de SQL no quita puntuación, así que del lado del server `511` ≠ `5.11` (el picker del cliente sí lo resuelve).
  - Verificado con Playwright contra los dev servers ya arriba, en la OPP-0459 (etapa 4 confirmada con `?fresh=1`; las dos primeras candidatas decían "Nueva oportunidad" en el mirror pero ya iban en "Cotización" en Monday): a **390px** y en **desktop 1440px**, `72002` ofrece "72002 - TDU ® Long Sleeve Shirt" con su chip de SKU y sin opción de texto libre —porque el SKU coincide exacto—, y `511 bota` lista las cinco botas 5.11 con la opción de texto libre al final. 77 tests, `tsc --noEmit` en los 3 tsconfigs y `oxlint` limpios.
  - **No se eligió ningún producto en la UI a propósito**: hacer clic en una opción escribe en una oportunidad real de Monday. El write path quedó cubierto por tests y por ser idéntico al anterior, pero no se ejecutó end-to-end.
  - Commit selectivo: el tree traía `worker/lib/costeo.ts` de la sesión concurrente, se dejó sin commitear.
- **`bb7b3e1`** — Contactos: cada vendedor ve solo los suyos, sin correo ni teléfono
  - Feedback de Efraín sobre la vista Contactos, con screenshot: *"1/ Los vendedores solo pueden ver SUS contactos, ningun otro. 2/ No aparece el correo ni el telefono (por lo pronto escondelos) pero si los puedes agregar al crear un contacto"*.
  - **Scoping.** El board Contactos **no tenía `authzCols`**, así que `dal.scopeFor()` lo dejaba abierto (`1=1`) para todos los roles: cualquier vendedor veía los 673 contactos del CRM. La regla ya existía pero solo del lado del cliente y solo en un lugar — `CreateOportunidadModal` filtra el picker por la columna Vendedor desde el 2026-07-17 (*"un vendedor solo puede poner un contacto SUYO"*). Ahora es del server: `authzCols: ['multiple_person_mm03vqwx']` en `shared/boards.ts` y el mismo predicado que ya usan Oportunidades y Proyectos aplica a `listItems`/`getItem` (y por lo tanto al picker del drawer, `EditClienteModal`). Compras y admin siguen viendo todo.
  - **Backfill obligatorio, ya aplicado en el D1 remoto** (674 filas). `items.vendedor_ids` —la columna que evalúa el scope— se llena en `upsertItem` **a partir de `authzCols`**, así que para Contactos estaba en `[]` en todas las filas; y como `reconcileBoard` corre con `skipIfUnchanged` (compara `content_hash`), **nunca se habría recalculado solo**: los vendedores habrían visto cero contactos hasta que cada uno cambiara en Monday. Se derivó por SQL de la columna Vendedor ya mirroreada en `columns` (idempotente, probado antes en un sqlite de scratch por el caso `value = null`). Resultado: 662 de 673 con vendedor; **quedan 11 contactos sin Vendedor en Monday** que hoy solo ven compras/admin — repartirlos es decisión de Efraín.
  - **Efecto secundario que había que cerrar**: con el board scopeado, un contacto sin Vendedor es invisible **para quien lo acaba de crear**. El form del portal ofrece Vendedor pero es opcional y vive detrás de "Más campos", y el bot de WhatsApp (`crear_contacto`) directamente no manda esa columna. `createRecord.ts` ahora estampa al creador cuando el campo llega vacío, y `CreateRecordModal` lo prellena para que el form muestre lo que va a pasar.
  - `buscar_contactos` del agente (WhatsApp + chat del portal) pasaba por `searchMirror`, que consulta el mirror crudo sin viewer: se cambió a `dal.listItems`, si no el vendedor tenía por chat lo que la UI le acababa de cerrar.
  - **Correo y teléfono**: se ocultan solo de la tabla (`HIDDEN_LIST_COLS` en `GenericBoardView`). **No se tocó `shared/visibility.ts`** —regla dura del repo— así que siguen legibles en el DTO y siguen capturándose en "Nuevo contacto" (ya estaban en `CREATE_FIELDS`); volver a mostrarlos es borrar dos líneas.
  - Verificado contra el worker local con `X-Dev-Email`: vendedor (Angel Omar) **20 contactos**, admin **658** del mismo endpoint. Screenshot de la tabla sin las dos columnas. 66 tests, `tsc --noEmit` en los 3 tsconfigs y `oxlint` limpios.
  - Commit selectivo: el tree traía trabajo de búsqueda de productos de la sesión concurrente (`ProductPicker`, `productSearch.ts`, `CotizacionTab`, `QuoteRow`, `costeo.ts` y dos hunks de `dal.ts`); del `dal.ts` compartido solo se commiteó el hunk del comentario que este cambio invalida.
- **`9e8a144`** — El panel de notificaciones ya no lo recorta el sidebar
  - Efraín, con screenshot: *"el boton de notificaciones esta roto"*. En la imagen solo se veía una esquina blanca del panel asomando junto a la campana, cortada en seco al borde del sidebar colapsado.
  - **Causa.** La campana vive dentro del contenedor con scroll del `Sidebar` (`overflowY:auto` + `overflowX:hidden`) y el popover era `position:absolute` **dentro** de ese contenedor, así que el navegador lo recortaba al ancho de la barra: 220px abierta, **60px colapsada** — justo el caso del screenshot. El comentario que ya traía el código ("abre hacia la derecha, hacia el área de contenido") describía la intención, pero un absolute no puede salirse de un ancestro con overflow oculto por más que se le empuje el `left`.
  - **Fix.** El panel de desktop se renderiza en un **portal a `document.body`** con `position:fixed`, anclado al `getBoundingClientRect()` de la campana — mismo patrón que ya usaba `SearchableSelect`. Posición recalculada al abrir y en `scroll` (capture) / `resize`; clamp horizontal para no salirse por la derecha y `maxHeight` = min(70vh, alto disponible) para ventanas cortas. La hoja móvil no se tocó: ya era `fixed inset:0`.
  - Detalle que se habría roto en silencio: al salir del portal, el panel dejó de estar dentro de `rootRef`, así que el listener de clic-afuera lo habría cerrado **al primer clic dentro del propio panel** (cambiar de bandeja, marcar leído). Se agregó `panelRef` al guard.
  - Verificado en Playwright contra el worker local, con los 4 layouts: sidebar abierto (1400×900), **colapsado** (el del screenshot), ventana corta (1200×520) y móvil 390px; más las interacciones — abre con la campana, clic en la pestaña *Actualizaciones* dentro del panel no cierra, Escape cierra, clic afuera cierra, toggle con la campana cierra. 66 tests, `tsc --noEmit` y `oxlint` en verde.
  - Commit selectivo: el tree traía `worker/lib/costeo.ts` de la sesión concurrente, se dejó sin commitear.
- **`b93cf95`** — Compras ahora edita Costo embellecimiento C/U en Costeo
  - Efraín: *"el costo embellecimiento lo debe cambiar COMPRAS en Costeo"*. La columna (`numeric_mm0gxvpa`, "Costo Total Embellecimento C/U") ya era escribible por compras/admin en el server desde siempre (`w: WAC` en `shared/visibility.ts`) — el hueco era de UI: la grid solo pinta `<input>` cuando la columna está en `writableIds` **y** en `inlineEditableCols`, y esa segunda lista no la incluía. Resultado: era el único costo de la fila que se veía como chip gris de solo lectura, en medio de Costo distr., Desc. %, Conversión y Gastos %, que sí se editan.
  - Fix de una línea en `gridMeta.tsx` (agregar `COL.embellecimiento` al set base). No hizo falta tocar el whitelist —regla dura del repo— ni ninguna rama de render: el input cae en la rama numérica genérica que ya comparten `QuoteRow` y `MobileQuoteRow` (preview local al teclear, PATCH al blur), y `previewRow` ya usaba esta columna en la cadena de costo (`costeoCalc.ts`), así que Costo total C/U, Utilidad y los totales se recalculan al instante.
  - Alcance real del cambio: solo el board **Costeo** para compras/admin. En Validación de Costeo sigue de solo lectura (ahí `precioOnly` deja únicamente P. venta) y el vendedor nunca la ve (grupo `AC`; tampoco está en `GRID_COLS_VENTA`).
  - Verificado: 66 tests, `tsc --noEmit` y `oxlint` limpios. Deploy vía push a `main` (GitHub Actions). Nota de concurrencia: el tree traía `worker/lib/costeo.ts` y `NotificationBell.tsx` de la sesión concurrente — se dejaron sin commitear, el commit lleva solo `gridMeta.tsx`.
- **`0238e80`** — Abrir una oportunidad ahora relee item y líneas de Monday
  - Efraín reportó, en corto y molesto: *"CHECA la validacion de costeo oportunidad 0795 sale la bota con costo 0 y tiene COSTO!"*, y enseguida la regla que importa: *"NECESITO QUE SE REVISE siempre que se ABRA una oportunidad que este 100% igual que monday si no no van a usar la plataforma"*.
  - **Causa.** El detalle del drawer salía 100% del mirror D1 y **nada en la ruta de lectura consultaba Monday**. El mirror solo se entera de un cambio por (a) webhook, que en `worker/sync/webhook.ts` **descarta** —no reprograma— cualquier evento que llegue dentro de 10s del último sync, así que de una ráfaga de compras llenando costos solo sobrevive el primer cambio; o (b) el reconcile del cron, que corre **cada 6 horas**. OPP-0795 se costeó a las 17:54–17:59 del 30/07 y se abrió minutos después: Monday ya tenía Costo Total Unitario 2892.75 / 1627.29 / 695.1 / 638.4 y el portal pintaba los valores viejos. Verificado contra la API de Monday antes de tocar código.
  - Agravante: el botón "Actualizar" del drawer llamaba `refetchItem` (**solo el padre**) con guard de 30s, así que ni refrescando a mano se arreglaban las líneas — que es justo donde viven costos y cantidades.
  - **Fix.** `GET /api/boards/:slug/items/:id?fresh=1` hace `refetchItemTree` (item + subitems) contra Monday **antes** de responder; el scoping por viewer se aplica antes del refetch (nadie dispara pulls de items que no puede ver), hay ventana de 3s para no pegarle dos veces en ráfagas y **fallback silencioso al mirror** si Monday falla o va lento. `POST .../refresh` usa el mismo camino, así que ahora sí baja las líneas.
  - El round-trip a Monday tarda **3–13s** medido en local (la query con `display_value` es cara), así que bloquear la apertura no era opción: el drawer pinta el mirror al instante y **reconcilia enseguida**, con `⟳ verificando con Monday…` en el encabezado en lugar del "sincronizado hace X" (que mentiría mientras corre) y un ref que descarta la respuesta si el usuario ya se movió a otra oportunidad.
  - Verificado con la OPP-0795 real: sin `fresh` el endpoint devolvía **0 líneas**; con `fresh`, las 4 botas con sus costos exactos de Monday (total $2,048,739). Screenshot del drawer y del indicador en Playwright. 66 tests, `tsc` en los 3 tsconfigs, `oxlint` y `build` en verde.
  - **Sin deploy** (tree con `worker/lib/costeo.ts` de la sesión concurrente). Queda como deuda la otra mitad de la causa: el debounce de 10s del webhook **tira** los eventos en vez de reprogramarlos, así que las LISTAS siguen pudiendo mostrar datos viejos hasta el reconcile — cambiarlo toca el presupuesto de rate limit de Monday y es decisión de Efraín.

## 2026-07-26

- **`92cf4df`** — Solicitud de costeo generada por el portal, con acuse automático
  - Efraín aclaró el alcance real de la generación de PDFs mientras probaba lo del día anterior: **las cotizaciones al cliente siguen en Eledo**, el portal no las genera. Lo que quiere saltarse de Eledo son la **solicitud de costeo** y la **OC a proveedores**. Y sobre la firma: *"no es necesario firmar o solicitar firmar, es solo el hecho de que se hizo"*, con el acuse disparándose al dar click en **"Mandar a costeo"**. Respuestas suyas a las dos preguntas de alcance: firma **solo para gente del portal** (nada de links para externos, así que no hace falta la ruta pública que saltaría Access) y **formato propio del portal**, "algo súper mega simple, un PDF con fondo blanco es más que suficiente", **sin imágenes de producto**.
  - Se reemplazó la plantilla `resumen-oportunidad` (invención mía del día anterior, fuera de sus casos de uso) por **`solicitud-costeo`**: las líneas de la oportunidad **sin precios**, que es justo lo que la solicitud pide que compras llene. Anclado en tests — el PDF no debe traer columna de precio, importe ni ningún monto (`expect(text).not.toMatch(/\$[\d,]/)`).
  - **Acuse automático** como concepto nuevo en el contrato (`autoAcuse` + `ATTEST_INTENT`): el documento se asienta al generarse con la MISMA evidencia que una firma —identidad de Access, fecha, IP de Cloudflare, huella SHA-256— pero sin trazo ni consentimiento que aceptar. Esas plantillas llevan `sign: []`, así que la UI no ofrece firmar y la ruta HTTP las rechaza: el acuse **solo lo pone el server** (`attestDocument`, que no pasa por el gate de `sign`). El copy del panel cambió a "Acusado"/"Ver con acuse" en vez de "Firmado"/"Ver firmado", para no prometer una ceremonia que no ocurrió.
  - `POST /api/oportunidades/:id/enviar-costeo` genera y acusa la solicitud en el mismo paso, **best-effort**: si el documento falla, el envío a cmp-tallas ya ocurrió y no se puede deshacer, así que solo se loguea y el vendedor puede regenerarlo a mano desde la pestaña. Regla de reuso afinada: regenerar **reescribe el acuse** (queda una sola solicitud por oportunidad, acusada por quien la generó al final); solo una firma **manual** vuelve inmutable un documento.
  - Antes de escribir la plantilla se bajó y renderizó la solicitud real que hoy produce Eledo (OPP-0717) para no adivinar campos: resultó ser la misma plantilla de la cotización con los precios en $0.00, con imagen de producto, descripción con viñetas, marca/modelo/color, cantidad y unidad. "Modelo" no existe como columna en los subitems, así que no se inventó; se usan SKU (`lookup_mkzn7x9a`), marca (`lookup_mm0xn98d`), unidad (`lookup_mm0w4f4v`), tallas (`lookup_mm19c0b6`) y descripción (`lookup_mm0xw8p7`), todas del mapa aprobado.
  - **Dos bugs de datos encontrados al revisar a ojo la primera solicitud real**, que ningún test de bytes habría cachado: las Tallas del catálogo llegan como un bloque JSON envuelto en fences de markdown y se imprimían crudas (`{"hombre":["CH","M"],"mujer":[],…}` con llaves y comillas, 8 renglones de basura por partida) → `formatTallas` lo aplana a "Hombre: CH, M, G · Mujer: …" omitiendo grupos vacíos y banderas en false; y los `long_text` de Monday usan `,,` como separador de renglón, así que la descripción de embellecimiento salía con ",,Etiqueta del fabricante:" y campos vacíos → `formatMultiline` parte por `,,` y tira los renglones que solo tienen etiqueta. Ambos con tests propios, incluyendo el caso "no es JSON, devuélvelo tal cual".
  - Ajuste de layout del mismo hallazgo visual: marca y color se recortaban con elipsis ("AZUL MARI…", "Risk Top Tacti…"), así que la unidad dejó de tener columna propia y va pegada a la cantidad ("30 Pieza") — casi siempre dice "Pieza" y ese ancho le hacía falta a las columnas que sí varían.
  - También se marcó `signable` la sección **Solicitudes de costeo** de la pestaña Documentación (commit `2e3faff`), que era el caso que Efraín quería probar primero: la constancia ya servía para cualquier key de `/api/files` bajo `oportunidades/`, solo faltaba ofrecerla ahí. Verificado firmando la solicitud real de OPP-0717 traída de Monday.
  - Verificado: **66 tests** (7 nuevos), `tsc --noEmit` en los 3 tsconfigs y `oxlint` limpios; la solicitud de OPP-0717 generada contra el worker local y revisada **a ojo** con `qlmanage` (8 partidas, tallas y embellecimiento legibles, cero montos, acuse en la última página de 3) y la UI en el navegador (badge "ACUSADO", sin botón de firmar). El disparo automático desde "Mandar a costeo" **no** se ejecutó end-to-end a propósito: ese botón corre la automatización real de cmp-tallas y mueve la etapa en Monday, no es algo que se pruebe sobre datos de producción sin permiso.
  - **Pendiente**: la **OC a proveedor** (siguiente pieza para saltarse Eledo) — primero hay que bajar una OC real de un Proyecto para ver qué campos trae y no adivinarlos. Sigue sin deploy.

## 2026-07-25

- **`f0082f5`** — Optimización: menos tokens, grid de cotización memoizada y tests del write path
  - Efraín pidió "dar la vuelta al repo" con tres objetivos: **usar menos tokens** al leerlo, **mejorar la velocidad** y **solidificar el código**, con la restricción dura de que *todo tiene que funcionar exactamente igual* y de que **seguimos escribiendo a Monday**. Se orquestó con 2 subagentes Sonnet en paralelo (auditoría de código muerto / auditoría de perf de React); Claude verificó cada hallazgo antes de aplicarlo — el de perf, de hecho, **corrigió la premisa de la tarea**: el poll de 5 s NO re-renderiza las listas porque `usePoll` ya usa ETag y un 304 deja `data` intacto.
  - **Menos tokens.** `shared/column-meta.gen.ts` era `JSON.stringify(…, null, 2)`: 5 líneas por columna con el `id` duplicado como llave. Ahora una columna por línea — **2523 → 304 líneas** (56 KB → 37 KB) — y grepear un id devuelve title/type/labels en el mismo renglón (antes había que pedir contexto). No se re-introspeccionó Monday: se extrajo el objeto del archivo actual, se re-emitió y se verificó igualdad profunda evaluando ambos como módulos JS. El generador (`scripts/introspect-boards.mjs`) emite ese formato y se volvió importable (`emitColumnMeta`, check de env y `main()` ya no corren al importar). Además, **190 líneas muertas** borradas tras verificación cruzada de cada símbolo: 4 archivos huérfanos (`BoardPlaceholder`, `DocUploadList`, `EditableField`, `InfoGrid`) y 8 exports sin uso. Se dejó fuera, a propósito, `src/data/oportunidades.ts` (~110 líneas muertas del prototipo de diseño): borrar medio archivo de mocks es decisión de alcance de Efraín.
  - **Velocidad.** (1) `worker/lib/serialize.ts`: `toItemDTO` reconstruía el Set de columnas legibles **por fila** — hasta 4000 por request, cada 5 s por usuario; ahora se memoiza por `(board, rol)`, seguro por construcción porque `VISIBILITY` solo se lee y el Set solo se usa con `.has()`. (2) `catalogIndex` en `gridMeta.tsx`: los `catalog.find()` por fila y por render (O(filas × catálogo) en cada tecla, en 4 call sites) pasan por un índice memoizado con `WeakMap` sobre la referencia del array — **sin cambiar ninguna firma**, conservando la semántica exacta de `find()` (gana el primer match; ids no finitos omitidos porque `Number('x') === NaN` nunca hacía match). (3) La fila desktop salió a `cotizacion/QuoteRow.tsx` con `React.memo`, igual que `MobileQuoteRow` (que tampoco estaba memoizada): `visibleCols`/`writableIds`/`editableCols` con `useMemo` y los 10 callbacks estabilizados con un ref a la versión más fresca — **sin tocar el cuerpo de ningún handler**, que es donde vive la lógica fina de concurrencia documentada en `patchRow`/`saveCols`. `CotizacionTab` 797 → 537 líneas. (4) `logo.webp` resultó ser un **PNG de 1000×1000 (301 KB) pintado a 28×28** → WebP real de 256×256, 15.8 KB.
  - **Solidez.** El repo no tenía **un solo test** y CI hacía `tsc` + build + **deploy directo a producción**. Se agregó vitest (`npm test`) con 35 tests sobre lo que el typecheck no puede ver (todo son strings): `canon.ts` — MD5 hecho a mano contra los vectores del **RFC 1321**, más la equivalencia `canonValue(write-shape) === canonValue(read-shape)` que es lo que hace funcionar el echo del outbox, incluido el caso de la doble canonicalización de checkbox; `columnEncode.ts` — un test por forma JSON, con la regla dura `status = {label}` (no `{labels:[…]}`) anclada; `visibility.ts` — fail-closed, escribible ⊆ legible, `almacen` sin acceso a boards de venta. Corren en CI **antes** del deploy.
  - **Hallazgo de permisos (corregido con decisión de Efraín).** `numeric_mkzneg3d` ("Precio de Venta C/U") estaba como `w: WV` = `['vendedor','admin']`, y como `outbox.ts` gatea SOLO con `canWrite()`, **el servidor sí aceptaba un PATCH del vendedor** — lo único que lo detenía era que la UI no pintaba el campo editable. El resto del código ya asumía lo contrario: `quoteVersions.ts` restaura el precio con `trusted: true` justamente porque "no es escribible por vendedor". Se le presentaron 3 opciones a Efraín señalando que esconderle el precio sería un candado cosmético (Cantidad y Subtotal siguen visibles: el unitario se deduce dividiendo); eligió **cerrar solo la escritura**. Ahora `w: WA = ['admin']`: vendedor y compras lo VEN junto con subtotal/IVA/total, pero no lo cambian. Verificado en vivo con suplantación contra un worker aislado en `:8799` (para no tocar el `:8787` de la sesión concurrente): PATCH del vendedor → **403 "cannot write numeric_mkzneg3d"** sin tocar Monday, Cantidad sigue escribible, admin conserva `w: true`.
  - **Dos bugs reales encontrados de paso.** (1) `public/manifest.json` apuntaba el ícono de PWA a `/src/assets/logo.webp`, una **ruta de dev server que 404ea en producción** (Vite reescribe `index.html`, pero `public/` se copia tal cual) — ahora `/logo.webp`. (2) La lógica de colores de línea estaba **duplicada y desincronizada** entre la fila desktop y `MobileQuoteRow`: la copia móvil hacía match solo por NOMBRE, así que nunca recibió el fix del stress test 2026-07-21 (match por relación) y mostraba "Sin colores configurados" en líneas con color válido cuando el mirror llega abreviado ("Camisa Zero" vs "1104 - Camisa Zero"). Unificadas en `colorOptions()`.
  - Verificado `tsc` (3 tsconfigs), `oxlint`, 59/59 tests y `npm run build` en verde, más Playwright en vivo (desktop 1440px y móvil 390px): drawer abre, grid pinta SKU/colores/avisos/totales idéntico al "antes", cero errores de consola. **NO se hizo una escritura real a Monday** — el write path se verificó por tests y por el 403 del gate, pero no se creó ni modificó ningún dato de producción.
  - Fuera del commit a propósito: `worker/lib/costeo.ts` traía un fix sin commitear de la sesión concurrente (guard de oportunidad sin líneas) — commits selectivos, ver [[concurrent-claude-sessions]].

- **`dbe2270`** — Firma electrónica y generación de PDFs en el portal
  - Efraín pidió dos cosas, sin estar presente y con libertad total para avanzar: (1) **firma electrónica de documentos** en el portal y (2) **creación de documentos PDF "como Eledo, pero mucho más simples porque ya tenemos los usecases"**. Se construyeron como una sola pieza porque se apoyan una en la otra: la firma necesita un PDF que el portal controle, y los documentos generados no sirven de mucho si nadie los firma. Doc completa en `docs/documentos-firma.md`.
  - **Decisión de arquitectura clave**: motor de PDF **propio, sin dependencias** (`worker/lib/pdf/`) en vez de traer `pdf-lib`. Dos razones: `package.json` venía sucio de la sesión concurrente (agregarle una dependencia habría barrido sus cambios al commitear), y lo que estas plantillas necesitan son tablas y bloques de texto, no PDFs arbitrarios. El costo aceptado es explícito: el motor **escribe pero no parsea**, así que no se puede estampar una firma dentro de un PDF ajeno — si algún día se quiere eso, ahí sí conviene `pdf-lib` (anotado en la doc).
  - Consecuencia de diseño de ese límite: un PDF que el portal no generó (la cotización que sube cmp-tallas a Monday) **no se modifica**. Se sella una copia en R2 —inmutable aunque Monday cambie después— y la firma vive en una **Constancia de firma electrónica** aparte que referencia su huella SHA-256. Los documentos que sí genera el portal se firman dentro del propio PDF.
  - Lo que sostiene que la firma signifique algo: el documento **guarda su snapshot de datos** (`documents.data`) y el PDF firmado se re-renderiza de ESE snapshot, nunca de una lectura fresca del mirror (si no, el contenido firmado cambiaría bajo los pies del firmante); el `sha256` del PDF base se **re-verifica antes de asentar cada firma** y se rechaza con 409 si el archivo cambió; y cada firma guarda evidencia — identidad autenticada por Access, consentimiento textual aceptado palabra por palabra, IP puesta por Cloudflare, user-agent y el hash exacto. Una firma por persona por documento (índice UNIQUE). El trazo es opcional; la identidad no.
  - 3 plantillas, elegidas sobre datos que el portal **ya tiene** (sin inventar procesos de negocio ni pisar a cmp-tallas): `resumen-oportunidad` (resumen interno con las líneas vigentes, explícitamente NO la cotización al cliente), `remision-inventario` (comprobante de entrega de un movimiento: firma quien entrega y quien recibe) y `constancia-firma`. Agregar otra = tipo de datos + case en `buildBlocks` + entrada en `DOC_TEMPLATES`.
  - Regla de producto que salió de la verificación: **regenerar reemplaza al documento que aún no tiene firmas** en vez de acumular copias (el caso normal es "lo generé, corregí un dato, lo vuelvo a generar"); en cuanto tiene una firma ya no se toca y nace un documento nuevo, porque el anterior es evidencia de algo que alguien firmó. Se descubrió al ver 3 remisiones idénticas apiladas en la UI durante las pruebas.
  - Tablas `documents` / `document_signatures` en D1, creadas **lazy en runtime** (`ensureDocumentTables`, mismo patrón que `api_cache`): la feature enciende sin aplicar DDL en remoto. Están documentadas en `worker/schema.sql` para bases nuevas.
  - Refactor de paso: `worker/lib/portalFiles.ts` extrae el mapa key→columna de Monday que estaba inline en la ruta `/api/files`, para que `documents.ts` lea los mismos bytes al sellarlos sin duplicarlo. De rebote se cerró un hueco chico: `/api/files` servía **cualquier** key que existiera en R2 sin revisar la fuente, y ahora queda limitado al prefijo `oportunidades/` — los PDF de `documentos/…` solo se sirven por su ruta, que sí verifica quién puede ver la fuente.
  - Scoping y whitelist: todo pasa por access+identity y además por el de la fuente (oportunidad vía `dal.getItem`, remisión exige acceso al board `inventario`). El resumen lee el **mirror crudo**, no el DTO ya filtrado, así que aplica `canRead` de `shared/visibility.ts` a mano — un documento nunca imprime una columna que el firmante no podría ver en pantalla (incluido Precio de Venta, whitelist de Efraín del 2026-07-24).
  - UI: `DocumentsPanel` reusable montado en dos lugares (Oportunidad → Documentación, e Inventario → Movimientos → columna *Remisión*), `SignaturePad` con pointer events (dedo, stylus o mouse; exporta **JPEG** porque el writer solo embebe DCTDecode) y `SignDocumentModal`, que **siempre previsualiza el PDF antes de firmar** — nadie firma a ciegas. El modal va en `lazy()` para no arrastrar pdfjs (130 KB gzip) al montar el panel: quedó en 2.6 KB.
  - **3 bugs reales encontrados y corregidos en la verificación**, ninguno visible al typecheck: (1) `pdfString` no degradaba de verdad los caracteres fuera de WinAnsi (un emoji salía crudo y rompía el stream) porque reconstruía desde el carácter y no desde el código ya saneado; (2) el key del archivo llega **percent-encoded** por el body JSON de `/api/documents` pero decodificado por el path de `/api/files`, así que sellar una cotización con acentos en el nombre fallaba con "archivo no encontrado" — se comparan ambas formas y el key se normaliza en la frontera (anclado en `worker/lib/portalFiles.test.ts`); (3) la vista previa del PDF a tamaño completo (~725px) empujaba el pad de firma y el consentimiento fuera de la pantalla — ahora la previa se limita en alto y hace scroll aparte.
  - Verificado: **59 tests** (23 nuevos: estructura del PDF, xref con offsets que de verdad apuntan a cada objeto, `/Length` real del stream, WinAnsi octal, métricas AFM, paginación, determinismo del render —de eso depende el hash sellado— y manejo de keys), `tsc --noEmit` en los 3 tsconfigs y `oxlint` limpios. End-to-end contra el worker local con **datos reales del mirror**: generar, firmar, PDF firmado, el portón de integridad rechazando un PDF base alterado a mano en R2, y el sellado de una cotización real de 480 KB traída de Monday. En el navegador con Playwright, desktop y 390px. Los PDF se revisaron **a ojo** renderizándolos con `qlmanage` (motor de PDF de macOS) — no solo aserciones de bytes.
  - **Sin deploy** (regla de CLAUDE.md): el árbol trae cambios sin commitear de la sesión concurrente. Commit selectivo — de `CLAUDE.md` y `docs/code-index.md` se stageó **solo lo mío**, dejando sus ediciones intactas en el working tree.
  - Pendiente de Efraín cuando lo revise: si quiere que la cotización firmada **suba a Monday** (columna "Cotizaciones Firmadas", `file_mm0zjras`) al firmarla — hoy la firma no escribe nada a Monday a propósito, no se quiso mutar un board sin su OK. Ya existe `addFileToColumn` para hacerlo en un solo paso.

## 2026-07-22

- **`b541783`** — Agente de inventario en WhatsApp para logística (rol `almacen`)
  - Efraín pidió un agente en WhatsApp para que logística **agregue o dé de baja inventario** usando "el mismo formulario que ya tenemos", solo conversando. Interpretación aclarada con él antes de construir (2 preguntas): (1) cubrir **los 4 tipos** de movimiento (Entrada/Salida/Transferencia/Consolidación), no solo Entrada/Salida — "agregar/eliminar" mapea a que entra/sale stock, y una corrección de conteo va como Consolidación (el ledger es append-only, no hay borrado de filas); (2) **escritura = `almacen` + `admin`**, con `compras` quedándose **solo-consulta** como en el portal (decisión suya de whitelist).
  - "Mismo formulario" resuelto reusando la lógica compartida, sin reimplementar reglas: `crear_movimiento` (nueva tool en `worker/lib/assistantTools.ts`) llama a `createMovement` de `worker/lib/inventory.ts` — la MISMA función que usa el form del portal, así que `validateMovementEndpoints` (qué almacén lleva cada tipo), folio autoincremental y `captured_by = identity.nombre` salen idénticos. Tool acompañante `listar_almacenes` para que el agente obtenga ids reales de almacén y nunca los invente.
  - Cuarta persona `almacenPrompt` en `worker/lib/assistantPersonas.ts` (antes el rol `almacen` caía al prompt de vendedor, el más restringido): inventario-only (no ve pipeline ni oportunidades), pregunta un dato a la vez, y **exige confirmación explícita** antes de capturar (mismo patrón que crear_oportunidad). `REGLAS_INVENTARIO` documenta al modelo qué almacén requiere cada tipo (Entrada=destino, Salida=origen, Transferencia=ambos, Consolidación=exactamente uno según alza/baja). Gating en `TOOL_ROLES`: lectura de inventario + `listar_almacenes` + `buscar_productos` = almacen/compras/admin; `crear_movimiento` = almacen + admin; `runTool` revalida el rol (defensa en profundidad). Persona de admin también actualizada para mencionar la captura.
  - Verificado `tsc --noEmit` + `oxlint` limpios. End-to-end en local vía `/wa/dev-chat` con una identidad `almacen` temporal: saludó con la persona correcta, buscó "playera" en el catálogo y desambiguó 8 modelos, resumió, esperó confirmación y **escribió el movimiento** (fila en `movements` con folio autogenerado, `captured_by` y `destination_id` correctos). Como el worker de la sesión concurrente en `:8787` estaba colgado, se levantó un worker **aislado en `:8799`** para no tocarlo; identidad y movimiento de prueba borrados después. Sin cambios de schema ni de secrets — infraestructura existente.
  - Alta de un usuario de almacén (pendiente de Efraín, decisión suya): una fila en `identity` con `role='almacen'` y `phone` (mismo mecanismo de whitelist de vendedores). Deploy pendiente cuando él lo decida.

- **`d7235b6`** — Centro de notificaciones del portal (Importantes + Actualizaciones)
  - Efraín pidió un centro de notificaciones "rock solid" partido en dos bandejas: **Importantes** (te mencionaron en una actualización, o un costeo salió con datos faltantes/inválidos) y **Actualizaciones** (la oportunidad cambió de etapa). Decisiones suyas al aclarar alcance: Importantes = **solo** menciones + costeo incompleto (descartó writes fallidos y errores de automatización); destinatarios de cambios de etapa **role-based por etapa**; entrega **solo campana del portal**; y **solo menciones hechas desde el portal** — las menciones nativas de Monday se **pospusieron** (requerirían suscribir `create_update` en `scripts/create-webhooks.mjs` y re-correrlo contra Monday en vivo).
  - Arquitectura rock-solid: tabla `notifications` en D1 (solo D1, no se espeja a Monday); `worker/lib/notify.ts` es el **único emisor**, idempotente por `dedupe_key` UNIQUE + `INSERT OR IGNORE` (reintentos de webhook y re-corridas de reconcile nunca duplican) y todo **best-effort** (try/catch → `sync_log`, jamás rompe el sync/write path). Los cambios de etapa se detectan por **diff en el único cuello de sync** (`worker/sync/upsert.ts` lee el `deal_stage` previo antes de sobreescribir y llama `maybeEmitStageChange`), con el reconcile de 6h de backstop si se pierde un webhook. Menciones y costeo se emiten sincrónicamente desde su handler (`worker/routes/boards.ts` POST update / `worker/routes/oportunidades.ts` enviar-costeo), donde ya se conoce actor y destinatarios.
  - Ruteo de destinatarios como data en `shared/notifications.ts` (`STAGE_NOTIFY` + selectores `owner`/`role:x`/`actor`/`mentioned`) — whitelist que Efraín tunea; nunca auto-notifica al actor, fail-closed ante ids/roles desconocidos.
  - API `worker/routes/notifications.ts` scoped a `viewer.email` (impersonation-aware): `GET /api/notifications` (ETag/304 para polling barato, conteo de no-leídas siempre por ambas bandejas), `POST /:id/read`, `POST /read-all`. Frontend: `useNotifications` (polling ETag 12s, pausa en pestaña oculta, optimista) + `NotificationBell` (badge rojo con conteo de Importantes / punto sutil si solo hay Actualizaciones; popover en desktop, hoja full-screen en móvil) en Sidebar + MobileTopBar, y `NotificationCenter` con las 2 bandejas. Leer = click en la fila (marca leída + deep-link a la oportunidad) o "Marcar todo como leído". Retención: prune de leídas >30d en `reconcileAll`.
  - Construido con 2 subagentes Sonnet (backend / frontend) sobre una fundación de contratos, a pedido de Efraín. Verificado `tsc --noEmit` + `oxlint` limpios y en vivo con Playwright (desktop + 390px, ambas bandejas, marcar leída). Un bug real encontrado y corregido en la verificación: el popover de desktop se anclaba a la derecha dentro del sidebar de 220px y se salía del borde izquierdo — ahora abre hacia el área de contenido. Tabla aplicada a D1 **local**; **pendiente aplicar el DDL a D1 remoto** (`wrangler d1 execute`) en el próximo deploy.
  - Arquitectura a futuro para WhatsApp (solo diseño, sin construir): el emisor único ya es el punto de fan-out. Para sumar push por WhatsApp después basta con (1) una política `WA_NOTIFY` como data en `shared/notifications.ts` (qué severities/kinds salen por WA — p.ej. solo Importantes), (2) una columna `wa_sent_at` en `notifications` para idempotencia de envío, y (3) un pequeño *drainer* en el cron existente que tome las filas pendientes con `phone` (identity ya lo trae) y las mande con `worker/wa/send.ts sendText`, marcando `wa_sent_at` — mismo patrón outbox que ya usa el repo, desacoplado del emit (best-effort, con reintentos). Ningún call-site cambia.

## 2026-07-21

Sesión de optimización pedida por Efraín (rama `optimizacion/tokens-y-writes`, no `main`): (1) usar menos tokens al trabajar el repo con Claude vía código reutilizable + un índice, (2) escribir a Monday más rápido, (3) preparar la salida de Monday — el punto (3) se **pospuso** por decisión suya tras revisar las opciones; alcance de (1) conservador (extracciones seguras, sin reescribir archivos grandes) y (2) "ambos" (camino de sync + auditoría de UI óptimista). Se orquestó con 2 subagentes Sonnet (worker / UI) + 1 Haiku (índice); Claude revisó cada diff antes de commitear. Plan en `~/.claude/plans/spicy-wishing-pine.md`.

- **`86d5287`** — Fix: botón "Salir" dejaba al usuario en "Invitado" en vez de mostrar login
  - Efraín reportó que el botón "Salir" no "sacaba de verdad" — lo dejaba en un estado de "Invitado" en vez de llevarlo a una pantalla de login.
  - Causa raíz: `apiFetch` (`src/lib/apiClient.ts`) solo permite **un** auto-retry de sesión de Access por pestaña (`ACCESS_RETRY_KEY` en sessionStorage, mecanismo del fix `9fedd65`). Cuando ese único intento no bastaba para recuperar una sesión válida (el redirect a `/cdn-cgi/access/logout` + vuelta no siempre re-autentica en un solo salto), cualquier 401/403 posterior se tragaba en silencio: cada componente (`UserChip.tsx`, tabs sueltos) hacía su propio `catch(() => setMe(null))` y mostraba "Invitado" sin ninguna pista de que hacía falta reintentar — de ahí que pareciera necesitar un segundo clic "mágico" en un botón chiquito ya mal etiquetado (dice "Salir" cuando ya no había sesión que cerrar).
  - Se verificó en vivo contra la API de Cloudflare que `auto_redirect_to_identity` de la app "CMP Portal" ya estaba en `false` (cambiado el mismo día, fuera de este repo/sesión, sin documentar) — no era la causa; el problema estaba en el frontend, no en la config de Access.
  - Fix: nueva señal global `src/lib/sessionState.ts` (`markSessionExpired`/`useSessionExpired`) que `apiClient.ts` dispara justo cuando se agota el auto-retry (401, o 403 específico de "pide acceso" de `mw/identity.ts` — los 403 de "forbidden por rol" no la disparan, a propósito). `App.tsx` tapa toda la UI con `SessionExpiredScreen.tsx` ("Tu sesión terminó" + botón "Iniciar sesión" que reusa `logout()`) en cuanto se dispara, en vez de dejar cada board en un estado ambiguo. `UserChip.tsx` de paso deja de hacer su propio `getMe()` aparte (competía con el resto de la app por el único retry) y pasa a usar el hook compartido `useMe()`.
  - Verificado con `tsc --noEmit` (limpio, 3 tsconfigs) y en local con Playwright (sin errores de consola, chip normal — Access no aplica en localhost así que el round-trip real solo se pudo probar en prod). Deploy manual (`wrangler deploy`, sin pasar por `main`/CI) para que Efraín lo probara en `portal.mexicanadeproteccion.com`.

- **`ca6495f`** — Auto-retry acotado en `SessionExpiredScreen` + límite real encontrado en Access/Google
  - Tras probar `86d5287` en vivo, Efraín reportó que seguía haciendo falta un segundo clic: el primero sí disparaba el logout de Access, pero la pantalla quedaba "estática" (mostrando la app normal, como si nunca hubiera cerrado sesión) hasta que interactuaba de nuevo con algo.
  - Diagnóstico por descarte con Efraín (sin acceso a un trace de red real): confirmó que durante el estado "estático" seguía viendo la app completa (sidebar, tableros), no una pantalla de login ni la de `SessionExpiredScreen` — es decir, Google lo reautenticaba **en silencio con la misma cuenta** antes de que la sesión de Access quedara realmente cerrada. Es el mismo bug de fondo ya diagnosticado en `9fedd65` (Google SSO reafirma la sesión sin pedir credenciales), reapareciendo pese a que `auto_redirect_to_identity` ya está en `false` — ese ajuste solo controla si Access muestra su propio selector de IdP en vez de saltar directo a Google; no tiene ningún efecto sobre si Google, una vez ahí, decide reautenticar solo o pedir cuenta de nuevo.
  - Se investigó si el IdP "Google" de Access (`f111580b-37b9-4583-a86e-498da8315ece` — ver [[cmp-portal-access-setup]]) permite forzar `prompt=select_account` de Google sin cerrar toda la sesión: verificado vía API (`GET /accounts/{id}/access/identity_providers/{idp}`) que el config de ese IdP solo expone `client_id` + `redirect_url`, sin ningún parámetro de `prompt`. **Conclusión: no hay forma soportada por Cloudflare Access de forzar el selector de cuenta de Google sin el logout encadenado de Google completo que ya se probó y revirtió en `92e7618`** (mismo efecto colateral: cierra Gmail/Drive/etc., no solo el portal).
  - Efraín decidió **dejarlo como quedó** (no reconsiderar el logout de Google encadenado) sabiendo esta limitación real — el auto-retry acotado (`SessionExpiredScreen.tsx`, hasta 2 reintentos automáticos con pausa de 1.5s antes de pedir clic manual, guardado en `sessionStorage` bajo `cmp:sessionScreenAutoRetries` para no loopear infinito si de plano no hay acceso) sigue siendo una mejora real para el caso de sesión genuinamente expirada — sigue sin resolver (ni puede resolverse desde el portal) el caso de Google con sesión activa reautenticando en silencio con la misma cuenta; workaround para cambiar de cuenta sigue siendo Incógnito o cambiar de cuenta a mano en el navegador.
  - Deploy manual (`wrangler deploy`) para pruebas en vivo.

- **`9fedd65`** — Fix: botón "Salir" no hacía nada (sesión de Google pegada a cuenta vieja)
  - Efraín reportó que nadie podía loguear correctamente y que el botón "Salir" (`UserChip.tsx`) no reaccionaba al click, tanto en `portal.mexicanadeproteccion.com` como en local.
  - Descartado primero lo obvio: el team domain de Access (`mexicanaproteccion.cloudflareaccess.com`), el AUD de la app "CMP Portal" y la policy "CMP Team" (`email_domain = mexicanadeproteccion.com`) coinciden exactamente con lo configurado en vivo en Cloudflare (verificado vía API con `CF_ZT_TOKEN`) — no había typo ni desync de AUD.
  - Causa raíz real: `logout()`/`recoverFromAccessSession()` (`src/lib/apiClient.ts`) solo pegaban a `/cdn-cgi/access/logout`, que limpia la cookie de **Access** pero no cierra la sesión de **Google**. La app de Access tiene `auto_redirect_to_identity: true`, así que en cuanto la pestaña volvía a la app, Access disparaba de inmediato un login de Google que Google resolvía en silencio con la misma cuenta ya logueada en el navegador — de ahí que "Salir" pareciera no hacer nada (ni en portal, donde Access está de por medio; en local no hay sesión de Access que cerrar, así que ahí el guard `isBehindAccess()` sigue devolviendo un no-op esperado, no es un bug).
  - Primer intento (revertido en `92e7618`): encadenar además un logout de Google (`accounts.google.com/logout`) antes de volver a Access. Efraín lo probó y reportó que lo sacaba de **toda** su sesión de Google (Gmail, Drive, etc.), no solo del portal — efecto colateral peor que el bug original. Se revirtió a solo limpiar la cookie de Access, que es lo único que este botón puede hacer sin tirar sesiones ajenas al portal.
  - Workaround real para cuenta equivocada: ventana de Incógnito, o cambiar de cuenta de Google a mano en el navegador — el botón "Salir" del portal no puede (ni debe) forzar eso.
  - Verificado con `tsc --noEmit` (limpio, 3 tsconfigs).

- **(sin commit de código — fix de datos en D1 prod)** — Causa raíz real del "no puedo loguear": faltaba la tabla `role_board_access` en producción
  - El botón "Salir" (arriba) resultó ser un distractor: sí funcionaba como se esperaba dentro de sus límites. El bug real reportado por Efraín ("nadie puede loguear correctamente") seguía sin explicarse hasta revisar `wrangler tail` en vivo.
  - Causa raíz: la tabla `role_board_access` (`worker/schema.sql`, agregada el 2026-07-18 en `26cf57e` — feature de accesos a boards por equipo) **nunca se creó en D1 de producción**, solo quedó en el schema del repo. `GET /api/me` llama a `getBoardAccess(env, viewer.role)` (`worker/lib/boardAccess.ts`) sin try/catch; para cualquier rol no-admin (vendedor/compras/almacén) eso dispara `SELECT ... FROM role_board_access` contra una tabla inexistente → `D1_ERROR: no such table` sin capturar → el request de `/api/me` fallaba → el frontend (`UserChip.tsx`) lo interpretaba como "Invitado". Los admins nunca lo veían porque su rol hace bypass hardcoded de esa consulta (`if (role === 'admin') return [...BOARD_KEYS]`) — de ahí que el bug pareciera intermitente/imposible de reproducir para Efraín como admin.
  - Confirmado en vivo con `wrangler tail` contra prod: se vio el error exacto `D1_ERROR: no such table: role_board_access` durante una sesión de impersonación (admin viendo como `ventaspeninsula@mexicanadeproteccion.com`, rol vendedor) y se verificó con `SELECT name FROM sqlite_master WHERE type='table'` que la tabla no existía en el D1 remoto.
  - Fix: se corrió directo contra D1 prod (`wrangler d1 execute --remote`) el `CREATE TABLE IF NOT EXISTS role_board_access` y el `INSERT OR IGNORE` de seed, tal cual ya estaban en `worker/schema.sql` desde el 07-18 — no hubo cambio de código, solo la migración pendiente que nunca se había aplicado en vivo. 21 filas sembradas, verificadas con `SELECT`.
  - Lección para no repetir: `worker/schema.sql` no tiene ningún mecanismo que garantice que un `CREATE TABLE` nuevo se aplique a D1 remoto al mergear — quedó como deuda pendiente desde `26cf57e` casi 3 días sin que nadie lo notara (bloqueaba silenciosamente a todo el personal no-admin).

- **`b98f823`** — Fix: producto fantasma en Cotización por líneas de Monday borradas sin webhook
  - Efraín reportó vía URL (`/validacion/11942923806`, OPP-0282) que el portal mostraba 3 productos y Monday solo 2.
  - Causa raíz: `scripts/create-webhooks.mjs` nunca registraba el evento `subitem_deleted` de Monday (solo `create_subitem`/`change_subitem_column_value`) — al borrar una línea de producto directo en Monday (no vía outbox del portal), el Worker nunca se enteraba y la fila quedaba huérfana en el mirror D1 para siempre. Confirmado en vivo: `webhooks(board_id: 18395657596)` no traía ese evento, y D1 tenía una 3ra subitem (`11943233281`, "Bota Táctica") que ya no existe en Monday (verificado con `items(ids:...){ subitems }`).
  - Fix: `worker/sync/webhook.ts` ahora trata `subitem_deleted` igual que `item_deleted` (borra la fila del mirror); `subitem_deleted` sumado a `SUBITEM_EVENTS` en `create-webhooks.mjs` para que futuras re-registraciones lo incluyan. Se registró el webhook faltante en vivo contra Monday (Oportunidades `18395657596` y Proyectos `18395657594`, los dos boards con subitems).
  - Limpieza inmediata: se borró la fila fantasma de D1 para OPP-0282 (el fallback de `refetchItem` ya la habría limpiado solo con el webhook nuevo registrado, pero se adelantó a mano).
  - Verificado con `tsc --noEmit` (limpio, 3 tsconfigs). Deploy hecho (`wrangler deploy`) para que el manejo explícito de `subitem_deleted` quedara activo.
  - **Auditoría completa a pedido de Efraín**: se comparó el conteo de subitems del mirror D1 contra Monday en vivo para las 626 oportunidades existentes (batches de 25 vía API, script en `/tmp`, no en el repo). Resultado: **19 oportunidades con 56 líneas fantasma en total** (mismo patrón — huérfanas, no hubo ningún caso de líneas faltantes ni de oportunidades borradas con mirror vivo). Varias coinciden con oportunidades "CLON"/"copy" (ej. OPP-0756 con 16 fantasma, OPP-0705 con 7, IDs casi consecutivos — consistente con un lote duplicado que se deshizo directo en Monday). Con autorización de Efraín se borraron las 56 filas exactas de D1 (mismo `DELETE` puntual, verificadas 1 a 1 contra `subitems` real de Monday antes de borrar). Re-auditoría posterior: 0 inconsistencias en las 626.

- **`510ab16`** — Fix: 4 bugs encontrados en stress test de Oportunidades (2026-07-21)
  - Efraín pidió un stress test completo del pipeline de Oportunidades (creación → costeo → validación → cotización → Ganada) con 13 oportunidades de prueba reales contra Monday, vía Playwright, buscando bugs — incluyó una con 25 líneas de producto. Un bug crítico (Ganar/Perder/Archivar 403 por falta de `w` en `deal_stage` de `shared/visibility.ts`, más el índice numérico crudo en vez del label) se corrigió durante esa misma sesión con autorización explícita de Efraín (commit previo). Este commit corrige los 4 bugs restantes, encontrados y verificados con evidencia real (API de Monday, no solo el mirror) durante ese mismo stress test.
  - **Outbox — condición de carrera real**: `submitWrite` (`worker/lib/outbox.ts`) hacía read-modify-write en JS (leer la fila completa, mutar el arreglo de columnas en memoria, `UPDATE` del blob entero) — dos PATCH concurrentes a la misma línea pero columnas distintas (ej. Color y Cantidad, cada edición dispara su propio request) podían leer el mismo snapshot antes de que cualquiera escribiera, y el que terminaba después pisaba por completo el cambio del otro. Confirmado con pérdida de dato real en Monday (no solo el mirror) durante el run de 25 líneas. Fix: UPSERT atómico por columna usando funciones JSON1 de SQLite (`json_each`/`json_group_array`/`json_insert`) dentro de un solo `UPDATE`, sin ventana entre lectura y escritura. Verificado disparando dos PATCH concurrentes reales contra D1 local — ambos campos quedaron guardados.
  - **Key duplicada de React en selects de Vendedor/Compras**: `listVendedores` (`worker/lib/dal.ts`) no deduplicaba — Efraín tiene dos filas en `identity` (login de trabajo y gmail personal, mismo `monday_user_id`), así que salía dos veces en la lista. Fix: `GROUP BY monday_user_id`. Verificado con Playwright: 0 errores de key duplicada (antes 3).
  - **Botón "Mandar a costeo" atascado**: el precheck (`checkCosteo`/`checkValidacion` en `OpportunityDrawer.tsx`) solo se re-ejecutaba cuando cambiaba el `item` cacheado en el cliente, pero columnas mirror que Monday calcula async (ej. ficha comercial, tras ligar un producto) pueden tardar en sincronizar al mirror D1 sin que nada dispare un refetch — con 25 líneas el botón nunca se reactivaba salvo recargando la página entera. Fix: poll de respaldo cada 8s mientras el chequeo siga en `false`, se detiene solo en cuanto queda listo.
  - **"Sin colores configurados" en línea ya costeada**: en `CotizacionTab.tsx` el color disponible se resolvía buscando en el catálogo por coincidencia exacta de nombre contra el mirror mostrado (`lookup_mm0x4kda`), pero ese mirror puede llegar abreviado (confirmado contra Monday real: mirror = "Camisa Zero", catálogo real = "1104 - Camisa Zero", con colores NEGRO/AZUL MARINO/KHAKI correctamente configurados) — el match fallaba en silencio y mostraba la lista de colores vacía aunque el dato guardado fuera correcto. Fix: resolver el producto de catálogo por el `linked_item_ids` real de la relación (`linkedProductoId`), no por nombre; solo cae a texto libre cuando la línea no tiene relación (producto sin match en catálogo).
  - Verificado con `tsc --noEmit` (limpio, 3 tsconfigs) y `oxlint` (sin warnings nuevos). Las 13 oportunidades y la línea de prueba usadas para verificar quedaron archivadas (`Cancelada`) al terminar.

- **`d7655aa`** — Fix: fondo de fila en grid de Costeo se perdía al hacer scroll horizontal
  - Reportado por Efraín con captura: en Costeo/Validación, al hacer scroll horizontal hacia columnas como Utilidad/Utilidad %/Avisos, el fondo blanco (o rosa en filas con avisos) de la línea desaparecía y se veía el fondo crema de la página detrás.
  - Causa: el wrapper de fondo de cada fila (`CotizacionTab.tsx`, el `<div>` que envuelve grid+error+detalle) es un bloque plano sin `width: fit-content`, mientras su grid hijo sí lo usa (`gridWrapStyle`) para medir el ancho real de las columnas. Al no compartir ese ancho, el wrapper quedaba clippeado al ancho visible del contenedor con scroll, y el contenido del grid (que sí se extiende más allá) mostraba el fondo de la página en vez del suyo.
  - Fix: aplicar `gridWrapStyle` también al wrapper de la fila, mismo patrón ya usado en header/TotalsRow. Verificado con Playwright contra un item real de Costeo (OPP-0724): scrolleando al extremo derecho, el fondo (blanco o rosa) ahora cubre toda la fila hasta Avisos.

- **`be35c60`** — UI: renombrar columna Margen a Utilidad % y agregar columna Utilidad (total)
  - Pedido de Efraín: la última columna de la grid de Costeo/Validación, "Margen" (`formula_mkznpw5p`), pasa a llamarse "Utilidad %" — mismo dato (% ponderado utilidad/subtotal), el label del portal estaba desfasado del nombre que ya tiene esa columna en Monday (`column-meta.gen.ts` ya la traía como "Utilidad (%)"). Ojo: "Margen Gob %"/"Margen Gob Total" es otra cosa, no se tocaron.
  - Columna nueva "Utilidad" (`formula_mkznry25`, money) justo antes: ya existía en el mirror y en el whitelist de `visibility.ts`, solo no se pintaba en `GRID_COLS_COSTEO`. `TotalsRow` suma el total y lo colorea igual que el %.
  - Verificado con `tsc -b` (3 tsconfigs, limpio) y captura real contra un item con costeo real (dev server local, `/costeo/<id>`): headers y color del TOTAL (rojo con margen negativo) correctos.
  - Hallazgo aparte, no corregido (fuera de alcance): en filas sin margen calculable, la propia columna de Monday devuelve el texto literal `"null"` para Utilidad % — preexistente, no introducido por este cambio.

- **`130bc11`** — Acelerar writes a Monday: confirmar desde la mutación, flush en paralelo y claim atómico
  - Meta 2. El write path ya era óptimista (el PATCH responde `{ok, pending}` al instante y el sync corre en `ctx.waitUntil(flushOutbox)`), así que "más rápido" = menos trabajo/round-trips en el flush, no cambiar la latencia percibida.
  - `flushGroup` ahora confirma el espejo desde la respuesta de `change_multiple_column_values` (se le pidió devolver `ITEM_FIELDS` con `column_values`) reusando `upsertItem`+`confirmOutboxEcho`, en vez de un `refetchItem` aparte: **elimina un round-trip a Monday por grupo**. Rama defensiva: si la mutación no trae columns utilizables, cae al `refetchItem` clásico.
  - `flushOutbox` corre los grupos con `Promise.all` (antes en serie, `for...await`).
  - `claimPendingBatch`: reclama el lote de filas `pending` de forma atómica (`UPDATE ... RETURNING`, marcándolas `sent`) para que dos `flushOutbox` solapados —cada PATCH dispara su propio `waitUntil`— no lean las mismas filas y muten el mismo item dos veces en Monday. Se reusó `'sent'` como marca de reclamo porque el `CHECK` de la tabla no admite un estado nuevo y `dal.ts`/`echo.ts` ya tratan `pending`+`sent` como "en vuelo"; en fallo del mutate las filas regresan a `pending`/`failed`.
  - Columnas mirror/lookup asíncronas (p.ej. Institución `lookup_mm1bs976`, que Monday recalcula sola tras cambiar Cliente) no vienen en la respuesta inmediata — las recogen el webhook posterior o el reconcile de 6h, **igual que antes** (el `refetchItem` que se reemplaza tampoco las veía al instante). Documentado en comentario para que nadie lo "arregle".
  - Verificación: `tsc -p tsconfig.worker.json` y `oxlint` limpios; el subagente probó `claimPendingBatch` (`UPDATE...RETURNING`) contra D1 **local** (3 filas reclamadas una sola vez, segundo claim inmediato devuelve 0). Prueba end-to-end contra Monday real pendiente de una edición manual desde el portal (requiere `MONDAY_API_KEY` viva) — riesgo residual acotado por la rama defensiva.

- **`2dce569`** — UI: etapa óptimista en el drawer + hook `useSaveState` y `PickerRow` compartidos
  - Metas 1 y 2 (parte UI). Auditoría de los 9 call sites reales de `patchItem`: CotizacionTab (2) y EmbellecimientosTab ya eran óptimistas (preview local antes del refetch); los 3 modales cierran/resuelven local al guardar (correcto).
  - **Hallazgo corregido**: en `OpportunityDrawer` los botones Cancelar/Perder/Ganar hacían el PATCH y luego `load()`, que lee el mirror de D1 — aún con la etapa vieja (echo async de Monday), así que los botones condicionados a `stage` no desaparecían hasta un refresh manual. Nuevo `applyStageOptimistic(idx)` pinta `cols.deal_stage` local al instante (usa `DEAL_STAGE_LABELS` + `{index}`, que es lo que lee `statusIndex`), reconciliando con `load()` como antes.
  - `useSaveState` (`src/lib/`, hook nuevo `{saving, error, run, setError}`): dedup el patrón `setSaving/try/catch/finally` idéntico en EditCliente/EditPersona/EditContacto. Se verificó que EditPersona sigue validando `if(!value)` antes de `run`, y que EditContacto conserva el bloqueo por `colId`.
  - `PickerRow` (`src/components/forms/`, componente nuevo): fila clicable de lista con el mismo estilo exacto, reusada por EditCliente y EditContacto (2 listas). Formatters: no se creó nada — `fmtMoney`/`fmtSyncAgo` ya estaban centralizados en `src/lib/format.ts`, sin duplicación real que consolidar.
  - Verificación: `tsc -p tsconfig.app.json` + `oxlint` limpios (sin warnings nuevos); `npm run build` OK.

- **`c876091`** — Agregar `docs/code-index.md` (índice archivo→propósito+exports) y puntero en CLAUDE.md
  - Meta 1. Índice curado de `src/`, `worker/` y `shared/` (146 archivos): una línea por archivo con propósito + exports clave, agrupado por área. Objetivo: en sesiones futuras grepear el índice antes de explorar el repo y ahorrar tokens de contexto. `shared/column-meta.gen.ts` marcado como generado (grepear, no leer completo).
  - `CLAUDE.md` gana un puntero al índice al inicio del "Mapa del repo" ("grepéalo antes de explorar; si algo no cuadra, verifica contra el código").
  - Índice curado a mano por el subagente (146 entradas) y luego un pase de limpieza (25KB, −26%: se quitaron rutas duplicadas y se dejaron solo nombres de exports).

- **`4abf133`** — Ordenar items de boards por última actualización de Monday (más reciente arriba)
  - Pedido de Efraín: "acomoda todos los boards por fecha de actualización, lo más reciente hasta arriba". `listItems()` en `worker/lib/dal.ts` ordenaba `ORDER BY name` (alfabético); pasó a `ORDER BY monday_updated_at DESC`, que ya era un campo poblado en el mirror (usado antes solo para el "actualizado hace X min" de la UI, nunca para ordenar).
  - Aplica a la lista de items de cualquier board (es el único `listItems` que alimenta `StageBoardList`/`groupByColumn`, que preserva el orden de llegada dentro de cada grupo de etapa sin re-ordenar). Los subitems (`childrenOf`, líneas de cotización) se dejaron con `ORDER BY name` a propósito — ahí el orden de captura importa.

- **`102b99b`** — Fix: Ganar/Perder/Cancelar oportunidad no escribían `deal_stage` (403 + valor equivocado)
  - `deal_stage` no tenía entrada `w` en `shared/visibility.ts` — `canWrite()` fallaba siempre, para cualquier rol, sin que nada en la UI lo señalara (los botones parecían funcionar: mostraban el aviso de éxito porque el `applyStageOptimistic` local pintaba la etapa antes de que el PATCH real fallara en el flush).
  - Además `patchItem` mandaba el índice crudo (`'1'`, `'2'`, `'5'`) en vez del label que Monday espera para columnas de status (regla dura del repo: `{label:"..."}`, nunca el índice) — se cambió a `DEAL_STAGE_LABELS[idx]`, mismo patrón que ya usaba `applyStageOptimistic`.
  - Encontrado durante una prueba de estrés de la sesión de optimización del día; Efraín dio luz verde para el fix en la misma sesión. `deal_stage` queda con el mismo set de roles (`V`) que el resto de columnas de solo-lectura-para-vendedor ya en esa lista.
- **`11d37fa`** — UI: renombrar miniatura "Solicitud de costeo" a "Costeo" en el tab Cotización
  - Efraín pidió acortar el label de la primera tarjeta de PDFs en `CotizacionPdfRow.tsx` (venía de `ec8ce08`); solo cambia el texto visible, no el `kind`/columna/endpoint detrás.

## 2026-07-20 (cont.)

- **`4ba4a98`** — Agregar columna Margen Gob Total en grid de Costeo/Validación
  - Efraín pidió mapear todas las columnas de los subitems de Oportunidades contra la grid y reportó que faltaba el total del margen GOB en Validación.
  - Auditoría contra `shared/column-meta.gen.ts` (59 columnas reales del subitem board 18395657607) vs `GRID_COLS_COSTEO`/`visibility.ts`: `formula_mkznsb7m` ("Margen Gob Total", dinero por línea) ya estaba en `subCols` para compras/admin (nivel `AC`) y ya se sumaba en `TotalsRow.tsx` internamente solo para el % ponderado — pero nunca se pintaba, ni por línea ni el monto agregado. Distinto de "Costo Total"/"Utilidad Total", que sí se muestran a propósito como agregado bajo las columnas "…C/U" (patrón documentado, sin columna de línea aparte).
  - Nueva columna "Margen Gob Total" en `GRID_COLS_COSTEO` (gridMeta.tsx), después de "Margen Gob %"; `TotalsRow.tsx` ahora también suma y muestra el monto agregado ahí. Hereda automáticamente el picker "Columnas" y su persistencia en localStorage (`cmp:costeoHiddenCols`), que ya existía y es compartida entre Costeo y Validación (`variant='costeo'` en ambos).
  - Verificado en vivo con Playwright contra Validación Costeo real (OPP-0369): la columna aparece con $44,951 por línea y en el TOTAL. `tsc --noEmit` y `oxlint` limpios.
- **`ec8ce08`** — Mostrar PDF de solicitud de costeo antes de las cotizaciones en el tab
  - Efraín pidió, en la pestaña Cotización del drawer, ver también el archivo de solicitud de costeo antes de las tarjetas de Sin firmar/Firmada (mismo patrón visual que ya existía para esas dos).
  - Nueva tarjeta "Solicitud de costeo" en `CotizacionPdfRow.tsx`, a la izquierda de las otras dos — apunta a `file_mm0z6rze`, la misma columna que `DocumentacionTab.tsx` ya etiquetaba "Solicitudes de costeo" y que ya estaba whitelisteada en `shared/visibility.ts` (no se tocó el whitelist). Existe otra columna (`file_mm10k65a`, "Solicitud Costeo", generada por el botón "Solicitar costeo") que no está expuesta en el mirror — se le avisó a Efraín por si en realidad se refería a esa, no se agregó sin confirmar (regla dura del repo: whitelist es decisión suya).
  - Extendido el `kind` del endpoint `/api/oportunidades/:id/cotizacion-pdf/:kind` y de `worker/lib/cotizacionPdfs.ts` para el nuevo tercer tipo.
  - Verificado en vivo con Playwright (OPP-0504): la tarjeta nueva aparece antes de Sin firmar/Firmada y "Ver" abre el PDF correcto en el modal. `tsc --noEmit` y `oxlint` limpios.
- **`c66550e`** — Compactar altura de filas en listas de boards y tablas de catálogo
  - Efraín reportó demasiado espacio vertical entre filas en la lista de Oportunidades (captura de "NUEVA OPORTUNIDAD"); pidió luego extenderlo a todos los boards, incluyendo Proyectos.
  - Padding de fila reducido de `11px 18px` a `3px 18px` en el `Row` compartido de `StageBoardList.tsx` (Oportunidades/Costeo/Validación/etc.) y del `Row` idéntico en `ProyectoBoardList.tsx` (Documentación y Tallas/Órdenes de Compra/Logística) — mismo patrón, componentes distintos.
  - Mismo criterio aplicado a las tablas de catálogo/inventario que comparten el patrón duplicado `thStyle`/`tdStyle` (`BoardTable.tsx` — Productos/Instituciones/Contactos/Proveedores —, `StockTab.tsx`, `MovementsTab.tsx`): celdas de `9-10px` a `5-6px` de padding vertical.
  - Verificado con Playwright en Oportunidades, Documentación y Tallas y Productos.
- **`7befccd`** — Board Costeo: ocultar etapas Seguimiento, Negociación, Ganada y Perdida
  - Efraín reportó que el board Costeo mostraba oportunidades de etapas que ya no le corresponden.
  - Causa: `costeo` en `STAGE_BOARDS` ([src/lib/dealStages.ts](src/lib/dealStages.ts)) no tenía `stages` definido, así que `StageBoardList.tsx` no aplicaba ningún filtro (`!config.stages` cae al fallback "pipeline completo", pensado para el board Oportunidades).
  - Le pregunté a Efraín si además de ocultar esas 4 debía restringirse a una sola etapa (p. ej. solo "En costeo"); eligió mantener el resto del pipeline visible y solo ocultar esas 4. Se agregó `excludeStages?: string[]` a `StageBoardConfig` (whitelist `stages` + ahora blacklist `excludeStages`, aplicados en cascada) en vez de convertir `costeo` en una whitelist estricta.
  - Nota de concurrencia: el working tree traía cambios sueltos de otra sesión (densidad de tablas, feature de "solicitud de costeo" en PDFs) — se aisló el commit con `git apply --cached` sobre solo el hunk propio en `StageBoardList.tsx`, el resto se dejó sin commitear.
- **`f9b7480`** — Rediseñar grid de Cotización (compacta, columnas fijas, columna Avisos) + ajustes de UI
  - Sesión larga e iterativa a partir de una captura de referencia que Efraín compartió ("mira como esto se ve sencillo, intenta imitarlo"): la grid de Cotización (`CotizacionTab.tsx`/`gridMeta.tsx`/`MobileQuoteRow.tsx`/`TotalsRow.tsx`) pasó de columnas repartidas en `1fr` (mucho espacio en blanco, chips estirados) a columnas de ancho fijo (`colsTemplate`) con celdas de solo lectura como chip gris plano y las editables en blanco con borde de acento — a propósito distintas, porque en Validación de Costeo P. venta es la única celda escribible de toda la fila y con el mismo tono no se notaba.
  - Columna "Avisos" nueva, siempre presente y de ancho fijo al final de cada grid — antes el aviso de una línea aparecía como celda opcional al final de la fila y las filas con/sin problema quedaban desalineadas entre sí; ahora es una pista real reservada siempre, con o sin contenido. "Sin confirmar"/"Pendiente de costeo"/etc. quedan exclusivos de Costeo — Validación de Costeo solo puede avisar "Falta precio".
  - La tabla ahora mide `fit-content` (aplicado directo en los elementos `display:grid`, no en un wrapper — anidar el fit-content en un bloque que envuelve al grid resultó frágil y causó una regresión real, un aviso se envolvía a una segunda línea por desajuste de conteo de celdas vs. columnas del template) — angosta en "Nueva oportunidad" en vez de estirarse con un hueco enorme antes de Avisos, y sigue con scroll horizontal propio en Costeo (16 columnas). Headers centrados; números de `type=number` sin flechitas de spinner (se comían el ancho en columnas angostas) y alineados a la derecha de forma consistente, incluido el renglón TOTAL (antes el total de Cantidad quedaba a la izquierda por heredar la alineación de columna en vez de la de un número).
  - Bug real encontrado y corregido en el camino: una condición de carrera en `saveCols`/`patchRow` (`CotizacionTab.tsx`) — el merge de estado tras el `await` a Monday usaba un snapshot de closure de antes de esperar, así que editar Cantidad mientras otro campo de la misma línea (p.ej. Con/Sin Embellecimiento) seguía guardándose podía revertirlo. Se resolvió mezclando siempre sobre el `r` fresco del updater funcional de `setRows`, nunca sobre la closure vieja.
  - De la misma sesión, en archivos que otra sesión de Claude traía en curso (working tree compartido, commiteado junto a petición explícita de Efraín): mensajes de validación de costeo/validación numeran la línea (`#7 "producto"`, `worker/lib/costeo.ts`) en vez de solo el nombre; `LineDetailPanel.tsx` también muestra el embellecimiento de la línea (solo lectura) en Costeo/Validación; densidad tipográfica reducida en todo el portal (`tokens/typography.css`, `NavItem`, `BoardTabsBar`, `UserChip`); sidebar con scroll propio cuando no cabe en pantalla, chevrons en el botón de colapsar, botón "Salir" visible; `createSubitem` acota reintentos (evitaba ~15s de espera en "+ Agregar línea"); fecha límite en Nueva oportunidad abre el date picker nativo al hacer click en todo el campo, no solo en el ícono.
  - Verificado en vivo con Playwright contra Monday real en varias oportunidades (Costeo, Validación de Costeo, Nueva oportunidad) a cada paso de la iteración — capturas de antes/después en cada fix, incluida la regresión del aviso envuelto y su corrección.
- **`8793f8e`** — Banner de impersonación más evidente: fondo rojo, botón claro
  - El banner de impersonación era apenas visible.
  - Ahora: fondo rojo oscuro (#d32f2f), texto blanco, botón "← SALIR" blanco muy evidente, borde inferior rojo más oscuro.
- **`dbcacb1`** — Hotfix: impersonación no permite regresar al perfil del admin
  - Bug: cuando un admin impersona otro usuario y hace click en "Salir", el cache global de `useMe()` no se invalidaba — seguía mostrando el usuario impersonado.
  - Causa: cache de `useMe()` es global y solo se refetcha al iniciar, nunca en cambios posteriores.
  - Fix: exportar `invalidateMeCache()` e invalidar en `startImpersonation()`/`stopImpersonation()` antes de redirigir.

## 2026-07-20

- **`c96b7bd`** — Ampliar selectores de Vendedor/Compras a admins y completar equipo de Compras
  - Efraín reportó que no podía elegirse a sí mismo (salinasefrain, role=admin en `identity`) como vendedor al crear una Nueva oportunidad, y que el selector de Compras solo mostraba a Pamela.
  - Causa: `listVendedores` ([worker/lib/dal.ts](worker/lib/dal.ts)) filtraba estrictamente `role = 'vendedor'`/`'compras'` — los admins nunca entraban aunque también puedan ser dueños de una oportunidad. Fix: se incluye siempre `role IN (rol, 'admin')`. El default automático de Vendedor al abrir el modal (antes gateado a `me.role === 'vendedor'`) ahora se activa para cualquier usuario presente en la lista ya ampliada, sin depender de su rol.
  - Compras: en D1 solo Pamela tenía `role='compras'` pese a que el team real "Compras" en Monday (consultado vía MCP) tiene 6 personas más. Confirmado el roster con Efraín contra ese team (excluyendo una cuenta personal de prueba, `poncesalinasefrain@gmail.com`) y actualizado `role='compras'` para Josue Rubio, Liliana Chale, Elizabeth Ocaña, Emily Martinez y Luis Enrique Hernandez (UPDATE directo a D1 remoto).
  - Nota de concurrencia: el working tree traía cambios sueltos de otra sesión en `CreateOportunidadModal.tsx` (fix de date picker), `CotizacionTab.tsx`, `MobileQuoteRow.tsx`, `gridMeta.tsx`, `worker/lib/costeo.ts` y `worker/lib/monday.ts` — se aisló el commit con un patch manual sobre solo el hunk propio en `CreateOportunidadModal.tsx` (`git apply --cached`), el resto se dejó sin commitear.
- **`9a9c3bb`** — Auto-recuperar sesión de Cloudflare Access cuando queda pegada a otra cuenta
  - Reporte de Efraín: a Jorge (webcmp) el login con Google no le pone la cuenta correcta.
  - Causa: la cookie de sesión de Cloudflare Access es independiente de con qué cuenta de Google esté logueado el navegador — si quedó pegada a un correo viejo, el portal sigue viendo ese correo aunque el usuario entre con la cuenta correcta, y no había forma de forzar un re-login desde la UI.
  - Fix en `apiFetch` ([src/lib/apiClient.ts](src/lib/apiClient.ts)): ante un 401 (JWT de Access inválido) o un 403 específicamente de "pide acceso" (mw/identity.ts — correo válido pero no encontrado en `identity`), redirige una sola vez por pestaña a `https://mexicanaproteccion.cloudflareaccess.com/cdn-cgi/access/logout?returnTo=...`, lo que limpia la sesión de Access y fuerza un login de Google fresco; vuelve a la URL donde estaba.
  - A propósito NO dispara con los demás 403 del worker (`{error:'forbidden'}` por rol — usuario correctamente identificado sin permiso para esa acción), para no meter en el loop a alguien que sí tiene su cuenta bien pero no el rol.
  - Gateado a hosts detrás de Access (`*.mexicanadeproteccion.com`, `*.workers.dev`) para no romper `npm run dev` local.

## 2026-07-19

- **`d330fcb`** — En Nueva oportunidad, solo permitir Archivar (no Perder)
  - No tiene sentido perder una oportunidad recién creada; solo se puede archivar.
- **`386c18f`** — Expandir botones Perder/Ganar/Archivar en drawer de oportunidades
  - Botón Perder: disponible en etapas posteriores a Nueva oportunidad.
  - Botón Ganar: solo después de etapa Cotización (6) — coherente con el flujo de ventas.
  - Botón Archivar: renombrado de "Cancelar" y disponible en cualquier etapa abierta.
  - Los tres botones se ocultan en etapas terminales (Ganada, Perdida, Cancelada).
- **`1e2f41e`** — Corregir error de build: WriteResponse no tiene 'errors'
  - El Deploy en GitHub Actions fallaba en `tsc -b` (build rojo desde el commit `73d8816`): tres call sites en `OpportunityDrawer.tsx` (cancelar/perder/ganar oportunidad) usaban `res.errors` (array), pero `WriteResponse` (`shared/dto.ts`) solo tiene `error?: string`.
  - Fix: `lines: [res.error ?? 'Verifica tu conexión.']` en los tres handlers.
  - Detectado vía `gh run list` / `gh run view --log-failed` a petición de Efraín ("deploy failed see github").

## 2026-07-18

- **`73d8816`** — Agregar indicador de líneas incompletas en cotizaciones
  - Nueva función `getLineWarnings()`: detecta problemas en cada línea (falta producto/color/cantidad, pendiente costeo, sin confirmar).
  - Web: banner ⚠️ con lista de problemas + fondo sutil #faf8f6 al inicio de cada fila.
  - Móvil: mismo indicador (banner + fondo) para consistencia visual.
  - Visible en ambas variantes (venta/costeo) y todos los stages.
- **`3d2bbf7`** — Agregar soporte de iOS homescreen icon y PWA manifest
  - `apple-touch-icon` en index.html: iOS reconoce el logo del CMP al agregar a pantalla de inicio (en lugar de mostrar solo una "C").
  - Metas PWA: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`.
  - `public/manifest.json`: configuración completa de web app standalone con iconos y metadata.
- **`d739b3d`** — Agregar eliminar líneas en cotizaciones
  - Botón ✕ (rojo, en Primera columna) para eliminar cada línea de producto.
  - Disponible en Nueva oportunidad y borradores de versión (mismo flujo: `canAddLines` = true).
  - Backend: DELETE endpoint en `/api/boards/:slug/items/:id` que llama a `deleteItem()` de Monday.
- **`ee3103c`** — Agregar botón "+ Agregar línea" en cotizaciones con productos
  - Problema: en Nueva oportunidad y borradores de versión, solo se podía agregar la primera línea de producto (el botón desaparecía después de crear la línea).
  - Solución: ahora el botón "+ Agregar línea" aparece siempre después de la tabla de cotizaciones cuando `canAddLines` es true (Nueva oportunidad y borradores de versión), no solo cuando la tabla está vacía.
  - Se agregó el botón en dos lugares: en la vista mobile (después de `TotalsRow` con `isMobile`) y en la vista desktop (después de `TotalsRow` sin mobile).
- **`b6f3749`** — Crear oportunidad sin esperar folio — abre drawer inmediatamente
  - Antes: el modal bloqueaba ~6 segundos esperando que Monday asignara el folio con polling (30 intentos × 200ms).
  - Ahora: crea el item y abre el drawer al instante; el folio se asigna async en background (visible al refrescar el drawer o al actualizar desde Monday).
  - Cambio de flujo: `CreateOportunidadModal` ya no bloquea, solo crea + callback inmediato. `OpportunityDrawer` carga el detail (que ya incluye el folio cuando está listo).
  - Solución a la solicitud de Efraín: "la verdad esta muy dificil esto necesito que funcione aunque no tenga folio va? que lo recupera async PERO que me deje crearla".
- **`26cf57e`** — Permisos por equipo: selección de boards visibles + limpieza de rol cliente
  - Efraín pidió continuar la parte de permisos: que el admin pueda elegir, por equipo, a qué boards del sidebar tiene acceso — ejemplo dado: Ventas no debe ver Inventario, Costeo ni Validación de costeo. Antes de codear se aclaró con él el alcance: "equipo" = los roles reales de Monday (ventas, compras, almacén, admin) y de paso confirmó borrar el rol `cliente` (sin uso real en el código) y que el rename `vendedor`→`ventas` fuera solo de label en UI, no del valor interno (evita tocar D1/bot de WhatsApp en vivo).
  - Pregunta aparte de Efraín ("ESTO ES CRUCIAL"): confirmado con código, no de memoria, que un vendedor no puede ver márgenes/costos de Oportunidades ni por el bot ni por el portal — ambos canales pasan por el mismo whitelist `shared/visibility.ts` (`toItemDTO` en `serialize.ts` para el portal, `readableRecord` en `assistantTools.ts` para el bot), y esas columnas solo están en el grupo `AC` (compras/admin).
  - Nueva tabla D1 `role_board_access` (`worker/schema.sql`, `worker/lib/boardAccess.ts`, `shared/boardAccess.ts`): whitelist de boardKeys del sidebar por equipo (vendedor/compras/almacen); `admin` siempre ve todo y no es editable (hardcoded, para que nunca se pueda auto-bloquear desde la UI). Endpoints `GET/PUT /api/admin/board-access`.
  - `identity.role` cambia su CHECK constraint de `('vendedor','compras','admin','cliente')` a `('vendedor','compras','admin','almacen')` — requirió recrear la tabla (SQLite no altera CHECK in-place); sin filas `cliente` que migrar (verificado antes de tocar nada). `/api/me` ahora expone `boardAccess`; `Sidebar.tsx` deja de filtrar con un array `roles` hardcoded por item y pasa a ser 100% data-driven (y colapsa secciones completas si quedan sin items).
  - Nueva sección "Accesos por equipo" en Configuración: matriz equipo × board, editable por el admin.
  - `worker/routes/inventario.ts` pasa de bloquear solo el rol `cliente` (ya inexistente, dead code) a proteger el API real con `boardAccess` — antes cualquier rol autenticado podía pegarle directo al endpoint sin pasar por el sidebar.
  - Seed inicial (criterio explícito de Efraín): Ventas pierde Costeo/Validación Costeo/Inventario/Proveedores; Compras y Admin conservan todo lo que ya tenían; Almacén arranca solo con Inventario — el resto queda a que Efraín lo ajuste desde la nueva UI.
  - Se limpiaron 5 comparaciones muertas contra el rol `cliente` que quedaban sueltas (`worker/assistant/routes.ts`, `worker/wa/routes.ts`, `ChatBubble.tsx`, `OpportunityDrawer.tsx`, comentario en `assistantPersonas.ts`) — ya no bloqueaban nada real, solo dejaban de compilar al quitar `cliente` del tipo `Role`.
  - Migración (CHECK constraint + tabla nueva + seed) aplicada a D1 local; pendiente aplicar a D1 remoto con `--remote` en el próximo deploy (mismo patrón que el seed de almacenes en `46b740f`).
  - Verificado con `tsc --noEmit` y `oxlint` limpios, y en vivo con Playwright: matriz de accesos como admin (toggle + Guardar con round-trip real a D1, revertido tras la prueba), e impersonando a un vendedor real el sidebar ya no muestra Costeo/Validación/Inventario/Proveedores.
  - Nota de concurrencia: otra sesión (Haiku) commiteó `0d1c62e` mientras este trabajo estaba en curso — su commit se llevó de paso una simplificación propia ya hecha en `OpportunityDrawer.tsx` (`canDuplicate`, parte de la limpieza de `cliente` de este mismo cambio), sin conflicto real. El resto del working tree se dejó intacto; se stagearon por nombre solo los 18 archivos propios de este cambio.
- **`0d1c62e`** — Agregar botones Perder, Cancelar y Ganar en drawer de oportunidades
  - Cancelar: disponible en stages 4 (Nueva oportunidad) y 15 (En costeo), cambia a stage 5 (Cancelada).
  - Perder: disponible desde stage 7 (Validación) en adelante, cambia a stage 2 (Perdida).
  - Ganar: disponible desde stage 7 (Validación) en adelante, cambia a stage 1 (Ganada).
  - Botones compactos (11px font-size, 6px 11px padding) con confirmaciones 2-step vía ConfirmButton.
- **`fb13878`** — Hacer 'Capturó' y 'Folio' read-only en inventario con autonumeración
  - Capturó: read-only, auto-rellenado con el nombre del usuario actual de sesión vía `getMe()`.
  - Folio: read-only, generado automáticamente en secuencia (1, 2, 3…) por el backend.
    - Backend calcula el máximo folio numérico existente e incrementa.
    - Frontend indica "Se genera automáticamente".
- **`c66d9b9`** — Agregar logo de CMP como favicon
  - Link favicon en index.html apuntando a `src/assets/logo.webp`.

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
- **`f75dfae`** — Vendedores editan precio en Cotización + optimizaciones de costo/velocidad
  - `CotizacionTab`: inline-edit ya no exclusivo del variant costeo — el vendedor edita Precio de Venta C/U en los boards de Ventas con preview local de Subtotal/IVA/Total; prop `editable` bloquea Ganada/Perdida.
  - Fix de carrera en `POST /oportunidades/:id/version`: `submitVersion` hace `await flushOutbox` antes de reenviar a costeo (cmp-tallas leía Monday sin los cambios) y el refetch de árbol se movió a la ruta después del costeo (recoge stage/PDF/snapshots; antes quedaba mirror viejo).
  - Asistente: loop unificado `worker/lib/agentLoop.ts` (WA + portal) con prompt caching (system+tools y prefijo completo, lecturas ~0.1×); `trimHistory` compacta `tool_result`s con >10 mensajes de antigüedad.
  - Roster de Monday cacheado en D1 (`api_cache`): `/api/users` TTL 6 h (441ms→16ms), admin 10 min, stale-if-error.
  - Frontend: `/api/boards` cacheado por sesión, polling pausado con pestaña oculta, drawer con cache SWR (reabrir oportunidad = instantáneo).

## 2026-07-16

- **`c32067a`** — Edición inline de cotizaciones en Nueva oportunidad + auto-open tras crear opp
  - `CotizacionTab`: en stage 4 (Nueva oportunidad) el vendedor edita inline producto/color/cantidad; precio nunca editable para vendedor (solo lectura). Otras etapas siguen editando solo vía "Nueva versión" (archivable).
  - Botón "+ Agregar línea" en Nueva oportunidad crea subitems vacíos; nuevo `POST /api/oportunidades/:id/productos` para crear líneas sin versioning.
  - `CreateOportunidadModal`: hace polling al folio, cierra el modal y auto-abre el drawer en cuanto está listo.
- **`edfb9c2`** — Deep links por oportunidad (`/boardKey/itemId`) + botón Copiar link
  - Ruteo por URL con History API (sin librería nueva): `useRoute()` en `src/lib/routing.ts` deriva board/itemId de la ruta; `App.tsx` y los 6 boards de oportunidad (Oportunidades, Costeo, Validación Costeo, Documentación y Tallas, Órdenes de Compra, Logística) pasaron de `useState` local a `openId`/`onOpenChange` por props.
  - Permite compartir un link directo a una oportunidad (WhatsApp, chat interno) y soporta back/forward del navegador; el fallback SPA de `wrangler.jsonc` ya cubre la navegación directa en producción.
  - `OpportunityDrawer` suma botón "Copiar link" junto a "Actualizar".
- **`eee5186`** — Fix: agregar línea no vinculaba subitem + producto/color no editables en cotización
  - `POST /oportunidades/:id/productos` usaba `create_item` en el board de subitems en vez de `create_subitem` — Monday nunca lo linkeaba al padre. También corregido el parseo del stage (`MirrorItem.columns` es JSON crudo, no el shape serializado de ItemDTO).
  - `CotizacionTab`: columna Color agregada al grid de Ventas (faltaba); Producto editable con datalist del catálogo (relación real o texto libre, igual que `NuevaVersionForm`); Color editable con datalist de colores disponibles del producto ligado.
  - Preview local del mirror de producto tras el write — antes parecía que la edición no se guardaba porque Monday puebla `lookup_mm0x4kda` de forma asíncrona.
- **`5c50882`** — Color de línea: dropdown real, no texto libre
  - El campo Color pasó de input+datalist a `<select>` con opciones tomadas del catálogo de Productos (`dropdown_mkztty4b`, ya en memoria) — instantáneo, sin depender del mirror asíncrono del subitem. Deshabilitado hasta elegir producto; un color guardado que ya no esté en la lista se conserva como opción suelta.
- **`ab3d53b`** — Warnings de color/cantidad + toggle Con Embellecimiento en Cotización
  - Cantidad de línea nueva arranca en 0 (antes 1) con warning "Cantidad requerida"; mismo trato para color vacío. Mismos checks que ya hacía `enviarCosteo`, ahora visibles por línea sin esperar a mandar a costeo.
  - Checkbox "Con Embellecimiento" en el grid de Ventas (Nueva oportunidad) / badge de solo lectura en otras etapas, escribe el mismo status column que `submitVersion` (`color_mm1b34bg`).
  - `EmbellecimientosTab` filtra: solo líneas marcadas "Con Embellecimiento" aparecen ahí (antes mostraba todas sin importar el status); mismo filtro en el snapshot de versiones superadas.
- **`8797f7d`** — Fix: color bloqueado sin explicación + labels reales de Embellecimiento
  - Color ya no se queda bloqueado cuando el producto no tiene lista de colores configurada — cae a texto libre en ese caso específico en vez de mostrar "Elige un producto primero" con un producto ya ligado.
  - Badge/toggle de embellecimiento muestra los labels reales de Monday ("Con Embellecimiento"/"Sin Embellecimiento") en vez de "Sí"/"No".
- **`8f9f99a`** — Color sin lista: dejar en blanco, no texto libre
  - Efraín: el vendedor no debe poder "inventar" un color que el catálogo no define — sin colores configurados, el campo queda vacío y deshabilitado en vez de abrir texto libre.
- **`a66ecc4`** — Embellecimientos: versiones (V1/V2 + Enviar a costeo) y agregar posición con imagen/archivo
  - `EmbellecimientosTab` comparte los chips de versión de `CotizacionTab` (`VersionChips` exportado) — el embellecimiento va pegado a la misma línea de producto (`QuoteLineSnapshot`), así que comparte versión y el botón "+ Enviar a costeo"; snapshot de zonas de solo lectura al ver una versión superada.
  - "+ Agregar posición" ya funciona: elige zona (de las 8 del template) + descripción, hace PATCH de `long_text_mm1bj4pt` preservando las demás zonas (`upsertEmbellZone`/`serializeEmbellecimiento`, inverso de `parseEmbellecimiento`).
  - El endpoint de imagen por zona ya no exige `image/*` — `file_mm5akjy5` es una columna de archivo genérica de Monday; el preview cae a un link "Ver archivo" si la URL no carga como `<img>`.
  - Gateado por permisos reales (`ColMeta.w` de `subCols`) y por `editable` (bloqueado en Ganada/Perdida, igual que Cotización).
- **`d60f8b5`** — Mostrar y permitir cambiar Cliente en el drawer de oportunidad
  - Institución y Cliente no aparecían en el header del drawer (solo nombre + sincronizado); se agregan como línea de texto bajo el nombre.
  - Nuevo `EditClienteModal` (mismo patrón que `EditInstitucionModal`) para relinkear el Contacto de una oportunidad ya creada — `deal_contact` solo se escribía al crearla, sin flujo de corrección posterior.
  - `shared/visibility.ts`: `deal_contact` pasa a escribible (vendedor/admin); Institución (`lookup_mm1bs976`) sigue siendo mirror — se actualiza sola al cambiar el Cliente, nunca editable directamente.
- **`fd8a8e0`** — Admin: impersonar usuarios ("Ver como") + fix de fuga de datos entre viewers
  - Configuración gana botón "Ver como" por usuario: `X-Impersonate-Email` solo se honra si el llamante real ya es admin activo (`worker/mw/identity.ts`); `c.get('viewer')` pasa a ser el target (mismo scoping de DAL/visibility/outbox que si esa persona hubiera entrado directo) y `c.get('impersonatedBy')` guarda al admin real para el banner y el log de auditoría. Banner fijo en `App.tsx` para salir, siempre visible aunque el rol impersonado no vea Configuración.
  - Bug encontrado al probarlo: un vendedor impersonado veía TODAS las oportunidades. `etagFor()` calculaba el ETag solo con datos del board (count + max `synced_at`), igual para cualquier viewer — un 304 (o el cache HTTP del propio navegador) devolvía la respuesta cacheada de OTRO viewer. Pasaba desapercibido porque cada usuario real usa su propio navegador; impersonar hace que un mismo navegador actúe como varias identidades y sí lo expone.
  - Fix: el ETag ahora incluye el scope del viewer (`admin`/`compras` comparten `all`, el resto usa su `monday_user_id`) y todo `/api/*` manda `Cache-Control: private, no-store` (sin pisar el header explícito del proxy de PDF de cotización) — defensa adicional para que el navegador nunca reproduzca la respuesta de un viewer para otro.
- **`aebc463`** — Vista guardada por usuario: filtros y etapas colapsadas persisten en localStorage
  - Nuevo `useSavedView` (`src/lib/useSavedView.ts`): guarda Vendedor/Compras/Estado y qué etapas están colapsadas, por email + board (`cmp:view:{email}:{boardKey}`), en `localStorage` del navegador — privado por persona, no viaja a Monday ni se comparte entre viewers.
  - `GroupCard` gana colapso controlado (`collapsed`/`onToggleCollapsed`) sin romper su uso existente en Configuración, que sigue con estado interno propio.
  - `StageBoardList` (compartido por los 6 boards de pipeline: Oportunidades, Costeo, Validación, Documentación y Tallas, Órdenes de Compra, Logística) queda enchufado al hook — cada vendedor/comprador recupera su filtro y sus etapas colapsadas al volver a conectarse. Catálogos/Inventario quedan fuera por ahora (no usan `StageBoardList`).
- **`afb998a`** — Miniaturas de PDF de cotización en el drawer (ver/descargar sin salir del portal)
  - Chips "Sin firmar"/"Firmada" junto a la versión vigente en la tab Cotización. Nuevo `worker/lib/cotizacionPdfs.ts` + `GET /api/oportunidades/:id/cotizacion-pdf/:kind`: resuelve el asset de Monday (mismo mecanismo que las imágenes de embellecimiento, `fetchAssetPublicUrls`) y transmite los bytes desde nuestro propio dominio — el link crudo que Monday guarda en la columna (`protected_static/...`) exige sesión de monday.com y bloquea framing por CSP.
  - El modal renderiza el PDF con `pdfjs-dist` en un `<canvas>` (`PdfCanvasPreview`, nuevo) en vez de `<iframe>`/`<embed>`: el visor nativo de PDF del navegador dentro de un iframe no resultó confiable ni en Chrome real (se probó, se quedaba en blanco).
  - Precarga en segundo plano (worker de pdf.js + bytes del PDF) apenas se abre la tab, no al hacer clic en "Ver" — bajó el tiempo de apertura del modal de varios segundos a ~500ms.
  - `DocumentacionTab.tsx` exporta las columnas de archivo (`file_mm0fgrzq`/`file_mm0zjras`) y un helper `latestFileUrl` para que `CotizacionTab` los reuse.
- **`5644c8c`** — Compartimentar código y abaratar sesiones: CLAUDE.md, rutas del worker, tabs/cotizacion, StageBoard
  - Vuelta nocturna de optimización pedida por Efraín: cero cambios funcionales (1293+/1286− — reorganización pura), objetivo bajar el costo en tokens de las sesiones de Claude Code y compartimentar.
  - Hallazgos: no existía CLAUDE.md (cada sesión re-exploraba el repo); CotizacionTab llegó a 960 líneas con el mismo bloque try/catch de guardado copiado 5 veces; worker/index.ts 632 líneas con todas las rutas inline; 5 wrappers de board idénticos salvo la config; pdfjs-dist importado estático metía 425 kB al chunk del drawer (511 kB) aunque la oportunidad no tuviera PDF. Lo que ya estaba bien: shared/dealStages único, api.ts vs apiClient.ts es separación intencional (hooks vs fetch), column-meta.gen.ts ya advierte que es generado.
  - CLAUDE.md nuevo: mapa del repo, comandos (incl. quirk de wrangler --env-file y check de puertos 5173/8787), reglas duras (nunca inventar column ids, status como `{label}`, patrón de log.md, sesiones concurrentes) y flujos clave. Es la mayor palanca de ahorro: se carga en cada sesión en lugar de re-derivarlo.
  - worker/index.ts 632→50 líneas: rutas movidas TAL CUAL a `worker/routes/{boards,oportunidades,admin,inventario}.ts` (mismo patrón que syncRoutes/waRoutes); `jsonStatus` compartido en `worker/lib/http.ts`.
  - CotizacionTab 960→~490: metadata/helpers puros en `tabs/cotizacion/gridMeta.tsx`; TotalsRow, VersionChips (import actualizado en EmbellecimientosTab), SnapshotTable y CotizacionPdfRow como módulos; helper `saveCols` unifica los 5 handlers de guardado (numérico/color/embellecimiento/etapa costeo/producto) con idéntica semántica de saving/preview/error.
  - CosteoBoard/ValidacionBoard/DocTallasBoard/OrdenesCompraBoard/LogisticaBoard (idénticos) → `StageBoard.tsx` genérico con `key={boardKey}` para preservar el reset del buscador al cambiar de board; OportunidadesBoard sigue aparte por su modal de creación.
  - pdfjs-dist ahora lazy (React.lazy + import() dinámico en la precarga): chunk del drawer 511 kB→85 kB; pdf.js solo se descarga cuando hay PDF, la precarga al montar la tab se conserva (misma latencia percibida).
  - Verificado: tsc limpio, build limpio, oxlint solo warnings pre-existentes, y screenshots Playwright en vivo de los 5 boards + drawer desde Oportunidades (grid venta con TOTAL) + drawer desde Costeo (grid costeo con dropdowns de Etapa, costos editables, PDFs y precio sugerido).
- **`b70612d`** — Vista Costeo/Validación por rol: captura de costos, totales y Mandar a Validación
  - Board Costeo: producto/color/cantidad/embellecimiento y Nuevos Productos en solo lectura (`readOnly`) — es trabajo de Ventas; Compras captura costos + Margen Gob % (`numeric_mkznnm5s`, ahora writable AC) + Etapa Costeo como dropdown real (`color_mm084gvf` pasa a WAC).
  - Botón "Mandar a Validación de costeo" (etapa 15→7): nuevo `POST /oportunidades/:id/enviar-validacion` + `enviarAValidacion` en `worker/lib/costeo.ts` — escribe `deal_stage` directo vía outbox (`trusted`), sin cmp-tallas (no hay endpoint para ese paso). Solo compras/admin.
  - Board Validación Costeo: `precioOnly` — lo único editable en la grid es Precio de Venta; ahora también lista etapa 9 además de la 7.
  - `CotizacionTab`: fila TOTAL alineada a la grid (venta: cantidad/subtotal/IVA/total; costeo: costo/precio/márgenes ponderados por subtotal), semáforo de Margen (<0 rojo, <20 amarillo, ≥20 verde) y "P. venta sugerido" con fallback local calculado a 23% de margen cuando Monday no lo generó.
  - WA: `normalizeMxTo` — Meta reporta números MX con el "1" legacy (521…) pero rechaza enviar a ese formato (#131030); se normaliza a 52… antes de mandar.
- **`a283c59`** — Mostrar y permitir cambiar Vendedor/Comprador en el drawer de oportunidad
  - Header del drawer gana Vendedor/Comprador junto al indicador de sincronización (antes solo mostraba Institución/Cliente); mismo patrón que el Cliente ya existente.
  - `shared/visibility.ts`: `deal_owner` y `multiple_person_mm03qyw9` pasan a escribibles (vendedor/compras/admin) — antes de solo lectura, así que el link "Cambiar" no tenía forma de guardar. Nuevo `EditPersonaModal` reutiliza `getVendedores()` (mismas listas que el formulario "Nueva oportunidad").
  - Los tres links "Cambiar" (Cliente/Vendedor/Comprador) pasan de texto a un ícono de lápiz discreto (`IconEdit`, nuevo) — la fila del header se sentía saturada de texto.

## 2026-07-17

- **`2e593f9`** — Adjuntar y ver archivos en Actualizaciones de oportunidades
  - Efraín reportó que los archivos en la tab Actualizaciones "no cargan bien" (ver captura: un link `[PDF](https://files-monday-com.s3...)` posteado por una automatización de cmp-tallas se veía como texto plano). Investigado: esos links firmados de S3 expiran ~1h después de generados (no desde el clic), así que los ya posteados están muertos para siempre — no es un bug de render, es una limitación de Monday. Se descartó "arreglar" ese texto (cosmético, no resuelve nada real) y en su lugar se construyó lo que faltaba de raíz: subida real de archivos desde el portal.
  - Compositor de Actualizaciones gana un picker de archivo (uno por update); `fetchUpdates` ahora pide `assets` a Monday y nuevo `addFileToUpdate` (`worker/lib/monday.ts`) sube vía la mutation `add_file_to_update` (mismo endpoint multipart `v2/file` que `addFileToColumn`) — attachment nativo de Monday sobre el update, no un link que expira.
  - PDFs muestran "Ver" (vista previa embebida con `PdfCanvasPreview`, mismo mecanismo que las cotizaciones) + "Descargar"; cualquier otra extensión solo "Descargar". Nuevo proxy `GET /api/boards/:slug/items/:id/updates/attachments/:assetId` resuelve la URL firmada fresca (`fetchAssetPublicUrls`, ya existente) y transmite los bytes desde nuestro dominio — nunca el link crudo de Monday al frontend.
  - Se puede publicar solo con archivo, sin texto (usa un body default `📎 nombre.ext`).
  - Verificado en vivo contra la API real de Monday y con Playwright sobre OPP-0678: subida de PDF con preview real, subida de no-PDF (solo descarga, sin intento de preview) y texto-solo (regresión). Al probar la mutation se generaron 3 updates de prueba en el board real — ya borrados (`delete_update`); un archivo de prueba (`test-upload.txt`) quedó adjunto a un update real porque Monday no expone mutation para borrar solo un adjunto (Efraín puede quitarlo a mano desde monday.com si quiere).
- **`0b6f6ac`** — Botón Duplicar en el drawer: clona a Nueva oportunidad sin cotizaciones ni documentos
  - Pedido de Efraín: botón "Duplicar" (solo texto, arriba del drawer) que clona una oportunidad a una nueva en etapa "Nueva oportunidad" — solo con los productos vigentes y los embellecimientos, nunca todas las cotizaciones ni otros documentos.
  - Nuevo `worker/lib/duplicateOportunidad.ts` + `POST /api/oportunidades/:id/duplicar`: copia Cliente/Vendedor/Comprador de la cabecera y, de cada línea vigente (el mirror actual de subitems, mismo criterio que `quoteVersions.ts`), producto/cantidad/color/comentarios/precio de venta + embellecimiento (estatus, descripción de zonas, imágenes de referencia — se descargan de Monday y se vuelven a subir a la línea nueva). Nunca toca `cotizacion_versions`, PDFs de cotización ni el grupo de costo AC/WAC — Etapa Costeo queda "No iniciado" en las líneas nuevas.
  - Botón oculto para el rol `cliente`; backend solo acepta vendedor/compras/admin (`DUPLICATE_ROLES`, mismo criterio que crear oportunidad).
  - Líneas creadas en paralelo (`Promise.all`, mismo patrón que `createOportunidad.ts`) — la primera versión las creaba secuencial y tardaba 36s con 6 líneas contra la Monday real; en paralelo bajó a ~11s.
  - Mismo polling de folio que "+ Nueva oportunidad" tras crear, y auto-navega al drawer de la oportunidad nueva — requirió exponer `navigate` desde `App.tsx` hasta `OpportunityDrawer` (antes `StageBoard`/`OportunidadesBoard` solo pasaban `onOpenChange`, que no permite cambiar de board). Fix en el camino: el drawer no se remonta al navegar a la oportunidad nueva (mismo componente, solo cambia `id`), así que el estado `duplicating` se resetea explícitamente por `id` para que el botón no se quede pegado en "Duplicando…".
  - Verificado en vivo contra Monday (curl + Playwright) sobre `OPP-0509` (TEST EFRA/test efrain): cabecera, 6 líneas y stage "Nueva oportunidad" correctos en cada corrida. Quedaron 3 registros de prueba (`OPP-0720`, `OPP-0721`, `OPP-0722`, todos "... (copia)" de OPP-0509) pendientes de limpieza de Efraín, mismo patrón que records de prueba anteriores.
- **`697a0f6`** — Zero Trust: vars de Access y preview_urls off en wrangler.jsonc
  - Cloudflare Access quedó activo (montado por API, no por dashboard): app "CMP Portal" sobre `portal.mexicanadeproteccion.com` + el hostname workers.dev, con la policy reusable "CMP Team" (sincronizada con los 25 correos activos de la tabla `identity`), Google como único IdP y auto-redirect. App aparte con policy Bypass para `/api/sync/webhook` y `/wa/webhook` en ambos hosts (Monday/WhatsApp llegan sin login; verificado con curl).
  - `wrangler.jsonc` gana `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` (los consume `worker/mw/access.ts` para validar el JWT `Cf-Access-Jwt-Assertion` en prod — sin estas vars todo `/api/*` da 401) y `preview_urls: false` (cada deploy los re-activaba y quedaban públicos).
  - Deploy hecho desde un worktree limpio en main para no publicar el trabajo en progreso de la otra sesión (regla de CLAUDE.md). Login verificado en vivo por Efraín con `salinasefrain@`.
  - Nuevo token `CF_ZT_TOKEN` en `.env` (Access/Workers/D1/R2/KV/DNS) — el `CLOUDFLARE_API_TOKEN` viejo no tiene permisos de Zero Trust. Al dar de alta usuarios nuevos: agregarlos en la policy de Access Y en `identity` (dos puertas).
- **`bf86d07`** — Mandar a costeo siempre visible; nueva versión ya no reenvía sola a costeo
  - Pedido de Efraín (con capturas): el chip "+ Enviar a costeo" junto a V1·vigente no tenía sentido — las cotizaciones cambian mucho, y el flujo que quiere es: en cualquier etapa (salvo Ganada/Perdida) el vendedor duplica la cotización creando una nueva versión y la regresa a costeo con el botón "Mandar a costeo", que ahora es siempre visible pero deshabilitado cuando la vigente ya se costeó.
  - Se revierte el acoplamiento del 2026-07-16 ("una nueva versión ES una solicitud de costeo"): `POST /oportunidades/:id/version` ya solo guarda/archiva — el reenvío a costeo es un paso explícito del vendedor con el botón. `QuoteVersionResponse` pierde el campo `costeo` y el aviso del drawer pasa a "Nueva versión guardada" + recordatorio de usar "Mandar a costeo" (omitido si ya está en etapas 15/7, en manos de Compras).
  - `checkCosteo` (worker/lib/costeo.ts) gana dos gates: etapas terminales bloqueadas (Ganada/Perdida/Cancelada, antes solo 15/7), y después de "Nueva oportunidad" exige al menos una línea con Etapa Costeo vacía o "No iniciado" — es decir, una versión nueva sin costear (submitVersion ya reseteaba las líneas editadas a "No iniciado" y las nuevas nacen sin etapa). Si todas están costeadas: "La cotización vigente ya se costeó — crea una nueva versión para regresarla a costeo."
  - Drawer: el pre-chequeo corre en todas las etapas (antes solo la 4) y el botón se muestra en todos los boards salvo Costeo/Validación; en etapa 4 conserva el banner de pendientes, en las demás el motivo va en el tooltip. El chip pasa a "+ Nueva versión".
  - Verificado contra el worker local (curl: Ganada/etapa 4/En Seguimiento/Costeo Confirmado responden cada uno su caso) y con Playwright: OPP-0387 (En Seguimiento) muestra el botón deshabilitado con el tooltip correcto y el chip renombrado; OPP-0382 (etapa 4) conserva el flujo original.
- **`9f59096`** — UI móvil: shell con menú deslizante, barra de asistente fija y listas apiladas
  - Pedido de Efraín: pensar la UI en móvil para vendedores con prisa, sin cambiar funcionalidad, con el chatbot como barra muy visible. Primera capa responsive del portal (antes todo era layout de desktop con estilos inline).
  - Nuevo `useIsMobile` (`src/lib/useIsMobile.ts`): un solo breakpoint (≤767px) vía `matchMedia` + `useSyncExternalStore` — como los estilos del repo son inline, la variación responsive se decide en JS, no con media queries por componente.
  - Shell móvil en `App.tsx`: sin sidebar permanente; nueva `MobileTopBar` (hamburguesa + board activo) cuyo menú deslizante reutiliza el `Sidebar` completo (mismas secciones/permisos; gana prop `hideCollapse` y export `BOARD_LABELS`). Abajo, `ChatBubble` gana variante `dock`: barra fija al pie con look de input de chat ("Pregúntale al asistente CMP…") que abre el chat a pantalla completa con teclado listo (autoFocus) — el asistente siempre a un tap, que era la idea central de Efraín para móvil.
  - `StageBoardList`: renglón apilado en cel (nombre+folio / institución / chips y hora en su línea) — nada se corta ni pide scroll horizontal; header y buscador a lo ancho. Mismo patrón de paddings en `GenericBoardView`; `GroupCard` con márgenes angostos.
  - Drawer: el header pasa de un renglón (meta izquierda + acciones derecha, que desbordaba y cortaba "Mandar a costeo") a apilado en cel con botones que envuelven; `BoardTabsBar` ya scrolleaba horizontal, solo ajusta padding. El grid de cotización ya tenía `overflowX: auto`.
  - Base táctil en `index.css`/`index.html`: `100dvh` (`.app-root`), `:hover` solo con puntero real (`@media (hover:hover)` — en touch se quedaba pegado), inputs a 16px en móvil (evita el auto-zoom de iOS al enfocar), `viewport-fit=cover` + safe-area insets en las barras.
  - Desktop intacto (verificado con screenshot 1440px). Verificado en viewport 390×844 con Playwright: lista, menú, chat full-screen y drawer sin recortes.
  - Nota de concurrencia: la otra sesión traía trabajo en curso en `OpportunityDrawer.tsx`, así que aquí se commiteó vía blob (HEAD + solo los edits móviles) dejando su trabajo intacto en el working tree.
- **`9707743`** — Nueva versión = duplicado literal de la vigente, editable inline como Nueva oportunidad
  - Efraín (con captura del modal): el draft editor de "Nueva versión" era abrumador y los embellecimientos en textarea "horribles" — quiere que "+ Nueva versión" sea literal una copia de la vigente, y que sobre esa copia (V2) el vendedor pueda modificar productos igual que en Nueva oportunidad.
  - `NuevaVersionForm` eliminado junto con `submitVersion`/`POST /version` (y sus DTOs `QuoteLineInput`/`QuoteVersionRequest`/`QuoteVersionResponse`). El chip ahora abre solo una confirmación ligera y llama al nuevo `POST /oportunidades/:id/version/duplicar` (`duplicateVersion` en quoteVersions.ts): archiva la vigente tal cual en D1 y regresa la Etapa Costeo de todas las líneas a "No iniciado" (`trusted`, decisión del server) — el mirror queda idéntico como borrador. Guardas: 422 en Ganada/Perdida, sin líneas, o si la vigente ya es borrador (no apilar copias por doble click).
  - Concepto "borrador" (`esDraftVigente`): todas las líneas con Etapa Costeo vacía/"No iniciado". Sobre un borrador el grid de Cotización se desbloquea inline igual que en Nueva oportunidad (producto/color/cantidad/embellecimiento + "Agregar línea" — `inlineEditableCols` ahora recibe un booleano y `POST /productos` acepta stage 4 o borrador); el chip "+ Nueva versión" se oculta (nada costeado que archivar) y "Mandar a costeo" se reactiva (misma señal que ya usaba `checkCosteo`). Ediciones sobre el borrador ya NO archivan versión cada vez — el ancla es el momento del duplicado.
  - Verificado en vivo sobre TEST LILIANA (OPP-0127, En costeo, líneas Listo/Listo/No iniciado): duplicar archivó V1 (con etapas preservadas en el snapshot), reseteó las 3 líneas, V2 vigente idéntica; re-duplicar 422; agregar línea sobre el borrador ok; Ganada 422 y agregar línea en seguimiento costeado 400. Playwright: grid del borrador editable sin chip, y modal de confirmación en OPP-0387. Quedó una "Nueva línea" vacía de prueba en OPP-0127 (sin endpoint para borrar subitems — Efraín puede quitarla en Monday).
- **`378f039`** — Restaurar versiones anteriores + warning de regreso a costeo al cambiar de versión
  - Pedido de Efraín: (1) avisar en el modal de "+ Nueva versión" que cambiar de versión hará que la oportunidad regrese a costeo, y (2) una manera simple de regresar a otra versión desde la UI.
  - Ambos modales (duplicar y restaurar) llevan el warning en ámbar: "Al cambiar de versión, la oportunidad tiene que pasar por costeo otra vez — nace/queda sin costear y se manda con «Mandar a costeo»".
  - Al ver una versión superada (chips V1/V2…) aparece "Restaurar Vn" con confirmación. Nuevo `POST /oportunidades/:id/version/:version/restaurar` (`restoreVersion` en quoteVersions.ts): archiva la vigente y deja el mirror igual a la instantánea — reescribe producto/color/cantidad/embellecimiento/precio (trusted) en las líneas vivas, recrea las que ya no existen (sus imágenes de zona no se versionan, no regresan) y BORRA de Monday las que no estaban en esa versión (nuevo `deleteItem` en monday.ts; `refetchItemTree` ya purgaba del mirror los subitems desaparecidos). Todo queda en Etapa Costeo "No iniciado" = borrador editable + "Mandar a costeo" reactivado.
  - `QuoteLineSnapshot` gana `productoItemId` (instantáneas nuevas re-linkean directo); las viejas caen a match por nombre (sin acentos) contra el mirror de Productos y, sin match, a texto libre. Gate de rol vendedor/compras/admin en duplicar y restaurar. `CotizacionTab` se remonta cuando cambia el número de versiones (key) — tras duplicar/restaurar la vista regresa sola a la vigente.
  - Verificado en vivo sobre TEST LILIANA (OPP-0127): restaurar V1 archivó la vigente como V2, dejó V3 = contenido de V1 (3 líneas, precios 1600/1500 de vuelta, etapas "No iniciado") y borró de Monday la "Nueva línea" de prueba de la sesión anterior (adiós pendiente de limpieza); versión inexistente 404. Playwright: warning en ambos modales y botón "Restaurar V1" sobre el snapshot.
- **`f337881`** — Agregar logo CMP al sidebar
  - Sidebar gana el logo de CMP (`src/assets/logo.webp`) al lado del texto "CMP Portal" — importado de Downloads y reemplazando el placeholder de placeholder gris.
- **`8784811`** — Nueva oportunidad: campos buscables y contacto filtrado por vendedor
  - Pedido de Efraín (con captura del modal): los selects de Vendedor/Compras/Contacto/Zona eran `<select>` nativos sin búsqueda — con 657 contactos en el board eso es inmanejable. Pidió también que Tipo de cotización y ¿nuevos productos? fueran "un selector en un click más fácil".
  - Nuevo `src/components/forms/SearchableSelect.tsx`: combobox con filtro al escribir (ignora acentos/mayúsculas), navegación por teclado (↑↓ Enter Esc) y la lista se renderiza en un portal con posición `fixed` recalculada on scroll/resize — el modal tiene `overflow-y:auto` en el body y un popover `absolute` normal se hubiera recortado en campos cerca del fondo. Reemplaza el `<select>` de Vendedor, Compras, Contacto y Zona.
  - Nuevo `src/components/forms/ChipSelect.tsx` (mismo look que los chips de versión de cotización) para Tipo de cotización y ¿Nuevos productos?, un clic en vez de abrir dropdown.
  - "Más lógica" pedida: Contacto ahora filtra a solo los contactos del vendedor elegido — la columna `multiple_person_mm03vqwx` (Vendedor) del board Contactos ya venía en `ItemDTO.cols` de cada item de la lista (no hizo falta tocar el worker), solo no se estaba usando. El campo queda deshabilitado ("Elige primero un vendedor…") hasta elegir Vendedor, y si el contacto ya elegido deja de pertenecer al vendedor tras cambiarlo, se limpia solo. Verificado contra D1 real: 651 de 657 contactos tienen vendedor asignado, así que el filtro no deja huérfanos de datos.
  - Verificado con `tsc --noEmit`, `npm run lint` (sin warnings nuevos) y en vivo con Playwright contra el dev server local: búsqueda con acentos, selección de vendedor filtrando Contacto a sus 2 contactos reales, navegación por teclado en Zona, chips de un clic — sin errores de consola.
- **`10ce503`** — Tallas: por ahora solo mostrar el link al Google Sheet
  - Pedido de Efraín: recortar temporalmente la pestaña Tallas a solo el link del archivo de Google Sheets del proyecto — se quita por ahora el resumen por línea de cotización y los botones de regenerar/validar/importar.
  - `TallasTab.tsx` queda mínimo: si el proyecto ligado tiene el link de sheet (`P_SHEET_LINK`, ahora exportado de `ProyectoSection.tsx` junto con `linkUrl`), lo muestra; si no, un mensaje de que aún no tiene archivo.
- **`a418575`** — Proyectos como board propio: 3 accesos, líneas manuales, catálogo Proveedores
  - Efraín pidió traer la info del board Proyectos (post-venta), "muy similar a Oportunidades". Primero se fusionó el sidebar (Postventa + Proyectos en una sola sección: Documentación y Tallas → Órdenes de Compra → Logística — todo el flujo del Proyecto junto). Luego, al investigar cómo combinar Proyecto+Oportunidad, se encontró que el `board_relation_mm0hf0y3` (Proyecto→Oportunidad) viene inconsistente en el mirror: verificado en vivo que Monday sí tiene el link (`linked_item_ids` vía la API real) pero el mirror de D1 lo guarda `null` para varios Proyectos reales — probablemente porque conectar una columna "connect boards" no siempre mueve el `updated_at` del item, así que el reconcile de 6h puede tardar en agarrarlo. Efraín pidió la solución más robusta: que Proyectos deje de depender de esa columna.
  - Los 3 accesos (siguen separados, a petición de Efraín) ahora listan `GET /api/boards/proyectos/items` directo (ya era genérico, sin cambios de Worker) agrupado por `project_status` (`src/lib/projectStages.ts`, nuevo — 6 estados reales: Desglose de tallas → En confirmación → Tallas Confirmadas → OC listas → Ejecución → Terminado) en vez de Oportunidades filtrada por `deal_stage`. Nuevos `ProyectoBoardList`/`ProyectoBoard`/`ProyectoDrawer` (`src/boards/proyectos/`) — el drawer abre siempre por el id propio del Proyecto (nunca vía el board_relation) y reusa `ProyectoTallasSection`/`ProyectoOrdenesSection`/`OcContratoSection` ya existentes. Actualizaciones queda directo al feed del Proyecto (`slug="proyectos"`), sin fallback.
  - Cotización/Embellecimientos de la Oportunidad se quedan como "bonus": nuevo `GET /api/proyectos/:id/oportunidad` (dirección inversa a la ruta ya existente) que primero lee el mirror y, si viene vacío, resuelve en vivo esa sola columna vía GraphQL (mismo patrón que `createOportunidad.ts` ya usaba para `deal_contact`) — y dispara un refetch completo para autocorregir el mirror. Verificado en vivo: un Proyecto real que mostraba "sin Oportunidad ligada" resolvió al instante y el mirror quedó corregido para la siguiente lectura.
  - Se agrega "Agregar línea manual" en la pestaña Tallas (Compras/admin): nuevo `POST /api/proyectos/:id/lineas` (mismo patrón acotado que `/api/oportunidades/:id/productos`, whitelist fija de columnas) + modal con picker del board **Proveedores** (`18397474806`, introspeccionado y registrado por primera vez — antes no existía en el portal) y su propio catálogo en el sidebar (Catálogos, solo compras/admin). Con el proveedor puesto, "Generar OC por proveedor" (`generate_oc`, ya soporta `only_proveedor`) genera una orden de compra real para esa línea sin pasar por el Sheet de tallas — resuelve el caso de productos faltantes o compras independientes que Efraín señaló como bloqueado.
  - Bug encontrado y arreglado en el camino (no introducido en este commit): `/api/proyectos/:id/lineas` y `/api/proyectos/:id/documento` (este último de otra sesión concurrente, el upload de OC/contrato firmado) quedaban atrapadas por el wildcard `/api/proyectos/:id/:action` registrado antes en el archivo — Hono lo matcheaba primero y devolvía 404 siempre. Se reordenaron ambas rutas específicas antes del wildcard.
  - Verificado en vivo contra Monday real: las 3 listas cargan agrupadas correctamente, el drawer resuelve la Oportunidad ligada, y el flujo completo de línea manual (crear vía UI con picker real de 98 proveedores → aparece en el grid de tallas) — quedaron 2 subitems de prueba en el board real, borrados (`delete_item`) junto con su fila en el mirror local.
  - Nota de concurrencia: el commit incluye `P_OC_CLIENTE`/`OcContratoSection`/`uploadProyectoDocumento` (feature de OC/contrato firmado) de una sesión concurrente — se dejaron porque el Documentación tab del nuevo drawer los reusa directo y porque el fix de rutas de arriba los desbloqueaba; se excluyeron a propósito `src/lib/dealStages.ts` y `src/boards/oportunidades/tabs/ActualizacionesTab.tsx` (cambios sueltos de esa misma sesión, sin relación con este trabajo) para que esa sesión los commitee por su cuenta.
- **`96c9be4`** — Fix import de tipos en ActualizacionesTab; Documentación y Tallas filtra a Ganada
  - Efraín pidió cerrar y commitear todo lo pendiente. `ActualizacionesTab.tsx` importaba `UpdateAttachmentDTO`/`MentionUserDTO`/`UpdateDTO` desde `lib/api` en vez de `lib/apiClient` (`api.ts` los reexporta con `export *`, pero `tsc` marcaba el import de tipos como inexistente — sin impacto en runtime, solo en el typecheck). `STAGE_BOARDS.doctallas` pasa de filtrar `deal_stage` "9" (Costeo Confirmado) a "1" (Ganada): el Proyecto (docs/tallas) solo se crea una vez ganada la oportunidad, así que filtrar en Costeo Confirmado dejaba la lista vacía. Este último ya quedó como código muerto tras el commit anterior (los 3 accesos usan `ProyectoBoard`, no `StageBoard`), pero se deja corregido por si se vuelve a usar.
  - `screenshot.mjs` (script suelto de verificación de otra sesión, sin uso en la app) se commitea también a petición de Efraín.

## 2026-07-18

- **`727e95c`** — Filtros en móvil: colapsan a botón + modal en vez de 3 selects apilados
  - Efraín reportó que en móvil los filtros de `StageBoardList` (Vendedor/Compras/Estado) ocupaban más de la mitad de la pantalla.
  - `FilterBar.tsx` detecta `useIsMobile` y en ese caso oculta los tres `<select>` detrás de un botón "Filtros" con badge de conteo activo; al tocarlo abren los mismos selects apilados dentro del `Modal` ya existente en el repo, con "Limpiar"/"Listo" en el footer. Desktop queda igual (selects inline como antes).
  - Nota de concurrencia: el working tree traía cambios sueltos de otra sesión (`mondayUpdatedAt` en `StageBoardList`/`ProyectoBoardList`/`ProyectoSection`/`apiClient`/worker) — se dejaron sin commitear, solo se tocó `FilterBar.tsx`.
  - Verificado en vivo con Playwright a 390×844: la fila de filtros pasó de varias líneas envueltas a una sola; el filtrado sigue aplicando en vivo dentro del modal (599 → 12 activas al elegir un vendedor) y el badge de conteo refleja el filtro activo.
- **`fef6ea2`** — Cotización móvil: lista de tarjetas en vez de grid horizontal
  - Efraín reportó (con captura) que la grid de Cotización en móvil se veía "horrible" — 9 (venta) a 16 (costeo) columnas fijas obligaban a scroll horizontal con celdas ilustradas casi ilegibles. Pidió pensarla distinto, en lista en vez de grid.
  - Nuevo `MobileQuoteRow.tsx`: cada línea de producto se apila en una tarjeta — el Producto arriba (input o texto según sea editable), el resto de columnas visibles (SKU, Color, Cant., Con Embellecimiento, precios/costos según variante) en pares label/valor de 2 columnas. Reusa el mismo `RowEditState`/callbacks que la grid de escritorio (`CotizacionTab.tsx`) — mismas reglas de escritura, sin duplicar lógica de negocio, solo el layout.
  - `TotalsRow` gana variante `isMobile` (resumen apilado en vez de la fila alineada a columnas) y `SnapshotTable` (instantánea de una versión superada) detecta `useIsMobile` internamente y renderiza sus propias tarjetas — mismo problema, mismo fix, para no dejar la vista de "versión anterior" rota en móvil.
  - Desktop intacto (screenshot 1400px sin cambios). Verificado con Playwright a 390×844 contra una oportunidad real con 8 líneas: tarjetas sin scroll horizontal, edición inline funcional, total apilado al final del listado.
  - Nota de concurrencia: el working tree traía cambios sueltos de otra sesión (`gridMeta.tsx` con columnas de Descripción/Tallas/confirmación de producto, más `App.tsx`/`Sidebar.tsx`/`ProyectoSection.tsx`/worker/shared) — se dejaron sin commitear, solo se tocaron los 3 archivos de la grid de Cotización + el nuevo `MobileQuoteRow.tsx`.
- **`b9b9e2c`** — Agregar vista "Oportunidades Web": filtro por prefijo WEB- en el pipeline
  - Efraín pidió un board "Oportunidades Web" — resultó ser, tras aclarar, no un board nuevo de Monday sino una vista/filtro más sobre el mismo board Oportunidades (id 18395657596): los items ya vienen con el nombre prefijado "WEB -" en Monday (leads del sitio web), solo faltaba exponerlo en el portal.
  - `StageBoardConfig` (`src/lib/dealStages.ts`) gana `namePrefix?: string`; nueva entrada `oportunidades_web` en `STAGE_BOARDS` sin filtro de etapa (pipeline completo) y `namePrefix: 'WEB -'`. `StageBoardList.tsx` aplica el filtro por nombre encadenado al de `stages` ya existente.
  - Nuevo ítem "Oportunidades Web" en el sidebar (sección Ventas, después de Oportunidades) con ícono de globo nuevo (`IconGlobe`). Ruta `/oportunidades_web` habilitada en `routing.ts`; se renderiza con el `StageBoard` genérico (mismo componente que Costeo/Validación) para no heredar el modal "+ Nueva oportunidad", exclusivo del board Oportunidades.
  - Verificado en vivo con Playwright: 32 oportunidades "WEB -" agrupadas por etapa, drawer abre en modo editable normal (igual que Oportunidades), `tsc --noEmit` y `oxlint` limpios.
  - Nota de concurrencia: el working tree traía cambios sueltos de otra sesión bastante más grandes (docs, `shared/column-meta.gen.ts`, `shared/visibility.ts`, `worker/lib/canon.ts`/`columnEncode.ts`/`costeo.ts`, `ProyectoSection.tsx`, `apiClient.ts`, `worker/routes/oportunidades.ts`, y un segundo cambio en `StageBoardList.tsx` de `mondayUpdatedAt`) — se dejaron sin commitear; en `StageBoardList.tsx` se usó `git add -p` para stagear solo el hunk del filtro por nombre.
- **`e372579`** — Agregar GitHub Actions: deploy automático a Cloudflare Workers en push a main
  - Efraín notó que sus pushes a `main` no se reflejaban en Cloudflare — el repo no tenía ninguna integración CI/CD (sin `.github/workflows`, sin script `deploy` en `package.json`); los deploys previos siempre fueron manuales (`wrangler deploy` desde un worktree limpio, como se documentó en `697a0f6`).
  - Nuevo `.github/workflows/deploy.yml`: en push a `main` corre `npm ci` → `tsc --noEmit` → `npm run build` → `wrangler deploy` vía `cloudflare/wrangler-action@v3`.
  - Secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` cargados al repo de GitHub (`gh secret set`, valores tomados del `.env` local existente — el mismo token que ya usan los deploys manuales — sin exponerlos en la sesión).
  - Nota de concurrencia: el working tree traía cambios sueltos y sin relación de otra sesión (inventario, docs, shared, worker/*, `wrangler.jsonc`, etc.) — se dejaron sin commitear, solo se agregó el archivo nuevo del workflow.
- **`dae0d9e`** — Fase 1 de migración de archivos a Cloudflare R2
  - Efraín pidió mover a almacenamiento propio los archivos que hoy solo viven en columnas `file` de Monday y se sirven vía URLs S3 firmadas que expiran ~1h. Fase 1 acotada a lo que el portal mismo sube: documento (OC/cotización/contrato firmado, `PROYECTO_DOCUMENTO_COL`) y embellecimiento por zona — lo que genera cmp-tallas (tallas/OC/costeo/cotización PDFs) queda fuera, ese servicio externo sigue subiendo a Monday.
  - Decisión tomada con Efraín antes de codear: esquema de key `oportunidades/{oppId}/{categoria}/{filename}`, resolviendo siempre el oppId de datos ya cargados (sin queries extra) — `linkedItemId(row, PROYECTO_OPP_REL)` para documento, `row.parent_item_id` para embellecimiento. Hallazgo de diseño: el key de embellecimiento necesitó incluir el `lineaId` (no solo la zona) porque dos líneas de la misma oportunidad pueden subir el mismo nombre de archivo a la misma zona — en Monday no colisiona porque cada línea tiene su propia columna de archivo independiente.
  - Nuevo bucket R2 "mexicanadeproteccion" (binding `FILES`), `worker/lib/r2.ts` (helpers), dual-write Monday+R2 en `POST /api/proyectos/:id/documento` y `uploadZoneImage`/`listZoneImages` (`worker/lib/embellecimientoImagenes.ts`). Nueva `GET /api/files/:key{.+}` sirve desde R2 y cae de vuelta a Monday (resolviendo el asset del mirror) si el key aún no existe — así el frontend puede apuntar siempre a `/api/files/...` sin depender del orden del backfill. Frontend (`DocumentacionTab.tsx`/`OcContratoSection`, `ProyectoDrawer.tsx`) reconstruye el link de R2 en vez de usar la URL firmada de Monday.
  - Script `scripts/backfill-r2-files.mjs` (dry-run por default, `--exec` sube de verdad, shell-out a `wrangler r2 object put --remote` igual que `hydrate.mjs` shell-a `wrangler d1 execute`) para pre-calentar R2 con archivos subidos antes de la migración.
  - Bloqueo real durante la ejecución: `wrangler r2 bucket create` falló (error 10042, R2 no habilitado en la cuenta) — Efraín lo habilitó desde el Dashboard a media sesión, se creó el bucket y se continuó.
  - Verificado en vivo contra Monday real y el bucket real: upload de documento (proyecto 12306734078) y de imagen de embellecimiento (línea 12237994419, zona Espalda) — dual-write confirmado, `GET /api/files/...` sirve bytes idénticos desde R2, 404 correcto para keys inexistentes. Backfill `--exec` corrido contra producción: solo 1 archivo real pre-existente en todo el corpus (54 proyectos, 2864 líneas) — el resto son features muy recientes. Los 2 archivos de prueba subidos durante la verificación se borraron de R2 (local y remoto); en Monday real quedan pendientes de borrado manual por Efraín (proyecto 12306734078 columna documento, línea 12237994419 zona Espalda) — los archivos solo se agregan, no sobrescriben, cero riesgo sobre datos reales.
  - Nota de concurrencia: `worker/routes/oportunidades.ts` traía cambios sueltos de otra sesión (`checkValidacion`/`validacion-check`, `onlyProveedor` en `generar-oc`) mezclados en el mismo archivo — se aisló el commit reconstruyendo el blob solo con los hunks propios (`git hash-object`+`git update-index --cacheinfo`) en vez de tocar el working tree, para no pisar ese trabajo en progreso. El resto del tree (inventario, docs, shared, schema) también se dejó sin commitear.
- **`46b740f`** — Inventario: catálogo de Almacenes y buscador de productos en Nuevo movimiento
  - Efraín pidió un board tipo catálogo "Almacenes" en Monday con búsqueda inteligente de Productos; tras aclarar alcance con él, Inventario sigue siendo deliberadamente nativo en D1 (no un board de Monday, ver `worker/routes/inventario.ts`), así que la mejora se hizo dentro de esa arquitectura: nueva pestaña "Almacenes" (`AlmacenesTab.tsx`) para listar y agregar almacenes fácilmente (`POST /api/inventario/warehouses`), y el campo Producto en "Nuevo movimiento" pasó de texto libre a un buscador contra el board real Productos de Monday (mismo patrón `usePoll`+`SearchInput` que el picker de Proveedor en `AgregarLineaModal`).
  - Seed de Mérida y CDMX como primeros almacenes tipo `bodega` en `worker/schema.sql` (antes solo existían los 5 "vendedor"); aplicado a D1 local, pendiente aplicar a D1 remoto en el próximo deploy (`--remote`).
  - Verificado en vivo con Playwright: pestaña Almacenes lista los 2 bodegas + 5 vendedores y el alta funciona; buscador de producto trae resultados reales del board Productos al escribir.
  - Nota de concurrencia: el working tree traía cambios sueltos y sin relación de otra sesión (docs, `shared/column-meta.gen.ts`, `shared/visibility.ts`, `shared/embellecimiento.ts`, boards de Oportunidades/Proyectos, `worker/lib/{assistantPersonas,assistantTools,canon,columnEncode,costeo,createOportunidad,serialize}.ts`, `worker/routes/oportunidades.ts`, R2) — se dejaron sin commitear, solo se stagearon los 8 archivos propios del módulo de Inventario.
- **`6765605`** — Chevron de detalle + confirmación de Compras (descripción/tallas) antes de Validación
  - Efraín pidió, en el board Costeo > tab Cotizaciones, ver la descripción y tallas completas de cada línea (hoy solo Producto/SKU/Total) y que Compras confirme explícitamente que son correctas — bloqueando "Mandar a Validación de costeo" hasta que todas las líneas estén confirmadas. Decisión de Efraín tras preguntar: confirmación por línea/producto (no una sola para toda la cotización) y guardada en el catálogo Productos, no en la línea — "esa info queda guardada POR producto".
  - Columna checkbox nueva "Descripción y tallas confirmadas" en Productos (`boolean_mm5cqtjs`, creada por Claude vía Monday MCP a petición explícita de Efraín): consistente con que Descripción/Tallas de las líneas ya son mirrors de `long_text_mm0xse7v`/`long_text_mm174q0j` del catálogo vía `board_relation_mkzmafgp` — confirmar ahí evita re-confirmar el mismo SKU en cada cotización donde aparece.
  - Chevron por línea (desktop grid y tarjeta móvil, `LineDetailPanel.tsx` nuevo compartido) expande Descripción/Tallas + el checkbox (editable solo compras/admin). Tras la primera pasada Efraín pidió más visibilidad: badge "Sin confirmar" en la fila colapsada (sin necesidad de expandir) y chevron más grande/bold (antes "no se veía mucho").
  - `checkValidacion` (`worker/lib/costeo.ts`) exige que cada línea tenga su producto de catálogo confirmado; `enviarAValidacion` lo aplica de verdad (422 con la lista de pendientes) — mismo patrón que `checkCosteo`/"Mandar a costeo", no solo la UI deshabilitada.
  - Ningún checkbox se había escrito antes en este repo — dos bugs reales encontrados verificando en vivo contra Monday (no en teoría): Monday rechaza `''` para desmarcar un checkbox (quiere JSON `null`, a diferencia de casi todos los demás tipos); y el write-hash de confirmación de eco canonicaliza dos veces (mirror optimista + dentro de `writeHash`) — el canon de checkbox no era idempotente (`'1'` no volvía a canonicalizar a `'1'`) y producía falsos "conflict" aunque el write a Monday sí hubiera funcionado.
  - Verificado en vivo contra Monday real (producto "Sublite Cushion Tactical", RB8805): ciclo check→uncheck→check confirmado en outbox y en el mirror, gate real de `enviarAValidacion` probado (422 con unconfirmed, luego 200 tras confirmar), Playwright a 390px y 1400px con el checkbox clickeado en vivo. El producto de prueba se dejó sin confirmar al terminar (no fue realmente revisado por Compras).
  - Nota de concurrencia: el working tree traía cambios sueltos y grandes de otra sesión (R2/embellecimiento, inventario, OC por proveedor) mezclados en los mismos archivos que este trabajo (`gridMeta.tsx`, `apiClient.ts`, `worker/routes/oportunidades.ts`, `OpportunityDrawer.tsx`) — se aisló el commit reconstruyendo cada archivo a HEAD + solo los hunks propios (verificado con `tsc --noEmit` sobre el subconjunto vía `git stash --keep-index`) antes de restaurar el working tree combinado; el resto se dejó sin commitear.
- **`43d8dbc`** — Fase 2 de migración R2, embellecimiento por zona en el asistente y OC por proveedor
  - Efraín reportó la app rota tras acumular muchos cambios sin commitear; causa real: `gridMeta.tsx` re-exportaba `EMB_STATUS_COL` desde `shared/embellecimiento.ts` (`export {...} from`) sin importarlo también para uso local — ese patrón no crea binding local, y el archivo sí usa `EMB_STATUS_COL` en `inlineEditableCols`/`GRID_COLS_VENTA`, así que `tsc` fallaba (TS2304) y bloqueaba el build. Fix: import explícito además del re-export.
  - Con el build ya sano, se confirmó y commiteó el resto del trabajo acumulado: fase 2 de la migración a R2 (`docs/cmp-tallas-endpoint-map.md`) — los archivos que genera cmp-tallas subiendo directo a Monday (solicitud de costeo, cotización no/firmada, tallas, OC) ahora se sirven vía `/api/files/...` con el mismo fallback a Monday que ya tenían documento/embellecimiento (sin dual-write posible, es el único mecanismo real); `scripts/backfill-r2-files.mjs` pre-calienta esas 5 categorías y trocea `fetchAssetPublicUrls` en lotes de 200 — Monday trunca en silencio (~1000 de 2339 ids) sin dar error.
  - Asistente (WA + portal, `assistantPersonas.ts`/`assistantTools.ts`/`createOportunidad.ts`): nueva tool de embellecimiento por zona al crear una oportunidad — pregunta las 8 zonas del template, valida contra `EMBELL_TEMPLATE_KEYS`, serializa a la columna real de la línea.
  - Tab Órdenes de compra (`ProyectoSection.tsx`): grid de líneas agrupado por proveedor (`board_relation` ahora se parsea con id real, no solo texto — `serialize.ts`) con botón de generar OC individual por proveedor (`onlyProveedor`) además del botón general.
  - Fix: "sincronizado hace" en las listas de Oportunidades/Proyectos usaba `syncedAt` (hora del mirror local) en vez de `mondayUpdatedAt` (hora real del cambio en Monday).
  - Nota de concurrencia: el working tree traía cambios sueltos de otra sesión activa en tiempo real durante esta misma revisión (`shared/visibility.ts`, rename `EditInstitucionModal.tsx`→`EditContactoModal.tsx`, `BoardTable.tsx` con una constante `COL_MAX_WIDTH` sin definir — a medio editar) — se detectó por archivos que aparecían modificados entre una revisión y la siguiente sin acción propia, y se aisló el commit con `git stash push --keep-index -u` para tipar en limpio solo el subconjunto propio antes de hacer `pop` y devolver el working tree combinado intacto; esos 4 archivos se dejaron sin commitear.
- **`dd1615f`** — Truncar columnas anchas en tablas de catálogo y agregar picker de Vendedor en Contactos
  - Efraín reportó (con captura) la columna Nombre de Contactos demasiado ancha por nombres institucionales larguísimos, y el scroller horizontal invisible hasta bajar toda la tabla de 658 filas — `BoardTable.tsx` nesteaba `overflowX: auto` en un div del alto del contenido en vez del viewport. Fix: todas las columnas (no solo Nombre) truncan a `max-width: 280px` con ellipsis + `title` tooltip, y el scroll X/Y se fusiona en un solo contenedor en `GenericBoardView.tsx` (antes solo `overflowY`). El mismo truncado resolvió de paso "Clientes" en Instituciones, reporte separado de Efraín con la misma causa raíz.
  - A petición de Efraín, `EditInstitucionModal.tsx` se renombra a `EditContactoModal.tsx` y gana un segundo picker con buscador para reasignar Vendedor (antes solo tenía el de Institución) — se quita el prefijo "Institución —" del título del modal, ahora solo el nombre del contacto.
  - `multiple_person_mm03vqwx` (Vendedor, Contactos) no era escribible en `shared/visibility.ts` — se le preguntó a Efraín antes de tocar el whitelist (regla dura del repo); confirmó el mismo set `vendedor+admin` que ya tiene Institución.
  - Verificado en vivo con Playwright contra Monday real: PATCH 200 al reasignar el vendedor de un contacto real (Alan Mancilla Contreras), confirmado en el modal y en la fila con el ícono de sincronizando; revertido al vendedor original al terminar la verificación. `tsc --noEmit` y `oxlint` limpios.

- Fix: no cargaban las actualizaciones de ninguna oportunidad (reporte de Efraín)
  - Causa raíz: el commit de ayer (`8e2846b`, "Actualizaciones no reflejaba las
    respuestas") reutilizó `UPDATE_FIELDS` — que incluye `assets{id name
    file_extension}` — también para el selection set de `replies` en
    `fetchUpdates` (`worker/lib/monday.ts`). Pero en el schema de Monday que
    usa el repo (`API-Version: 2025-04`), el tipo `Reply` no tiene campo
    `assets` (confirmado con introspección en vivo: `Reply` solo trae `body,
    created_at, creator, creator_id, id, text_body, updated_at, kind,
    edited_at, likes, pinned_to_top, viewers`). GraphQL valida el shape de la
    query completa antes de ejecutarla, así que la query fallaba con
    `"Cannot query field \"assets\" on type \"Reply\""` para CUALQUIER item,
    tuviera o no replies — de ahí que fuera "ninguna oportunidad", no un dato
    específico.
  - Fix: `REPLY_FIELDS` separado (sin `assets`) para el selection set de
    `replies`; `UPDATE_FIELDS` (con `assets`) se queda igual para los updates
    de primer nivel. `worker/routes/boards.ts:301` ya usaba `u.assets ?? []`
    al armar el DTO, así que las respuestas simplemente quedan con
    `attachments: []` (correcto — Monday no soporta adjuntos en replies en
    esta versión de API, no es una regresión).
  - Verificado con `tsc --noEmit` y `npm test` (219 tests), y end-to-end
    contra Monday real: query exacta confirmada con error de schema antes del
    fix (`curl` directo con la API key real, `API-Version: 2025-04`) y 200 con
    datos reales después (oportunidad OPP-0774, updates con replies anidados).
    También probado contra el worker local (`GET
    /api/boards/oportunidades/items/:id/updates` → 200).
