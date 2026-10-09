// El plugin vite.precargaRutas.ts calca, en una tabla, qué vista lazy de
// App.tsx pinta cada ruta. Si App.tsx cambia y la tabla no, la precarga de los
// chunks de esa ruta se apaga en silencio (nada falla, solo vuelve a estar
// lento en Mérida). Esto amarra las dos.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRAWERS, VISTAS } from '../../vite.precargaRutas';

const RAIZ = join(import.meta.dirname, '..', '..');
const app = readFileSync(join(RAIZ, 'src', 'App.tsx'), 'utf8');

describe('precarga de chunks por ruta', () => {
  it('cada vista de la tabla existe y App.tsx la importa lazy', () => {
    for (const modulo of [...Object.keys(VISTAS), ...Object.keys(DRAWERS)]) {
      expect(existsSync(join(RAIZ, modulo)), modulo).toBe(true);
    }
    for (const modulo of Object.keys(VISTAS)) {
      const rel = './' + modulo.replace(/^src\//, '').replace(/\.tsx$/, '');
      expect(app, modulo).toContain(`import('${rel}')`);
    }
  });

  it('cada ruta que App.tsx pinta con una vista lazy está en la tabla', () => {
    const rutasApp = [...app.matchAll(/activeBoard === '([a-z_]+)'/g)].map(m => m[1]);
    const enTabla = new Set(Object.values(VISTAS).flat());
    expect(rutasApp.filter(r => !enTabla.has(r))).toEqual([]);
  });
});
