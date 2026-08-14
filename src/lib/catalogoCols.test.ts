// (vive aparte de productSearch.test.ts, que cubre la BÚSQUEDA de productos)
// CATALOGO_COLS decide qué columnas del board Productos viajan cuando se carga
// el catálogo de la pestaña Cotización. Si falta una que el código sí lee, no
// truena nada: el campo simplemente llega VACÍO — un checkbox se ve
// desmarcado, "Sin proveedor" aparece donde sí hay proveedor, el selector de
// Color se queda sin opciones. Es el peor tipo de bug: silencioso y con cara
// de dato malo en Monday.
//
// Por eso este test no compara contra una lista escrita a mano: rehace la
// auditoría. Recorre el cierre de imports desde la grid y el picker, junta toda
// cadena que sea llave del board `productos` en column-meta.gen.ts, y exige que
// CATALOGO_COLS las cubra.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CATALOGO_COLS, COLS_BAJO_DEMANDA } from './productSearch';
import { COLUMN_META } from '../../shared/column-meta.gen';

const RAIZ = join(import.meta.dirname, '..', '..');

// Todo lo que demostradamente recibe ItemDTO del catálogo de productos.
const SEMILLAS = [
  'src/boards/oportunidades/tabs/CotizacionTab.tsx',
  'src/boards/oportunidades/tabs/cotizacion/gridMeta.tsx',
  'src/boards/oportunidades/tabs/cotizacion/QuoteRow.tsx',
  'src/boards/oportunidades/tabs/cotizacion/MobileQuoteRow.tsx',
  'src/boards/oportunidades/tabs/cotizacion/LineDetailPanel.tsx',
  'src/boards/oportunidades/tabs/cotizacion/AjustarLineaModal.tsx',
  'src/components/forms/ProductPicker.tsx',
  'src/boards/proyectos/CotizacionVirtualTab.tsx',
  'src/boards/proyectos/AjustarLineaVirtualModal.tsx',
];

function resolverImport(desde: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(desde), spec);
  for (const c of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Cierre transitivo de imports locales desde las semillas. */
function archivosQueTocanElCatalogo(): string[] {
  const vistos = new Set<string>();
  const cola = SEMILLAS.map((s) => join(RAIZ, s));
  while (cola.length) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue;
    vistos.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)) {
      const r = resolverImport(f, m[1]);
      // shared/ queda fuera: son contratos y tipos, no lectura de columnas.
      if (r && !vistos.has(r) && !r.includes('/shared/')) cola.push(r);
    }
  }
  return [...vistos];
}

/** Columnas del board Productos referenciadas en esos archivos. No supone
 * ninguna forma de id (así se me escapó `product_and_service_sku` la primera
 * vez, que termina en un segmento corto): compara contra las llaves reales. */
function columnasReferenciadas(): Map<string, string> {
  const productos = COLUMN_META.productos ?? {};
  const hallado = new Map<string, string>();
  for (const f of archivosQueTocanElCatalogo()) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"`]([^'"`\n]{3,60})['"`]/g)) {
      const id = m[1];
      // `name` es campo propio del item (item.name), no una columna.
      if (id !== 'name' && productos[id] && !hallado.has(id)) {
        hallado.set(id, f.replace(RAIZ + '/', ''));
      }
    }
  }
  return hallado;
}

describe('CATALOGO_COLS', () => {
  it('cubre TODA columna de Productos que lee la grid de cotización', () => {
    // La regla real: toda columna de Productos que el código lea tiene que
    // estar declarada en ALGUNA de las dos listas — en el catálogo masivo, o
    // marcada como "se pide aparte". Lo que no puede pasar es que se lea una
    // que no está en ninguna: eso llega vacío y nadie se entera.
    const referenciadas = columnasReferenciadas();
    const declaradas = new Set<string>([...CATALOGO_COLS, ...COLS_BAJO_DEMANDA]);
    const faltantes = [...referenciadas].filter(([id]) => !declaradas.has(id));
    expect(
      faltantes.map(([id, f]) => `${id} (${COLUMN_META.productos?.[id]?.title}) leída en ${f}`),
    ).toEqual([]);
  });

  it('no declara columnas de más', () => {
    // No es cosmético: cada columna extra son bytes en una descarga que ocurre
    // al abrir una oportunidad editable.
    const referenciadas = columnasReferenciadas();
    const sobrantes = CATALOGO_COLS.filter((id) => !referenciadas.has(id));
    expect(sobrantes).toEqual([]);
    // Y nada puede estar en las dos listas a la vez.
    const enAmbas = CATALOGO_COLS.filter((id) => (COLS_BAJO_DEMANDA as readonly string[]).includes(id));
    expect(enAmbas).toEqual([]);
  });

  it('todas existen de verdad en el board Productos', () => {
    // Atrapa un id inventado o mal copiado, que si no llegaría siempre vacío.
    for (const id of [...CATALOGO_COLS, ...COLS_BAJO_DEMANDA]) {
      expect(COLUMN_META.productos?.[id], `${id} no existe en el board productos`).toBeTruthy();
    }
  });
});
