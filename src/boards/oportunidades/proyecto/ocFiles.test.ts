// El nombre del archivo es lo ÚNICO que distingue las dos copias de una misma
// orden, y de él sale la miniatura del tab. Si el match se rompe, la tarjeta
// muestra la copia sin precios como si fuera la orden — o deja de mostrar nada.
import { describe, it, expect } from 'vitest';
import { findLatestOcFile } from './OrdenesSection';

const f = (name: string) => ({ url: `/api/files/${name}`, name });
const PROVEEDOR = ['5.11 Tactical de México SA De CV'];
// `nombreArchivoOc` (worker/lib/oc.ts) pasa los acentos a ASCII y cambia lo
// demás que no es \w/-/espacio por "_": así llega la razón social REAL al
// nombre del archivo.
const RZ = '5_11 Tactical de Mexico SA De CV';

describe('findLatestOcFile', () => {
  it('la miniatura es la copia CON costos, no la de sin costos', () => {
    const r = findLatestOcFile([f(`OC_OC-226_${RZ}.pdf`), f(`OC_OC-226_${RZ}_SIN-COSTOS.pdf`)], PROVEEDOR);
    expect(r.conCostos?.name).toBe(`OC_OC-226_${RZ}.pdf`);
    expect(r.sinCostos?.name).toBe(`OC_OC-226_${RZ}_SIN-COSTOS.pdf`);
  });

  it('se queda con la ÚLTIMA orden del proveedor', () => {
    const r = findLatestOcFile([f(`OC_OC-100_${RZ}.pdf`), f(`OC_OC-226_${RZ}.pdf`)], PROVEEDOR);
    expect(r.conCostos?.name).toBe(`OC_OC-226_${RZ}.pdf`);
  });

  it('NO ofrece una copia sin costos de un folio anterior', () => {
    // Sería mandarle al proveedor las cantidades de la orden pasada.
    const r = findLatestOcFile([f(`OC_OC-100_${RZ}_SIN-COSTOS.pdf`), f(`OC_OC-226_${RZ}.pdf`)], PROVEEDOR);
    expect(r.conCostos?.name).toBe(`OC_OC-226_${RZ}.pdf`);
    expect(r.sinCostos).toBeUndefined();
  });

  it('ignora las OC de otros proveedores', () => {
    const r = findLatestOcFile([f('OC_OC-226_Otro Proveedor SA.pdf')], PROVEEDOR);
    expect(r.conCostos).toBeUndefined();
  });

  it('sin candidatos no adivina', () => {
    expect(findLatestOcFile([f(`OC_OC-226_${RZ}.pdf`)], [])).toEqual({});
  });
});
