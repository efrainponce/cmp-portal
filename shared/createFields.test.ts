// El alta de un Proyecto "desde cero" (sin Oportunidad ligada, Efraín 2026-08-26)
// tiene dos formas de salir mal EN SILENCIO — el item se crea en Monday y nadie
// lo vuelve a ver desde el portal. Este test las ancla.
import { describe, it, expect } from 'vitest';
import { CREATE_FIELDS, CREATE_DEFAULTS } from './createFields';
import { BOARDS } from './boards';
import { COLUMN_META } from './column-meta.gen';

describe('CREATE_FIELDS.proyectos', () => {
  it('exige las columnas por las que se scopea el renglón (worker/lib/dal.ts)', () => {
    // vendedor lee por authzCols; compras por comprasCol. Si cualquiera de las
    // dos queda vacía, el proyecto nace invisible para quien lo acaba de crear.
    const requeridas = CREATE_FIELDS.proyectos.filter(f => f.required).map(f => f.id);
    for (const col of BOARDS.proyectos.authzCols ?? []) expect(requeridas).toContain(col);
    expect(requeridas).toContain(BOARDS.proyectos.comprasCol);
  });

  it('nace con una etapa real de project_status', () => {
    // src/lib/projectStages.ts filtra los 4 accesos del sidebar por
    // project_status: un proyecto sin valor no cae en NINGÚN grupo y no se
    // lista en ninguna parte (mismo hallazgo que worker/lib/ganarOportunidad.ts).
    const etapa = CREATE_DEFAULTS.proyectos?.project_status;
    const labels = Object.values(COLUMN_META.proyectos.project_status.labels ?? {}).map(l => l.label);
    expect(labels).toContain(etapa);
  });

  it('no deja ligar la Oportunidad desde el form', () => {
    // Ligar Proyecto↔Oportunidad es exclusivo de "Ganar" (idempotente, no
    // duplica el proyecto). Elegirla aquí permitiría un segundo proyecto para
    // la misma oportunidad.
    expect(CREATE_FIELDS.proyectos.map(f => f.id)).not.toContain('board_relation_mm0hf0y3');
  });
});
