// Ancla: los mapas de "Estado del producto" (color_mm0hqf79) deben cubrir
// EXACTAMENTE las etiquetas que Monday declara hoy en shared/column-meta.gen.ts.
//
// El 2026-08-19 se descubrió que llevaban semanas desfasados sin que nada
// avisara: Monday había reemplazado el índice 5 ("Enviado con el" → "Pendiente
// de Recolectar") y agregado tres etiquetas más. `maybeLogProductoStatus` hace
// `if (!newLabel) return`, así que esas transiciones NO entraban al historial;
// y `LABEL_TO_BUCKET` las ignoraba, así que tampoco sumaban en la batería del
// Proyecto. Dos fallas silenciosas: sin excepción, sin log, sin síntoma visible.
//
// Este test truena en cuanto alguien regenere el meta (scripts/introspect-boards.mjs)
// y deje los mapas atrás. Si truena: agrega la etiqueta a PRODUCT_STATUS_LABELS,
// LABEL_TO_BUCKET, ESTADO_PRODUCTO_ORDER y ESTADO_PRODUCTO_COLORS — no borres
// el test. (ESTADO_PRODUCTO_COLORS vive en un .tsx que arrastra React, por eso
// no se valida aquí.)
import { describe, it, expect } from 'vitest';
import { COLUMN_META } from './column-meta.gen';
import { PRODUCT_STATUS_LABELS } from './notifications';
import { LABEL_TO_BUCKET, ESTADO_PRODUCTO_ORDER } from '../src/lib/estadoProductoBuckets';

const COL_ESTADO = 'color_mm0hqf79';

/** Etiquetas reales del board, sin los huecos que Monday deja al borrar una. */
const mondayLabels = Object.entries(COLUMN_META.proyectos_sub[COL_ESTADO]?.labels ?? {})
  .filter(([, l]) => l.label.trim() !== '');

describe('Estado del producto: los mapas del portal siguen a Monday', () => {
  it('el board todavía tiene etiquetas (si no, el meta se regeneró vacío)', () => {
    expect(mondayLabels.length).toBeGreaterThan(10);
  });

  it('PRODUCT_STATUS_LABELS calca índice→etiqueta de Monday', () => {
    for (const [index, l] of mondayLabels) {
      expect(PRODUCT_STATUS_LABELS[index], `índice ${index} de ${COL_ESTADO}`).toBe(l.label);
    }
  });

  it('no inventa índices que Monday ya no tiene', () => {
    const reales = new Set(mondayLabels.map(([index]) => index));
    for (const index of Object.keys(PRODUCT_STATUS_LABELS)) {
      expect(reales.has(index), `índice ${index} ya no existe en Monday`).toBe(true);
    }
  });

  it('cada etiqueta cae en un bucket de la batería', () => {
    for (const [, l] of mondayLabels) {
      expect(LABEL_TO_BUCKET[l.label], `"${l.label}" sin bucket`).toBeDefined();
    }
  });

  it('cada etiqueta se puede elegir en el selector de estado', () => {
    for (const [, l] of mondayLabels) {
      expect(ESTADO_PRODUCTO_ORDER, `"${l.label}" fuera del selector`).toContain(l.label);
    }
  });

  it('el selector no ofrece etiquetas que Monday no acepta', () => {
    const reales = new Set(mondayLabels.map(([, l]) => l.label));
    for (const label of ESTADO_PRODUCTO_ORDER) {
      expect(reales.has(label), `"${label}" ya no existe en Monday`).toBe(true);
    }
  });
});
