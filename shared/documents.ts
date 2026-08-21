// Documentos del portal + firma electrónica (2026-07-25). Dos piezas que se
// apoyan una en la otra:
//
//  1. GENERACIÓN — plantillas declarativas renderizadas server-side a PDF
//     (worker/lib/pdf/*). No reemplazan lo que genera cmp-tallas (cotización
//     al cliente, tallas, OC): son documentos internos del portal.
//  2. FIRMA — cada documento se puede firmar dentro del portal. La firma es un
//     trazo (JPEG) + un registro de auditoría en D1 (quién, cuándo, desde dónde,
//     y el SHA-256 del PDF exacto que se firmó). El PDF firmado se REGENERA con
//     el bloque de firma incluido, así que el hash sellado es lo que ata la
//     firma al contenido.
//
// Los PDF ajenos (los que sube cmp-tallas a Monday) no se pueden re-renderizar,
// así que para esos la firma produce una "Constancia de firma electrónica"
// aparte que referencia el hash del archivo original.
import type { Role } from './types';
import { nombreDescarga } from './nombreArchivo';

export type DocTemplateId = 'solicitud-costeo' | 'cotizacion' | 'validacion-costeo' | 'remision-inventario' | 'constancia-firma';

/** De dónde salen los datos del documento. `archivo` = PDF que ya existe en
 * Monday/R2 y que el portal solo sella + certifica (no lo genera). */
export type DocSourceKind = 'oportunidad' | 'movimiento' | 'archivo';

export interface DocTemplate {
  id: DocTemplateId;
  label: string;
  description: string;
  source: DocSourceKind;
  /** Roles que pueden generar el documento. */
  create: Role[];
  /** Roles que pueden VER el documento (listarlo/descargarlo) — además de
   * poder ver la fuente (assertSourceVisible en worker/lib/documents.ts). Sin
   * esto, todo el que puede ver la oportunidad puede ver cualquiera de sus
   * documentos, que es lo correcto para la mayoría (solicitud de costeo,
   * cotización). `validacion-costeo` trae costos/utilidad y es la excepción:
   * "ESTO SOLO LO VEN compras y admin" (Efraín, 2026-08-14). Sin este campo =
   * sin restricción extra (default: todos los que ven la fuente). */
  view?: Role[];
  /** Roles que pueden firmarlo. Lista vacía = documento no firmable. */
  sign: Role[];
  /** Cuántas firmas admite antes de considerarse completo. */
  maxSignatures: number;
  /** El documento se asienta solo con el ACUSE de quien lo generó (identidad de
   * Access + fecha + huella), sin pedirle a nadie que firme: "no es necesario
   * firmar, es solo el hecho de que se hizo" (Efraín, 2026-07-26). Estas
   * plantillas llevan `sign: []` — no hay firma manual que ofrecer. */
  autoAcuse?: boolean;
}

const ALL: Role[] = ['vendedor', 'compras', 'admin'];

export const DOC_TEMPLATES: Record<DocTemplateId, DocTemplate> = {
  'solicitud-costeo': {
    id: 'solicitud-costeo',
    label: 'Solicitud de costeo',
    description: 'Las líneas de producto de la oportunidad SIN precios, para que compras las costee. Sale con el acuse de quien la solicitó; no requiere firma.',
    source: 'oportunidad',
    create: ALL,
    // Sin firma manual: el acuse automático es todo lo que lleva.
    sign: [],
    maxSignatures: 1,
    autoAcuse: true,
  },
  // "Salir de Monday" (Zona Efrain, 2026-08-13): cotización con precios para el
  // cliente, generada 100% en el portal. SIN USO desde el 2026-08-18: la
  // cotización nativa volvió a la plantilla de Eledo + firma DocuSeal, la misma
  // que recibe el cliente en el flujo normal (Efraín: "replicar la construcción
  // de una cotización con Eledo y DocuSeal nativo"), y vive en las columnas de
  // archivo como cualquier otra. Se conserva la plantilla porque el motor de
  // PDF propio sigue ahí y es el respaldo si Eledo se cae.
  cotizacion: {
    id: 'cotizacion',
    label: 'Cotización',
    description: 'Cotización con precios para el cliente, generada nativamente en el portal.',
    source: 'oportunidad',
    create: ALL,
    sign: [],
    maxSignatures: 1,
    autoAcuse: true,
  },
  // Hoja de costeo al mandar a validación (2026-08-14): snapshot en horizontal
  // de TODAS las columnas de la grid de Costeo (producto, costos, precio,
  // márgenes) tal como quedaron al pasar la etapa "En costeo" → "Costeo en
  // validación". Sale sola al dar "Mandar a Validación de costeo"
  // (worker/routes/oportunidades.ts) — nadie la genera a mano. Solo
  // compras/admin la ven: trae costos y utilidad, que el vendedor nunca ve
  // (Efraín, 2026-08-14: "ESTO SOLO LO VEN compras y admin").
  'validacion-costeo': {
    id: 'validacion-costeo',
    label: 'Costeo — Validación',
    description: 'Todas las columnas de la cotización costeada (costos, precio, márgenes), en horizontal. Sale sola al mandar a validación de costeo.',
    source: 'oportunidad',
    create: ['compras', 'admin'],
    view: ['compras', 'admin'],
    sign: [],
    maxSignatures: 1,
    autoAcuse: true,
  },
  'remision-inventario': {
    id: 'remision-inventario',
    label: 'Remisión de inventario',
    description: 'Comprobante de entrega/salida de un movimiento de inventario, con firma de quien entrega y de quien recibe.',
    source: 'movimiento',
    create: ['almacen', 'compras', 'admin'],
    sign: ['almacen', 'compras', 'admin', 'vendedor'],
    maxSignatures: 2,
  },
  'constancia-firma': {
    id: 'constancia-firma',
    label: 'Constancia de firma',
    description: 'Sella un PDF que ya existe (cotización generada, orden de compra, contrato) y emite la constancia de firma electrónica con su huella SHA-256.',
    source: 'archivo',
    create: ALL,
    sign: ALL,
    maxSignatures: 2,
  },
};

export function isDocTemplateId(value: string): value is DocTemplateId {
  return value in DOC_TEMPLATES;
}

/** Texto que el firmante acepta explícitamente antes de firmar; se guarda
 * palabra por palabra en la fila de la firma (evidencia de consentimiento). */
/** Texto que se asienta cuando el documento se acusa solo (autoAcuse): no hubo
 * ceremonia de firma, lo que consta es que la acción se hizo desde una sesión
 * autenticada del portal. */
export const ATTEST_INTENT =
  'Documento generado desde el portal por la cuenta autenticada que aparece en el ' +
  'acuse. No requiere firma: lo que consta es la acción, su fecha y la huella ' +
  'SHA-256 del documento.';

export const SIGN_INTENT =
  'Acepto que el trazo y los datos de identidad registrados constituyen mi firma ' +
  'electrónica sobre este documento, y que su contenido queda sellado por la huella ' +
  'SHA-256 asentada en el acuse.';

export interface SignatureDTO {
  id: number;
  signerEmail: string;
  signerName: string;
  signerRole: string;
  signedAt: string;             // ISO
  /** SHA-256 del PDF base en el momento de firmar — debe coincidir con el del documento. */
  sha256: string;
  /** Trazo de la firma; null cuando se firmó solo con nombre mecanografiado. */
  imageUrl: string | null;
  ip: string | null;
}

export interface DocumentDTO {
  id: string;                   // uuid
  templateId: DocTemplateId;
  title: string;
  sourceKind: DocSourceKind;
  sourceId: string;
  boardKey: string | null;
  folio: string | null;
  /** SHA-256 del PDF base (el que se firma). */
  sha256: string;
  bytes: number;
  createdBy: string;
  createdAt: string;
  signatures: SignatureDTO[];
  /** true cuando ya alcanzó maxSignatures. */
  complete: boolean;
}

export interface CreateDocumentRequest {
  templateId: DocTemplateId;
  /** itemId de la oportunidad, id del movimiento, o key de /api/files para `archivo`. */
  sourceId: string;
  /** Solo para `archivo`: nombre legible del PDF que se está sellando. */
  sourceLabel?: string;
}
export interface CreateDocumentResponse { ok: boolean; document?: DocumentDTO; error?: string }

export interface SignDocumentRequest {
  /** data URL image/jpeg del trazo (canvas). Opcional: sin trazo la firma queda
   * asentada solo con la identidad autenticada + nombre mecanografiado. */
  signatureJpeg?: string;
  /** Nombre tal como el firmante lo escribió; por default el de su identidad. */
  typedName?: string;
  /** Debe llegar exactamente igual a SIGN_INTENT — el server rechaza cualquier otro. */
  intent: string;
}
export interface SignDocumentResponse { ok: boolean; document?: DocumentDTO; error?: string }

export interface DocumentsResponse { documents: DocumentDTO[] }

/** Nombre del archivo que descarga el usuario. `itemName` es el `name` del item
 * fuente en Monday ("OPP-0947 - CONOS TORREON"), que ya trae el folio adelante;
 * sin él (remisiones de inventario) se cae al folio propio del documento. */
export function documentFilename(
  doc: { templateId: DocTemplateId; folio: string | null; id: string }, signed: boolean, itemName?: string | null,
): string {
  const etiqueta = `${DOC_TEMPLATES[doc.templateId]?.label ?? 'Documento'}${signed ? ' (firmado)' : ''}`;
  if (itemName) return nombreDescarga({ item: itemName, etiqueta });
  return nombreDescarga({ etiqueta: `${etiqueta} ${doc.folio || doc.id.slice(0, 8)}` });
}

/** Huella corta para mostrar en la UI sin abrumar (los 16 primeros hex). */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ');
}
