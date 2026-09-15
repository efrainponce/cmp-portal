// Efraín, 2026-09-15: Paola (sin Monday) escribe con el id prestado de Efraín,
// igual que Rodrigo. Sus actualizaciones deben decir "Paola", no un @mention
// que apunte al usuario de Efraín ni le avise a él.
import { describe, it, expect } from 'vitest';
import { firmaAutor, idMondayEsPropio } from './firmaUpdate';

const efrain = { id: '98389537', name: 'Efrain Ponce Salinas', email: 'salinasefrain@mexicanadeproteccion.com' };
const paola = { email: 'cdmx.administracion@mexicanadeproteccion.com', nombre: 'Paola Silvana Andrade Facundo', monday_user_id: 98389537 };
const rodrigo = { email: 'coordinador2.centro@mexicanadeproteccion.com', nombre: 'Rodrigo', monday_user_id: 98389537 };
const efrainGmail = { email: 'efrain.ponces@gmail.com', nombre: 'Efrain Ponce Salinas', monday_user_id: 98389537 };
const ricardo = { email: 'directorcomercial@mexicanadeproteccion.com', nombre: 'Ricardo Rivera Rodríguez', monday_user_id: 100021002 };
const ricardoMonday = { id: 100021002, name: 'Ricardo Rivera Rodríguez', email: 'directorcomercial@mexicanadeproteccion.com' };

describe('idMondayEsPropio', () => {
  it('id prestado: Paola y Rodrigo NO son el usuario de Monday 98389537', () => {
    expect(idMondayEsPropio(paola, efrain)).toBe(false);
    expect(idMondayEsPropio(rodrigo, efrain)).toBe(false);
  });
  it('el dueño real sí, aunque entre con su otro correo (mismo nombre)', () => {
    expect(idMondayEsPropio(efrainGmail, efrain)).toBe(true);
    expect(idMondayEsPropio(ricardo, ricardoMonday)).toBe(true);
  });
  it('sin roster (Monday caído y sin cache) no se afirma nada', () => {
    expect(idMondayEsPropio(ricardo, undefined)).toBe(false);
  });
});

describe('firmaAutor', () => {
  it('Paola firma en texto plano con SU nombre y sin mention', () => {
    expect(firmaAutor(paola, efrain, { itemNativo: false })).toEqual({
      firma: '— Paola Silvana Andrade Facundo vía Portal CMP', mention: null,
    });
  });
  it('un vendedor con su propia cuenta firma con @mention', () => {
    expect(firmaAutor(ricardo, ricardoMonday, { itemNativo: false })).toEqual({
      firma: '— @Ricardo Rivera Rodríguez vía Portal CMP',
      mention: { id: 100021002, nombre: 'Ricardo Rivera Rodríguez' },
    });
  });
  it('item nativo: texto plano aunque el id sea propio', () => {
    expect(firmaAutor(ricardo, ricardoMonday, { itemNativo: true }).mention).toBeNull();
  });
  it('usuario nativo del portal (id sintético): texto plano', () => {
    expect(firmaAutor({ ...ricardo, monday_user_id: -3 }, undefined, { itemNativo: false }).mention).toBeNull();
  });
});
