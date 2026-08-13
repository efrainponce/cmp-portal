// Fixture data del prototipo de diseño del portal, reusada como fallback
// offline: src/lib/mockFallback.ts la sirve cuando el fetch al Worker falla
// (worker abajo, no solo en dev) — ver docs/code-index.md.

export interface Status {
  key: string;
  label: string;
  color: string;
  tint: string;
}

interface Embellecimiento {
  posicion: string;
  descripcion: string;
}

export interface OppProduct {
  producto: string;
  sku: string;
  color: string;
  cantidad: number;
  precioUnitario: number;
  embellecimientos?: Embellecimiento[];
}

export interface UpdateEntry {
  texto: string;
  autor: string;
  cuando: string;
}

export interface Opportunity {
  id: string;
  cliente: string;
  institucion: string;
  folio: string;
  vendedor: string;
  statusKey: string;
  tipo: string;
  valor: string;
  updated: string;
  products: OppProduct[];
  updates?: UpdateEntry[];
}

export const statuses: Status[] = [
  { key: 'nueva', label: 'Nueva oportunidad', color: '#9a958a', tint: '#eeece7' },
  { key: 'en_coste', label: 'En costeo', color: '#a97c3a', tint: '#f3e9d8' },
  { key: 'costeo_validacion', label: 'Costeo en validación', color: '#a97c3a', tint: '#f3e9d8' },
  { key: 'costeo_confirmado', label: 'Costeo confirmado', color: '#6f7f57', tint: '#e9eee2' },
  { key: 'seguimiento', label: 'Cotización en seguimiento', color: '#5b7794', tint: '#e6ebf0' },
  { key: 'negociacion', label: 'En negociación', color: '#5b7794', tint: '#e6ebf0' },
  { key: 'esperando_oc', label: 'Esperando OC', color: '#b6842f', tint: '#f5ecd9' },
  { key: 'ganada', label: 'Ganada', color: '#4f7a41', tint: '#e6efe1' },
  { key: 'perdida', label: 'Perdida', color: '#9c4c3d', tint: '#f3e5e1' },
  { key: 'cancelada', label: 'Cancelada', color: '#8f897b', tint: '#efece7' },
];

export const opportunities: Opportunity[] = [
  { id: 'o1', cliente: 'Seguridad Perimetral SA', institucion: 'CFE', folio: 'OP-2026-0141', vendedor: 'Diego Torres', statusKey: 'nueva', tipo: 'Estudio de mercado', valor: '$340K', updated: 'Hace 1 h', products: [
    { producto: 'Cámara de vigilancia PTZ', sku: 'CAM-PTZ-40', color: 'N/A', cantidad: 12, precioUnitario: 18500 },
    { producto: 'Sensor perimetral IR', sku: 'SEN-IR-12', color: 'N/A', cantidad: 20, precioUnitario: 4200 },
  ] },
  { id: 'o2', cliente: 'Grupo Fronterizo Seguridad', institucion: 'Guardia Nacional', folio: 'OP-2026-0126', vendedor: 'Ana Ruiz', statusKey: 'nueva', tipo: 'Licitación', valor: '$2.1M', updated: 'Hace 4 h', updates: [
    { texto: 'Cliente solicitó ajustar cantidades de chalecos.', autor: 'Ana Ruiz', cuando: 'Hace 2 h' },
    { texto: 'Se envió cotización preliminar para revisión interna.', autor: 'Ana Ruiz', cuando: 'Hace 1 d' },
  ], products: [
    { producto: 'Chaleco balístico NIJ IIIA', sku: 'CHB-3A-L', color: 'Negro', cantidad: 80, precioUnitario: 12800, embellecimientos: [{ posicion: 'Frente izquierdo', descripcion: 'Bordado 8 cm' }] },
    { producto: 'Casco táctico ACH', sku: 'CAS-ACH-M', color: 'Verde OD', cantidad: 80, precioUnitario: 6400 },
  ] },
  { id: 'o3', cliente: 'Insumos Tácticos del Pacífico', institucion: 'Policía Estatal Jalisco', folio: 'OP-2026-0125', vendedor: 'Laura Sánchez', statusKey: 'nueva', tipo: 'Venta Directa', valor: '$180K', updated: 'Hace 6 h', products: [
    { producto: 'Uniforme táctico ripstop', sku: 'UNI-RIP-M', color: 'Negro', cantidad: 25, precioUnitario: 2100, embellecimientos: [{ posicion: 'Espalda', descripcion: 'Serigrafía 20 cm' }] },
    { producto: 'Botas tácticas 8"', sku: 'BOT-TAC-8', color: 'Negro', cantidad: 25, precioUnitario: 2450 },
  ] },
  { id: 'o4', cliente: 'Tecnología Militar del Bajío', institucion: 'Policía Federal', folio: 'OP-2026-0130', vendedor: 'Diego Torres', statusKey: 'en_coste', tipo: 'Licitación', valor: '$980K', updated: 'Hace 1 d', products: [
    { producto: 'Radio táctico digital', sku: 'RAD-DIG-06', color: 'Negro', cantidad: 60, precioUnitario: 9800 },
    { producto: 'Chaleco portaequipo MOLLE', sku: 'CHP-MOL-L', color: 'Coyote', cantidad: 60, precioUnitario: 3400 },
  ] },
  { id: 'o5', cliente: 'Óptica de Precisión', institucion: 'SEDENA', folio: 'OP-2026-0128', vendedor: 'Carlos Peña', statusKey: 'en_coste', tipo: 'Venta Directa', valor: '$410K', updated: 'Hace 1 d', products: [
    { producto: 'Mira telescópica 4-16x50', sku: 'MIR-416-50', color: 'Negro', cantidad: 15, precioUnitario: 21500 },
    { producto: 'Binocular táctico 10x42', sku: 'BIN-1042', color: 'Negro', cantidad: 10, precioUnitario: 6800 },
  ] },
  { id: 'o6', cliente: 'Grupo Defensa Integral', institucion: 'Secretaría de Seguridad Ciudadana', folio: 'OP-2026-0133', vendedor: 'Carlos Peña', statusKey: 'costeo_validacion', tipo: 'Estudio de mercado', valor: '$760K', updated: 'Hace 2 d', updates: [
    { texto: 'Validación de costeo enviada al gerente de línea.', autor: 'Carlos Peña', cuando: 'Hace 3 h' },
    { texto: 'Cliente confirmó tallas requeridas por lote.', autor: 'Carlos Peña', cuando: 'Hace 2 d' },
  ], products: [
    { producto: 'Chaleco antibalas nivel IV', sku: 'CHB-4-M', color: 'Negro', cantidad: 40, precioUnitario: 15600, embellecimientos: [{ posicion: 'Frente derecho', descripcion: 'Bordado 10 cm' }] },
    { producto: 'Casco balístico nivel IIIA', sku: 'CAS-3A-M', color: 'Negro', cantidad: 40, precioUnitario: 5200 },
  ] },
  { id: 'o7', cliente: 'Óptica Militar Continental', institucion: 'SEDENA', folio: 'OP-2026-0132', vendedor: 'Ana Ruiz', statusKey: 'costeo_validacion', tipo: 'Licitación', valor: '$1.5M', updated: 'Hace 2 d', products: [
    { producto: 'Visor nocturno monocular Gen3', sku: 'VIS-G3-MN', color: 'Negro', cantidad: 30, precioUnitario: 48000 },
  ] },
  { id: 'o8', cliente: 'Equipos Tácticos SA', institucion: 'Fiscalía General del Estado', folio: 'OP-2026-0135', vendedor: 'Laura Sánchez', statusKey: 'costeo_confirmado', tipo: 'Venta Directa', valor: '$520K', updated: 'Hace 3 d', products: [
    { producto: 'Uniforme investigador', sku: 'UNI-INV-L', color: 'Azul marino', cantidad: 45, precioUnitario: 2300, embellecimientos: [{ posicion: 'Manga derecha', descripcion: 'Bordado 6 cm' }] },
    { producto: 'Chaleco identificador', sku: 'CHI-ID-L', color: 'Amarillo', cantidad: 45, precioUnitario: 950 },
  ] },
  { id: 'o9', cliente: 'Distribuidora Halcón', institucion: 'SEMAR', folio: 'OP-2026-0138', vendedor: 'Marisol Vega', statusKey: 'seguimiento', tipo: 'Licitación', valor: '$3.4M', updated: 'Hace 3 d', products: [
    { producto: 'Traje de buceo táctico', sku: 'TRJ-BUC-M', color: 'Negro', cantidad: 35, precioUnitario: 32000 },
    { producto: 'Chaleco de flotación', sku: 'CHF-FLT-M', color: 'Naranja', cantidad: 35, precioUnitario: 4100 },
  ] },
  { id: 'o10', cliente: 'Defensa y Blindaje MX', institucion: 'Guardia Nacional', folio: 'OP-2026-0137', vendedor: 'Diego Torres', statusKey: 'seguimiento', tipo: 'Venta Directa', valor: '$290K', updated: 'Hace 4 d', products: [
    { producto: 'Placa balística nivel IV', sku: 'PLB-4-STD', color: 'Negro', cantidad: 24, precioUnitario: 8900 },
    { producto: 'Casco táctico ACH', sku: 'CAS-ACH-M', color: 'Verde OD', cantidad: 24, precioUnitario: 6400 },
  ] },
  { id: 'o11', cliente: 'Soluciones Ópticas MX', institucion: 'Guardia Nacional', folio: 'OP-2026-0139', vendedor: 'Carlos Peña', statusKey: 'negociacion', tipo: 'Licitación', valor: '$1.8M', updated: 'Hace 5 d', products: [
    { producto: 'Visor nocturno binocular Gen3', sku: 'VIS-G3-BN', color: 'Negro', cantidad: 25, precioUnitario: 62000 },
  ] },
  { id: 'o12', cliente: 'Grupo Tecnológico del Norte', institucion: 'SEDENA', folio: 'OP-2026-0143', vendedor: 'Ana Ruiz', statusKey: 'esperando_oc', tipo: 'Licitación', valor: '$1.24M', updated: 'Hace 6 d', products: [
    { producto: 'Dron de reconocimiento', sku: 'DRN-REC-01', color: 'Gris', cantidad: 8, precioUnitario: 128000 },
    { producto: 'Radio táctico digital', sku: 'RAD-DIG-06', color: 'Negro', cantidad: 15, precioUnitario: 9800 },
  ] },
  { id: 'o13', cliente: 'Balística Aplicada MX', institucion: 'SEMAR', folio: 'OP-2026-0119', vendedor: 'Marisol Vega', statusKey: 'ganada', tipo: 'Venta Directa', valor: '$640K', updated: 'Hace 2 sem', updates: [
    { texto: 'Orden de compra recibida, iniciando documentación.', autor: 'Marisol Vega', cuando: 'Hace 2 sem' },
  ], products: [
    { producto: 'Chaleco balístico NIJ IIIA', sku: 'CHB-3A-L', color: 'Negro', cantidad: 40, precioUnitario: 12800, embellecimientos: [{ posicion: 'Espalda', descripcion: 'Texto vinil reflejante color plata' }, { posicion: 'Frente derecho', descripcion: 'Logotipo bordado directo' }] },
  ] },
  { id: 'o14', cliente: 'Protección Civil Integral', institucion: 'Protección Civil CDMX', folio: 'OP-2026-0117', vendedor: 'Laura Sánchez', statusKey: 'ganada', tipo: 'Estudio de mercado', valor: '$215K', updated: 'Hace 3 sem', products: [
    { producto: 'Uniforme de rescate', sku: 'UNI-RES-M', color: 'Naranja', cantidad: 30, precioUnitario: 2600, embellecimientos: [{ posicion: 'Espalda', descripcion: 'Serigrafía 25 cm' }] },
  ] },
  { id: 'o15', cliente: 'Vanguardia Táctica', institucion: 'Fiscalía General', folio: 'OP-2026-0110', vendedor: 'Diego Torres', statusKey: 'perdida', tipo: 'Licitación', valor: '$890K', updated: 'Hace 1 mes', products: [
    { producto: 'Chaleco portaequipo MOLLE', sku: 'CHP-MOL-L', color: 'Coyote', cantidad: 50, precioUnitario: 3400 },
  ] },
  { id: 'o16', cliente: 'Grupo Aeroespacial del Norte', institucion: 'Fuerza Aérea Mexicana', folio: 'OP-2026-0108', vendedor: 'Marisol Vega', statusKey: 'cancelada', tipo: 'Venta Directa', valor: '$1.1M', updated: 'Hace 1 mes', products: [
    { producto: 'Traje de vuelo Nomex', sku: 'TRJ-VUE-M', color: 'Verde OD', cantidad: 20, precioUnitario: 14500 },
  ] },
];

export const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('es-MX');
