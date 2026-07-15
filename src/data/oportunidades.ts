// Mock data ported from the CMP Portal design project's Oportunidades board
// (Board Oportunidades.dc.html / Surface 2 Design.dc.html). No backend yet —
// this is the same fixture data the design prototype ships with.

export interface Status {
  key: string;
  label: string;
  color: string;
  tint: string;
}

export interface Embellecimiento {
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

export interface QuoteProduct extends OppProduct {
  precioUnitarioFmt: string;
  subtotalFmt: string;
  hasEmbellecimiento: boolean;
}

export interface QuoteVersion {
  id: number;
  label: string;
  createdAt: string;
  status: 'anterior' | 'vigente';
  products: QuoteProduct[];
  productsTotalFmt: string;
}

export interface DocEntry {
  nombre: string;
  tipo: string;
  fecha: string;
}

export interface OppDocuments {
  solicitudes: DocEntry[];
  cotizacionesNoFirmadas: DocEntry[];
  cotizacionesFirmadas: DocEntry[];
  ordenes: DocEntry[];
  ordenesInternas: DocEntry[];
  ordenesProveedor: DocEntry[];
  logistica: DocEntry[];
}

export interface NewProductProposal {
  nombre: string;
  descripcion: string;
  imagen: string | null;
  confirmed?: boolean;
}

export const emptyDocs = (): OppDocuments => ({
  solicitudes: [],
  cotizacionesNoFirmadas: [],
  cotizacionesFirmadas: [],
  ordenes: [],
  ordenesInternas: [],
  ordenesProveedor: [],
  logistica: [],
});

export const zonas = [
  { id: 'espalda', label: 'Espalda' },
  { id: 'frente_derecho', label: 'Frente derecho' },
  { id: 'frente_izquierdo', label: 'Frente izquierdo' },
  { id: 'manga_derecha', label: 'Manga derecha/costado derecho' },
  { id: 'manga_izquierda', label: 'Manga izquierda/costado izquierdo' },
  { id: 'etiqueta_fabricante', label: 'Etiqueta del fabricante' },
  { id: 'etiqueta_propiedad', label: 'Etiqueta de propiedad' },
  { id: 'otros', label: 'Otros' },
];

export const colores = ['N/A', 'Negro', 'Verde OD', 'Coyote', 'Azul marino', 'Amarillo', 'Naranja'];

export const tallaSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

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

export const statusByKey = (key: string): Status =>
  statuses.find((s) => s.key === key) ?? statuses[0];

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

export const vendedores = Array.from(new Set(opportunities.map((o) => o.vendedor))).sort();

export const productCatalog = Array.from(
  new Map(opportunities.flatMap((o) => o.products).map((p) => [p.sku, p])).values()
);

export const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('es-MX');

export const toQuoteProduct = (p: OppProduct): QuoteProduct => ({
  ...p,
  precioUnitarioFmt: fmtMoney(p.precioUnitario),
  subtotalFmt: fmtMoney(p.precioUnitario * p.cantidad),
  hasEmbellecimiento: Boolean(p.embellecimientos?.length),
});

// Only o1 has multi-version quote history + documents + new-product proposals
// in the source design — every other opportunity falls back to its base
// `products` list as the single "active version".
export const quoteVersionsByOpp: Record<string, QuoteVersion[]> = {
  o1: [
    { id: 1, label: 'V1', createdAt: 'Hace 5 d', status: 'anterior', products: [
      { producto: 'Cámara de vigilancia PTZ', sku: 'CAM-PTZ-40', color: 'N/A', cantidad: 12, precioUnitario: 18500, precioUnitarioFmt: '$18,500', subtotalFmt: '$222,000', hasEmbellecimiento: false },
      { producto: 'Sensor perimetral IR', sku: 'SEN-IR-12', color: 'N/A', cantidad: 20, precioUnitario: 4200, precioUnitarioFmt: '$4,200', subtotalFmt: '$84,000', hasEmbellecimiento: false },
    ], productsTotalFmt: '$306,000' },
    { id: 2, label: 'V2', createdAt: 'Hace 1 h', status: 'vigente', products: [
      { producto: 'Cámara de vigilancia PTZ', sku: 'CAM-PTZ-40', color: 'N/A', cantidad: 15, precioUnitario: 18500, precioUnitarioFmt: '$18,500', subtotalFmt: '$277,500', hasEmbellecimiento: false },
      { producto: 'Sensor perimetral IR', sku: 'SEN-IR-12', color: 'N/A', cantidad: 20, precioUnitario: 4200, precioUnitarioFmt: '$4,200', subtotalFmt: '$84,000', hasEmbellecimiento: false },
      { producto: 'Central de monitoreo NVR', sku: 'NVR-CTRL-16', color: 'N/A', cantidad: 2, precioUnitario: 32000, precioUnitarioFmt: '$32,000', subtotalFmt: '$64,000', hasEmbellecimiento: false },
    ], productsTotalFmt: '$425,500' },
  ],
};

export const activeQuoteVersionByOpp: Record<string, number> = { o1: 2 };

export const documentsByOpp: Record<string, OppDocuments> = {
  o1: {
    solicitudes: [{ nombre: 'Solicitud de costeo V2.pdf', tipo: 'PDF', fecha: 'Hace 1 h' }],
    cotizacionesNoFirmadas: [{ nombre: 'Cotización V1.pdf', tipo: 'PDF', fecha: 'Hace 5 d' }],
    cotizacionesFirmadas: [{ nombre: 'Cotización V2 firmada.pdf', tipo: 'PDF', fecha: 'Hace 1 h' }],
    ordenes: [{ nombre: 'Orden de compra OC-4471.pdf', tipo: 'PDF', fecha: 'Hace 3 d' }],
    ordenesInternas: [{ nombre: 'OC interna - tallas confirmadas.pdf', tipo: 'PDF', fecha: 'Hace 2 d' }],
    ordenesProveedor: [{ nombre: 'OC proveedor - CMP.pdf', tipo: 'PDF', fecha: 'Hace 1 d' }],
    logistica: [],
  },
};

export const newProductsByOpp: Record<string, NewProductProposal[]> = {
  o1: [
    { nombre: 'Cámara de vigilancia solar autónoma', descripcion: 'Cámara PTZ con panel solar integrado y batería de respaldo, pensada para perímetros sin acceso a energía eléctrica.', imagen: null },
  ],
};

export const NEW_PRODUCTS_TARGET = 5;
