// Live feed backed by Monday's own item updates (GET/POST /boards/:slug/items/:id/updates)
// — never mirrored to D1, always a fresh read, so it stays the single source of
// truth the team already checks inside monday.com itself.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardSlug, MentionUserDTO, UpdateAttachmentDTO, UpdateDTO } from '../../../lib/api';
import { getMentionUsers, getUpdates, postUpdate, postUpdateAttachment, updateAttachmentHref } from '../../../lib/api';
import { Modal } from '../../../components/core/Modal';

const PdfCanvasPreview = lazy(() =>
  import('../../../components/core/PdfCanvasPreview').then((m) => ({ default: m.PdfCanvasPreview })),
);

interface Props {
  slug: BoardSlug;
  itemId: string;
}

function AttachmentIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}>
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill={color} opacity=".14" />
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke={color} strokeWidth="1.4" />
      <path d="M14 2v5h5" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Un adjunto de un update: PDFs abren vista previa embebida (mismo mecanismo
 * que las cotizaciones); cualquier otra extensión solo ofrece descarga. */
function AttachmentChip({ slug, itemId, a, onPreview }: {
  slug: BoardSlug; itemId: string; a: UpdateAttachmentDTO; onPreview: () => void;
}) {
  const isPdf = a.ext === 'pdf';
  const downloadHref = updateAttachmentHref(slug, itemId, a.id, a.name, true);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', marginTop: 8, marginRight: 8,
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-sunken)',
    }}>
      <AttachmentIcon color="var(--ink-quiet)" />
      <span style={{ font: 'var(--text-caption)', color: 'var(--ink)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {a.name}
      </span>
      {isPdf && (
        <>
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>·</span>
          <span onClick={onPreview} style={{ cursor: 'pointer', font: 'var(--text-caption)', color: 'var(--accent)' }}>Ver</span>
        </>
      )}
      <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>·</span>
      <a href={downloadHref} download style={{ font: 'var(--text-caption)', color: 'var(--accent)', textDecoration: 'none' }}>Descargar</a>
    </div>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.round(hrs / 24);
  return `Hace ${days} d`;
}

// Splits an update body on any "@Full Name" that matches a known teammate so
// mentions render highlighted in the feed, same names the composer below can tag.
function renderBody(text: string, users: MentionUserDTO[] | null): React.ReactNode {
  if (!users || users.length === 0) return text;
  const names = [...users].map(u => u.nombre).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(@(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    part.startsWith('@') && names.includes(part.slice(1))
      ? <span key={i} style={{ color: 'var(--accent)', fontWeight: 600 }}>{part}</span>
      : <span key={i}>{part}</span>
  );
}

interface Picker { query: string; start: number }

export function ActualizacionesTab({ slug, itemId }: Props) {
  const [updates, setUpdates] = useState<UpdateDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [users, setUsers] = useState<MentionUserDTO[] | null>(null);
  const [mentions, setMentions] = useState<MentionUserDTO[]>([]);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UpdateAttachmentDTO | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setError(false);
    getUpdates(slug, itemId).then(setUpdates).catch(() => setError(true));
  };

  useEffect(load, [slug, itemId]);
  useEffect(() => { getMentionUsers().then(setUsers).catch(() => setUsers([])); }, []);

  // Precarga el worker de pdf.js en cuanto se sabe que hay al menos un
  // adjunto PDF en el feed — así el modal abre casi de inmediato al primer clic.
  useEffect(() => {
    if (!updates?.some(u => u.attachments.some(a => a.ext === 'pdf'))) return;
    import('../../../components/core/PdfCanvasPreview').then((m) => m.warmPdfWorker()).catch(() => {});
  }, [updates]);

  const filteredUsers = useMemo(() => {
    if (!picker || !users) return [];
    const q = picker.query.toLowerCase();
    return users.filter(u => u.nombre.toLowerCase().includes(q)).slice(0, 6);
  }, [picker, users]);

  const onDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    const cursor = e.target.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const atIndex = uptoCursor.lastIndexOf('@');
    if (atIndex === -1) { setPicker(null); return; }
    const between = uptoCursor.slice(atIndex + 1);
    if (/\s/.test(between)) { setPicker(null); return; }
    setPicker({ query: between, start: atIndex });
    setPickerIndex(0);
  };

  const selectMention = (u: MentionUserDTO) => {
    if (!picker) return;
    const before = draft.slice(0, picker.start);
    const after = draft.slice(picker.start + 1 + picker.query.length);
    const insertion = `@${u.nombre} `;
    const newDraft = before + insertion + after;
    setDraft(newDraft);
    setMentions(prev => [...prev, u]);
    setPicker(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = before.length + insertion.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!picker || filteredUsers.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => (i + 1) % filteredUsers.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIndex(i => (i - 1 + filteredUsers.length) % filteredUsers.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(filteredUsers[pickerIndex]); }
    else if (e.key === 'Escape') { setPicker(null); }
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text && !file) return;
    setPosting(true);
    setAttachError(null);
    try {
      const activeMentions = mentions.filter(m => draft.includes(`@${m.nombre}`));
      const body = text || `📎 ${file!.name}`;
      const created = await postUpdate(slug, itemId, body, activeMentions);
      if (file) {
        const result = await postUpdateAttachment(slug, itemId, created.id, file);
        if (!result.ok) setAttachError(result.error ?? 'No se pudo adjuntar el archivo.');
      }
      setDraft('');
      setMentions([]);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch {
      /* leave the draft so the user can retry */
    } finally {
      setPosting(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 640, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff', position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={onDraftChange}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setPicker(null), 150)}
          placeholder="Escribe una actualización para el equipo… usa @ para etiquetar a alguien"
          rows={3}
          disabled={posting}
          style={{ width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', resize: 'vertical' }}
        />
        {picker && filteredUsers.length > 0 && (
          <div style={{
            position: 'absolute', left: 14, right: 14, bottom: 62, zIndex: 10,
            background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto',
          }}>
            {filteredUsers.map((u, i) => (
              <div
                key={u.id}
                onMouseDown={(e) => { e.preventDefault(); selectMention(u); }}
                style={{
                  padding: '8px 12px', cursor: 'pointer', font: 'var(--text-label)',
                  background: i === pickerIndex ? 'var(--surface-hover, #f3f3f3)' : 'transparent',
                  color: 'var(--ink)',
                }}
              >
                {u.nombre}
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={posting}
          style={{ display: 'none' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
          {file ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: 'var(--text-caption)', color: 'var(--ink-quiet)', overflow: 'hidden' }}>
              <AttachmentIcon color="var(--ink-quiet)" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
              <span onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} style={{ cursor: 'pointer', color: 'var(--status-perdida)' }}>✕</span>
            </div>
          ) : (
            <div
              onClick={() => !posting && fileInputRef.current?.click()}
              style={{ cursor: posting ? 'default' : 'pointer', font: 'var(--text-caption)', color: 'var(--ink-quiet)', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <AttachmentIcon color="var(--ink-quiet)" /> Adjuntar archivo
            </div>
          )}
          <div
            onClick={(draft.trim() || file) && !posting ? submit : undefined}
            style={{
              padding: '8px 14px', borderRadius: 'var(--radius-lg)', font: 'var(--text-label-strong)', cursor: (draft.trim() || file) && !posting ? 'pointer' : 'default',
              background: (draft.trim() || file) && !posting ? 'var(--accent)' : 'var(--border)',
              color: (draft.trim() || file) && !posting ? 'var(--ink-on-accent)' : 'var(--ink-quiet)',
              flex: 'none',
            }}
          >
            {posting ? 'Publicando…' : 'Publicar'}
          </div>
        </div>
        {attachError && (
          <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 6 }}>{attachError}</div>
        )}
      </div>

      {error && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', padding: '12px 2px' }}>
          No se pudieron cargar las actualizaciones.
        </div>
      )}
      {!error && updates === null && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', padding: '12px 2px' }}>Cargando…</div>
      )}
      {updates !== null && updates.length === 0 && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', padding: '12px 2px' }}>
          Sin actualizaciones todavía.
        </div>
      )}
      {updates?.map((u) => (
        <div key={u.id} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{renderBody(u.body, users)}</div>
          {u.attachments.length > 0 && (
            <div>
              {u.attachments.map((a) => (
                <AttachmentChip key={a.id} slug={slug} itemId={itemId} a={a} onPreview={() => setPreview(a)} />
              ))}
            </div>
          )}
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 4 }}>
            {u.author} · {fmtWhen(u.createdAt)}
          </div>
        </div>
      ))}

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} width={760}>
          <Suspense fallback={<div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>}>
            <PdfCanvasPreview url={updateAttachmentHref(slug, itemId, preview.id, preview.name)} maxWidth={712} />
          </Suspense>
        </Modal>
      )}
    </div>
  );
}
