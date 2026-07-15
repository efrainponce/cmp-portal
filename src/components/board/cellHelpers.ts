// Plain (non-component) helpers for cell rendering — kept out of cells.tsx so
// that file only exports the CellContent component (fast-refresh friendly).
import type { ColMeta, ColVal } from '../../lib/api';
import { fmtMoney, isMoneyTitle } from '../../lib/format';
import { statusIndex } from '../../lib/statusValue';

export function cellAlign(col: ColMeta): 'right' | 'left' {
  return col.type === 'numeric' || col.type === 'formula' ? 'right' : 'left';
}

export function renderCellText(col: ColMeta, val?: ColVal): string {
  if (!val) return '—';
  if ((col.type === 'numeric' || col.type === 'formula') && isMoneyTitle(col.title)) {
    const n = Number(val.value ?? val.text);
    if (!Number.isNaN(n) && val.text !== '') return fmtMoney(n);
  }
  if (col.type === 'file') {
    const count = Array.isArray(val.value)
      ? val.value.length
      : val.text ? val.text.split(',').filter(Boolean).length : 0;
    return count ? `📎 ${count}` : '—';
  }
  return val.text || '—';
}

export function chipFor(col: ColMeta, val: ColVal): { label: string; color: string; tint: string } {
  const byValue = val.value !== undefined ? col.labels?.[statusIndex(val)] : undefined;
  const entry = byValue ?? Object.values(col.labels ?? {}).find((l) => l.label === val.text);
  const color = entry?.color ?? 'var(--ink-quiet)';
  const tint = entry?.color ? entry.color + '22' : 'var(--bg-sunken)';
  return { label: entry?.label ?? val.text, color, tint };
}
