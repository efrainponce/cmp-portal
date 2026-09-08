// shared/xlsxWrite.ts — genera un .xlsx de verdad, sin dependencias.
//
// Por qué no un CSV: el estado de cuenta se exporta para trabajarlo en Excel,
// y un CSV llega como texto — los montos no suman, "1,000,000" se parte en la
// coma según la configuración regional de la máquina, y las fechas se
// reinterpretan solas. Un .xlsx lleva el número COMO número y su formato de
// moneda pegado, que es justo lo que se necesita para provisionar.
//
// El zip se escribe con entradas STORED (sin comprimir): un estado de cuenta
// son decenas de KB de XML, comprimirlo no cambia nada y `CompressionStream`
// obligaría a que todo esto fuera async. Portado de janing-portal
// (2026-09-08) para el Excel del Estado de cuenta; aquí no hay lector de
// xlsx, así que el test recorre el zip a mano (shared/xlsxWrite.test.ts).

export type EstiloCelda = 'titulo' | 'moneda';

export interface CeldaOut {
  v: string | number | null;
  estilo?: EstiloCelda;
}

export type ValorCelda = string | number | null | CeldaOut;

export interface HojaOut {
  nombre: string;
  filas: ValorCelda[][];
  /** Ancho por columna en caracteres; sin esto Excel abre todo en 8.43. */
  anchos?: number[];
}

// ---------------------------------------------------------------- xml

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** Escapa para XML y tira los caracteres de control que Excel rechaza (un
 * \\x00 pegado desde otro sistema deja el archivo "corrupto" sin más pista). */
export function escaparXml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ESCAPES[ch])
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/** 1 → "A", 27 → "AA". */
function colRef(col: number): string {
  let s = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel truncaría el nombre de hoja a 31 caracteres y se atraganta con
 * []:*?/\\ — mejor arreglarlo aquí que entregar un archivo que no abre. */
export function nombreHojaValido(nombre: string): string {
  const limpio = nombre.replace(/[[\]:*?/\\]/g, ' ').trim();
  return (limpio || 'Hoja').slice(0, 31);
}

const ESTILO_ID: Record<EstiloCelda, number> = { titulo: 1, moneda: 2 };

function celdaXml(ref: string, celda: CeldaOut): string {
  const s = celda.estilo ? ` s="${ESTILO_ID[celda.estilo]}"` : '';
  if (celda.v === null || celda.v === '') return '';
  if (typeof celda.v === 'number') {
    // NaN/Infinity no tienen representación en el XML: van como texto para no
    // producir un archivo que Excel considere dañado.
    if (!Number.isFinite(celda.v)) return `<c r="${ref}" t="inlineStr"><is><t>${escaparXml(String(celda.v))}</t></is></c>`;
    return `<c r="${ref}"${s}><v>${celda.v}</v></c>`;
  }
  // inlineStr en vez de sharedStrings: un estado de cuenta casi no repite
  // texto, y evita mantener una segunda tabla en sincronía.
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escaparXml(celda.v)}</t></is></c>`;
}

function normalizar(v: ValorCelda): CeldaOut {
  if (v === null) return { v: null };
  if (typeof v === 'string' || typeof v === 'number') return { v };
  return v;
}

function hojaXml(hoja: HojaOut): string {
  const cols = hoja.anchos?.length
    ? `<cols>${hoja.anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const filas = hoja.filas.map((fila, i) => {
    const celdas = fila.map((v, j) => celdaXml(`${colRef(j + 1)}${i + 1}`, normalizar(v))).join('');
    return `<row r="${i + 1}">${celdas}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `${cols}<sheetData>${filas}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>`
  + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
  // Excel exige que existan los dos rellenos de siempre (none y gray125) aunque no se usen.
  + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
  + `<borders count="1"><border/></borders>`
  + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  + `<cellXfs count="3">`
  + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
  + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
  + `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
  + `</cellXfs>`
  + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
  + `</styleSheet>`;

// ---------------------------------------------------------------- zip

const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Miembro { nombre: string; datos: Uint8Array }

/** Zip con todo STORED. La fecha del archivo queda fija en 1980-01-01 a
 * propósito: la salida depende solo del contenido, así que dos exports del
 * mismo estado de cuenta dan bytes idénticos y las pruebas no dependen del
 * reloj. */
function zip(miembros: Miembro[]): Uint8Array {
  const enc = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let offset = 0;

  for (const m of miembros) {
    const nombre = enc.encode(m.nombre);
    const crc = crc32(m.datos);
    const local = new Uint8Array(30 + nombre.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // versión necesaria
    lv.setUint16(6, 0x0800, true);      // nombres en UTF-8
    lv.setUint16(8, 0, true);           // method 0 = stored
    lv.setUint16(10, 0, true);          // hora
    lv.setUint16(12, 0x0021, true);     // fecha 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, m.datos.length, true);
    lv.setUint32(22, m.datos.length, true);
    lv.setUint16(26, nombre.length, true);
    lv.setUint16(28, 0, true);
    local.set(nombre, 30);

    const central = new Uint8Array(46 + nombre.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);          // versión que lo creó
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x0021, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, m.datos.length, true);
    cv.setUint32(24, m.datos.length, true);
    cv.setUint16(28, nombre.length, true);
    cv.setUint32(42, offset, true);
    central.set(nombre, 46);

    locales.push(local, m.datos);
    centrales.push(central);
    offset += local.length + m.datos.length;
  }

  const tamCentral = centrales.reduce((s, b) => s + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, miembros.length, true);
  ev.setUint16(10, miembros.length, true);
  ev.setUint32(12, tamCentral, true);
  ev.setUint32(16, offset, true);

  const total = offset + tamCentral + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of [...locales, ...centrales, eocd]) { out.set(b, p); p += b.length; }
  return out;
}

// ---------------------------------------------------------------- api

/** Arma el .xlsx completo. Síncrono: sin compresión no hay streams de por
 * medio, así que sirve igual en el Worker y en el navegador. */
export function escribirXlsx(hojas: HojaOut[]): Uint8Array {
  if (hojas.length === 0) throw new Error('un .xlsx necesita al menos una hoja');
  const enc = new TextEncoder();
  const nombres = hojas.map(h => nombreHojaValido(h.nombre));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + `</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets>${nombres.map((n, i) => `<sheet name="${escaparXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + `</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    // El id de styles va después de las hojas para no chocar con los suyos.
    + `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `</Relationships>`;

  return zip([
    { nombre: '[Content_Types].xml', datos: enc.encode(contentTypes) },
    { nombre: '_rels/.rels', datos: enc.encode(rels) },
    { nombre: 'xl/workbook.xml', datos: enc.encode(workbook) },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: enc.encode(wbRels) },
    { nombre: 'xl/styles.xml', datos: enc.encode(STYLES_XML) },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: enc.encode(hojaXml(h)) })),
  ]);
}
