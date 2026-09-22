import { describe, expect, it } from 'vitest';
import { fechaRetorno, retornoVencido, sumarDias, validarSolicitud } from './muestras';

describe('fechas de retorno', () => {
  it('suma días sin recorrerse por zona horaria, cruzando mes y año', () => {
    expect(sumarDias('2026-09-14', 7)).toBe('2026-09-21');
    expect(sumarDias('2026-12-28', 7)).toBe('2027-01-04');
    expect(sumarDias('14/09/2026', 7)).toBeNull();
  });
  it('sin fecha o sin días no hay retorno', () => {
    expect(fechaRetorno(null, 7)).toBeNull();
    expect(fechaRetorno('2026-09-14', null)).toBeNull();
    expect(fechaRetorno('2026-09-14', 0)).toBe('2026-09-14');
  });
  it('vencida solo si sigue con el cliente y ya pasó la fecha', () => {
    expect(retornoVencido({ estado: 'entregada', fechaRetorno: '2026-09-20' }, '2026-09-21')).toBe(true);
    expect(retornoVencido({ estado: 'entregada', fechaRetorno: '2026-09-21' }, '2026-09-21')).toBe(false);
    expect(retornoVencido({ estado: 'validada', fechaRetorno: '2026-09-01' }, '2026-09-21')).toBe(false);
    expect(retornoVencido({ estado: 'enviada', fechaRetorno: '2026-09-01' }, '2026-09-21')).toBe(false);
  });
});

describe('validarSolicitud', () => {
  // El Excel de ejemplo (Fiscalía Tlaxcala): 5.11 Stryke Pant, talla en "observaciones".
  const linea = { producto: 'STRYKE PANT', sku: '74369', marca: '5.11', color: 'STORM', talla: '32 X 30', cantidad: 1 };

  it('normaliza textos vacíos a "" y conserva lo capturado', () => {
    const r = validarSolicitud({ fechaEntrega: '2026-09-14', diasRetorno: '7', lineas: [{ ...linea, comentarios: '  ' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.diasRetorno).toBe(7);
    expect(r.valor.notas).toBeNull();
    expect(r.valor.lineas[0]).toMatchObject({ producto: 'STRYKE PANT', talla: '32 X 30', comentarios: '', productoId: null });
  });
  it('rechaza sin renglones, sin producto, cantidad 0 o fecha mal escrita', () => {
    expect(validarSolicitud({ lineas: [] }).ok).toBe(false);
    expect(validarSolicitud({ lineas: [{ ...linea, producto: ' ' }] }).ok).toBe(false);
    expect(validarSolicitud({ lineas: [{ ...linea, cantidad: 0 }] }).ok).toBe(false);
    expect(validarSolicitud({ fechaEntrega: '14/09/2026', lineas: [linea] }).ok).toBe(false);
    expect(validarSolicitud({ diasRetorno: 2.5, lineas: [linea] }).ok).toBe(false);
    expect(validarSolicitud({ lineas: [{ ...linea, productoId: 'abc' }] }).ok).toBe(false);
  });
});
