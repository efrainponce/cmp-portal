// Generic cell rendering: turns a ColMeta + ColVal into the right visual —
// colored chip for status/dropdown, plain text/money/📎-count otherwise.
import type { ColMeta, ColVal } from '../../lib/api';
import { StatusBadge } from '../core/Badges';
import { chipFor, renderCellText } from './cellHelpers';

const CHIP_TYPES = new Set(['color', 'dropdown', 'status']);

export function CellContent({ col, val }: { col: ColMeta; val?: ColVal }) {
  if (!val || val.text === '') {
    return <span style={{ color: 'var(--ink-faint)' }}>—</span>;
  }
  if (CHIP_TYPES.has(col.type) && col.labels) {
    const { label, color, tint } = chipFor(col, val);
    return <StatusBadge label={label} color={color} tint={tint} />;
  }
  return <span>{renderCellText(col, val)}</span>;
}
