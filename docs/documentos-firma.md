# Documentos del portal + firma electrónica

Dos features que se apoyan una en la otra (2026-07-25):

1. **Generación de PDFs** con plantillas declarativas, renderizadas en el Worker.
2. **Firma electrónica** de esos documentos y de los PDF que ya existen en Monday.

No reemplazan a cmp-tallas: la cotización al cliente, las tallas y la OC las sigue
generando Vercel (`docs/cmp-tallas-endpoint-map.md`). Lo de aquí son documentos
internos del portal, más la capa de firma sobre cualquiera de los dos mundos.

## Piezas

| Archivo | Qué hace |
|---|---|
| `shared/documents.ts` | Contrato + registro de plantillas (`DOC_TEMPLATES`), roles que generan/firman, `SIGN_INTENT`. |
| `worker/lib/pdf/writer.ts` | Escritor de PDF sin dependencias: Helvetica/Bold, líneas, rectángulos, JPEG. |
| `worker/lib/pdf/layout.ts` | Bloques → páginas: encabezado/pie, tablas que se parten, cajas de firma. |
| `worker/lib/pdf/templates.ts` | Las 3 plantillas (datos planos → bloques). Funciones puras. |
| `worker/lib/documents.ts` | D1 + R2: crear, listar, firmar, portón de integridad. |
| `worker/routes/documents.ts` | `/api/documents*`. |
| `worker/lib/portalFiles.ts` | Resuelve un key de `/api/files` → bytes (R2, con fallback al asset de Monday). |
| `src/components/documents/` | `DocumentsPanel` (genera/lista/firma), `SignDocumentModal`, `SignaturePad`. |
| `src/lib/documentsApi.ts` | Cliente tipado. |

Tablas D1: `documents` y `document_signatures` (ver `worker/schema.sql`). Se crean
**lazy** en runtime (`ensureDocumentTables`), como `api_cache` — no hay que aplicar
el schema en remoto para que la feature encienda.

R2: `documentos/{docId}/base.pdf`, `.../firmado.pdf`, `.../firma-N.jpg`.

## Plantillas

| Id | Fuente | Firman | Para qué |
|---|---|---|---|
| `solicitud-costeo` | oportunidad (`item_id`) | — (acuse automático) | Las líneas de la oportunidad **sin precios**, para que compras las costee. Se genera sola al dar "Mandar a costeo". |
| `remision-inventario` | movimiento (`movements.id`) | almacén · compras · admin · vendedor | Comprobante de entrega: firma quien entrega y quien recibe. |
| `constancia-firma` | archivo (key de `/api/files`) | vendedor · compras · admin | Sella un PDF que ya existe (cotización generada, OC, contrato) y emite la constancia con su huella. |

Agregar una plantilla = tipo de datos + `case` en `buildBlocks` + entrada en
`DOC_TEMPLATES` + (si necesita datos nuevos) un resolver en `documents.ts`.

## Reglas que sostienen la firma

- **El documento guarda su snapshot** (`documents.data`). El PDF firmado se
  re-renderiza de ese snapshot, nunca de una lectura fresca del mirror: si no, el
  contenido firmado cambiaría bajo los pies del firmante.
- **`sha256` es la huella del PDF base** guardado en R2. Antes de asentar una firma
  se re-lee y se re-hashea; si no coincide, la firma se rechaza con 409
  (`el documento cambió desde que se generó`).
- **Un PDF ajeno no se modifica** — no hay parser de PDF, solo escritor. Se copia a
  R2 (inmutable aunque Monday cambie) y la firma vive en su *constancia*, que
  referencia la huella del original.
- **Una firma por persona por documento** (índice UNIQUE), con evidencia:
  identidad autenticada por Access, nombre, rol, consentimiento textual aceptado
  palabra por palabra, IP puesta por Cloudflare (`CF-Connecting-IP`), user-agent y
  el hash del PDF firmado.
- **Regenerar reemplaza al documento sin firmar** de la misma plantilla+fuente, en
  vez de acumular copias. En cuanto tiene una firma ya no se toca: ahí nace un
  documento nuevo, porque el anterior es evidencia.
- El trazo es **opcional**; la identidad no. Sin trazo la firma queda asentada con
  la cuenta autenticada y el nombre mecanografiado.
- **Acuse automático (`autoAcuse`)**: para la solicitud de costeo no hay ceremonia
  de firma — "no es necesario firmar, es solo el hecho de que se hizo" (Efraín,
  2026-07-26). El documento se asienta al generarse con la misma evidencia que una
  firma (identidad de Access, fecha, IP, huella) pero con `ATTEST_INTENT` y sin
  trazo. Esas plantillas llevan `sign: []`, así que la UI no ofrece firmar y la
  ruta HTTP las rechaza: el acuse solo lo pone el server (`attestDocument`).
  Regenerar reescribe el acuse; solo una firma **manual** vuelve inmutable al
  documento.

## Endpoints

```
GET  /api/documents?sourceKind=oportunidad|movimiento|archivo&sourceId=…
POST /api/documents                     {templateId, sourceId, sourceLabel?}
GET  /api/documents/:id
GET  /api/documents/:id/pdf[?firmado=1]
GET  /api/documents/:id/firmas/:sigId   (JPEG del trazo)
POST /api/documents/:id/firmar          {signatureJpeg?, typedName?, intent}
```

Todo pasa por access+identity y además por el scoping de la **fuente**: una
oportunidad se valida con `dal.getItem` (el vendedor solo ve las suyas) y una
remisión exige acceso al board `inventario`. `/api/files` quedó limitado al prefijo
`oportunidades/` a propósito: los PDF de `documentos/…` solo se sirven por su ruta,
que sí revisa la fuente.

## Qué NO genera el portal

Las **cotizaciones al cliente siguen saliendo de Eledo** (decisión de Efraín,
2026-07-26). Lo que el portal genera para saltarse Eledo es la **solicitud de
costeo** y —pendiente— la **OC a proveedor**. Diseño: formato propio del portal,
fondo blanco, sin imágenes de producto (el motor solo embebe JPEG y el catálogo
las tiene en PNG; SKU + marca identifican la partida).

## Dónde se usa en la UI

- **Oportunidad → Documentación**: sección "Documentos del portal" (solicitud de
  costeo) y, bajo cada solicitud/cotización de Monday, "Firma electrónica de …"
  (constancia).
- **Inventario → Movimientos**: columna *Remisión* → "Generar / firmar" despliega el
  panel de la remisión de ese movimiento.

`SignDocumentModal` siempre previsualiza el PDF antes de firmar (nadie firma a
ciegas) con `PdfCanvasPreview`; se carga con `lazy()` para no arrastrar pdfjs al
montar el panel.

## Notas de implementación

- El escritor de PDF se hizo a mano en vez de traer `pdf-lib` para no tocar
  `package.json` (había otra sesión con el árbol sucio) y porque lo que se necesita
  son tablas y bloques de texto, no PDFs arbitrarios. Si algún día hace falta
  estampar sobre un PDF existente (firma dentro del archivo original), ahí sí
  conviene `pdf-lib`: es lo único que este writer no puede hacer.
- El texto se escribe en **WinAnsi con escapes octales**, no UTF-8: los acentos
  salen bien y el stream queda 100% ASCII (`pdfString`). Anclado en tests.
- Las firmas se capturan como **JPEG**, no PNG, porque el writer solo embebe
  DCTDecode (un PNG con alpha necesitaría inflar el IDAT para separar el SMask).
- Verificación visual: `qlmanage -t -s 1400 -o <dir> archivo.pdf` renderiza con el
  motor de PDF de macOS — sirve para revisar a ojo lo que genera el Worker.
