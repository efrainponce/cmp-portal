import { describe, expect, it } from 'vitest';
import { etiquetaLinea, notasDeLineas, COMENTARIOS_VENTAS_COL, armarHilos, idsDelFeed } from './updatesLineas';
import type { MondayUpdate } from './monday';

const cols = (m: Record<string, string>) => JSON.stringify(Object.entries(m).map(([id, text]) => ({ id, text })));

describe('etiquetaLinea', () => {
  it('Oportunidad: producto en texto + color, no el name numérico', () => {
    expect(etiquetaLinea('oportunidades_sub', { name: '1', columns: cols({ text_mm0bkm1j: 'Botiquín IFAK', text_mm07s2mg: 'Negro' }) }))
      .toBe('Botiquín IFAK · Negro');
  });
  it('sin texto cae al espejo del catálogo, y sin nada al name', () => {
    expect(etiquetaLinea('oportunidades_sub', { name: '1', columns: cols({ lookup_mm0x4kda: 'Kepi' }) })).toBe('Kepi');
    expect(etiquetaLinea('oportunidades_sub', { name: '3', columns: '[]' })).toBe('3');
  });
  it('Proyecto: producto · color · talla', () => {
    expect(etiquetaLinea('proyectos_sub', { name: 'x', columns: cols({ text_mm0hs17x: 'Camisa', text_mm0h4a1c: 'Azul', text_mm1antcb: 'M' }) }))
      .toBe('Camisa · Azul · M');
  });
});

describe('notasDeLineas', () => {
  it('solo líneas con Comentarios Ventas, sin repetir la misma nota del mismo producto', () => {
    const rows = [
      { item_id: 1, name: '1', columns: cols({ text_mm0bkm1j: 'Kepi', [COMENTARIOS_VENTAS_COL]: 'bordado al frente' }) },
      { item_id: 2, name: '2', columns: cols({ text_mm0bkm1j: 'Kepi', [COMENTARIOS_VENTAS_COL]: 'bordado al frente' }) },
      { item_id: 3, name: '3', columns: cols({ text_mm0bkm1j: 'Botas' }) },
      { item_id: 4, name: '4', columns: cols({ text_mm0bkm1j: 'Botas', [COMENTARIOS_VENTAS_COL]: '  ' }) },
    ];
    expect(notasDeLineas(rows)).toEqual([{ id: '1', etiqueta: 'Kepi', texto: 'bordado al frente' }]);
  });
});

// Hilos del feed (Jorge, 2026-09-25): tarjeta por comentario con sus respuestas
// adentro — antes el feed las aplanaba y no se sabía a qué contestaban.
describe('armarHilos', () => {
  const u = (id: string, at: string, extra: Partial<MondayUpdate> = {}): MondayUpdate => ({
    id, text_body: `texto ${id}`, created_at: at, creator: { name: 'Efrain Ponce Salinas' }, assets: [], ...extra,
  });
  const item = { slug: 'oportunidades' as const, itemId: 10 };

  it('comentarios: el más reciente arriba; respuestas: en orden de conversación', () => {
    const feed = armarHilos([
      { u: u('1', '2026-09-01T10:00:00Z', { replies: [u('1b', '2026-09-03T10:00:00Z'), u('1a', '2026-09-02T10:00:00Z')] }), fuente: item },
      { u: u('2', '2026-09-05T10:00:00Z'), fuente: item },
    ], new Map(), 10);
    expect(feed.map(d => d.id)).toEqual(['2', '1']);
    expect(feed[1].replies?.map(r => r.id)).toEqual(['1a', '1b']);
    expect(feed[0].replies).toBeUndefined();
  });

  it('lo del portal sale con quien firmó, no con el dueño del token de Monday', () => {
    const [d] = armarHilos([{ u: u('1', '2026-09-01T10:00:00Z', {
      text_body: 'Ya quedó\n\n— Paola Silvana Andrade Facundo vía Portal CMP',
      replies: [u('1a', '2026-09-02T10:00:00Z', { creator: { name: 'Angel Omar Canto Cural' } })],
    }), fuente: item }], new Map(), 10);
    expect(d.author).toBe('Paola Silvana Andrade Facundo');
    expect(d.replies?.[0].author).toBe('Angel Omar Canto Cural');
    // El texto sale entero: la firma solo se oculta en pantalla.
    expect(d.body).toContain('vía Portal CMP');
  });

  it('sin creador (automatización) cae a "Monday"', () => {
    const [d] = armarHilos([{ u: u('1', '2026-09-01T10:00:00Z', { creator: null }), fuente: item }], new Map(), 10);
    expect(d.author).toBe('Monday');
  });

  it('la respuesta hereda la fuente del comentario (otro item) pero no el chip de producto', () => {
    const [d] = armarHilos([{
      u: u('1', '2026-09-01T10:00:00Z', { replies: [u('1a', '2026-09-02T10:00:00Z')] }),
      origen: 'OPP-1100 · Botiquín', fuente: { slug: 'oportunidades', itemId: 99 },
    }], new Map(), 10);
    expect(d.origen).toBe('OPP-1100 · Botiquín');
    expect(d.fuente).toEqual({ slug: 'oportunidades', itemId: '99' });
    expect(d.replies?.[0].fuente).toEqual({ slug: 'oportunidades', itemId: '99' });
    expect(d.replies?.[0].origen).toBeUndefined();
  });

  it('el "visto" cubre también las respuestas', () => {
    const crudos = [{ u: u('1', '2026-09-01T10:00:00Z', { replies: [u('1a', '2026-09-02T10:00:00Z')] }), fuente: item }];
    expect(idsDelFeed(crudos)).toEqual(['1', '1a']);
    const [d] = armarHilos(crudos, new Map([['1a', ['Jorge Perez']]]), 10);
    expect(d.replies?.[0].seenBy).toEqual(['Jorge Perez']);
  });
});
