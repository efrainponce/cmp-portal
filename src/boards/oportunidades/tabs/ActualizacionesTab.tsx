// Live feed backed by Monday's own item updates (GET/POST /boards/:slug/items/:id/updates)
// — never mirrored to D1, always a fresh read, so it stays the single source of
// truth the team already checks inside monday.com itself.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardSlug, MentionUserDTO, UpdateDTO } from '../../../lib/api';
import { getMentionUsers, getUpdates, postUpdate } from '../../../lib/api';

interface Props {
  slug: BoardSlug;
  itemId: string;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = () => {
    setError(false);
    getUpdates(slug, itemId).then(setUpdates).catch(() => setError(true));
  };

  useEffect(load, [slug, itemId]);
  useEffect(() => { getMentionUsers().then(setUsers).catch(() => setUsers([])); }, []);

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
    if (!text) return;
    setPosting(true);
    try {
      const activeMentions = mentions.filter(m => draft.includes(`@${m.nombre}`));
      await postUpdate(slug, itemId, text, activeMentions);
      setDraft('');
      setMentions([]);
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <div
            onClick={draft.trim() && !posting ? submit : undefined}
            style={{
              padding: '8px 14px', borderRadius: 'var(--radius-lg)', font: 'var(--text-label-strong)', cursor: draft.trim() && !posting ? 'pointer' : 'default',
              background: draft.trim() && !posting ? 'var(--accent)' : 'var(--border)',
              color: draft.trim() && !posting ? 'var(--ink-on-accent)' : 'var(--ink-quiet)',
            }}
          >
            {posting ? 'Publicando…' : 'Publicar'}
          </div>
        </div>
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
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 4 }}>
            {u.author} · {fmtWhen(u.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}
