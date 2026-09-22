// "Exportar a Excel" de las listas del portal (Efraín, 2026-09-21: en Monday
// cualquier board se baja a Excel y el portal solo lo tenía en Estado de
// Cuenta; al salir de Monday eso no puede faltar).
//
// TODO sale de lo que la lista YA tiene en memoria — los renglones filtrados
// y las columnas que pinta. No hay endpoint nuevo ni se piden columnas extra,
// a propósito: el worker ya recortó `cols` y `totales` por rol y por correo
// (shared/visibility.ts), así que el Excel no puede traer una columna que la
// persona no ve en pantalla (utilidades, costos, proveedores).
import type { ColMeta, ColVal, ItemDTO } from '../../shared/dto';
import type { ValorCelda } from '../../shared/xlsxWrite';
import { limpiarNombreArchivo } from '../../shared/nombreArchivo';
import { isMoneyTitle } from './format';
import { downloadBlob } from './estadoCuentaApi';

export interface ColumnaExport<T> {
  titulo: string;
  /** string = texto; number = número de verdad (suma en Excel); null = vacía. */
  valor: (fila: T) => string | number | null | undefined;
  /** Los números de esta columna llevan formato de moneda. */
  moneda?: boolean;
  /** Ancho en caracteres; sin él se calcula del contenido. */
  ancho?: number;
}

const ANCHO_MIN = 8;
const ANCHO_MAX = 60;

/** Valor de una celda de Monday para Excel: `numbers` va como número (el
 * `value` parseado, o el texto sin comas de miles); todo lo demás, su `text` —
 * las fechas ya vienen 'aaaa-mm-dd' y así se quedan, sin pasar por Date. */
export function valorDeCelda(col: ColMeta, val: ColVal | undefined): string | number | null {
  if (!val || val.text === '') return null;
  if (col.type === 'numbers') {
    const crudo = typeof val.value === 'number' || typeof val.value === 'string' ? val.value : val.text;
    const n = typeof crudo === 'number' ? crudo : Number(String(crudo).replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return val.text;
}

/** Columnas de exportación a partir de las `ColMeta` de una tabla — Nombre va
 * siempre primero, igual que en BoardTable. */
export function columnasDeItems(cols: ColMeta[], tituloNombre = 'Nombre'): ColumnaExport<ItemDTO>[] {
  return [
    { titulo: tituloNombre, valor: (it) => it.name },
    // `button` y `subtasks` nunca traen texto: serían columnas vacías.
    ...cols.filter((col) => col.type !== 'button' && col.type !== 'subtasks').map((col): ColumnaExport<ItemDTO> => ({
      titulo: col.title,
      valor: (it) => valorDeCelda(col, it.cols[col.id]),
      moneda: col.type === 'numbers' && isMoneyTitle(col.title),
    })),
  ];
}

/** Columnas de dinero que el worker manda aparte de `cols` (`totales` de las
 * listas de etapa, resumen del Estado de cuenta): un número por renglón,
 * `undefined` = celda vacía. El porcentaje va sin formato de moneda. */
export function columnasDeCifras<T, K extends string>(
  metricas: readonly { key: K; titulo: string }[],
  cifra: (fila: T, key: K) => number | undefined,
): ColumnaExport<T>[] {
  return metricas.map((m) => ({
    titulo: m.titulo,
    valor: (fila) => cifra(fila, m.key),
    moneda: !/pct$/i.test(m.key),
    ancho: 18,
  }));
}

/** Filas (encabezado + datos) y anchos de la hoja. Pura: es lo que se prueba. */
export function hojaDe<T>(columnas: ColumnaExport<T>[], filas: T[]): { filas: ValorCelda[][]; anchos: number[] } {
  const anchos = columnas.map((c) => c.ancho ?? Math.max(ANCHO_MIN, c.titulo.length + 2));
  const out: ValorCelda[][] = [columnas.map((c) => ({ v: c.titulo, estilo: 'titulo' as const }))];
  for (const fila of filas) {
    out.push(columnas.map((c, i) => {
      const v = c.valor(fila) ?? null;
      if (v === null || v === '') return null;
      if (c.ancho === undefined) {
        // Un número con formato de moneda ocupa más que sus dígitos ("$1,234,567.00").
        const largo = typeof v === 'number' ? String(Math.round(v)).length + 6 : v.length + 2;
        if (largo > anchos[i]) anchos[i] = Math.min(ANCHO_MAX, largo);
      }
      return typeof v === 'number' && c.moneda ? { v, estilo: 'moneda' as const } : v;
    }));
  }
  return { filas: out, anchos };
}

/** `Instituciones-2026-09-21.xlsx` — fecha LOCAL (toISOString es UTC y después
 * de las 6 pm en México ya diría mañana). */
export function nombreExport(titulo: string, hoy = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const fecha = `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(hoy.getDate())}`;
  return `${limpiarNombreArchivo(titulo) || 'Exportación'}-${fecha}.xlsx`;
}

/** Arma el .xlsx y lo descarga. El escritor se importa AQUÍ (import dinámico):
 * solo lo usaba el worker, y así no entra al bundle principal por un botón que
 * se oprime de vez en cuando. */
export async function exportarXlsx<T>(titulo: string, columnas: ColumnaExport<T>[], filas: T[]): Promise<void> {
  const { escribirXlsx } = await import('../../shared/xlsxWrite');
  const hoja = hojaDe(columnas, filas);
  const bytes = escribirXlsx([{ nombre: titulo, filas: hoja.filas, anchos: hoja.anchos }]);
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, nombreExport(titulo));
}
