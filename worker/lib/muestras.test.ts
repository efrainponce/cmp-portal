import { describe, expect, it } from 'vitest';
import { textoEnvio } from './muestras';
import { PORTAL_SIGNATURE, isAutomationUpdate } from './updateNotify';

describe('textoEnvio', () => {
  const lineas = [{ id: '1', producto: 'STRYKE PANT', productoId: null, sku: '74369', marca: '5.11', color: 'STORM', talla: '32 X 30', cantidad: 1, comentarios: 'Logo pecho' }];
  const texto = textoEnvio('MUE-3', 'Nicolás Rosas', { fechaEntrega: '2026-09-14', diasRetorno: 7, notas: null }, lineas);

  it('lista cada renglón con su detalle', () => {
    expect(texto).toContain('MUE-3');
    expect(texto).toContain('• 1 × STRYKE PANT (74369 · 5.11 · STORM · talla 32 X 30) — Logo pecho');
    expect(texto).toContain('entrega 2026-09-14 · retorno 7 días');
  });
  // Con la firma, el webhook create_update de Monday no la vuelve a notificar
  // como comentario (worker/lib/updateNotify.ts): el aviso ya salió al enviar.
  it('lleva la firma del portal y no parece reporte de máquina', () => {
    expect(texto).toContain(PORTAL_SIGNATURE);
    expect(isAutomationUpdate(texto)).toBe(false);
  });
});
