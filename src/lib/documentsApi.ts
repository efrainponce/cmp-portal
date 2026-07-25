// Cliente de /api/documents/* (documentos generados por el portal + firma
// electrónica). Reusa apiFetch por el manejo de 401/403 de Access, igual que
// src/lib/inventoryApi.ts. El contrato vive en shared/documents.ts.
import { apiFetch } from './apiClient';
import type {
  CreateDocumentResponse, DocumentDTO, DocumentsResponse, DocSourceKind,
  DocTemplateId, SignDocumentResponse,
} from '../../shared/documents';
import { SIGN_INTENT } from '../../shared/documents';

export type { DocumentDTO, DocTemplateId, DocSourceKind };
export { SIGN_INTENT };
export { DOC_TEMPLATES, documentFilename, shortHash } from '../../shared/documents';

export async function listDocuments(sourceKind: DocSourceKind, sourceId: string): Promise<DocumentDTO[]> {
  const res = await apiFetch(`/documents?sourceKind=${sourceKind}&sourceId=${encodeURIComponent(sourceId)}`);
  if (!res.ok) throw new Error('GET documents failed: ' + res.status);
  const body: DocumentsResponse = await res.json();
  return body.documents;
}

export async function createDocument(
  templateId: DocTemplateId, sourceId: string, sourceLabel?: string,
): Promise<CreateDocumentResponse> {
  const res = await apiFetch('/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, sourceId, sourceLabel }),
  });
  const body: CreateDocumentResponse = await res.json().catch(() => ({ ok: false, error: 'respuesta inválida' }));
  return res.ok ? body : { ok: false, error: body.error ?? `error ${res.status}` };
}

/** Firma el documento. `signatureJpeg` es el data URL del trazo del canvas. */
export async function signDocument(
  id: string, signatureJpeg: string | null, typedName: string,
): Promise<SignDocumentResponse> {
  const res = await apiFetch(`/documents/${id}/firmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatureJpeg: signatureJpeg ?? undefined, typedName, intent: SIGN_INTENT }),
  });
  const body: SignDocumentResponse = await res.json().catch(() => ({ ok: false, error: 'respuesta inválida' }));
  return res.ok ? body : { ok: false, error: body.error ?? `error ${res.status}` };
}

/** URL del PDF (base o firmado) — se le pasa tal cual a PdfCanvasPreview o a un <a>. */
export function documentPdfUrl(doc: DocumentDTO, signed = doc.signatures.length > 0): string {
  return `/api/documents/${doc.id}/pdf${signed ? '?firmado=1' : ''}`;
}
