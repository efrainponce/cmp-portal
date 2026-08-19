// Ancla de "duplicar = copia exacta" (Efraín, 2026-08-19).
//
// El 2026-08-19 Elizabeth duplicó OPP-0593 y el clon nació sin Zona, sin Tipo
// de cotización, sin Fecha límite ni Fecha de cotización, con las condiciones
// comerciales en el texto por defecto de Monday en vez de las que ella había
// escrito, y con las 9 líneas en otro orden. La causa no fue un bug: el
// duplicado copiaba SOLO 4 columnas de la cabecera y el resto nacía vacío,
// en silencio.
//
// Este test es de TEXTO a propósito, como worker/lib/monday.destructivo.test.ts:
// lo que hay que impedir no es una función concreta, es que una columna del
// board quede fuera del duplicado sin que nadie lo decida. Cada columna
// escribible de Oportunidades y de sus subitems tiene que estar o copiada en
// duplicateOportunidad.ts, o en la lista NO_COPIAR de aquí abajo con su razón.
// Si Monday gana una columna nueva y se re-corre scripts/introspect-boards.mjs,
// este test truena hasta que alguien decida de qué lado va.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COLUMN_META } from '../../shared/column-meta.gen';

const FUENTE = readFileSync(new URL('./duplicateOportunidad.ts', import.meta.url).pathname, 'utf8');

// Tipos que Monday no deja escribir (espejos, fórmulas, ids, logs) o que no
// son datos (botones, la propia lista de subitems): copiarlos es imposible o
// no significa nada. Monday los recalcula solo a partir de lo que sí se copia.
const TIPOS_DERIVADOS = new Set([
  'name', 'subtasks', 'subitems', 'mirror', 'formula', 'item_id', 'creation_log',
  'last_updated', 'pulse_updated', 'button', 'unsupported', 'direct_doc', 'doc',
  'auto_number', 'progress', 'integration',
]);

/** Columnas que a propósito NO se copian, con el porqué. Quitar una de aquí
 * sin agregarla al duplicado (o al revés) truena el test. */
const NO_COPIAR: Record<string, string> = {
  // Evidencia de pasos que el duplicado no vivió — forjarla es mentir con datos.
  date_mm094kzf: 'Fecha solicitud costeo — el clon no solicitó nada',
  date_mm09b6nz: 'Fecha solicitud validación costeo — idem',
  date_mm0mc3dj: 'Fecha Validación Costeo — idem',
  date_mm09wqah: 'Fecha Creación Proyecto — el clon no tiene proyecto',
  file_mm0fgrzq: 'PDF Cotizaciones generadas — diría el folio de la original',
  file_mm0z6rze: 'PDF Cotizaciones sin precio — idem',
  file_mm0zjras: 'PDF Cotizaciones Firmadas — una firma no se duplica',
  file_mm10k65a: 'PDF Solicitud Costeo — idem',
  // Ligas que, compartidas, ensucian a la original.
  board_relation_mm0hw8ew: 'Proyectos — dos oportunidades en el mismo proyecto rompe tallas y OC',
  link_mm468m26: 'Carpeta Drive — el clon estrena la suya (la crea Monday)',
  // El clon no está perdido aunque la original sí lo esté.
  dropdown_mm0mg00: 'Razón de Pérdida',
  text_mm47xmh: 'Comentario de Pérdida',
  // Origen del REGISTRO, no dato de la oportunidad.
  text_mm3q450n: 'Event ID — id único del envío de web que creó ESE registro',
  boolean_mm3q9zxm: 'Origen Web — el clon lo creó una persona en el portal',
};

// Columnas de texto que Monday dejó tiradas al importar (se llaman igual que
// botones y espejos: "Tasks", "Solicitar costeo", "Última actualización"…).
// Siempre vacías; no son campos del negocio.
const RESIDUALES = /^text_mm67/;

describe('duplicar = copia exacta', () => {
  for (const slug of ['oportunidades', 'oportunidades_sub'] as const) {
    it(`no deja fuera ninguna columna escribible de ${slug}`, () => {
      const olvidadas = Object.values(COLUMN_META[slug])
        .filter(col => !TIPOS_DERIVADOS.has(col.type))
        .filter(col => !RESIDUALES.test(col.id))
        .filter(col => !(col.id in NO_COPIAR))
        .filter(col => !FUENTE.includes(`'${col.id}'`))
        .map(col => `${col.id} (${col.title})`);
      expect(olvidadas).toEqual([]);
    });
  }

  it('las exclusiones son decisiones, no columnas que ya no existen', () => {
    const vivas = Object.keys(COLUMN_META.oportunidades);
    expect(Object.keys(NO_COPIAR).filter(id => !vivas.includes(id))).toEqual([]);
  });

  it('crea las líneas una por una: en Monday el orden es el orden de creación', () => {
    // El clon de OPP-0593 salió Chamarra/UA Stellar/Camisola cuando la
    // original iba Pantalón/Camisola/Chamarra — eso fue Promise.all sobre
    // createSubitem. Las imágenes sí van en paralelo (ya no hay orden que
    // preservar), por eso el ancla es sobre createSubitem, no sobre el archivo.
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function duplicateOportunidad'));
    const creacion = cuerpo.slice(0, cuerpo.indexOf('createSubitem'));
    expect(creacion).not.toMatch(/Promise\.all\([^)]*\bmap\b[\s\S]*$/);
    expect(cuerpo).toMatch(/for \(const linea of lineas\)/);
  });
});
