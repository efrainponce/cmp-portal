// El agrupador decide de cuántas hojas sale la OC con imágenes y qué foto le
// toca a cada ficha: si agrupara mal, el proveedor recibiría el mismo producto
// repetido en 10 medias hojas (o dos productos distintos bajo una sola foto).
import { describe, it, expect } from 'vitest';
import { agruparPorProducto, construirFichas, buildOrdenCompraProveedorImagenesPdf } from './ordenCompraProveedorImagenes';
import { PRODUCT_CARD_TALLAS_MAX } from './layout';
import type { OcProveedorLinea } from './ordenCompraProveedor';
import type { PdfImageData } from './png';

function linea(p: Partial<OcProveedorLinea>): OcProveedorLinea {
  return {
    producto: 'Apex Pant', zona: '', sku: '74434', color: 'Dark Navy', talla: '50x32',
    unidad: 'PZA', moneda: 'MXN', precio: 1500, cantidad: 10, descuento: 0.18, ...p,
  };
}

describe('agruparPorProducto', () => {
  it('junta las tallas del mismo SKU en UNA ficha', () => {
    const grupos = agruparPorProducto([
      linea({ talla: '48x36', cantidad: 10 }),
      linea({ talla: '50x30', cantidad: 10 }),
      linea({ talla: '50x36', cantidad: 12 }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].cantidad).toBe(32);
    expect(grupos[0].tallas.map(t => t.talla)).toEqual(['48x36', '50x30', '50x36']);
  });

  it('separa SKUs distintos y conserva el orden en que llegaron', () => {
    const grupos = agruparPorProducto([
      linea({ sku: '74434', producto: 'Apex Pant' }),
      linea({ sku: '71391', producto: 'Company Shirt' }),
      linea({ sku: '74434', producto: 'Apex Pant', talla: '50x34' }),
    ]);
    expect(grupos.map(g => g.sku)).toEqual(['74434', '71391']);
    expect(grupos[0].tallas).toHaveLength(2);
  });

  it('el color solo entra en la etiqueta cuando el grupo trae más de uno', () => {
    const unColor = agruparPorProducto([linea({ talla: 'L' }), linea({ talla: 'M' })]);
    expect(unColor[0].tallas.map(t => t.talla)).toEqual(['L', 'M']);

    const dosColores = agruparPorProducto([
      linea({ talla: 'L', color: 'Dark Navy' }),
      linea({ talla: 'L', color: 'Black' }),
    ]);
    expect(dosColores[0].tallas.map(t => t.talla)).toEqual(['Dark Navy · L', 'Black · L']);
  });

  it('los embellecimientos NO llevan ficha (van en su tabla aparte)', () => {
    const grupos = agruparPorProducto([
      linea({}),
      linea({ zona: 'Frente derecho', sku: '', producto: 'Bordado' }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].sku).toBe('74434');
  });

  it('avisa cuando el mismo SKU llega con precios distintos', () => {
    const grupos = agruparPorProducto([linea({ precio: 1500 }), linea({ precio: 1800, talla: 'XL' })]);
    expect(grupos[0].preciosVarios).toBe(true);
    // El importe suma cada línea con SU precio, no con el de la primera.
    expect(grupos[0].importe).toBeCloseTo(10 * 1500 * 0.82 + 10 * 1800 * 0.82, 2);
  });

  it('una línea sin SKU se agrupa por nombre de producto en vez de perderse', () => {
    const grupos = agruparPorProducto([linea({ sku: '', producto: 'Chaleco especial' })]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].producto).toBe('Chaleco especial');
  });
});

describe('construirFichas', () => {
  it('NUNCA recorta tallas: un producto con muchas se parte en varias fichas', () => {
    const tallas = Array.from({ length: PRODUCT_CARD_TALLAS_MAX * 2 + 3 }, (_, i) => `T${i}`);
    const grupos = agruparPorProducto(tallas.map(talla => linea({ talla, cantidad: 1 })));
    const fichas = construirFichas(grupos, new Map());

    expect(fichas).toHaveLength(3);
    // La suma de las tallas impresas es EXACTAMENTE la del pedido.
    expect(fichas.flatMap(f => f.tallas.map(t => t.talla))).toEqual(tallas);
    expect(fichas.map(f => f.titulo)).toEqual([
      'Apex Pant (1 de 3)', 'Apex Pant (2 de 3)', 'Apex Pant (3 de 3)',
    ]);
  });

  it('los totales salen solo en la última ficha del producto', () => {
    const tallas = Array.from({ length: PRODUCT_CARD_TALLAS_MAX + 1 }, (_, i) => `T${i}`);
    const fichas = construirFichas(agruparPorProducto(tallas.map(talla => linea({ talla }))), new Map());
    expect(fichas[0].pie[0]).toBe('Continúa en la ficha siguiente');
    expect(fichas[1].pie[0]).toContain('c/u');
    // El pie mide igual en las dos: su alto decide cuántas tallas caben.
    expect(fichas[0].pie).toHaveLength(fichas[1].pie.length);
  });

  it('un producto que cabe entero sale en UNA ficha, sin "(1 de 1)"', () => {
    const fichas = construirFichas(agruparPorProducto([linea({ talla: 'L' })]), new Map());
    expect(fichas).toHaveLength(1);
    expect(fichas[0].titulo).toBe('Apex Pant');
  });

  it('sin foto para el SKU, la ficha va con imagen nula (placeholder gris)', () => {
    const fichas = construirFichas(agruparPorProducto([linea({})]), new Map());
    expect(fichas[0].imagen).toBeNull();
  });
});

// Renders/muestras que alguien subió para ESTE proyecto
// (worker/lib/proyectoImagenes.ts, Efraín 2026-08-25). Van como ficha propia
// con la foto grande: mostrarlas de miniatura anularía el motivo de subirlas.
describe('imágenes extra del proyecto', () => {
  const img = (n: number): PdfImageData => ({
    width: n, height: n, colorSpace: 'DeviceRGB', filter: 'DCTDecode', bytes: new Uint8Array([n]),
  });
  const extras = new Map([['74434', [
    { nombre: 'Render bordado frente', imagen: img(1) },
    { nombre: 'Muestra aprobada', imagen: img(2) },
  ]]]);

  it('cada imagen extra se lleva su propia ficha, después de la de tallas', () => {
    const grupos = agruparPorProducto([linea({ talla: 'L' })]);
    const fichas = construirFichas(grupos, new Map([['74434', img(9)]]), false, extras);
    expect(fichas).toHaveLength(3);
    expect(fichas[0].tallas).toHaveLength(1);          // la de siempre, con el pedido
    expect(fichas[1].titulo).toBe('Apex Pant — imagen 2 de 3');
    expect(fichas[2].titulo).toBe('Apex Pant — imagen 3 de 3');
  });

  it('las fichas extra NO repiten tallas ni totales: el pedido ya está arriba', () => {
    const fichas = construirFichas(agruparPorProducto([linea({ talla: 'L', cantidad: 7 })]),
      new Map([['74434', img(9)]]), false, extras);
    expect(fichas[1].tallas).toEqual([]);
    expect(fichas[1].pie.join(' ')).not.toContain('7');
    expect(fichas[1].datos).toContainEqual(['Referencia', 'Render bordado frente']);
  });

  it('sin foto de catálogo, la numeración cuenta solo lo que el proveedor ve', () => {
    // La ficha de tallas sale con placeholder gris, así que las imágenes
    // visibles son 2, no 3 — decir "imagen 2 de 3" sobre dos fotos confunde.
    const fichas = construirFichas(agruparPorProducto([linea({ talla: 'L' })]), new Map(), false, extras);
    expect(fichas[1].titulo).toBe('Apex Pant — imagen 1 de 2');
    expect(fichas[2].titulo).toBe('Apex Pant — imagen 2 de 2');
  });

  it('un SKU sin imágenes del proyecto sale exactamente como antes', () => {
    const fichas = construirFichas(agruparPorProducto([linea({ sku: '71391', talla: 'L' })]), new Map(), false, extras);
    expect(fichas).toHaveLength(1);
  });
});

describe('sin costos', () => {
  const base = {
    folioOrden: 'OC-225', folioProyecto: 'PRY-1', folioOpp: 'OPP-0906',
    nombreProyecto: 'Uniformes', proveedor: '5.11', proveedorRazonSocial: '5.11 Tactical',
    comprador: 'Compras', fecha: '24/08/2026', metodoPago: 'TRANSFERENCIA',
    condicionesPago: '50/50', notas: '', elaboradoNombre: 'A', revisadoNombre: 'B', autorizadoNombre: 'C',
  };
  const lineas = [linea({ talla: 'L', cantidad: 7, precio: 1234.5, descuento: 0.18 })];
  const texto = (sinCostos: boolean) => new TextDecoder('latin1').decode(
    buildOrdenCompraProveedorImagenesPdf({ ...base, lineas, sinCostos, imagenes: new Map() }),
  );

  it('la copia con costos SÍ trae los importes', () => {
    const t = texto(false);
    expect(t).toContain('1,234.50');
    expect(t).toContain('IVA');
  });

  it('la copia sin costos no trae precio, importe, IVA ni total', () => {
    const t = texto(true);
    expect(t).not.toContain('1,234.50');
    expect(t).not.toContain('IVA');
    expect(t).not.toContain('letras');
  });

  it('sin costos conserva lo que sí necesita quien surte', () => {
    const t = texto(true);
    expect(t).toContain('TRANSFERENCIA');       // términos de pago: no son dinero
    expect(t).toContain('UNIDADES');
    expect(t).toContain('SIN COSTOS');          // la copia va marcada
  });

  it('el pie de la ficha pierde el dinero pero mantiene su alto', () => {
    const grupos = agruparPorProducto(lineas);
    const con = construirFichas(grupos, new Map(), false);
    const sin = construirFichas(grupos, new Map(), true);
    expect(con[0].pie[0]).toContain('c/u');
    expect(sin[0].pie[0]).not.toContain('$');
    expect(sin[0].pie[0]).toContain('talla');
    // El alto del pie decide cuántas tallas caben: no puede cambiar entre copias.
    expect(sin[0].pie).toHaveLength(con[0].pie.length);
  });
});

describe('buildOrdenCompraProveedorImagenesPdf', () => {
  const base = {
    folioOrden: 'OC-225', folioProyecto: 'PRY-1', folioOpp: 'OPP-0906',
    nombreProyecto: 'Uniformes', proveedor: '5.11', proveedorRazonSocial: '5.11 Tactical',
    comprador: 'Compras', fecha: '24/08/2026', metodoPago: 'TRANSFERENCIA',
    condicionesPago: '50/50', notas: '', elaboradoNombre: 'A', revisadoNombre: 'B', autorizadoNombre: 'C',
  };

  it('genera un PDF válido aunque NINGÚN producto tenga foto (placeholder gris)', () => {
    const bytes = buildOrdenCompraProveedorImagenesPdf({
      ...base, lineas: [linea({}), linea({ sku: '71391', talla: 'L' })], imagenes: new Map(),
    });
    const texto = new TextDecoder('latin1').decode(bytes);
    expect(texto.startsWith('%PDF-1.4')).toBe(true);
    expect(texto).toContain('%%EOF');
  });

  it('los totales son los MISMOS que la OC normal — incluye embellecimientos', () => {
    const lineas = [linea({ cantidad: 10, precio: 100, descuento: 0 }), linea({ zona: 'Espalda', cantidad: 10, precio: 50, descuento: 0 })];
    const texto = new TextDecoder('latin1').decode(
      buildOrdenCompraProveedorImagenesPdf({ ...base, lineas, imagenes: new Map() }),
    );
    // 1000 + 500 = 1500 de subtotal; el PDF lo escribe en octal/WinAnsi pero los
    // dígitos son ASCII y salen literales en el stream de contenido.
    expect(texto).toContain('1,500.00');
  });
});
