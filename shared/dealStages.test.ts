// "Mandar a costeo" se esconde por etapa (Efraín, 2026-08-18): antes vivía
// siempre visible y en media docena de etapas solo servía para mostrar un
// banner rojo con un pendiente que nadie podía resolver.
import { describe, it, expect } from 'vitest';
import { puedeMandarACosteo, COSTEO_STAGE_BLOCKED, DEAL_STAGE_LABELS } from './dealStages';

describe('puedeMandarACosteo', () => {
  it('sí en Nueva oportunidad, aunque no haya borrador', () => {
    expect(puedeMandarACosteo('4', false)).toBe(true);
  });

  it('no en las etapas que el server rechaza, ni con borrador', () => {
    for (const stage of Object.keys(COSTEO_STAGE_BLOCKED)) {
      expect(puedeMandarACosteo(stage, false)).toBe(false);
      expect(puedeMandarACosteo(stage, true)).toBe(false);
    }
  });

  it('en una etapa avanzada solo con un borrador de versión', () => {
    expect(puedeMandarACosteo('9', false)).toBe(false);   // Costeo Confirmado, ya costeada
    expect(puedeMandarACosteo('9', true)).toBe(true);     // tras "+ Nueva versión"
    expect(puedeMandarACosteo('8', true)).toBe(true);     // Esperando OC
  });

  it('las etapas bloqueadas son etapas reales del pipeline', () => {
    for (const stage of Object.keys(COSTEO_STAGE_BLOCKED)) {
      expect(DEAL_STAGE_LABELS[stage]).toBeTruthy();
    }
  });
});
