// Motor de la consulta libre del bot de dirección. Lo que se ancla: que un
// campo desconocido o tapado sea ERROR (nunca un filtro que se cae en silencio),
// que los filtros de texto no dependan de acentos/mayúsculas, que las fechas
// filtren por prefijo ("2026-08" = todo agosto) y que los grupos/totales sumen.
import { describe, it, expect } from 'vitest';
import {
  validarConsulta, ejecutarConsulta, aplicarPeriodoDefault, anioEnCurso, ConsultaError, CAMPOS, SIN_DATO, type Fila,
} from './consultaLibre';

const TODOS = new Set([...Object.keys(CAMPOS.oportunidades), ...Object.keys(CAMPOS.lineas)]);
const SIN_UTILIDAD = new Set([...TODOS].filter(c => c !== 'utilidad' && c !== 'utilidad_total'));

const opps: Fila[] = [
  { folio: 'OPP-1', etapa: 'Ganada', estado: 'ganada', zona: 'Sureste', vendedor: 'Ray', creada: '2026-08-03', monto: 1000, utilidad: 200 },
  { folio: 'OPP-2', etapa: 'Ganada', estado: 'ganada', zona: 'sureste ', vendedor: 'Ana', creada: '2026-08-20', monto: 3000, utilidad: 500 },
  { folio: 'OPP-3', etapa: 'Perdida', estado: 'perdida', zona: 'Centro', vendedor: 'Ray', creada: '2026-07-15', monto: 500, utilidad: null },
  { folio: 'OPP-4', etapa: 'En costeo', estado: 'abierta', zona: null, vendedor: 'Ana', creada: '2026-09-01', monto: 0, utilidad: null },
  { folio: 'OPP-5', etapa: 'Cotización', estado: 'abierta', zona: 'Centro', vendedor: 'Luz', creada: '2026-08-31', monto: 2000, utilidad: null },
];

const q = (raw: Record<string, unknown>, disp = TODOS) => validarConsulta({ tabla: 'oportunidades', ...raw }, disp);

describe('validarConsulta — fail-closed', () => {
  it('campo desconocido = error con la lista de campos válidos', () => {
    expect(() => q({ filtros: [{ campo: 'region', op: '=', valor: 'Sur' }] })).toThrow(/Campos válidos: .*zona/);
    expect(() => q({ agrupar_por: ['sucursal'] })).toThrow(ConsultaError);
  });

  it('campo tapado por visibilidad = error explícito, no se ignora', () => {
    expect(() => q({ metricas: [{ fn: 'suma', campo: 'utilidad' }] }, SIN_UTILIDAD)).toThrow(/no está disponible/);
    // Y tampoco aparece en la lista de válidos que se le sugiere al modelo.
    try { q({ agrupar_por: ['x'] }, SIN_UTILIDAD); } catch (e) { expect(String(e)).not.toMatch(/utilidad/); }
  });

  it('tabla, operador y tipo de métrica se validan', () => {
    expect(() => validarConsulta({ tabla: 'proyectos' }, TODOS)).toThrow(/tabla/);
    expect(() => q({ filtros: [{ campo: 'zona', op: 'like', valor: 'x' }] })).toThrow(/Operador/);
    expect(() => q({ metricas: [{ fn: 'suma', campo: 'zona' }] })).toThrow(/numérico/);
    expect(() => q({ filtros: [{ campo: 'zona', op: '>', valor: 'a' }] })).toThrow(/números o fechas/);
    expect(() => q({ filtros: [{ campo: 'zona', op: '=' }] })).toThrow(/necesita valor/);
  });

  it('ordenar_por agrupado debe existir en el resultado; el límite se topa', () => {
    expect(() => q({ agrupar_por: ['zona'], ordenar_por: 'monto' })).toThrow(/ordenar_por/);
    expect(q({ limite: 999 }).limite).toBe(50);
  });
});

describe('periodo por defecto = año en curso', () => {
  it('sin filtro de fecha agrega creada >= 1 de enero y lo dice', () => {
    const { consulta, periodo } = aplicarPeriodoDefault(q({ agrupar_por: ['zona'] }), '2026', false);
    expect(consulta.filtros).toContainEqual({ campo: 'creada', op: '>=', valor: '2026-01-01' });
    expect(periodo).toMatch(/2026/);
    // Sobre las filas: OPP-3 (julio) entra, nada de 2025 si lo hubiera.
    const r = ejecutarConsulta([...opps, { ...opps[0], folio: 'OPP-2025', creada: '2025-12-31' }], consulta);
    expect(r.filas_que_cumplen).toBe(5);
  });

  it('si la consulta ya trae un periodo (cualquier fecha o mes/año) se respeta', () => {
    for (const filtros of [
      [{ campo: 'fecha_cotizacion', op: '>=', valor: '2025-06' }],
      [{ campo: 'mes_creada', op: '=', valor: '2025-11' }],
      [{ campo: 'anio_creada', op: '=', valor: '2025' }],
    ]) {
      const c = q({ filtros });
      expect(aplicarPeriodoDefault(c, '2026', false).consulta).toEqual(c);
    }
  });

  it('toda_la_historia no agrega nada', () => {
    const c = q({});
    expect(aplicarPeriodoDefault(c, '2026', true)).toEqual({ consulta: c, periodo: 'toda la historia' });
  });

  it('el año es el de México, no el de UTC', () => {
    // 1 de enero 03:00 UTC = 31 de dic 21:00 en CDMX.
    expect(anioEnCurso(new Date('2027-01-01T03:00:00Z'))).toBe('2026');
    expect(anioEnCurso(new Date('2027-01-01T07:00:00Z'))).toBe('2027');
  });
});

describe('ejecutarConsulta', () => {
  it('"¿qué zona va mejor?": agrupa sin importar mayúsculas/espacios, ordena por la métrica y da participación', () => {
    const r = ejecutarConsulta(opps, q({
      filtros: [{ campo: 'estado', op: '=', valor: 'Ganada' }],
      agrupar_por: ['zona'],
      metricas: [{ fn: 'suma', campo: 'monto' }],
    }));
    expect(r.filas_que_cumplen).toBe(2);
    expect(r.total_grupos).toBe(1);
    expect(r.resultado[0]).toMatchObject({ zona: 'Sureste', contar: 2, suma_monto: 4000, suma_monto_pct_del_total: 100 });
    expect(r.totales).toMatchObject({ contar: 2, suma_monto: 4000 });
  });

  it('los vacíos se agrupan como (sin dato) y quedan al final', () => {
    const r = ejecutarConsulta(opps, q({ agrupar_por: ['zona'], metricas: [{ fn: 'suma', campo: 'monto' }] }));
    expect(r.resultado.map(g => g.zona)).toEqual(['Sureste', 'Centro', SIN_DATO]);
    expect(r.resultado.find(g => g.zona === 'Centro')).toMatchObject({ suma_monto: 2500, contar: 2 });
  });

  it('fechas por prefijo: "2026-08" es todo agosto', () => {
    const r = ejecutarConsulta(opps, q({ filtros: [{ campo: 'creada', op: '=', valor: '2026-08' }], metricas: [{ fn: 'contar' }] }));
    expect(r.resultado[0].contar).toBe(3);
    const rango = ejecutarConsulta(opps, q({
      filtros: [{ campo: 'creada', op: '>=', valor: '2026-08' }, { campo: 'creada', op: '<=', valor: '2026-08' }],
      metricas: [{ fn: 'suma', campo: 'monto' }],
    }));
    expect(rango.resultado[0].suma_monto).toBe(6000);
  });

  it('en / contiene / vacio / != ignoran acentos', () => {
    const cuenta = (filtros: unknown[]) => ejecutarConsulta(opps, q({ filtros, metricas: [{ fn: 'contar' }] })).resultado[0].contar;
    expect(cuenta([{ campo: 'etapa', op: 'en', valor: ['cotizacion', 'en costeo'] }])).toBe(2);
    expect(cuenta([{ campo: 'vendedor', op: 'contiene', valor: 'RA' }])).toBe(2);
    expect(cuenta([{ campo: 'zona', op: 'vacio' }])).toBe(1);
    expect(cuenta([{ campo: 'estado', op: '!=', valor: 'abierta' }])).toBe(3);
  });

  it('métricas: promedio/mediana ignoran vacíos, suma de nada es 0, contar_distintos normaliza', () => {
    const r = ejecutarConsulta(opps, q({ metricas: [
      { fn: 'promedio', campo: 'utilidad' }, { fn: 'mediana', campo: 'monto' },
      { fn: 'contar_distintos', campo: 'zona' }, { fn: 'max', campo: 'creada' },
    ] }));
    expect(r.resultado[0]).toMatchObject({ promedio_utilidad: 350, mediana_monto: 1000, contar_distintos_zona: 2, max_creada: '2026-09-01' });
    const vacia = ejecutarConsulta(opps, q({ filtros: [{ campo: 'folio', op: '=', valor: 'X' }], metricas: [{ fn: 'suma', campo: 'monto' }] }));
    expect(vacia.resultado[0]).toMatchObject({ contar: 0, suma_monto: 0 });
  });

  it('listado: columnas pedidas, orden y truncado', () => {
    const r = ejecutarConsulta(opps, q({ columnas: ['folio', 'monto'], ordenar_por: 'monto', limite: 2 }));
    expect(r.resultado).toEqual([{ folio: 'OPP-2', monto: 3000 }, { folio: 'OPP-5', monto: 2000 }]);
    expect(r.truncado).toBe(true);
  });
});
