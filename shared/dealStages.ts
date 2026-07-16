// shared/dealStages.ts — Etapa (deal_stage) canon shared by the frontend and
// the worker (assistant tools). Label map from docs/monday-column-map.md,
// introspected 2026-07-13. Never fabricate; re-introspect on drift.
export const DEAL_STAGE_LABELS: Record<string, string> = {
  '0': 'En Seguimiento',
  '1': 'Ganada',
  '2': 'Perdida',
  '3': 'En Negociación',
  '4': 'Nueva oportunidad',
  '5': 'Cancelada',
  '6': 'Cotización',
  '7': 'Costeo en validación',
  '8': 'Esperando OC',
  '9': 'Costeo Confirmado',
  '15': 'En costeo',
};

// Real pipeline order per Monday's deal_stage status column settings
// (labels_positions_v2), live-introspected 2026-07-14 — CONFIRMED, not a guess.
// Nueva oportunidad -> En costeo -> Costeo en validación -> Costeo Confirmado
// -> Cotización -> En Seguimiento -> En Negociación -> Esperando OC -> Ganada
// -> Perdida -> Cancelada.
export const DEAL_STAGE_ORDER = ['4', '15', '7', '9', '6', '0', '3', '8', '1', '2', '5'];

// Terminal stages: Ganada, Perdida, Cancelada. "Abiertas" = everything else.
export const CLOSED_STAGES = new Set(['1', '2', '5']);

/**
 * True when `stage` sits at or past `threshold` in DEAL_STAGE_ORDER.
 * Unknown/absent stages fail open (return true): the UI only declutters,
 * the server already protects the data.
 */
export function stageAtOrAfter(stage: string | undefined, threshold: string): boolean {
  if (!stage) return true;
  const pos = DEAL_STAGE_ORDER.indexOf(stage);
  if (pos === -1) return true;
  return pos >= DEAL_STAGE_ORDER.indexOf(threshold);
}

/** Reverse lookup: stage label (as shown in Monday) -> numeric key. Case- and
 * accent-insensitive so the assistant can pass user-typed labels. */
export function stageKeyForLabel(label: string): string | undefined {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const target = norm(label);
  return Object.entries(DEAL_STAGE_LABELS).find(([, l]) => norm(l) === target)?.[0];
}
