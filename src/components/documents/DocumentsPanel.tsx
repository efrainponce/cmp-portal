// Panel reusable de documentos del portal para cualquier fuente: la
// Documentación de una oportunidad y las remisiones de un movimiento de
// inventario montan el mismo componente, cambiando plantilla y sourceId.
//
// Genera → previsualiza → firma. El PDF firmado y el base son URLs distintas
// (?firmado=1) para que se pueda comparar lo sellado contra lo firmado.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Button } from '../core/Button';

// El modal de firma arrastra pdfjs (~130 KB gzip) por la previsualización del
// PDF; se carga al abrirlo, no al montar el panel, igual que CotizacionPdfRow.
const SignDocumentModal = lazy(() => import('./SignDocumentModal').then((m) => ({ default: m.SignDocumentModal })));
import {
  DOC_TEMPLATES, createDocument, documentPdfUrl, listDocuments, shortHash,
  type DocSourceKind, type DocTemplateId, type DocumentDTO,
} from '../../lib/documentsApi';
import { useMe } from '../../lib/useMe';

interface DocumentsPanelProps {
  sourceKind: DocSourceKind;
  sourceId: string;
  /** Plantillas ofrecidas aquí (el server revalida rol y fuente). */
  templates: DocTemplateId[];
  title?: string;
  /** Etiqueta legible del archivo cuando la plantilla sella un PDF ajeno. */
  sourceLabel?: string;
  /** Mostrar solo los documentos de estas plantillas; por default, los de `templates`. */
  filter?: (doc: DocumentDTO) => boolean;
}

export function DocumentsPanel({ sourceKind, sourceId, templates, title, sourceLabel, filter }: DocumentsPanelProps) {
  const me = useMe();
  const [docs, setDocs] = useState<DocumentDTO[] | null>(null);
  const [busy, setBusy] = useState<DocTemplateId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState<DocumentDTO | null>(null);

  const reload = useCallback(() => {
    listDocuments(sourceKind, sourceId)
      .then((list) => setDocs(filter ? list.filter(filter) : list))
      .catch(() => setDocs([]));
  }, [sourceKind, sourceId, filter]);

  useEffect(reload, [reload]);

  const generate = async (templateId: DocTemplateId) => {
    setBusy(templateId);
    setError(null);
    const res = await createDocument(templateId, sourceId, sourceLabel);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? 'No se pudo generar el documento.'); return; }
    reload();
  };

  const role = me?.role;
  const offered = templates
    .map((id) => DOC_TEMPLATES[id])
    .filter((t) => !!t && (!role || t.create.includes(role)));

  return (
    <div>
      {title && <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 8 }}>{title}</div>}

      {offered.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {offered.map((t) => (
            <Button
              key={t.id}
              variant={busy === t.id ? 'disabled' : 'secondary'}
              onClick={() => generate(t.id)}
              title={t.description}
            >
              {busy === t.id ? 'Generando…' : `Generar ${t.label.toLowerCase()}`}
            </Button>
          ))}
        </div>
      )}

      {error && <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)', marginBottom: 10 }}>{error}</div>}

      {docs === null ? (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>Cargando documentos…</div>
      ) : docs.length === 0 ? (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>Todavía no hay documentos generados.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {docs.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              canSign={!!role && (DOC_TEMPLATES[doc.templateId]?.sign.includes(role) ?? false)
                && !doc.complete
                && !doc.signatures.some((s) => s.signerEmail === me?.email)}
              onSign={() => setSigning(doc)}
            />
          ))}
        </div>
      )}

      {signing && (
        <Suspense fallback={null}>
          <SignDocumentModal
            doc={signing}
            signerName={me?.nombre || me?.email || ''}
            onClose={() => setSigning(null)}
            onSigned={(updated) => {
              setSigning(null);
              setDocs((prev) => (prev ?? []).map((d) => (d.id === updated.id ? updated : d)));
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function DocumentRow({ doc, canSign, onSign }: { doc: DocumentDTO; canSign: boolean; onSign: () => void }) {
  const template = DOC_TEMPLATES[doc.templateId];
  const signed = doc.signatures.length > 0;
  // Plantillas de acuse automático: nadie firmó nada, así que el copy no habla
  // de firmas (Efraín, 2026-07-26).
  const acuse = template?.autoAcuse === true;
  const created = new Date(doc.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '12px 14px',
      background: 'var(--bg-raised)', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{template?.label ?? doc.title}</div>
        {doc.folio && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>Folio {doc.folio}</span>}
        <span style={{
          font: '600 10px \'Inter\', sans-serif', textTransform: 'uppercase', letterSpacing: '.3px',
          color: doc.complete ? 'var(--status-ganada)' : signed ? 'var(--status-esperando)' : 'var(--ink-faint)',
        }}>
          {acuse
            ? (signed ? 'Acusado' : 'Sin acuse')
            : doc.complete ? 'Firmado' : signed ? `${doc.signatures.length} de ${template?.maxSignatures ?? 1} firmas` : 'Sin firmar'}
        </span>
      </div>

      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
        Generado {created} · huella {shortHash(doc.sha256)}…
      </div>

      {doc.signatures.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {doc.signatures.map((sig) => (
            <div key={sig.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {sig.imageUrl && (
                <img
                  src={sig.imageUrl}
                  alt={`Firma de ${sig.signerName}`}
                  style={{ height: 26, borderRadius: 4, border: '1px solid var(--border-subtle)', background: '#fff' }}
                />
              )}
              <span style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)' }}>
                {sig.signerName} · {new Date(sig.signedAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <a href={documentPdfUrl(doc, false)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          <Button variant="ghost">Ver PDF</Button>
        </a>
        {signed && (
          <a href={documentPdfUrl(doc, true)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <Button variant="ghost">{acuse ? 'Ver con acuse' : 'Ver firmado'}</Button>
          </a>
        )}
        {canSign && <Button variant="primary" onClick={onSign}>Firmar</Button>}
      </div>
    </div>
  );
}
