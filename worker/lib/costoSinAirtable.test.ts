// Aviso "Sin costo en Airtable" (Efraín, 2026-09-25): el costo NO se inventa,
// se avisa con link al producto en Airtable.
import { describe, it, expect } from 'vitest';
import { airtableProductoUrl, faltaCosto } from './costoSinAirtable';

const col = (id: string, text: string) => ({ id, text });

describe('faltaCosto', () => {
  it('producto sin Costo Distribuidor → aviso con link a su registro en Airtable', () => {
    // La Bota 12477 del reporte de Elisa, tal como está en el catálogo.
    expect(faltaCosto('12477 - Bota Lite Mid BOA®', [
      col('numeric_mkzpx7eb', ''), col('text_mkzmgvc7', 'recJIH3IgqpnJHylV'),
    ])).toEqual({
      nombre: '12477 - Bota Lite Mid BOA®',
      link: 'https://airtable.com/apprQnMOKPEBYt4AU/tblxZZLHRUAeJbGa2/recJIH3IgqpnJHylV',
    });
  });

  it('costo en 0 también cuenta como faltante', () => {
    expect(faltaCosto('X', [col('numeric_mkzpx7eb', '0')])).toEqual({ nombre: 'X', link: null });
  });

  it('con costo no hay aviso', () => {
    expect(faltaCosto('Ridge Pant', [col('numeric_mkzpx7eb', '1500'), col('text_mkzmgvc7', 'recFR8CKeTKaUTvNM')])).toBeNull();
    expect(faltaCosto('Caro', [col('numeric_mkzpx7eb', '1,170')])).toBeNull();
  });
});

describe('airtableProductoUrl', () => {
  it('solo arma link con un id rec… válido', () => {
    expect(airtableProductoUrl('')).toBeNull();
    expect(airtableProductoUrl('12443362292')).toBeNull();
    expect(airtableProductoUrl(' recFR8CKeTKaUTvNM ')).toBe('https://airtable.com/apprQnMOKPEBYt4AU/tblxZZLHRUAeJbGa2/recFR8CKeTKaUTvNM');
  });
});
