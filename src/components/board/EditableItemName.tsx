// Nombre del item editable en el encabezado del drawer (Oportunidad y Proyecto).
// Vendedor, compras y admin pueden renombrar desde cualquier board (Efraín,
// 2026-08-13); el permiso real lo manda ColMeta.w de la pseudo-columna `name`
// (shared/visibility.ts) y el server lo vuelve a checar en el PATCH.
import { useState } from 'react';
import { IconEdit } from '../icons';
import { patchItem } from '../../lib/apiClient';
import type { BoardSlug } from '../../../shared/boards';

interface Props {
  slug: BoardSlug;
  itemId: string;
  name: string;
  canEdit: boolean;
  /** Token tipográfico del título en cada drawer (subtitle en Oportunidad, title en Proyecto). */
  font: string;
  /** Pinta el nombre nuevo de inmediato: el espejo tarda en confirmar el echo. */
  onRenamed: (nombre: string) => void;
}

export function EditableItemName({ slug, itemId, name, canEdit, font, onRenamed }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => { setDraft(name); setError(null); setEditing(true); };
  const cancel = () => { setEditing(false); setError(null); };

  const save = async () => {
    const nombre = draft.trim();
    if (!nombre) { setError('El nombre no puede quedar vacío.'); return; }
    if (nombre === name) { cancel(); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await patchItem(slug, itemId, { name: nombre });
      if (res.ok) {
        onRenamed(nombre);
        setEditing(false);
      } else {
        setError(res.error ?? 'No se pudo guardar el nombre.');
      }
    } catch {
      setError('No se pudo guardar el nombre. Verifica tu conexión.');
    }
    setSaving(false);
  };

  if (!editing) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <div style={{ font, color: 'var(--ink)' }}>{name}</div>
        {canEdit && (
          <button
            onClick={start}
            title="Cambiar nombre"
            aria-label="Cambiar nombre"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', background: 'none', padding: 2,
              color: 'var(--ink-quiet)', cursor: 'pointer', borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-quiet)'; }}
          >
            <IconEdit style={{ width: 13, height: 13 }} />
          </button>
        )}
      </div>
    );
  }

  return (
    // flex 1 1 100%: el nombre es largo (folio + institución + canal) y el input
    // se queda con el renglón completo del header mientras se edita — en cel
    // (390px) queda apretadísimo si compite con el chip de etapa.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          autoFocus
          value={draft}
          maxLength={255}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void save(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          style={{
            font, color: 'var(--ink)', background: 'var(--bg-raised)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            padding: '5px 9px', flex: '1 1 260px', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box',
          }}
        />
        <button
          onClick={saving ? undefined : () => void save()}
          style={{
            border: 'none', background: 'none', padding: 0,
            font: 'var(--text-label-strong)', color: 'var(--accent)',
            cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          onClick={saving ? undefined : cancel}
          style={{
            border: 'none', background: 'none', padding: 0,
            font: 'var(--text-label)', color: 'var(--ink-quiet)', cursor: 'pointer',
          }}
        >
          Cancelar
        </button>
      </div>
      {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{error}</div>}
    </div>
  );
}
