// Read-only embellishment summary per product line — the design's per-zona
// técnica/tamaño editor needs structured zone data that only exists on the
// Subelementos de Proyectos board (out of scope here); this renders the real
// Oportunidades-subitem embellishment status + free-text description instead.
import type { ColMeta, ItemDTO } from '../../../lib/api';
import { StatusBadge, MonoTag } from '../../../components/core/Badges';
import { chipFor } from '../../../components/board/cellHelpers';
import { explodeEmbellecimiento } from '../../../lib/embellecimiento';

const STATUS_COL = 'color_mm1b34bg';
const DESC_COL = 'long_text_mm1bj4pt';
const SKU_COL = 'lookup_mkzn7x9a';
const NAME_COL = 'lookup_mm0x4kda';

export function EmbellecimientosTab({ subCols, products }: { subCols: ColMeta[]; products: ItemDTO[] }) {
  const statusCol = subCols.find((c) => c.id === STATUS_COL);

  if (products.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Sin líneas de producto registradas.
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {products.map((p) => {
        const statusVal = statusCol ? p.cols[STATUS_COL] : undefined;
        const zones = explodeEmbellecimiento(p.cols[DESC_COL]?.text, true);
        return (
          <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{p.cols[NAME_COL]?.text || p.name}</div>
              {p.cols[SKU_COL]?.text && <MonoTag>{p.cols[SKU_COL].text}</MonoTag>}
              {statusVal?.text && statusCol && (() => {
                const { label, color, tint } = chipFor(statusCol, statusVal);
                return <StatusBadge label={label} color={color} tint={tint} />;
              })()}
            </div>
            {zones.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {zones.map((z) => (
                  <div key={z.label} style={{ font: 'var(--text-body)', color: 'var(--ink-secondary)' }}>
                    <span style={{ color: 'var(--ink)' }}>{z.label}:</span> {z.value}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ font: 'var(--text-body)', color: 'var(--ink-faint)' }}>
                — sin descripción de embellecimiento —
              </div>
            )}
            <div style={{ marginTop: 10, font: 'var(--text-small-strong)', color: 'var(--ink-faint)', cursor: 'default' }}>
              + Agregar posición (próximamente)
            </div>
          </div>
        );
      })}
    </div>
  );
}
