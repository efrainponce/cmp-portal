// Monday's `status`-type columns serialize `value` as {index, post_id,
// changed_at}, not a bare index — this extracts the index used to match
// ColMeta.labels keys and to filter by deal_stage.
import type { ColVal } from './api';

export function statusIndex(val?: ColVal): string {
  const v = val?.value;
  if (v && typeof v === 'object' && 'index' in (v as Record<string, unknown>)) {
    return String((v as { index: unknown }).index);
  }
  return String(v ?? val?.text ?? '_none');
}
