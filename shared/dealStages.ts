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

// Etapas ofrecibles como punto de partida de un duplicado ("Duplicar" en el
// drawer, worker/lib/duplicateOportunidad.ts + DuplicarOportunidadModal —
// Efraín, 2026-08-14: "duplicar pregunta a que estado se manda"): el pipeline
// "hacia adelante" real, mismo orden que CLAUDE.md — no las etapas laterales
// (Perdida/Cancelada/Seguimiento/Negociación/Cotización), que no tiene
// sentido elegir como arranque de un duplicado.
export const DUPLICAR_ETAPAS_VALIDAS = ['4', '15', '7', '9', '8', '1'];

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

/** Value shape que Monday realmente usa para deal_stage ({label, index}) — todo el
 * pipeline (crear línea, quoteVersions, notify) decide la etapa leyendo `.index`
 * del value crudo, NUNCA el label. Un item nativo ("salir de Monday", Zona Efrain)
 * jamás recibe el echo real de Monday que normalmente rellena ese índice, así que
 * quien escribe deal_stage ahí (creación o edición) debe stampearlo con esta forma
 * — ver worker/lib/createRecord.ts submitCreateNative y worker/lib/outbox.ts. */
export function dealStageValue(label: string): { label: string; index?: number } {
  const key = stageKeyForLabel(label);
  return key === undefined ? { label } : { label, index: Number(key) };
}
