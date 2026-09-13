// Router de comandos del bot (docs/plan-wa-cartera.md §6): lo que se contesta
// SIN modelo tiene que reconocerse igual con mayúsculas, acentos y "#".
import { describe, it, expect } from 'vitest';
import { parseComando, PAYLOAD } from './comandos';

describe('parseComando', () => {
  it('botones del template por payload', () => {
    expect(parseComando('Ver detalle', PAYLOAD.verDetalle)).toEqual({ tipo: 'cartera' });
    expect(parseComando('Cerrar esa', PAYLOAD.cerrar)).toEqual({ tipo: 'cerrar', n: null, cierre: 'cancelada' });
    expect(parseComando('Hoy no', PAYLOAD.hoyNo)).toEqual({ tipo: 'posponer', n: null });
  });

  it('cartera y filtros', () => {
    expect(parseComando('Cartera')).toEqual({ tipo: 'cartera' });
    expect(parseComando('¿Qué priorizo hoy?'.replace(/[¿?]/g, ''))).toEqual({ tipo: 'cartera' });
    expect(parseComando('APAGADAS')).toEqual({ tipo: 'cartera', filtro: 'apagada' });
    expect(parseComando('se mueven')).toEqual({ tipo: 'cartera', filtro: 'se_mueve' });
    expect(parseComando('atoradas ')).toEqual({ tipo: 'cartera', filtro: 'atorada' });
  });

  it('número = detalle; "N: texto" = seguimiento con el texto intacto', () => {
    expect(parseComando('3')).toEqual({ tipo: 'detalle', n: 3 });
    expect(parseComando('#12.')).toEqual({ tipo: 'detalle', n: 12 });
    expect(parseComando('2: Llamé, piden muestra el lunes')).toEqual({ tipo: 'seguimiento', n: 2, texto: 'Llamé, piden muestra el lunes' });
    expect(parseComando('2 - piden descuento')).toEqual({ tipo: 'seguimiento', n: 2, texto: 'piden descuento' });
    expect(parseComando('2 — piden\ndescuento')).toEqual({ tipo: 'seguimiento', n: 2, texto: 'piden\ndescuento' });
  });

  it('cerrar / perder / archivar con o sin número', () => {
    expect(parseComando('cerrar 3')).toEqual({ tipo: 'cerrar', n: 3, cierre: 'cancelada' });
    expect(parseComando('Archivar la #4')).toEqual({ tipo: 'cerrar', n: 4, cierre: 'cancelada' });
    expect(parseComando('perder 2')).toEqual({ tipo: 'cerrar', n: 2, cierre: 'perdida' });
    expect(parseComando('cerrar esa')).toEqual({ tipo: 'cerrar', n: null, cierre: 'cancelada' });
    expect(parseComando('cerrar')).toEqual({ tipo: 'cerrar', n: null, cierre: 'cancelada' });
  });

  it('posponer', () => {
    expect(parseComando('hoy no')).toEqual({ tipo: 'posponer', n: null });
    expect(parseComando('Posponer 5')).toEqual({ tipo: 'posponer', n: 5 });
    expect(parseComando('más tarde')).toEqual({ tipo: 'posponer', n: null });
  });

  it('confirmaciones y motivo', () => {
    expect(parseComando('SÍ')).toEqual({ tipo: 'confirmar', respuesta: 'si' });
    expect(parseComando('dale')).toEqual({ tipo: 'confirmar', respuesta: 'si' });
    expect(parseComando('no')).toEqual({ tipo: 'confirmar', respuesta: 'no' });
    expect(parseComando('Perdida')).toEqual({ tipo: 'confirmar', respuesta: 'perdida' });
    expect(parseComando('motivo: eligieron otro proveedor')).toEqual({ tipo: 'motivo', texto: 'eligieron otro proveedor' });
  });

  it('texto libre NO es comando: va al agente', () => {
    expect(parseComando('la de Celaya sigue viva, piden muestra')).toBeNull();
    expect(parseComando('crea una oportunidad para el IMSS')).toBeNull();
    expect(parseComando('¿cómo va PRO-812?')).toBeNull();
    expect(parseComando('123')).toBeNull();      // 3 dígitos no es una posición
    expect(parseComando('')).toBeNull();
  });
});
