// Condiciones de la cotización — bloque a NIVEL COTIZACIÓN (no por línea):
// condiciones comerciales, tiempo de entrega y vigencia. Escribe directo a las
// columnas de `oportunidades` (shared/quoteTerms.ts, que también trae los
// textos por defecto — ese es el único archivo a tocar para cambiarlos).
//
// Los textos por defecto NO se escriben solos a Monday: se ven como placeholder
// mientras el campo está vacío y "Usar texto por defecto" los inserta para que
// se puedan ajustar antes de guardar (Efraín, 2026-07-30).
import { useState } from 'react';
import { QUOTE_TERMS } from '../../../../../shared/quoteTerms';
import type { ColMeta, ItemDetailDTO } from '../../../../lib/api';
import { patchItem } from '../../../../lib/apiClient';
import { useIsMobile } from '../../../../lib/useIsMobile';

export function CondicionesCotizacion({
  oppId, oppCols, item, onSaved, locked = false,
}: {
  oppId?: string;
  /** ColMeta del board `oportunidades` — de aquí sale quién puede escribir (`w`). */
  oppCols: ColMeta[];
  item?: ItemDetailDTO;
  onSaved?: () => void;
  /** true en Ganada/Perdida o viendo una versión superada — solo lectura. */
  locked?: boolean;
}) {
  const isMobile = useIsMobile();
  // Valor tecleado por campo (undefined = mostrar lo que trae el mirror).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string | undefined>>({});

  const fields = QUOTE_TERMS
    .map((f) => ({ ...f, meta: oppCols.find((c) => c.id === f.id) }))
    .filter((f) => f.meta);        // fail-closed: sin ColMeta el rol no la ve
  if (!item || fields.length === 0) return null;

  const save = async (id: string, raw: string) => {
    const current = item.cols[id]?.text ?? '';
    if (raw === current) { setEdits((e) => ({ ...e, [id]: raw })); return; }
    if (!oppId) return;
    setSaving((s) => ({ ...s, [id]: true }));
    setError((e) => ({ ...e, [id]: undefined }));
    try {
      await patchItem('oportunidades', oppId, { [id]: raw });
      onSaved?.();
    } catch (e) {
      setError((er) => ({ ...er, [id]: e instanceof Error ? e.message : 'No se pudo guardar.' }));
    } finally {
      setSaving((s) => ({ ...s, [id]: false }));
    }
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    background: 'var(--bg)', color: 'var(--ink)',
    font: 'var(--text-label)', resize: 'vertical' as const,
  };

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
      background: 'var(--bg-raised)', padding: isMobile ? '14px' : '16px 18px',
      marginBottom: 16,
    }}>
      <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)', marginBottom: 2 }}>
        Condiciones de la cotización
      </div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 12 }}>
        Aplican a toda la cotización, no a un producto en particular.
      </div>

      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      }}>
        {fields.map((f) => {
          const stored = item.cols[f.id]?.text ?? '';
          const value = edits[f.id] ?? stored;
          const editable = !locked && !!f.meta?.w;
          const isEmpty = value.trim() === '';
          return (
            <div key={f.id} style={{ gridColumn: f.multiline && !isMobile ? '1 / -1' : 'auto' }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 8, marginBottom: 4,
              }}>
                <label style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
                  {f.label}
                </label>
                {editable && isEmpty && (
                  <span
                    onClick={() => { setEdits((e) => ({ ...e, [f.id]: f.fallback })); void save(f.id, f.fallback); }}
                    style={{ font: 'var(--text-caption)', color: 'var(--accent)', cursor: 'pointer' }}
                  >
                    Usar texto por defecto
                  </span>
                )}
                {saving[f.id] && (
                  <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>guardando…</span>
                )}
              </div>

              {editable ? (
                f.multiline ? (
                  <textarea
                    rows={7}
                    value={value}
                    placeholder={f.fallback}
                    onChange={(ev) => setEdits((e) => ({ ...e, [f.id]: ev.target.value }))}
                    onBlur={(ev) => void save(f.id, ev.target.value)}
                    style={inputStyle}
                  />
                ) : (
                  <input
                    value={value}
                    placeholder={f.fallback}
                    onChange={(ev) => setEdits((e) => ({ ...e, [f.id]: ev.target.value }))}
                    onBlur={(ev) => void save(f.id, ev.target.value)}
                    style={inputStyle}
                  />
                )
              ) : (
                // Solo lectura: si está vacío se enseña el texto por defecto en
                // gris y marcado como no guardado — es lo que aplicaría, pero
                // todavía no vive en Monday (Eledo no lo imprimiría).
                <div style={{
                  font: 'var(--text-label)', whiteSpace: 'pre-wrap',
                  color: isEmpty ? 'var(--ink-faint)' : 'var(--ink-secondary)',
                }}>
                  {isEmpty ? `${f.fallback}\n(texto por defecto — sin guardar)` : value}
                </div>
              )}

              {error[f.id] && (
                <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 4 }}>
                  {error[f.id]}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
