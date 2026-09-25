// La firma la escribe worker/lib/firmaUpdate.ts en dos formas (con y sin @,
// según si el id de Monday es propio o prestado — ver firmaUpdate.test.ts).
import { describe, it, expect } from 'vitest';
import { separarFirma } from './firmaPortal';

describe('separarFirma', () => {
  it('firma en texto plano (id prestado: Paola, Rodrigo)', () => {
    expect(separarFirma('Ya quedó la OC\n\n— Paola Silvana Andrade Facundo vía Portal CMP'))
      .toEqual({ texto: 'Ya quedó la OC', autor: 'Paola Silvana Andrade Facundo' });
  });

  it('firma como @mención (cuenta propia de Monday)', () => {
    expect(separarFirma('Revisen el color porfa\n\n— @Ricardo Rivera Rodríguez vía Portal CMP'))
      .toEqual({ texto: 'Revisen el color porfa', autor: 'Ricardo Rivera Rodríguez' });
  });

  it('Monday puede juntar los saltos de línea: la firma igual se reconoce al final', () => {
    expect(separarFirma('Listo — @Angel Omar Canto Cural vía Portal CMP'))
      .toEqual({ texto: 'Listo', autor: 'Angel Omar Canto Cural' });
  });

  it('un comentario escrito en Monday no trae firma: queda tal cual', () => {
    const body = '@EMILY MARTINEZ GONZALEZ me podrías apoyar porfa';
    expect(separarFirma(body)).toEqual({ texto: body, autor: null });
  });

  it('solo cuenta la firma del FINAL — una raya en medio del texto no se toca', () => {
    const body = 'Precio — vía Portal CMP dice el cliente, confirmar mañana';
    expect(separarFirma(body)).toEqual({ texto: body, autor: null });
  });

  it('respeta los saltos de línea del comentario', () => {
    expect(separarFirma('Línea 1\nLínea 2\n\n— Jorge Perez vía Portal CMP'))
      .toEqual({ texto: 'Línea 1\nLínea 2', autor: 'Jorge Perez' });
  });

  it('un comentario que solo es firma no se queda vacío', () => {
    const body = '— Jorge Perez vía Portal CMP';
    expect(separarFirma(body)).toEqual({ texto: body, autor: 'Jorge Perez' });
  });
});
