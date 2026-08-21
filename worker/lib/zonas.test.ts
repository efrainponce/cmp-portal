// La zona privada 'Efrain' (Efraín, 2026-08-12) es la ÚNICA excepción a "admin
// ve todo", así que su whitelist se ancla aquí igual que las de
// shared/visibility.test.ts: quién está dentro es decisión de Efraín, no del
// código que la consulta.
import { describe, it, expect } from 'vitest';
import { isZonaPrivadaAdminPermitido } from './zonas';

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
