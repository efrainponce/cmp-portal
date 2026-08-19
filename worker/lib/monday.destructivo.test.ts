// Ancla del borrado: existe UN solo lugar en el worker que borra en Monday.
//
// Historia corta, porque las dos mitades importan:
//
// - 2026-08-18: un script pidió una lista con un filtro que la ruta no conocía
//   (`?parent=`), recibió el board COMPLETO y el loop que venía detrás borró 70
//   líneas de 22 oportunidades en 4.5 minutos. En Monday no hay deshacer masivo.
// - 2026-08-19 (mañana): la reacción fue prohibir el borrado por completo —
//   "quitar" pasó a ser ocultar en el portal.
// - 2026-08-19 (tarde): eso rompió costeo el mismo día. Una línea quitada seguía
//   viva en Monday, y validar_costeo (cmp-tallas) lee los subitems DIRECTO de
//   Monday: rechazó el envío por una línea que el portal ya no le mostraba a
//   nadie. Efraín: "que todo sea 1-1 con Monday si no errores van a pasar".
//
// Así que el portal sí borra, pero por un solo camino y con guardas. Este test
// es de TEXTO a propósito: lo que hay que impedir no es una función concreta,
// es que cualquier archivo del worker le mande a Monday la palabra "delete",
// venga de un helper, de un gql suelto o de un string armado a mano.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = new URL('../', import.meta.url).pathname; // worker/
const BORRADOR = 'lib/itemBorrado.ts'; // el único autorizado

function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    if (!ruta.endsWith('.ts') || ruta.includes('.test.')) return [];
    return [ruta];
  });
}

function codigoSinComentarios(archivo: string): string {
  return readFileSync(archivo, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// Mutaciones destructivas de la API de Monday (docs 2024-10). `delete_item` es
// la única con un uso legítimo —una línea que el usuario quita— y solo desde
// itemBorrado.ts; borrar boards, columnas o grupos no lo hace el portal jamás.
const PROHIBIDAS = [
  'delete_subitem', 'delete_board', 'delete_group',
  'delete_column', 'delete_update', 'delete_folder', 'delete_workspace',
];

describe('borrar en Monday: un solo camino', () => {
  const archivos = fuentes(RAIZ);

  it('encuentra los fuentes del worker (el test no se está auto-anulando)', () => {
    expect(archivos.length).toBeGreaterThan(20);
    expect(archivos.some(a => a.endsWith('lib/monday.ts'))).toBe(true);
    expect(archivos.some(a => a.endsWith(BORRADOR))).toBe(true);
  });

  it.each(PROHIBIDAS)('ninguna mutación %s en el código del worker', mutacion => {
    const culpables = archivos.filter(a => codigoSinComentarios(a).includes(mutacion));
    expect(culpables.map(c => c.slice(RAIZ.length))).toEqual([]);
  });

  it('delete_item solo aparece en itemBorrado.ts', () => {
    const culpables = archivos
      .filter(a => codigoSinComentarios(a).includes('delete_item'))
      .map(c => c.slice(RAIZ.length));
    expect(culpables).toEqual([BORRADOR]);
  });

  it('el cliente de Monday no exporta ningún helper de borrado', async () => {
    const monday = await import('./monday');
    const destructivos = Object.keys(monday).filter(k => /delete|remove|borrar|eliminar/i.test(k));
    expect(destructivos).toEqual([]);
  });

  it('itemBorrado respalda el renglón y topa el ritmo antes de borrar', () => {
    const src = codigoSinComentarios(join(RAIZ, BORRADOR));
    // El respaldo (INSERT en item_borrado) y el tope tienen que quedar ARRIBA
    // del delete_item: si algo falla, lo que no puede perderse es el dato.
    const tope = src.indexOf('TOPE_POR_HORA');
    const respaldo = src.indexOf('INSERT INTO item_borrado');
    const borrado = src.indexOf('delete_item');
    expect(tope).toBeGreaterThanOrEqual(0);
    expect(respaldo).toBeGreaterThanOrEqual(0);
    expect(borrado).toBeGreaterThan(respaldo);
    expect(borrado).toBeGreaterThan(tope);
    // Un id a la vez: nada de listas de ids en la mutación.
    expect(src).not.toMatch(/delete_item[\s\S]{0,120}\[/);
  });
});

// Efraín, 2026-08-19: "asegúrate que DIVIDIR o editar solo patchea lo existente
// y crea subitems cuando es necesario". Así está hoy — `editar` hace un
// submitWrite sobre la MISMA línea, y `dividir` crea la línea hermana y le
// resta la cantidad al origen con otro submitWrite. Ninguno de los dos quita
// nada.
describe('ajustar línea (editar/dividir) solo modifica y crea', () => {
  const src = codigoSinComentarios(join(RAIZ, 'lib/lineaAjustes.ts'));

  it('escribe con submitWrite y crea con createSubitem', () => {
    expect(src).toContain('submitWrite(');
    expect(src).toContain('createSubitem(');
  });

  it('no quita líneas', () => {
    for (const prohibido of ['borrarItem', 'delete_item', 'DELETE FROM items']) {
      expect(src).not.toContain(prohibido);
    }
  });
});
