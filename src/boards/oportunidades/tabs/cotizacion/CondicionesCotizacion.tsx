// Condiciones de la cotización — bloque a NIVEL COTIZACIÓN (no por línea):
// condiciones comerciales, tiempo de entrega y vigencia. Escribe directo a las
// columnas de `oportunidades` (shared/quoteTerms.ts, que también trae los
// textos por defecto — ese es el único archivo a tocar para cambiarlos).
//
// Si un campo está vacío y quien lo ve puede escribirlo, el texto por defecto
// se escribe SOLO a Monday al abrir — ya no hay botón "Usar texto por defecto";
// el vendedor/compras lo cambia si hace falta (Efraín, 2026-10-02).
import { useEffect, useRef, useState } from 'react';
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

  // Rellena con el texto por defecto lo que venga vacío — una vez por campo
  // y oportunidad (el mirror tarda en traer el valor guardado).
  const autollenado = useRef(new Set<string>());
  useEffect(() => {
    if (!item || !oppId || locked) return;
    for (const f of fields) {
      const key = `${oppId}:${f.id}`;
      if (!f.meta?.w || autollenado.current.has(key)) continue;
      if ((item.cols[f.id]?.text ?? '').trim() !== '' || (edits[f.id] ?? '').trim() !== '') continue;
      autollenado.current.add(key);
      setEdits((e) => ({ ...e, [f.id]: f.fallback }));
      void save(f.id, f.fallback);
    }
  });

  if (!item || fields.length === 0) return null;

  async function save(id: string, raw: string) {
    if (!item) return;
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
  }

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
      marginTop: 20, marginBottom: 16,
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
