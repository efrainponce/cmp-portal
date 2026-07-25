// Modal de firma: previsualiza el PDF que se está firmando, captura el trazo y
// muestra el consentimiento textual + la huella SHA-256 que quedará asentada.
// El PDF se previsualiza SIEMPRE antes de firmar (nadie firma a ciegas).
import { useRef, useState } from 'react';
import { Modal } from '../core/Modal';
import { Button } from '../core/Button';
import { PdfCanvasPreview } from '../core/PdfCanvasPreview';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { DOC_TEMPLATES, SIGN_INTENT, shortHash, signDocument, documentPdfUrl, type DocumentDTO } from '../../lib/documentsApi';
import { useIsMobile } from '../../lib/useIsMobile';

export function SignDocumentModal({ doc, signerName, onClose, onSigned }: {
  doc: DocumentDTO;
  signerName: string;
  onClose: () => void;
  onSigned: (updated: DocumentDTO) => void;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const isMobile = useIsMobile();
  const [name, setName] = useState(signerName);
  const [accepted, setAccepted] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = DOC_TEMPLATES[doc.templateId];
  const canSign = accepted && name.trim().length > 1 && !busy;

  const submit = async () => {
    if (!canSign) return;
    setBusy(true);
    setError(null);
    const res = await signDocument(doc.id, padRef.current?.toJpeg() ?? null, name.trim());
    setBusy(false);
    if (!res.ok || !res.document) { setError(res.error ?? 'No se pudo firmar.'); return; }
    onSigned(res.document);
  };

  return (
    <Modal
      title={`Firmar: ${template?.label ?? doc.title}`}
      onClose={onClose}
      width={isMobile ? 480 : 720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant={canSign ? 'primary' : 'disabled'} onClick={submit}>
            {busy ? 'Firmando…' : 'Firmar documento'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* La vista previa se limita en alto y hace scroll aparte: a tamaño
            completo una carta mide ~725px y empuja el pad de firma y el
            consentimiento fuera de la pantalla. */}
        <div style={{
          display: 'flex', justifyContent: 'center', background: 'var(--bg)',
          borderRadius: 'var(--radius-lg)', padding: 12,
          maxHeight: isMobile ? 260 : 320, overflowY: 'auto',
        }}>
          <PdfCanvasPreview url={documentPdfUrl(doc, false)} maxWidth={isMobile ? 380 : 520} />
        </div>

        <div>
          <Label>Nombre del firmante</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 11px', font: 'var(--text-body)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)', color: 'var(--ink)',
            }}
          />
        </div>

        <div>
          <Label>Firma {hasInk ? '' : '(opcional el trazo, no la identidad)'}</Label>
          <SignaturePad ref={padRef} onChange={setHasInk} />
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>{SIGN_INTENT}</span>
        </label>

        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 12px' }}>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', marginBottom: 4 }}>
            Se registrará tu cuenta del portal, la fecha, tu IP y esta huella del documento:
          </div>
          <code style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)', wordBreak: 'break-all' }}>
            {shortHash(doc.sha256)}…
          </code>
        </div>

        {error && (
          <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)' }}>{error}</div>
        )}
      </div>
    </Modal>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink-secondary)', marginBottom: 6 }}>{children}</div>
  );
}
