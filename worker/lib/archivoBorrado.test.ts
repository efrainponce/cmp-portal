// Ancla de "borrar un documento" (Efraín, 2026-08-19: "vendedor puede borrar
// documentos que el SUBIO"). Cubre lo que el typecheck no ve —todo son strings
// crudos de Monday— y quién puede borrar.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArchivos, mismoArchivo, sobrevivientes, respaldoKey, puedeBorrarArchivo } from './archivoBorrado';

const OC = 'Orden de compra Intellectus V.f.2.pdf';

/** El caso real que originó todo: OPP-0506 con la MISMA OC subida dos veces. */
const VALUE_0506 = JSON.stringify({
  files: [
    { name: OC, assetId: 3190457457, isImage: 'false', fileType: 'ASSET' },
    { name: OC, assetId: 3190459422, isImage: 'false', fileType: 'ASSET' },
    { name: 'DECLARACION DE USUARIO FINAL.pdf', assetId: 3190463325, isImage: 'false', fileType: 'ASSET' },
  ],
});

describe('lectura de una columna file', () => {
  it('saca nombre + assetId de cada archivo', () => {
    expect(parseArchivos(VALUE_0506)).toEqual([
      { assetId: 3190457457, nombre: OC },
      { assetId: 3190459422, nombre: OC },
      { assetId: 3190463325, nombre: 'DECLARACION DE USUARIO FINAL.pdf' },
    ]);
  });

  it('columna vacía o basura no truena', () => {
    expect(parseArchivos(null)).toEqual([]);
    expect(parseArchivos('no soy json')).toEqual([]);
  });

  it('item nativo: archivos sin assetId (solo viven en R2)', () => {
    expect(parseArchivos(JSON.stringify({ files: [{ name: 'OC.pdf' }] }))).toEqual([{ assetId: 0, nombre: 'OC.pdf' }]);
  });
});

describe('qué sobrevive al borrado', () => {
  const actuales = parseArchivos(VALUE_0506);

  it('quita SOLO el duplicado pedido, aunque se llame igual que otro', () => {
    expect(sobrevivientes(actuales, { assetId: 3190459422, nombre: OC })).toEqual([
      { assetId: 3190457457, nombre: OC },
      { assetId: 3190463325, nombre: 'DECLARACION DE USUARIO FINAL.pdf' },
    ]);
  });

  it('null si el archivo ya no está — el llamador NO debe reescribir la columna', () => {
    expect(sobrevivientes(actuales, { assetId: 999, nombre: 'otra cosa.pdf' })).toBeNull();
  });

  it('borrar el último deja la lista vacía (la columna queda sin documento)', () => {
    const uno = [{ assetId: 1, nombre: 'a.pdf' }];
    expect(sobrevivientes(uno, { assetId: 1, nombre: 'a.pdf' })).toEqual([]);
  });

  it('nativos (sin assetId) empatan por nombre y se quita UNO, no los dos', () => {
    const nativos = [{ assetId: 0, nombre: 'OC.pdf' }, { assetId: 0, nombre: 'OC.pdf' }];
    expect(sobrevivientes(nativos, { assetId: 0, nombre: 'OC.pdf' })).toEqual([{ assetId: 0, nombre: 'OC.pdf' }]);
  });

  it('con assetId manda el assetId, no el nombre', () => {
    expect(mismoArchivo({ assetId: 1, nombre: 'a' }, { assetId: 2, nombre: 'a' })).toBe(false);
    expect(mismoArchivo({ assetId: 1, nombre: 'a' }, { assetId: 1, nombre: 'b' })).toBe(true);
  });
});

describe('respaldo antes de borrar', () => {
  it('el key lleva el assetId: dos duplicados no se pisan el respaldo', () => {
    const a = respaldoKey(506, 'documento', { assetId: 3190457457, nombre: OC });
    const b = respaldoKey(506, 'documento', { assetId: 3190459422, nombre: OC });
    expect(a).not.toBe(b);
    expect(a).toBe(`oportunidades/506/documento-borrado/3190457457-${OC}`);
  });
});

describe('quién puede borrar', () => {
  const vendedor = { role: 'vendedor' as const, email: 'ricardo@mexicanadeproteccion.com' };

  it('el que lo subió, sí (sin importar mayúsculas)', () => {
    expect(puedeBorrarArchivo(vendedor, 'Ricardo@Mexicanadeproteccion.com')).toBe(true);
  });

  it('otro vendedor, no', () => {
    expect(puedeBorrarArchivo(vendedor, 'otro@mexicanadeproteccion.com')).toBe(false);
  });

  it('admin siempre', () => {
    expect(puedeBorrarArchivo({ role: 'admin', email: 'efrain@mexicanadeproteccion.com' }, 'otro@mexicanadeproteccion.com')).toBe(true);
  });

  it('archivo sin registro de subida (anterior a esto): lo borra el dueño del item', () => {
    expect(puedeBorrarArchivo(vendedor, null)).toBe(true);
  });
});

// Mismo criterio que worker/lib/monday.destructivo.test.ts: `update_assets_on_item`
// no lleva la palabra "delete", pero SÍ destruye (el asset que se deja fuera de
// la lista desaparece de Monday — verificado en vivo). Que viva en un solo
// archivo, con su respaldo y su tope, es la mitad de la garantía.
describe('la mutación que destruye archivos vive en un solo lugar', () => {
  const RAIZ = new URL('../', import.meta.url).pathname; // worker/

  function fuentes(dir: string): string[] {
    return readdirSync(dir).flatMap(nombre => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) return fuentes(ruta);
      if (!ruta.endsWith('.ts') || ruta.includes('.test.')) return [];
      return [ruta];
    });
  }

  it('solo lib/archivoBorrado.ts usa update_assets_on_item', () => {
    const culpables = fuentes(RAIZ).filter(a => {
      const codigo = readFileSync(a, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return codigo.includes('update_assets_on_item');
    });
    expect(culpables.map(c => c.slice(RAIZ.length))).toEqual(['lib/archivoBorrado.ts']);
  });

  it('respalda en R2 y topa por hora antes de tocar Monday', () => {
    // Sobre el CÓDIGO, sin comentarios: el encabezado del archivo nombra la
    // mutación para explicarla y desordenaría la comparación de posiciones.
    const src = readFileSync(join(RAIZ, 'lib/archivoBorrado.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).toContain('putFile(');
    expect(src).toContain('TOPE_POR_HORA');
    expect(src.indexOf('INSERT INTO archivo_borrado')).toBeLessThan(src.indexOf('update_assets_on_item'));
  });
});
