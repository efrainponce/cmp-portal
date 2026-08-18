// La hoja "Costeo — Validación" se congela al validar el costeo y ya no se
// regenera, así que lo que imprima aquí es lo que queda para siempre. Estos
// tests cuidan las dos cosas que Efraín pidió el 2026-08-18 al ver el PDF de
// OPP-0913 salir con precio $0 y columnas de impuesto: que el Precio de Venta
// SÍ se imprima, y que IVA / Total c/IVA NO.
import { describe, it, expect } from 'vitest';
import { renderTemplate, type CosteoValidacionData } from './templates';

const decode = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);
// El membrete es un JPEG embebido: sus bytes pueden contener cualquier patrón
// corto por azar, así que se descarta el stream de imagen antes de buscar texto
// (mismo truco que writer.test.ts).
const textOf = (bytes: Uint8Array): string =>
  decode(bytes).replace(/<< \/Type \/XObject[\s\S]*?stream\r?\n[\s\S]*?endstream/g, '');

// Números reales de OPP-0913, ya con el precio capturado.
const data: CosteoValidacionData = {
  kind: 'validacion-costeo',
  nombre: 'OPP-0913 - Sureste/ FGE CAMP - Arma no letal',
  folio: 'OPP-0913',
  institucion: 'Fiscalía del estado de Campeche',
  vendedor: 'Angel Omar Canto Cural',
  zona: 'Sureste',
  lineas: [{
    producto: 'Pistola P2P SECURE 68P Negra/Naranja Cal. .68 350fps PEPPER',
    sku: '2292329',
    color: 'negro',
    cantidad: 25,
    moneda: 'MXN',
    costoDistr: 0,
    descuentoPct: 0,
    costoReal: 5972,
    conversion: 0,
    gastosPct: 0,
    costoEmbellecimiento: 0,
    costoTotal: 6270.6,
    techo: 0,
    precioSugerido: 0,
    precioVenta: 2490,
    subtotal: 62250,
    margenGobPct: 15,
    margenGobTotal: 9337.5,
    utilidad: -103852.5,
    utilidadPct: -166.83,
  }],
  subtotal: 62250,
  utilidad: -103852.5,
};

const render = () => textOf(renderTemplate({
  docId: 'doc-test', data, generatedAt: '2026-08-18T16:31:23.071Z', signatures: [],
}));

describe('hoja Costeo — Validación', () => {
  it('imprime el precio de venta y el subtotal de la línea', () => {
    const pdf = render();
    expect(pdf).toContain('P. venta');
    expect(pdf).toContain('2,490');
    expect(pdf).toContain('62,250');
  });

  it('no imprime IVA ni Total c/IVA', () => {
    const pdf = render();
    expect(pdf).not.toContain('IVA');
    expect(pdf).not.toContain('Total c/');
  });

  it('conserva costo, margen y utilidad — el punto de la hoja', () => {
    const pdf = render();
    for (const t of ['Costo real C/U', 'Costo total C/U', 'Margen Gob', 'Utilidad', '5,972', '6,270.6', '15%']) {
      expect(pdf).toContain(t);
    }
  });
});
