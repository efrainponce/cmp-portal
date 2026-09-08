import { describe, it, expect } from 'vitest';
import { escribirXlsx, escaparXml, nombreHojaValido } from './xlsxWrite';

/** Lector mínimo del zip STORED que produce escribirXlsx: recorre los
 * encabezados locales y devuelve nombre → contenido. Sin inflador porque el
 * escritor nunca comprime. */
function miembros(bytes: Uint8Array): Map<string, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  let p = 0;
  while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const tam = dv.getUint32(p + 18, true);
    const nLen = dv.getUint16(p + 26, true);
    const xLen = dv.getUint16(p + 28, true);
    const nombre = dec.decode(bytes.subarray(p + 30, p + 30 + nLen));
    expect(method, `${nombre} debe ir STORED`).toBe(0);
    const ini = p + 30 + nLen + xLen;
    out.set(nombre, dec.decode(bytes.subarray(ini, ini + tam)));
    p = ini + tam;
  }
  // Lo que sigue es el directorio central.
  expect(dv.getUint32(p, true)).toBe(0x02014b50);
  return out;
}

describe('escribirXlsx', () => {
  it('arma un paquete OOXML con una hoja por entrada y los estilos', () => {
    const bytes = escribirXlsx([
      { nombre: 'Estado de cuenta', filas: [[{ v: 'Total', estilo: 'titulo' }, { v: 1234.5, estilo: 'moneda' }]], anchos: [12, 16] },
      { nombre: 'Flujo por mes', filas: [['ago 26', 100]] },
    ]);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    const m = miembros(bytes);
    expect([...m.keys()]).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
    expect(m.get('xl/workbook.xml')).toContain('<sheet name="Estado de cuenta" sheetId="1"');
    expect(m.get('xl/workbook.xml')).toContain('<sheet name="Flujo por mes" sheetId="2"');
    expect(m.get('xl/worksheets/sheet1.xml')).toContain('<col min="1" max="1" width="12" customWidth="1"/>');
  });

  it('los números van como número (con su formato de moneda) y los textos como inlineStr', () => {
    const m = miembros(escribirXlsx([{ nombre: 'H', filas: [[{ v: 'Total', estilo: 'titulo' }, { v: 1234.5, estilo: 'moneda' }, 'texto & más']] }]));
    const hoja = m.get('xl/worksheets/sheet1.xml')!;
    expect(hoja).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Total</t></is></c>');
    expect(hoja).toContain('<c r="B1" s="2"><v>1234.5</v></c>');
    expect(hoja).toContain('texto &amp; más');
    expect(m.get('xl/styles.xml')).toContain('formatCode="&quot;$&quot;#,##0.00"');
  });

  it('las celdas vacías no se escriben y NaN se vuelve texto', () => {
    const hoja = miembros(escribirXlsx([{ nombre: 'H', filas: [[null, '', NaN]] }])).get('xl/worksheets/sheet1.xml')!;
    expect(hoja).not.toContain('r="A1"');
    expect(hoja).not.toContain('r="B1"');
    expect(hoja).toContain('<c r="C1" t="inlineStr"><is><t>NaN</t></is></c>');
  });

  it('es determinista: mismo contenido, mismos bytes', () => {
    const hojas = [{ nombre: 'H', filas: [['a', 1]] }];
    expect(escribirXlsx(hojas)).toEqual(escribirXlsx(hojas));
  });

  it('sin hojas no hay libro', () => {
    expect(() => escribirXlsx([])).toThrow();
  });
});

describe('nombreHojaValido', () => {
  it('quita lo que Excel rechaza y recorta a 31', () => {
    expect(nombreHojaValido('Cobros/pagos: 2026?')).toBe('Cobros pagos  2026');
    expect(nombreHojaValido('x'.repeat(40))).toHaveLength(31);
    expect(nombreHojaValido('   ')).toBe('Hoja');
  });
});

describe('escaparXml', () => {
  it('escapa los cinco y tira los caracteres de control', () => {
    expect(escaparXml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
    expect(escaparXml('a\u0000b\tc')).toBe('ab\tc');
  });
});
