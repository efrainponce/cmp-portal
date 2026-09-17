import { describe, it, expect } from 'vitest';
import { esNombreDePrueba } from './limpieza';

// La limpieza solo puede tocar nombres que digan test/prueba/borrar, y nunca
// los proyectos/productos reales de laboratorio ("PRUEBAS DE LAB…").
describe('esNombreDePrueba', () => {
  it('acepta test / prueba / borrar en cualquier caja', () => {
    expect(esNombreDePrueba('OPP-0940 - TEST E2E — borrar')).toBe(true);
    expect(esNombreDePrueba('OPP-0811 - PRUEBA')).toBe(true);
    expect(esNombreDePrueba('Contacto de test')).toBe(true);
  });
  it('rechaza nombres reales y los de laboratorio', () => {
    expect(esNombreDePrueba('OPP-0901 - Uniformes SSP Yucatán')).toBe(false);
    expect(esNombreDePrueba('PRUEBAS DE LAB TELAS H. AYUNTAMIENTO MID')).toBe(false);
    expect(esNombreDePrueba('PRUEBASHILOS - PRUEBAS DE LABORATORIO A HILOS')).toBe(false);
  });
});
