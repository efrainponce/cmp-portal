import { describe, expect, it } from 'vitest';
import { renderDocument } from './layout';
import type { PdfImageData } from './png';

// Captura ancha (tabla de tallas del inventario 5.11): 3.2:1.
const ancha: PdfImageData = { width: 2252, height: 694, colorSpace: 'DeviceRGB', filter: 'FlateDecode', bytes: new Uint8Array([0]) };

describe('bloque image', () => {
  it('dibuja la imagen a todo el ancho a su proporción y el placeholder cuando falta', () => {
    const bytes = renderDocument({ title: 'Inventario 5.11', docId: 'INV-1', generatedAt: '22/09/2026' }, [
      { kind: 'image', titulo: 'Inventario MEX', imagen: ancha },
      { kind: 'image', titulo: 'Inventario USA', imagen: null },
    ]);
    const txt = new TextDecoder('latin1').decode(bytes);
    // Ancho de contenido carta = 612 − 2×48 = 516pt; alto = 516 × 694/2252.
    const alto = (516 * 694) / 2252;
    expect(txt).toMatch(new RegExp(`516(\\.0+)? 0 0 ${alto.toFixed(2).slice(0, 5)}`));
    expect(txt).toContain('Sin imagen');
  });
});
