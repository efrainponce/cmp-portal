// Permisos de columna de la consulta libre: cada campo existe solo si su
// columna de origen es legible para el viewer (shared/visibility.ts). Si un
// campo sin fuente se colara, el modelo lo vería aunque la whitelist lo tape.
import { describe, it, expect } from 'vitest';
import { CAMPOS } from '../../shared/consultaLibre';
import { FUENTES, disponiblesPara, nombreProducto } from './consultaLibre';

const EFRAIN = 'salinasefrain@mexicanadeproteccion.com';
const JORGE = 'webcmp@mexicanadeproteccion.com';

describe('consulta libre — campos por viewer', () => {
  it('todo campo del motor declara su columna de origen', () => {
    for (const tabla of ['oportunidades', 'lineas'] as const) {
      for (const campo of Object.keys(CAMPOS[tabla])) expect(FUENTES[tabla], `${tabla}.${campo}`).toHaveProperty(campo);
    }
  });

  it('la whitelist de utilidades ve TODOS los campos (ninguno se pierde por una columna fuera de VISIBILITY)', () => {
    for (const tabla of ['oportunidades', 'lineas'] as const) {
      expect([...disponiblesPara(tabla, 'admin', EFRAIN)].sort()).toEqual(Object.keys(CAMPOS[tabla]).sort());
    }
  });

  it('Jorge (admin fuera de utilidades) ve todo menos la utilidad', () => {
    const opp = disponiblesPara('oportunidades', 'admin', JORGE);
    const lin = disponiblesPara('lineas', 'admin', JORGE);
    expect(opp.has('utilidad')).toBe(false);
    expect(lin.has('utilidad_total')).toBe(false);
    expect(opp.has('monto')).toBe(true);
    expect(lin.has('costo_total')).toBe(true);
  });

  it('sin correo, la utilidad se oculta (default seguro)', () => {
    expect(disponiblesPara('oportunidades', 'admin', null).has('utilidad')).toBe(false);
  });
});

describe('nombreProducto — el mismo producto no se parte en dos grupos', () => {
  it('catálogo > texto > nombre de la línea sin prefijo numérico de SKU', () => {
    expect(nombreProducto('Taclite Pro Long Sleeve Shirt', 'otro', 'x')).toBe('Taclite Pro Long Sleeve Shirt');
    expect(nombreProducto('', 'Bota táctica', 'x')).toBe('Bota táctica');
    expect(nombreProducto(null, null, '72175 - Taclite Pro Long Sleeve Shirt')).toBe('Taclite Pro Long Sleeve Shirt');
    // Un prefijo de marca (no numérico) se queda: es parte del nombre.
    expect(nombreProducto(null, null, 'CONDOR EMBLEMAS - CHAMARRA')).toBe('CONDOR EMBLEMAS - CHAMARRA');
    expect(nombreProducto(null, '  ', null)).toBeNull();
  });
});
