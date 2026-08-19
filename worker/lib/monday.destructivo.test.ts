// Ancla de la regla dura: el portal NUNCA borra en Monday.
//
// Efraín, 2026-08-19, tras el incidente del 2026-08-18 (un loop borró 70 líneas
// de 22 oportunidades en 4.5 minutos): "no se puede NUNCA NUNCA NUNCA borrar de
// monday — solo modificar y o duplicar o crear".
//
// Este test lee el código fuente del worker y falla si aparece cualquier
// mutación destructiva de la API de Monday. Es a propósito un test de TEXTO y
// no de tipos: lo que hay que impedir no es una función concreta, es que el
// worker le mande a Monday la palabra "delete" — venga de un helper, de un gql
// suelto o de un string armado a mano.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = new URL('../', import.meta.url).pathname; // worker/

function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    if (!ruta.endsWith('.ts') || ruta.includes('.test.')) return [];
    return [ruta];
  });
}

// Mutaciones destructivas de la API de Monday (docs 2024-10). No incluye
// `archive_*`: archivar tampoco se usa, pero lo que rompe datos es borrar.
const DESTRUCTIVAS = [
  'delete_item', 'delete_subitem', 'delete_board', 'delete_group',
  'delete_column', 'delete_update', 'delete_folder', 'delete_workspace',
];

describe('el worker nunca borra en Monday', () => {
  const archivos = fuentes(RAIZ);

  it('encuentra los fuentes del worker (el test no se está auto-anulando)', () => {
    expect(archivos.length).toBeGreaterThan(20);
    expect(archivos.some(a => a.endsWith('lib/monday.ts'))).toBe(true);
  });

  it.each(DESTRUCTIVAS)('ninguna mutación %s en el código del worker', mutacion => {
    const culpables = archivos.filter(a => {
      // Solo código: los comentarios que EXPLICAN la regla nombran la mutación
      // a propósito y no deben tumbar el test.
      const codigo = readFileSync(a, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return codigo.includes(mutacion);
    });
    expect(culpables.map(c => c.slice(RAIZ.length))).toEqual([]);
  });

  it('el cliente de Monday no exporta ningún helper de borrado', async () => {
    const monday = await import('./monday');
    const destructivos = Object.keys(monday).filter(k => /delete|remove|borrar|eliminar/i.test(k));
    expect(destructivos).toEqual([]);
  });
});

// Efraín, 2026-08-19: "asegúrate que DIVIDIR o editar solo patchea lo existente
// y crea subitems cuando es necesario". Así está hoy — `editar` hace un
// submitWrite sobre la MISMA línea, y `dividir` crea la línea hermana y le
// resta la cantidad al origen con otro submitWrite. Ninguno de los dos quita
// nada: ni de Monday (ya no se puede) ni de la vista del portal.
describe('ajustar línea (editar/dividir) solo modifica y crea', () => {
  const src = readFileSync(join(RAIZ, 'lib/lineaAjustes.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('escribe con submitWrite y crea con createSubitem', () => {
    expect(src).toContain('submitWrite(');
    expect(src).toContain('createSubitem(');
  });

  it('no quita líneas: ni borrado de Monday ni ocultarItem', () => {
    for (const prohibido of ['deleteItem', 'delete_item', 'ocultarItem', 'DELETE FROM items']) {
      expect(src).not.toContain(prohibido);
    }
  });
});
