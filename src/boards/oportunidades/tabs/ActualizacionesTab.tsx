// Live feed backed by Monday's own item updates (GET/POST /boards/:slug/items/:id/updates)
// — never mirrored to D1, always a fresh read, so it stays the single source of
// truth the team already checks inside monday.com itself.
import { useEffect, useState } from 'react';
import type { BoardSlug, UpdateDTO } from '../../../lib/api';
import { getUpdates, postUpdate } from '../../../lib/api';
import { PaymentRequestButton } from '../../../components/board/PaymentRequestButton';

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

export function ActualizacionesTab({ slug, itemId }: Props) {
  const [updates, setUpdates] = useState<UpdateDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const load = () => {
    setError(false);
    getUpdates(slug, itemId).then(setUpdates).catch(() => setError(true));
  };

  useEffect(load, [slug, itemId]);

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setPosting(true);
    try {
      await postUpdate(slug, itemId, text);
      setDraft('');
      load();
    } catch {
      /* leave the draft so the user can retry */
    } finally {
      setPosting(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 640, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <PaymentRequestButton slug={slug} itemId={itemId} kind="anticipo" />
        <PaymentRequestButton slug={slug} itemId={itemId} kind="saldo" />
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe una actualización para el equipo…"
          rows={3}
          disabled={posting}
          style={{ width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', resize: 'vertical' }}
        />
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
          <div style={{ font: 'var(--text-label)', color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{u.body}</div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 4 }}>
            {u.author} · {fmtWhen(u.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}
