// shared/costeoAvisos.ts — los avisos de "Mandar a costeo" que dependen solo
// de la oportunidad (no de sus líneas). Viven aquí porque el drawer los
// PREDICE con el detalle que ya tiene en pantalla (2026-10-08, plan CWV paso
// 7): sin eso el aviso "Falta esto para…" aparecía ~1 s después de abrir, al
// llegar `costeo-check`, y empujaba pestañas y cotización ~70-90 px. El server
// (worker/lib/costeo.ts checkCosteo) sigue siendo quien decide y usa los
// MISMOS textos, así que al llegar su respuesta el aviso no cambia de alto.
export const AVISO_SIN_INSTITUCION = 'Asigna una institución a la oportunidad.';
export const AVISO_SIN_LINEAS = 'La oportunidad no tiene líneas de producto. Agrega al menos una.';

export function avisosOportunidadCosteo(institucion: string | null | undefined, nLineas: number): string[] {
  const out: string[] = [];
  if (!(institucion ?? '').trim()) out.push(AVISO_SIN_INSTITUCION);
  if (nLineas === 0) out.push(AVISO_SIN_LINEAS);
  return out;
}
