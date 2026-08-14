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

export type DocTemplateId = 'solicitud-costeo' | 'cotizacion' | 'remision-inventario' | 'constancia-firma';

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
  // "Salir de Monday" (Zona Efrain, test, 2026-08-13): cotización con precios
  // para el cliente, generada 100% en el portal (sin Eledo, sin subir a una
  // columna de Monday) — solo la usa generarCotizacionNativeD1
  // (worker/lib/cotizacion.ts) para items nativos. Auto-acuse, como
  // solicitud-costeo: sin ceremonia de firma en este primer corte.
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

/** Nombre del archivo que descarga el usuario. */
export function documentFilename(doc: { templateId: DocTemplateId; folio: string | null; id: string }, signed: boolean): string {
  const base = DOC_TEMPLATES[doc.templateId]?.label.replace(/\s+/g, '-') ?? 'Documento';
  const ref = doc.folio || doc.id.slice(0, 8);
  return `${base}-${ref}${signed ? '-firmado' : ''}.pdf`;
}

/** Huella corta para mostrar en la UI sin abrumar (los 16 primeros hex). */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ');
}
