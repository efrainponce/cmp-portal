// Re-export: la lógica de parse/serialize por zona vive en shared/embellecimiento.ts
// (el worker también la necesita, para createOportunidad.ts) — este módulo se
// conserva para no romper imports existentes del frontend.
export {
  EMBELL_TEMPLATE_KEYS,
  EMB_STATUS_COL,
  EMB_LABEL_CON,
  EMB_LABEL_SIN,
  parseEmbellecimiento,
  explodeEmbellecimiento,
  serializeEmbellecimiento,
  upsertEmbellZone,
} from '../../shared/embellecimiento';
export type { EmbellZoneKey, EmbellZone } from '../../shared/embellecimiento';
