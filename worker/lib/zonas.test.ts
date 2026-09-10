// La zona privada 'Efrain' (Efraín, 2026-08-12) es la ÚNICA excepción a "admin
// ve todo", así que su whitelist se ancla aquí igual que las de
// shared/visibility.test.ts: quién está dentro es decisión de Efraín, no del
// código que la consulta.
import { describe, it, expect } from 'vitest';
import { catalogoNaceNativo, isZonaPrivadaAdminPermitido } from './zonas';

describe('whitelist de la zona privada', () => {
  it('las tres personas de siempre siguen dentro (CEO, Elisa, quien mantiene el portal)', () => {
    for (const email of [
      'efrainponce@mexicanadeproteccion.com',
      'efrain.ponce@mexicanadeproteccion.com',
      'administracion@mexicanadeproteccion.com',
      'salinasefrain@mexicanadeproteccion.com',
      'efrain.ponces@gmail.com',
    ]) expect(isZonaPrivadaAdminPermitido(email)).toBe(true);
  });

  // Efraín, 2026-08-21: "dales acceso a EMY y a PAM como Elisa". PAM es admin,
  // así que la whitelist le basta; EMY es de compras y su lectura la sigue
  // acotando comprasScopeFor — ver el comentario en zonas.ts.
  it('PAM y EMY entraron el 2026-08-21', () => {
    expect(isZonaPrivadaAdminPermitido('compras@mexicanadeproteccion.com')).toBe(true);
    expect(isZonaPrivadaAdminPermitido('cotizaciones4@mexicanadeproteccion.com')).toBe(true);
  });

  it('cualquier otro correo queda fuera, aunque sea admin', () => {
    expect(isZonaPrivadaAdminPermitido('otro.admin@mexicanadeproteccion.com')).toBe(false);
    // El resto de Compras NO entró: solo EMY (cotizaciones4@).
    expect(isZonaPrivadaAdminPermitido('cotizaciones5@mexicanadeproteccion.com')).toBe(false);
    expect(isZonaPrivadaAdminPermitido('webcmp@mexicanadeproteccion.com')).toBe(false);
    expect(isZonaPrivadaAdminPermitido(null)).toBe(false);
    expect(isZonaPrivadaAdminPermitido('')).toBe(false);
  });

  // Regresión 2026-08-18: la whitelist iba por monday_user_id y "Actuar en
  // Monday como" (worker/routes/admin.ts) presta ese id — un vendedor nuevo
  // dado de alta con el id de un permitido heredaba la zona completa: tab,
  // alta de registros dentro y las notificaciones reservadas a la whitelist.
  it('un id prestado NO hereda la zona: manda la persona, no el monday_user_id', () => {
    expect(isZonaPrivadaAdminPermitido('coordinador2.centro@mexicanadeproteccion.com')).toBe(false);
  });

  it('no distingue mayúsculas ni espacios (el correo llega de Access)', () => {
    expect(isZonaPrivadaAdminPermitido(' Efrain.Ponces@Gmail.com ')).toBe(true);
  });
});

// Efraín, 2026-09-10: alta de Contacto e Institución DENTRO de "Nueva
// oportunidad". Desde los catálogos, lo que captura la whitelist sigue naciendo
// nativo sin preguntar (2026-08-18); desde una oportunidad de Monday el form
// manda `native: false`, porque una oportunidad real no puede ligar nada
// nativo (assertNoNativeLink) y tronaría al guardarla.
describe('¿nace nativo el contacto o institución que se da de alta?', () => {
  it('la whitelist, desde los catálogos (sin `native`): nativo, como siempre', () => {
    expect(catalogoNaceNativo('compras@mexicanadeproteccion.com')).toBe(true);
    expect(catalogoNaceNativo('efrain.ponces@gmail.com', true)).toBe(true);
  });

  it('la whitelist, desde una oportunidad de Monday (`native: false`): en Monday', () => {
    expect(catalogoNaceNativo('compras@mexicanadeproteccion.com', false)).toBe(false);
    expect(catalogoNaceNativo('administracion@mexicanadeproteccion.com', false)).toBe(false);
  });

  it('fuera de la whitelist nunca nace nativo por esta vía, pida lo que pida', () => {
    expect(catalogoNaceNativo('otro.vendedor@mexicanadeproteccion.com')).toBe(false);
    expect(catalogoNaceNativo('otro.vendedor@mexicanadeproteccion.com', true)).toBe(false);
    expect(catalogoNaceNativo(null)).toBe(false);
  });
});
