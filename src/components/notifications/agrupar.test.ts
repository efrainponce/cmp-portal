import { describe, it, expect } from 'vitest';
import type { NotificationDTO } from '../../../shared/dto';
import { agruparNotificaciones, resumenNotif, tabDeGrupo } from './agrupar';

let id = 100;
const n = (p: Partial<NotificationDTO>): NotificationDTO => ({
  id: id--, severity: 'importante', kind: 'update_comment', title: 'Nuevo comentario en OPP-1 - Uniformes', body: 'hola',
  boardKey: 'oportunidades', itemId: '1', itemName: 'OPP-1 - Uniformes', link: null, actor: 'Ricardo', read: false,
  createdAt: '2026-10-01T10:00:00Z', ...p,
});

describe('agruparNotificaciones', () => {
  it('junta las del mismo item y conserva el orden del aviso más reciente', () => {
    const g = agruparNotificaciones([
      n({ itemId: '2', itemName: 'OPP-2 - Botas' }),
      n({ itemId: '1' }),
      n({ itemId: '2', itemName: 'OPP-2 - Botas', read: true }),
      n({ itemId: '1', kind: 'mention' }),
    ]);
    expect(g.map((x) => [x.nombre, x.notifs.length, x.unread])).toEqual([
      ['OPP-2 - Botas', 2, 1],
      ['OPP-1 - Uniformes', 2, 2],
    ]);
  });

  it('deja sueltos los avisos sin item y los que abren un link externo', () => {
    const g = agruparNotificaciones([
      n({ kind: 'salud', itemId: null, itemName: null, title: 'Salud del portal: 1 problema' }),
      n({ kind: 'costo_desactualizado', link: 'https://airtable.com/x' }),
      n({}),
    ]);
    expect(g.map((x) => x.itemId)).toEqual([null, null, '1']);
    expect(g[0].nombre).toBe('Salud del portal: 1 problema');
  });

  it('sin nombre del item (no está en el espejo) usa el título del aviso', () => {
    const g = agruparNotificaciones([n({ itemName: null, title: 'Muestra enviada a Compras' })]);
    expect(g[0].nombre).toBe('Muestra enviada a Compras');
  });
});

describe('tabDeGrupo', () => {
  it('comentario o mención pendiente → Actualizaciones', () => {
    const [g] = agruparNotificaciones([n({ kind: 'stage_change' }), n({ kind: 'mention' })]);
    expect(tabDeGrupo(g)).toBe('actualizaciones');
  });
  it('solo cambios de etapa → la pestaña por defecto', () => {
    const [g] = agruparNotificaciones([n({ kind: 'stage_change' })]);
    expect(tabDeGrupo(g)).toBeNull();
  });
  it('un comentario YA leído no manda: cuenta lo pendiente', () => {
    const [g] = agruparNotificaciones([n({ kind: 'stage_change' }), n({ kind: 'mention', read: true })]);
    expect(tabDeGrupo(g)).toBeNull();
  });
});

describe('resumenNotif', () => {
  const nombre = 'OPP-1 - Uniformes';
  it('comentario: quién y qué dijo, sin repetir el nombre del item', () => {
    expect(resumenNotif(n({ body: 'ya  quedó\nel costo' }), nombre)).toBe('Ricardo: ya quedó el costo');
  });
  it('mención', () => {
    expect(resumenNotif(n({ kind: 'mention', title: `Te mencionaron en ${nombre}`, body: '@Eli revisa' }), nombre))
      .toBe('Ricardo te mencionó: @Eli revisa');
  });
  it('cambio de etapa: quita el nombre del item del título', () => {
    expect(resumenNotif(n({ kind: 'stage_change', title: `${nombre} pasó a Cotización`, body: null }), nombre))
      .toBe('Pasó a Cotización');
  });
  it('título que termina en "en <item>"', () => {
    expect(resumenNotif(n({ kind: 'producto_propuesto', title: `Rodrigo propuso un producto nuevo en ${nombre}`, body: 'Botas' }), nombre))
      .toBe('Rodrigo propuso un producto nuevo — Botas');
  });
});
