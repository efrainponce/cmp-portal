// Versiones por fecha del Inventario 5.11 (Pam, 2026-09-25): el día se cuenta
// en hora de México y cada día muestra el último guardado de cada tarjeta.
import { describe, it, expect } from 'vitest';
import { diaInventario, diasInventario, fechaInventario, inventarioAlDia, type InventarioVersionDTO } from './inventarioCotizacion';

const v = (productoId: string, color: string, guardadoAt: string, comentarios = ''): InventarioVersionDTO => ({
  productoId, productoNombre: productoId, color, comentarios, agregadoManualmente: false, guardadoAt,
});

describe('diaInventario / fechaInventario', () => {
  it('cuenta el día en hora de México, no en UTC', () => {
    // 02:00 UTC del 26 = 20:00 del 25 en CDMX.
    expect(diaInventario('2026-09-26T02:00:00.000Z')).toBe('2026-09-25');
    expect(fechaInventario('2026-09-26T02:00:00.000Z')).toBe('25/09/2026');
    expect(fechaInventario('2026-09-20')).toBe('20/09/2026');
  });
});

describe('versiones por día', () => {
  const historial = [
    v('A', 'BLACK', '2026-09-20T16:00:00.000Z', 'lunes'),
    v('B', '', '2026-09-20T17:00:00.000Z', 'b lunes'),
    v('A', 'BLACK', '2026-09-25T15:00:00.000Z', 'viernes temprano'),
    v('A', 'BLACK', '2026-09-25T18:00:00.000Z', 'viernes tarde'),
  ];

  it('lista los días del más reciente al más viejo, sin repetir', () => {
    expect(diasInventario(historial)).toEqual(['2026-09-25', '2026-09-20']);
  });

  it('un día pasado muestra lo de ese día, no lo que se subió después', () => {
    const al20 = inventarioAlDia(historial, '2026-09-20');
    expect(al20.map((r) => r.comentarios).sort()).toEqual(['b lunes', 'lunes']);
  });

  it('el día vigente toma el ÚLTIMO guardado de cada tarjeta y conserva las que no cambiaron', () => {
    const al25 = inventarioAlDia(historial, '2026-09-25');
    expect(al25.find((r) => r.productoId === 'A')?.comentarios).toBe('viernes tarde');
    expect(al25.find((r) => r.productoId === 'B')?.comentarios).toBe('b lunes');
  });
});
