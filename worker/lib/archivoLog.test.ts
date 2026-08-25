// La bitácora es best-effort a propósito: si falla, el archivo igual se sube.
// Eso la vuelve fácil de romper en silencio, así que lo que se ancla aquí es su
// contrato de forma — y sobre todo que NO puede tumbar el flujo que la llama.
import { describe, it, expect, vi } from 'vitest';
import { registrarArchivo } from './archivoLog';
import type { Env } from '../env';

/** D1 de mentiras que graba los binds de cada INSERT. */
function envFalso(fallar = false): { env: Env; inserts: unknown[][] } {
  const inserts: unknown[][] = [];
  const prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      run: async () => {
        if (fallar) throw new Error('D1 caído');
        if (sql.includes('INSERT INTO archivo_evento')) inserts.push(args);
        return {};
      },
    }),
    run: async () => {
      if (fallar) throw new Error('D1 caído');
      return {};
    },
  });
  return { env: { DB: { prepare } } as unknown as Env, inserts };
}

describe('registrarArchivo', () => {
  it('guarda el acto con su referencia', async () => {
    const { env, inserts } = envFalso();
    await registrarArchivo(env, {
      acto: 'genera', categoria: 'oc', nombre: 'OC_OC-236_ABRAHAM.pdf',
      boardId: 18395657594, itemId: 123, colId: 'file_mm0hj9pn', bytes: 500, porEmail: 'a@b.com',
    });
    expect(inserts).toHaveLength(1);
    const [acto, categoria, nombre, boardId, itemId, colId, assetId, r2Key, bytes, porEmail, origen] = inserts[0];
    expect([acto, categoria, nombre]).toEqual(['genera', 'oc', 'OC_OC-236_ABRAHAM.pdf']);
    expect([boardId, itemId, colId]).toEqual([18395657594, 123, 'file_mm0hj9pn']);
    expect([assetId, r2Key]).toEqual([null, null]);
    expect([bytes, porEmail, origen]).toEqual([500, 'a@b.com', 'portal']);
  });

  it('NUNCA lanza aunque D1 esté caído', async () => {
    // Es la propiedad que importa: una OC que no se emite porque no se pudo
    // loggear sería peor que perder el registro.
    const { env } = envFalso(true);
    await expect(registrarArchivo(env, { acto: 'sube', categoria: 'x', nombre: 'a.pdf' }))
      .resolves.toBeUndefined();
  });

  it('recorta nombres absurdos en vez de rechazarlos', async () => {
    const { env, inserts } = envFalso();
    await registrarArchivo(env, { acto: 'sube', categoria: 'x', nombre: 'a'.repeat(500) });
    expect((inserts[0][2] as string).length).toBe(300);
  });
});
