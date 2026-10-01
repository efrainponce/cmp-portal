// Tallas (text_mm5v6jhj) editable inline en la tabla de Productos — mismo
// campo, mismo PATCH y mismo formato ("S, M, XL" / "unitalla") que el panel de
// detalle de la línea en la Cotización (LineDetailPanel/onEditTallas). El
// worker empuja "Tallas Portal" a Airtable al escribirlo (syncTallasPortal).
// Efraín, 2026-09-30: "en el board de productos necesitamos poder EDITAR las
// tallas, como lo hacemos dentro de la oportunidad".
import { useState } from 'react';
import { patchItem } from '../../lib/apiClient';
import type { ItemDTO } from '../../lib/api';

export const PRODUCTO_TALLAS_COL = 'text_mm5v6jhj';

export function TallasCell({ item, onSaved }: { item: ItemDTO; onSaved: () => void }) {
  const actual = (item.cols[PRODUCTO_TALLAS_COL]?.text ?? '').trim();
  // `draft` = lo que se escribe; `guardado` = lo último que se mandó, para no
  // brincar al valor viejo mientras el mirror alcanza al write.
  const [draft, setDraft] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (guardado !== null && guardado === actual) setGuardado(null);
  const valor = draft ?? guardado ?? actual;

  const guardar = async (next: string) => {
    setDraft(null);
    if (next === (guardado ?? actual)) return;
    setGuardado(next);
    setSaving(true);
    setError(null);
    try {
      await patchItem('productos', item.id, { [PRODUCTO_TALLAS_COL]: next });
      onSaved();
    } catch (e) {
      setGuardado(null);
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      value={valor}
      placeholder="S, M, XL o unitalla"
      title={error ?? (saving ? 'guardando…' : valor)}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => { void guardar(e.target.value.trim()); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(null); setTimeout(() => (e.target as HTMLInputElement).blur()); }
      }}
      style={{
        width: 170, font: 'var(--text-label)', color: 'var(--ink)',
        border: `1px solid ${error ? 'var(--status-perdida)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)', padding: '4px 6px', boxSizing: 'border-box',
        background: saving ? 'var(--bg-sunken)' : '#fff',
      }}
    />
  );
}
