// El PDF lo escribimos a mano (worker/lib/pdf/writer.ts), así que estos tests
// cuidan lo que un typecheck no ve: que el archivo sea estructuralmente válido
// (xref con offsets reales, /Length correcto) y que el texto en español salga
// escapado a WinAnsi en vez de UTF-8, que es lo que rompe los acentos en pantalla.
import { describe, it, expect } from 'vitest';
import { PdfWriter, pdfString, widthOf, jpegInfo, LETTER } from './writer';
import { wrapText, renderDocument } from './layout';
import { renderTemplate, formatTallas, formatMultiline } from './templates';

const decode = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

describe('pdfString', () => {
  it('escapa paréntesis y backslash', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
  });

  it('emite los acentuados como octal WinAnsi, no como UTF-8', () => {
    // á = 0xE1 en WinAnsi → \341. En UTF-8 serían dos bytes (0xC3 0xA1) y
    // Acrobat pintaría "Ã¡".
    expect(pdfString('á')).toBe('(\\341)');
    expect(pdfString('Ñ')).toBe('(\\321)');
    // Comillas tipográficas y guion largo viven en 128-159 (no son Latin-1).
    expect(pdfString('—')).toBe('(\\227)');
    expect(pdfString('“x”')).toBe('(\\223x\\224)');
  });

  it('degrada a ? lo que no cabe en un byte', () => {
    expect(pdfString('😀')).toBe('(?)');
  });
});

describe('widthOf', () => {
  it('mide Helvetica con las métricas AFM', () => {
    expect(widthOf('W', 10)).toBeCloseTo(9.44, 2);
    expect(widthOf('i', 10)).toBeCloseTo(2.22, 2);
    // La negrita es más ancha en las minúsculas.
    expect(widthOf('cotización', 10, 'HB')).toBeGreaterThan(widthOf('cotización', 10));
  });

  it('cuenta los acentuados como su letra base', () => {
    expect(widthOf('á', 10)).toBeCloseTo(widthOf('a', 10), 5);
    expect(widthOf('Ñ', 12)).toBeCloseTo(widthOf('N', 12), 5);
  });

  it('escala lineal con el tamaño', () => {
    expect(widthOf('Remisión', 20)).toBeCloseTo(widthOf('Remisión', 10) * 2, 5);
  });
});

describe('PdfWriter.build', () => {
  it('produce un PDF con xref cuyos offsets apuntan a cada objeto', () => {
    const pdf = new PdfWriter();
    const page = pdf.addPage();
    pdf.text(page, 40, 60, 'Cotización #123');
    pdf.rect(page, 40, 80, 200, 20, { fill: '#eeeeee' });
    const bytes = pdf.build();
    const text = decode(bytes);

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');

    // Cada entrada del xref debe caer exactamente en "<id> 0 obj". La tabla
    // arranca con la entrada libre del objeto 0, así que el índice ES el id.
    const table = text.slice(startxref).split('\n').slice(2);
    let checked = 0;
    table.forEach((line, id) => {
      const m = /^(\d{10}) 00000 n $/.exec(line);
      if (!m) return;
      expect(text.slice(Number(m[1]))).toMatch(new RegExp(`^${id} 0 obj`));
      checked++;
    });
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('declara /Length igual a los bytes reales del stream', () => {
    const pdf = new PdfWriter();
    pdf.text(pdf.addPage(), 40, 60, 'Ñandú — “prueba”');
    const text = decode(pdf.build());
    const m = /<< +\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text);
    expect(m).not.toBeNull();
    expect(m![2].length).toBe(Number(m![1]));
  });

  it('coordina la Y desde arriba (origen PDF invertido)', () => {
    const pdf = new PdfWriter();
    pdf.text(pdf.addPage(), 0, 100, 'x');
    expect(decode(pdf.build())).toContain(`1 0 0 1 0 ${LETTER.height - 100} Tm`);
  });

  it('ignora imágenes que no son JPEG en vez de corromper el archivo', () => {
    const pdf = new PdfWriter();
    const page = pdf.addPage();
    expect(pdf.image(page, new Uint8Array([1, 2, 3, 4]), 0, 0, 10, 10)).toBe(false);
    expect(decode(pdf.build())).not.toContain('/XObject');
  });

  it('embebe un JPEG como DCTDecode con sus dimensiones', () => {
    // JPEG mínimo: SOI + SOF0 (8 bits, 4x2, 3 componentes) + EOI.
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x04, 0x03,
      0, 0, 0, 0, 0, 0, 0, 0, 0,
      0xff, 0xd9,
    ]);
    expect(jpegInfo(jpeg)).toEqual({ width: 4, height: 2, components: 3 });

    const pdf = new PdfWriter();
    pdf.image(pdf.addPage(), jpeg, 10, 10, 40, 20);
    const text = decode(pdf.build());
    expect(text).toContain('/Subtype /Image /Width 4 /Height 2');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Im1 Do');
  });
});

describe('wrapText', () => {
  it('respeta el ancho disponible', () => {
    const lines = wrapText('El vendedor firma la cotización antes de mandarla al cliente', 120, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(widthOf(line, 10)).toBeLessThanOrEqual(120);
  });

  it('parte palabras que no caben, sin desbordarse', () => {
    const lines = wrapText('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 40, 10);
    for (const line of lines) expect(widthOf(line, 10)).toBeLessThanOrEqual(40);
  });

  it('conserva los saltos de línea del texto', () => {
    expect(wrapText('uno\ndos', 500, 10)).toEqual(['uno', 'dos']);
  });
});

describe('renderDocument', () => {
  it('pagina una tabla larga y numera todas las páginas', () => {
    const bytes = renderDocument(
      { title: 'Prueba', docId: 'abc', generatedAt: '2026-07-25' },
      [{
        kind: 'table',
        columns: [{ header: 'Producto', width: 0.7 }, { header: 'Cant.', width: 0.3, align: 'right' }],
        rows: Array.from({ length: 120 }, (_, i) => [`Producto ${i}`, String(i)]),
      }],
    );
    const text = decode(bytes);
    const count = Number(/\/Count (\d+)/.exec(text)?.[1]);
    expect(count).toBeGreaterThan(1);
    expect(text).toContain(`P\\341gina 1 de ${count}`);
    expect(text).toContain(`P\\341gina ${count} de ${count}`);
  });
});

describe('renderTemplate', () => {
  it('renderiza la solicitud de costeo SIN ninguna columna de precio', () => {
    const bytes = renderTemplate({
      docId: 'doc-1',
      generatedAt: '2026-07-25T10:00:00.000Z',
      signatures: [],
      data: {
        kind: 'solicitud-costeo',
        nombre: 'Uniformes Hospital General',
        folio: '1234',
        lineas: [
          { producto: 'Filipina', sku: 'FIL-001', marca: 'SK7', color: 'Azul', unidad: 'Pieza', cantidad: 10, descripcion: 'Tejido 50-50 poliéster' },
          { producto: 'Pantalón', sku: 'PAN-014', color: 'Negro', cantidad: 5, tallas: 'CH-M-G', embellecimiento: true, descripcionEmbellecimiento: 'Bordado en manga' },
        ],
      },
    });
    const text = decode(bytes);
    expect(text).toContain('Uniformes Hospital General');
    expect(text).toContain('PRODUCTOS POR COSTEAR');
    expect(text).toContain('FIL-001');
    expect(text).toContain('2 partida\\(s\\)');
    expect(text).toContain('15');                       // total de piezas
    // El punto de la solicitud es que compras ponga los precios: el PDF no debe
    // traer columna de precio, importe ni ningún monto.
    expect(text).not.toContain('P. UNITARIO');
    expect(text).not.toContain('IMPORTE');
    expect(text).not.toMatch(/\$[\d,]/);
    // Detalle largo fuera de la tabla (en la celda se recortaría).
    expect(text).toContain('Tejido 50-50 poli\\351ster');
    expect(text).toContain('Tallas: CH-M-G');
    expect(text).toContain('Bordado en manga');
  });

  it('acusa el documento sin hablar de firmas cuando la plantilla es autoAcuse', () => {
    const bytes = renderTemplate({
      docId: 'doc-1b',
      generatedAt: '2026-07-26T10:00:00.000Z',
      baseSha256: 'c'.repeat(64),
      signatures: [{
        label: 'Solicitó',
        name: 'César Emilio Díaz Trujillo',
        role: 'vendedor',
        email: 'cesar@x.com',
        signedAt: '2026-07-26T10:00:01.000Z',
        sha256: 'c'.repeat(64),
        ip: '189.1.2.3',
      }],
      data: { kind: 'solicitud-costeo', nombre: 'OPP-0717', lineas: [] },
    });
    const text = decode(bytes);
    expect(text).toContain('ACUSE');
    expect(text).toContain('SOLICIT');
    expect(text).toContain('C\\351sar Emilio D\\355az Trujillo');
    // Sin ceremonia de firma: no se pide firmar ni se anuncian firmas pendientes.
    expect(text).not.toContain('FIRMAS');
    expect(text).not.toContain('admite una firma');
  });

  it('el mismo snapshot de datos produce bytes idénticos (el hash sellado depende de eso)', () => {
    const input = {
      docId: 'doc-2',
      generatedAt: '2026-07-25T10:00:00.000Z',
      signatures: [],
      data: {
        kind: 'remision-inventario' as const,
        movimientoId: 7,
        tipo: 'Salida',
        producto: 'Chaleco táctico',
        cantidad: 3,
        origen: 'Mérida',
        capturadoPor: 'almacen@x.com',
        fecha: '2026-07-24T18:00:00.000Z',
      },
    };
    expect(renderTemplate(input)).toEqual(renderTemplate(input));
  });

  it('imprime la evidencia de auditoría de cada firma', () => {
    const bytes = renderTemplate({
      docId: 'doc-3',
      generatedAt: '2026-07-25T10:00:00.000Z',
      baseSha256: 'a'.repeat(64),
      signatures: [{
        label: 'Recibe',
        name: 'Ray Rodríguez',
        role: 'vendedor',
        email: 'ray@x.com',
        signedAt: '2026-07-25T11:00:00.000Z',
        sha256: 'a'.repeat(64),
        ip: '187.1.2.3',
      }],
      data: {
        kind: 'constancia-firma',
        archivo: 'Cotizacion-1234.pdf',
        referencia: 'oportunidades/999/cotizacion-no-firmada/Cotizacion-1234.pdf',
      },
    });
    const text = decode(bytes);
    expect(text).toContain('RECIBE');                 // etiqueta de la caja de firma
    expect(text).toContain('Ray Rodr\\355guez');
    expect(text).toContain('187.1.2.3');
    expect(text).toContain('ray@x.com');
    // El pie imprime el hash COMPLETO del documento base, sin recortar.
    expect(text).toContain(`SHA-256 ${'a'.repeat(64)}`);
  });
});

// Los valores crudos de Monday que se veían mal en la primera solicitud real
// (OPP-0717): las Tallas llegan como bloque JSON y los long_text con ",,".
describe('formatTallas', () => {
  it('aplana el JSON del catálogo y omite lo vacío', () => {
    const raw = '```json\n{\n"hombre": ["CH", "M", "G"],\n"mujer": [],\n"unitalla": false,\n"otros": []\n}\n```';
    expect(formatTallas(raw)).toBe('Hombre: CH, M, G');
  });

  it('conserva varios grupos y las banderas verdaderas', () => {
    expect(formatTallas('{"hombre":["CH"],"mujer":["M","G"],"unitalla":true}'))
      .toBe('Hombre: CH · Mujer: M, G · Unitalla');
  });

  it('devuelve el texto tal cual si no es JSON, y nada si está vacío', () => {
    expect(formatTallas('CH, M, G')).toBe('CH, M, G');
    expect(formatTallas('   ')).toBeUndefined();
    expect(formatTallas(undefined)).toBeUndefined();
  });

  it('no imprime nada cuando todos los grupos están vacíos', () => {
    expect(formatTallas('{"hombre":[],"mujer":[],"unitalla":false}')).toBeUndefined();
  });
});

describe('formatMultiline', () => {
  it('parte por ",," y tira los campos sin llenar', () => {
    const raw = 'Espalda: BOMBEROS a 2 líneas.,,Frente derecho: Escudo bordado,,Etiqueta del fabricante:,,Otros:';
    expect(formatMultiline(raw)).toBe('Espalda: BOMBEROS a 2 líneas.\nFrente derecho: Escudo bordado');
  });

  it('respeta saltos de línea normales y devuelve nada si no queda contenido', () => {
    expect(formatMultiline('uno\ndos')).toBe('uno\ndos');
    expect(formatMultiline(',,,,')).toBeUndefined();
    expect(formatMultiline('Etiqueta:')).toBeUndefined();
  });
});
