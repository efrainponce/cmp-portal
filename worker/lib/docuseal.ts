// worker/lib/docuseal.ts — DocuSeal cliente delgado para pedir firma electrónica
// sobre un PDF ya subido a Monday (Fase 0, plan "salir de Monday", 2026-08-12). El
// Worker llama a DocuSeal directo en vez de que cmp-tallas sea el intermediario —
// mismo endpoint/auth para 1 o varias firmas (la cotización pide 1, la OC pide 3
// en orden Elaborado→Revisado→Autorizado; `order` en cada signer es lo que le dice
// a DocuSeal la secuencia — nativo suyo, no hay que reconstruirlo).
//
// NO se migra a la firma electrónica propia del portal (worker/lib/documents.ts) —
// decisión ya tomada (docs/documentos-firma.md): DocuSeal sigue siendo el firmante
// de cotización/tallas/OC.
import type { Env } from '../env';

export class DocuSealError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const DOCUSEAL_URL = 'https://api.docuseal.com/submissions/pdf';
// bcc real de cmp-tallas (api/generate_cotizacion.py, api/generate_oc.py) — cada
// submission completada le llega en copia, no es un secreto.
const BCC_COMPLETED = 'administracion@mexicanadeproteccion.com';

export interface DocuSealSigner {
  role: string;     // etiqueta que ve el firmante, p.ej. "Vendedor" / "Elaborado"
  name: string;
  email: string;
  /** Firma secuencial (0,1,2,…) — solo para submissions de varias firmas (OC).
   * Sin `order`, DocuSeal deja que todos firmen en cualquier momento. */
  order?: number;
}

export interface CreateSubmissionInput {
  /** Nombre de la submission en DocuSeal — cmp-tallas usa el item_id de Monday. */
  name: string;
  /** URL pública del PDF ya subido a Monday (public_url de addFileToColumn).
   * Alternativa a `pdfBase64` — exactamente uno de los dos. */
  pdfUrl?: string;
  /** El PDF en base64, para documentos que NO viven en Monday (Zona Efrain):
   * los genera el portal y quedan en R2, y una URL nuestra no le sirve a
   * DocuSeal porque /api/* está detrás de Cloudflare Access — no podría
   * descargarla. La API acepta cualquiera de las dos formas en el mismo campo
   * `file` (verificado contra api.docuseal.com, 2026-08-18). */
  pdfBase64?: string;
  filename: string;
  signers: DocuSealSigner[];
  /** Copia a administración al completarse. Default true (lo que hace
   * cmp-tallas). Se apaga en la zona privada: ahí el documento no debe salir
   * de sus firmantes (Efraín, 2026-08-18). */
  bccCompleted?: boolean;
}

/** Crea una submission nueva a partir del PDF hospedado en Monday. Devuelve el id
 * de la submission (string) — nunca reusa una existente: cada generación es un
 * documento distinto que exige firmas frescas (mismo criterio que cmp-tallas). */
export async function createDocuSealSubmission(env: Env, input: CreateSubmissionInput): Promise<string> {
  if (!env.DOCUSEAL_API_KEY) throw new DocuSealError('DOCUSEAL_API_KEY not configured');

  const file = input.pdfBase64 ?? input.pdfUrl;
  if (!file) throw new DocuSealError('sin PDF: falta pdfUrl o pdfBase64');

  const res = await fetch(DOCUSEAL_URL, {
    method: 'POST',
    headers: { 'X-Auth-Token': env.DOCUSEAL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      documents: [{ file, name: input.filename }],
      submitters: input.signers.map(s => ({
        role: s.role, name: s.name, email: s.email, send_email: true,
        ...(s.order !== undefined ? { order: s.order } : {}),
      })),
      send_email: true,
      message: {},
      ...(input.bccCompleted === false ? {} : { bcc_completed: BCC_COMPLETED }),
      merge_documents: false,
      flatten: false,
      remove_tags: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new DocuSealError(`DocuSeal HTTP ${res.status}: ${JSON.stringify(body)}`);

  if (Array.isArray(body) && body.length > 0 && body[0] && typeof body[0] === 'object') {
    return String((body[0] as { id?: unknown }).id ?? '');
  }
  if (body && typeof body === 'object') return String((body as { id?: unknown }).id ?? '');
  return '';
}
