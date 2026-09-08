import { describe, it, expect } from 'vitest';
import {
  abonoVencido, diasParaPago, etiquetaMes, flujoPorMes, hoyISO, resumenConcepto, resumenEstadoCuenta,
} from './estadoCuenta';

const HOY = '2026-08-20';
const cobrado = (monto: number, fecha: string) => ({ monto, fecha });
const programado = (monto: number, fechaEstimada: string) => ({ monto, fecha: null, fechaEstimada });

describe('resumenConcepto', () => {
  it('sin cobros queda pendiente y debe el total', () => {
    const r = resumenConcepto(1_000_000, [], HOY);
    expect(r).toMatchObject({ abonado: 0, saldo: 1_000_000, avance: 0, estado: 'pendiente', sinProgramar: 1_000_000 });
  });

  it('el caso de la factura de un millón con cien mil cobrados', () => {
    const r = resumenConcepto(1_000_000, [cobrado(100_000, '2026-07-30')], HOY);
    expect(r.abonado).toBe(100_000);
    expect(r.saldo).toBe(900_000);
    expect(r.avance).toBeCloseTo(0.1);
    expect(r.estado).toBe('parcial');
  });

  it('lo PROGRAMADO no cuenta como cobrado, pero sí como provisión', () => {
    const r = resumenConcepto(1_000_000, [
      cobrado(100_000, '2026-07-30'),
      programado(400_000, '2026-09-15'),
      programado(500_000, '2026-10-01'),
    ], HOY);
    expect(r.abonado).toBe(100_000);
    expect(r.programado).toBe(900_000);
    expect(r.saldo).toBe(900_000);
    expect(r.sinProgramar).toBe(0);
    expect(r.estado).toBe('parcial');
  });

  it('avisa qué parte del saldo no tiene ni fecha estimada', () => {
    const r = resumenConcepto(1_000_000, [programado(300_000, '2026-09-15')], HOY);
    expect(r.sinProgramar).toBe(700_000);
  });

  it('la próxima fecha es la del cobro pendiente más cercano, no la del primero capturado', () => {
    const r = resumenConcepto(1_000_000, [
      programado(500_000, '2026-10-01'),
      programado(400_000, '2026-09-15'),
      cobrado(100_000, '2026-01-01'),
    ], HOY);
    expect(r.proximaFecha).toBe('2026-09-15');
  });

  it('un cobro programado que ya venció se suma aparte', () => {
    const r = resumenConcepto(1_000_000, [programado(400_000, '2026-08-01'), programado(500_000, '2026-12-01')], HOY);
    expect(r.vencido).toBe(400_000);
  });

  it('cuando lo cobrado suma el total, queda pagado', () => {
    const r = resumenConcepto(1_000_000, [cobrado(100_000, '2026-07-30'), cobrado(400_000, '2026-08-01'), cobrado(500_000, '2026-08-10')], HOY);
    expect(r.estado).toBe('liquidado');
    expect(r.avance).toBe(1);
  });

  it('el redondeo de punto flotante no deja una factura pagada en "parcial"', () => {
    expect(resumenConcepto(0.3, [cobrado(0.1, '2026-01-01'), cobrado(0.2, '2026-01-02')], HOY).estado).toBe('liquidado');
  });

  it('un centavo de menos sigue siendo parcial (la tolerancia no tapa un faltante real)', () => {
    expect(resumenConcepto(1_000_000, [cobrado(999_999.98, '2026-01-01')], HOY).estado).toBe('parcial');
  });

  it('pagar de más se marca aparte, con la barra topada en 1', () => {
    const r = resumenConcepto(100, [cobrado(150, '2026-01-01')], HOY);
    expect(r.estado).toBe('sobrepago');
    expect(r.saldo).toBe(-50);
    expect(r.avance).toBe(1);
  });

  it('un concepto en cero no divide entre cero', () => {
    expect(resumenConcepto(0, [], HOY).avance).toBe(0);
    expect(resumenConcepto(0, [], HOY).estado).toBe('liquidado');
  });
});

describe('vencimiento de un cobro programado', () => {
  it('el que se programó para HOY todavía no está vencido', () => {
    expect(abonoVencido(programado(1, '2026-08-20'), HOY)).toBe(false);
    expect(abonoVencido(programado(1, '2026-08-19'), HOY)).toBe(true);
  });

  it('un cobro que YA entró nunca se marca vencido, por viejo que sea', () => {
    expect(abonoVencido({ monto: 1, fecha: '2020-01-01', fechaEstimada: '2019-01-01' }, HOY)).toBe(false);
  });

  it('sin fecha estimada no hay vencimiento que calcular', () => {
    expect(abonoVencido({ monto: 1, fecha: null, fechaEstimada: null }, HOY)).toBe(false);
    expect(diasParaPago(null, HOY)).toBe(null);
  });

  it('cuenta los días que faltan y los que lleva vencido', () => {
    expect(diasParaPago('2026-08-30', HOY)).toBe(10);
    expect(diasParaPago('2026-08-20', HOY)).toBe(0);
    expect(diasParaPago('2026-07-21', HOY)).toBe(-30);
  });

  it('hoyISO usa la hora local, no UTC', () => {
    // 20:00 en México (UTC-6) ya es el día siguiente en UTC: si esto tomara
    // toISOString(), un cobro programado para hoy se vería vencido esta noche.
    expect(hoyISO(new Date(2026, 7, 20, 20, 0, 0))).toBe('2026-08-20');
  });
});

describe('resumenEstadoCuenta', () => {
  const conceptos = [
    { tipo: 'ingreso' as const, total: 1_000_000, abonado: 100_000, saldo: 900_000, vencido: 900_000 },
    { tipo: 'ingreso' as const, total: 200_000, abonado: 200_000, saldo: 0 },
    { tipo: 'egreso' as const, total: 50_000, abonado: 20_000, saldo: 30_000, vencido: 0 },
  ];

  it('separa lo que ya se movió de lo que falta, por lado', () => {
    expect(resumenEstadoCuenta(conceptos)).toEqual({
      cobrado: 300_000, porCobrar: 900_000, totalIngresos: 1_200_000,
      pagado: 20_000, porPagar: 30_000, totalEgresos: 50_000,
      saldo: 280_000, vencidoPorCobrar: 900_000, vencidoPorPagar: 0,
    });
  });

  it('un sobrepago no cuenta como "por cobrar" negativo', () => {
    const r = resumenEstadoCuenta([{ tipo: 'ingreso', total: 100, abonado: 150, saldo: -50 }]);
    expect(r.porCobrar).toBe(0);
    expect(r.cobrado).toBe(150);
  });

  it('sin conceptos, todo en cero', () => {
    expect(resumenEstadoCuenta([]).saldo).toBe(0);
  });
});

describe('flujoPorMes', () => {
  it('agrupa por mes y separa ingresos de egresos', () => {
    const meses = flujoPorMes([
      { tipo: 'ingreso', monto: 100_000, fecha: '2026-08-05' },
      { tipo: 'ingreso', monto: 50_000, fecha: '2026-08-20' },
      { tipo: 'egreso', monto: 30_000, fecha: '2026-08-10' },
      { tipo: 'ingreso', monto: 400_000, fecha: null, fechaEstimada: '2026-09-15' },
    ]);
    expect(meses.map(m => m.mes)).toEqual(['2026-08', '2026-09']);
    expect(meses[0]).toMatchObject({ ingreso: 150_000, egreso: 30_000, ingresoReal: 150_000, ingresoEstimado: 0 });
    expect(meses[1]).toMatchObject({ ingreso: 400_000, ingresoEstimado: 400_000, ingresoReal: 0 });
  });

  it('un cobro programado cae en el mes de su fecha ESTIMADA', () => {
    const meses = flujoPorMes([{ tipo: 'ingreso', monto: 400_000, fecha: null, fechaEstimada: '2026-12-31' }]);
    expect(meses.at(-1)).toMatchObject({ mes: '2026-12', ingresoEstimado: 400_000 });
  });

  it('rellena los meses vacíos para que el tiempo no mienta', () => {
    const meses = flujoPorMes([
      { tipo: 'ingreso', monto: 1, fecha: '2026-08-01' },
      { tipo: 'ingreso', monto: 1, fecha: null, fechaEstimada: '2026-11-01' },
    ]);
    expect(meses.map(m => m.mes)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(meses[1].ingreso).toBe(0);
  });

  it('cruza el año sin inventar el mes 13', () => {
    const meses = flujoPorMes([
      { tipo: 'egreso', monto: 1, fecha: '2026-11-15' },
      { tipo: 'egreso', monto: 1, fecha: '2027-02-01' },
    ]);
    expect(meses.map(m => m.mes)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('un dedazo en el año no genera mil barras vacías', () => {
    const meses = flujoPorMes([
      { tipo: 'ingreso', monto: 1, fecha: '2026-08-01' },
      { tipo: 'ingreso', monto: 1, fecha: null, fechaEstimada: '2126-08-01' },
    ]);
    expect(meses.length).toBeLessThanOrEqual(26);
    expect(meses.at(-1)!.mes).toBe('2126-08');
  });

  it('lo que no se puede ubicar en el tiempo no entra a la gráfica', () => {
    expect(flujoPorMes([{ tipo: 'ingreso', monto: 500, fecha: null, fechaEstimada: null }])).toEqual([]);
    expect(flujoPorMes([])).toEqual([]);
  });
});

describe('etiquetaMes', () => {
  it('se lee corto en el eje', () => {
    expect(etiquetaMes('2026-08')).toBe('ago 26');
    expect(etiquetaMes('2027-01')).toBe('ene 27');
  });
});
