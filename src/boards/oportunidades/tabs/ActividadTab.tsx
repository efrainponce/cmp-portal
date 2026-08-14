// Log de actividad (worker/lib/activityLog.ts) — a diferencia de Actualizaciones
// (comentarios que postea la gente), esto es un mirror filtrado de los cambios
// de columna que Monday ya registra en su propio activity log: quién cambió
// qué y cuándo, sin que nadie tenga que escribirlo. Solo lectura.
import { useEffect, useState } from 'react';
import type { ActivityEntryDTO, BoardSlug } from '../../../lib/apiClient';
import { getActivity } from '../../../lib/api';

interface Props {
  slug: BoardSlug;
  itemId: string;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function describe(e: ActivityEntryDTO): string {
  const actor = e.actorName ?? 'Alguien';
  if (e.event === 'create_pulse') return `${actor} creó "${e.text ?? 'el elemento'}"`;
  if (!e.columnTitle) return `${actor} hizo un cambio`;
  if (e.previousText && e.text) return `${actor} cambió ${e.columnTitle} de "${e.previousText}" a "${e.text}"`;
  if (e.text) return `${actor} puso ${e.columnTitle} en "${e.text}"`;
  return `${actor} vació ${e.columnTitle}`;
}

export function ActividadTab({ slug, itemId }: Props) {
  const [entries, setEntries] = useState<ActivityEntryDTO[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setEntries(null);
    setError(false);
    getActivity(slug, itemId).then(setEntries).catch(() => setError(true));
  }, [slug, itemId]);

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 640, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {error && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', padding: '12px 2px' }}>
          No se pudo cargar la actividad.
        </div>
      )}
      {!error && entries === null && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', padding: '12px 2px' }}>Cargando…</div>
      )}
      {entries !== null && entries.length === 0 && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', padding: '12px 2px' }}>
          Sin actividad registrada todavía.
        </div>
      )}
      {entries?.map((e, i) => (
        <div key={i} style={{ borderTop: '1px solid var(--border-subtle)', padding: '10px 2px' }}>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>{describe(e)}</div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2 }}>{fmtWhen(e.at)}</div>
        </div>
      ))}
    </div>
  );
}
