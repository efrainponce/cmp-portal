// Vista de cartera (docs/plan-wa-cartera.md §1): clasificación, prioridad,
// candidata a cerrar y render — todo puro, con fechas fijas.
import { describe, it, expect } from 'vitest';
import {
  clasificarCartera, renderCartera, renderDetalle, renderLinea, parametrosResumen, boardKeyDeEtapa, UMBRALES, type EntradaCartera,
} from './cartera';

const AHORA = new Date('2026-09-12T14:00:00.000Z');
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000).toISOString();
const en = (dias: number) => new Date(AHORA.getTime() + dias * 86_400_000).toISOString().slice(0, 10);

function entrada(over: Partial<EntradaCartera> & { item_id: number }): EntradaCartera {
  return {
    folio: `PRO-${over.item_id}`, nombre: `Opp ${over.item_id}`, institucion: 'Hospital X', etapaKey: '4', monto: 0,
    fechaLimite: null, mondayUpdatedAt: hace(1), etapaDesde: hace(1), ultimoSeguimiento: null,
    ...over,
  };
}

describe('clasificarCartera', () => {
  it('apagada = ≥14 días sin movimiento; atorada = Nueva ≥3 días; se_mueve = Esperando OC', () => {
    const v = clasificarCartera([
      entrada({ item_id: 1, mondayUpdatedAt: hace(20), etapaDesde: hace(20) }),
      entrada({ item_id: 2, etapaKey: '4', mondayUpdatedAt: hace(2), etapaDesde: hace(5) }),
      entrada({ item_id: 3, etapaKey: '8', mondayUpdatedAt: hace(1), etapaDesde: hace(1) }),
      entrada({ item_id: 4, etapaKey: '6', mondayUpdatedAt: hace(1), etapaDesde: hace(1) }),
    ], 'vendedor', AHORA);
    const por = Object.fromEntries(v.oportunidades.map(o => [o.item_id, o]));
    expect(por[1].categoria).toBe('apagada');
    expect(por[2].categoria).toBe('atorada');
    expect(por[3].categoria).toBe('se_mueve');
    expect(por[4].categoria).toBe('normal');
    expect(v.conteo).toEqual({ total: 4, se_mueve: 1, atorada: 1, apagada: 1 });
  });

  it('días en etapa: del activity_log; sin registro, aproximado desde monday_updated_at', () => {
    const v = clasificarCartera([
      entrada({ item_id: 1, etapaKey: '15', etapaDesde: hace(2), mondayUpdatedAt: hace(0) }),
      entrada({ item_id: 2, etapaKey: '15', etapaDesde: null, mondayUpdatedAt: hace(9) }),
    ], 'vendedor', AHORA);
    const por = Object.fromEntries(v.oportunidades.map(o => [o.item_id, o]));
    expect(por[1].diasEnEtapa).toBe(2);
    expect(por[1].diasEtapaAprox).toBe(false);
    expect(por[2].diasEnEtapa).toBe(9);
    expect(por[2].diasEtapaAprox).toBe(true);
    expect(renderLinea(por[2])).toContain('aprox');
  });

  it('En costeo: para el vendedor "compras la está costeando"; para compras lo que falte o "lista para validación"', () => {
    const base = [entrada({ item_id: 1, etapaKey: '15', etapaDesde: hace(3) })];
    expect(clasificarCartera(base, 'vendedor', AHORA).oportunidades[0].siguientePaso).toMatch(/Compras/);
    expect(clasificarCartera(base, 'vendedor', AHORA).oportunidades[0].categoria).toBe('atorada');
    const compras = clasificarCartera([{ ...base[0], costeoFalta: 'Falta costo en 2 líneas' }], 'compras', AHORA).oportunidades[0];
    expect(compras.siguientePaso).toBe('Costeo: Falta costo en 2 líneas');
    expect(compras.categoria).toBe('atorada');
    const lista = clasificarCartera([{ ...base[0], costeoFalta: null }], 'compras', AHORA).oportunidades[0];
    expect(lista.categoria).toBe('se_mueve');
  });

  it('prioridad: fecha límite cercana y etapa avanzada suben; ordena por prioridad', () => {
    const v = clasificarCartera([
      entrada({ item_id: 1, etapaKey: '6' }),
      entrada({ item_id: 2, etapaKey: '8', fechaLimite: en(3) }),
      entrada({ item_id: 3, etapaKey: '4', fechaLimite: en(-2) }),
    ], 'vendedor', AHORA);
    expect(v.oportunidades.map(o => o.item_id)).toEqual([2, 3, 1]);
    expect(v.oportunidades[0].prioridad).toBe(6);
    expect(v.oportunidades[1].diasParaLimite).toBe(-2);
  });

  it('candidata: la más vieja con ≥45 días, saltando pospuestas y propuestas hace <7 días', () => {
    const v = clasificarCartera([
      entrada({ item_id: 1, mondayUpdatedAt: hace(60), pospuestaHasta: new Date(AHORA.getTime() + 3 * 86_400_000).toISOString() }),
      entrada({ item_id: 2, mondayUpdatedAt: hace(50), propuestaAt: hace(2) }),
      entrada({ item_id: 3, mondayUpdatedAt: hace(46) }),
      entrada({ item_id: 4, mondayUpdatedAt: hace(44) }),
    ], 'vendedor', AHORA);
    expect(v.candidata?.item_id).toBe(3);
    const sinCandidata = clasificarCartera([entrada({ item_id: 4, mondayUpdatedAt: hace(UMBRALES.cierre - 1) })], 'vendedor', AHORA);
    expect(sinCandidata.candidata).toBeNull();
  });

  it('boardKey por etapa: costeo → costeo, validación en adelante → validacion, nueva → oportunidades', () => {
    expect(boardKeyDeEtapa('15')).toBe('costeo');
    expect(boardKeyDeEtapa('7')).toBe('validacion');
    expect(boardKeyDeEtapa('8')).toBe('validacion');
    expect(boardKeyDeEtapa('4')).toBe('oportunidades');
    expect(boardKeyDeEtapa(null)).toBe('oportunidades');
  });
});

describe('render', () => {
  const vista = clasificarCartera([
    entrada({ item_id: 1, etapaKey: '15', etapaDesde: hace(2), monto: 120000, institucion: 'Hospital Ángeles' }),
    entrada({ item_id: 2, mondayUpdatedAt: hace(45), etapaDesde: hace(45), institucion: 'IMSS Celaya' }),
    entrada({ item_id: 3, etapaKey: '8', monto: 50000 }),
  ], 'vendedor', AHORA);

  it('renderCartera numera y devuelve los ids en el mismo orden', () => {
    const { texto, itemIds } = renderCartera(vista);
    expect(itemIds).toHaveLength(3);
    itemIds.forEach((id, i) => expect(texto).toContain(`${i + 1}. PRO-${id}`));
    expect(texto).toContain('3 abiertas');
    expect(texto).toContain('$120,000');
    expect(texto).toContain('Escribe el número');
  });

  it('renderCartera filtrada dice cuando no hay de esa categoría', () => {
    expect(renderCartera(vista, { filtro: 'normal' }).texto).toMatch(/No tienes oportunidades en curso/);
    const { itemIds } = renderCartera(vista, { filtro: 'apagada' });
    expect(itemIds).toEqual([2]);
  });

  it('cartera vacía: texto propio por rol', () => {
    expect(renderCartera(clasificarCartera([], 'vendedor', AHORA)).texto).toMatch(/No tienes oportunidades abiertas/);
    expect(renderCartera(clasificarCartera([], 'compras', AHORA)).texto).toMatch(/costeo/);
  });

  it('renderDetalle trae etapa, movimiento, monto, siguiente paso y el link del portal', () => {
    const o = vista.oportunidades.find(x => x.item_id === 1)!;
    const t = renderDetalle(o);
    expect(t).toContain('*PRO-1 Opp 1*');
    expect(t).toContain('Etapa: En costeo (2 días)');
    expect(t).toContain('Monto: $120,000');
    expect(t).toContain('Sin seguimientos registrados');
    expect(t).toContain('https://portal.mexicanadeproteccion.com/costeo/1');
  });

  it('parametrosResumen: 6 parámetros sin saltos de línea, con "nada por hoy" si no hay candidata', () => {
    const p = parametrosResumen(vista, 'Juan Pérez', true);
    expect(p).toHaveLength(6);
    for (const x of p) expect(x).not.toMatch(/\n/);
    expect(p[0]).toBe('Juan');
    expect(p[1]).toContain('3 abiertas');
    expect(p[5]).toContain('PRO-2');
    expect(parametrosResumen(vista, 'Juan', false)[5]).toBe('nada por hoy');
    const pocas = parametrosResumen(clasificarCartera([entrada({ item_id: 9 })], 'vendedor', AHORA), 'Ana', true);
    expect(pocas[3]).toBe('—');
    expect(pocas[5]).toBe('nada por hoy');
  });
});
