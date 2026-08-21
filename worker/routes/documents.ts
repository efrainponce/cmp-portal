// API de documentos del portal + firma electrónica (2026-07-25).
// Todo pasa por access+identity (worker/index.ts) y además por el scoping de la
// FUENTE del documento (worker/lib/documents.ts): un vendedor solo ve los
// documentos de oportunidades que ya podía ver, y las remisiones exigen acceso
// al board de inventario.
import type { Hono } from 'hono';
import type { Env } from '../env';
import type {
  CreateDocumentRequest, CreateDocumentResponse, DocumentsResponse,
  SignDocumentRequest, SignDocumentResponse,
} from '../../shared/documents';
import { isDocTemplateId } from '../../shared/documents';
import {
  createDocument, listDocuments, loadDocument, documentPdf, signDocument,
  signatureImage, DocumentError,
} from '../lib/documents';
import { jsonStatus, contentDisposition } from '../lib/http';

function fail(err: unknown): Response {
  if (err instanceof DocumentError) return jsonStatus({ ok: false, error: err.message }, err.status);
  console.log('[documents] ' + String(err));
  return jsonStatus({ ok: false, error: 'internal error' }, 500);
}

function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      // inline: el drawer lo previsualiza con pdfjs sin forzar descarga. El
      // nombre ya viene armado con el de la oportunidad (worker/lib/documents.ts).
      'Content-Disposition': contentDisposition(filename),
      'Cache-Control': 'private, no-store',
    },
  });
}

export function documentRoutes(app: Hono<{ Bindings: Env }>) {
  // Documentos de una fuente: ?sourceKind=oportunidad&sourceId=18395657596
  app.get('/api/documents', async c => {
    const sourceKind = c.req.query('sourceKind') ?? '';
    const sourceId = c.req.query('sourceId') ?? '';
    if (!sourceKind || !sourceId) return c.json({ error: 'sourceKind y sourceId son requeridos' }, 400);
    try {
      const documents = await listDocuments(c.env, c.get('viewer'), sourceKind, sourceId);
      return c.json({ documents } satisfies DocumentsResponse);
    } catch (err) {
      return fail(err);
    }
  });

  app.post('/api/documents', async c => {
    const body = await c.req.json<CreateDocumentRequest>().catch(() => null);
    if (!body || !isDocTemplateId(String(body.templateId))) return c.json({ ok: false, error: 'plantilla inválida' }, 400);
    if (!body.sourceId) return c.json({ ok: false, error: 'sourceId es requerido' }, 400);
    try {
      const document = await createDocument(c.env, c.get('viewer'), {
        templateId: body.templateId,
        sourceId: String(body.sourceId),
        sourceLabel: body.sourceLabel,
      });
      return c.json({ ok: true, document } satisfies CreateDocumentResponse);
    } catch (err) {
      return fail(err);
    }
  });

  app.get('/api/documents/:id', async c => {
    try {
      const document = await loadDocument(c.env, c.req.param('id'), c.get('viewer'));
      if (!document) return c.json({ error: 'not found' }, 404);
      return c.json({ document });
    } catch (err) {
      return fail(err);
    }
  });

  // ?firmado=1 devuelve el PDF con las cajas de firma llenas (o la constancia,
  // cuando la fuente era un PDF ajeno); sin el flag, el PDF base sellado.
  app.get('/api/documents/:id/pdf', async c => {
    const signed = c.req.query('firmado') === '1';
    try {
      const { bytes, filename } = await documentPdf(c.env, c.req.param('id'), c.get('viewer'), signed);
      return pdfResponse(bytes, filename);
    } catch (err) {
      return fail(err);
    }
  });

  app.get('/api/documents/:id/firmas/:sigId', async c => {
    const sigId = Number(c.req.param('sigId'));
    if (!Number.isFinite(sigId)) return c.json({ error: 'not found' }, 404);
    try {
      const bytes = await signatureImage(c.env, c.req.param('id'), sigId, c.get('viewer'));
      if (!bytes) return c.json({ error: 'not found' }, 404);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(bytes.length),
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch (err) {
      return fail(err);
    }
  });

  app.post('/api/documents/:id/firmar', async c => {
    const body = await c.req.json<SignDocumentRequest>().catch(() => null);
    if (!body) return c.json({ ok: false, error: 'cuerpo inválido' }, 400);
    try {
      const document = await signDocument(c.env, c.req.param('id'), c.get('viewer'), {
        signatureJpeg: body.signatureJpeg,
        typedName: body.typedName,
        intent: String(body.intent ?? ''),
        // Evidencia de auditoría: la IP la pone Cloudflare, no el cliente.
        ip: c.req.header('CF-Connecting-IP') ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
      });
      return c.json({ ok: true, document } satisfies SignDocumentResponse);
    } catch (err) {
      return fail(err);
    }
  });
}
