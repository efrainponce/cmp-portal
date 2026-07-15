// Read-only tallas summary per product line — real data is the "Tallas"
// mirror column (a text summary), not a per-size qty grid; the design's
// size-breakdown grid and "talla incorrecta" flag have no backing data/write
// endpoint yet, so they're omitted rather than fabricated.
import type { ColMeta, ItemDTO } from '../../../lib/api';
import { MonoTag } from '../../../components/core/Badges';

const NAME_COL = 'lookup_mm0x4kda';
const SKU_COL = 'lookup_mkzn7x9a';
const CANTIDAD_COL = 'numeric_mkzm6399';
const TALLAS_COL = 'lookup_mm19c0b6';

/** The Tallas mirror sometimes carries a ```json-fenced size-by-category
 * object rather than plain text — render it as a readable summary when it
 * parses, falling back to the raw text otherwise. */
function formatTallas(text: string): string {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) return text;
  try {
    const obj = JSON.parse(match[1]);
    const parts = Object.entries(obj)
      .filter(([, v]) => Array.isArray(v) ? v.length > 0 : v)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
    return parts.length ? parts.join(' · ') : text;
  } catch {
    return text;
  }
}

export function TallasTab({ subCols, products }: { subCols: ColMeta[]; products: ItemDTO[] }) {
  const hasTallasCol = subCols.some((c) => c.id === TALLAS_COL);

  if (products.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Sin líneas de producto registradas.
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 4 }}>Confirmación de tallas por producto</div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>
        Cantidad y tallas registradas en la cotización.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {products.map((p) => (
          <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{p.cols[NAME_COL]?.text || p.name}</div>
              {p.cols[SKU_COL]?.text && <MonoTag>{p.cols[SKU_COL].text}</MonoTag>}
              <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
                Cotizado: {p.cols[CANTIDAD_COL]?.text || '—'}
              </div>
            </div>
            <div style={{ marginTop: 8, font: 'var(--text-body)', color: 'var(--ink-secondary)' }}>
              {hasTallasCol
                ? (p.cols[TALLAS_COL]?.text ? formatTallas(p.cols[TALLAS_COL].text) : '— sin tallas registradas —')
                : '— columna de tallas no visible para tu rol —'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
