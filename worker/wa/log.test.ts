// Bitácora de WhatsApp (worker/wa/log.ts): cómo se leen los avisos de estado de
// Meta y cómo avanza el estado de un mensaje.
import { describe, it, expect } from 'vitest';
import { describirError, extraerEstados, siguienteEstado } from './log';

describe('extraerEstados', () => {
  it('lee sent/delivered/read/failed del webhook de Meta, con el motivo del fallo', () => {
    const body = {
      entry: [{
        changes: [{
          value: {
            statuses: [
              { id: 'wamid.A', status: 'delivered', timestamp: '1757613600', recipient_id: '525610621150' },
              { id: 'wamid.B', status: 'failed', timestamp: '1757613601', errors: [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'Receiver is incapable of receiving this message' } }] },
            ],
          },
        }],
      }],
    };
    expect(extraerEstados(body)).toEqual([
      { wamid: 'wamid.A', estado: 'entregado', at: '2025-09-11T18:00:00.000Z', error: null },
      { wamid: 'wamid.B', estado: 'fallido', at: '2025-09-11T18:00:01.000Z', error: '131026 Message undeliverable: Receiver is incapable of receiving this message' },
    ]);
  });

  it('un webhook de mensaje entrante (sin statuses) o estados desconocidos → nada', () => {
    expect(extraerEstados({ entry: [{ changes: [{ value: { messages: [{ id: 'x', from: '52', type: 'text' }] } }] }] })).toEqual([]);
    expect(extraerEstados({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.C', status: 'deleted' }] } }] }] })).toEqual([]);
    expect(extraerEstados(null)).toEqual([]);
  });
});

describe('siguienteEstado', () => {
  it('avanza enviado → entregado → leido', () => {
    expect(siguienteEstado('enviado', 'entregado')).toBe('entregado');
    expect(siguienteEstado('entregado', 'leido')).toBe('leido');
  });

  it('no retrocede si Meta avisa en desorden', () => {
    expect(siguienteEstado('leido', 'entregado')).toBe('leido');
    expect(siguienteEstado('entregado', 'enviado')).toBe('entregado');
  });

  it('fallido gana sobre enviado/entregado y es final', () => {
    expect(siguienteEstado('enviado', 'fallido')).toBe('fallido');
    expect(siguienteEstado('entregado', 'fallido')).toBe('fallido');
    expect(siguienteEstado('fallido', 'leido')).toBe('fallido');
  });
});

describe('describirError', () => {
  it('sin errores → null; sin details usa message', () => {
    expect(describirError(undefined)).toBeNull();
    expect(describirError([{ code: 131049, title: 'Not delivered', message: 'Meta chose not to deliver' }])).toBe('131049 Not delivered: Meta chose not to deliver');
  });
});
