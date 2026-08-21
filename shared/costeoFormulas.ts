// shared/costeoFormulas.ts — La matemática del costeo, pura y sin dependencias:
// las mismas fórmulas que Monday calcula en el board de subitems de
// Oportunidades (18395657607), verificadas 1:1 contra sus columnas de fórmula
// el 2026-07-15 (ver la nota larga en src/lib/costeoCalc.ts, que re-exporta
// esto para la UI).
//
// Vive en shared/ desde 2026-08-20 porque el WORKER también las necesita:
// materializa los totales de cada línea al sincronizarla (worker/lib/
// lineaTotales.ts) y una línea NATIVA (Zona Efrain) no existe en Monday, así
// que nadie calculó sus fórmulas — sin esto sus totales saldrían en $0.
// Duplicar la matemática en el worker era la otra opción; se descartó porque
// un drift entre las dos copias no lo cacha nada.
//
// Las columnas con unidad "%" (Descuento Distr.%, Gastos%, Margen Gob%, IVA%)
// se GUARDAN como número entero (18 = 18%) y las fórmulas las usan entre 100
// — confirmado numéricamente, no asumido.
const pct = (n: number) => n / 100;

export interface CostChain {
  descuento: number;
  costoReal: number;
  costoConvertido: number;
  costoTotalUnit: number;
  costoTotal: number;
}

export function computeCostChain(input: {
  cantidad: number; costoDistr: number; descuentoPct: number;
  conversion: number; gastosPct: number; embellecimiento: number;
}): CostChain {
  const descuento = pct(input.descuentoPct) * input.costoDistr;
  const costoReal = input.costoDistr - descuento;
  const costoConvertido = costoReal * input.conversion;
  const costoTotalUnit = (1 + pct(input.gastosPct)) * costoReal * input.conversion + input.embellecimiento;
  const costoTotal = input.cantidad * costoTotalUnit;
  return { descuento, costoReal, costoConvertido, costoTotalUnit, costoTotal };
}

export interface PriceChain {
  subtotal: number;
  iva: number;
  totalConIva: number;
  margenGobUnit: number;
  margenGobTotal: number;
  diferencia: number;
  utilidad: number;
  utilidadTotal: number;
  utilidadPct: number;
}

export function computePriceChain(input: {
  cantidad: number; precio: number; margenGobPct: number;
  costoTotalUnit: number; ivaPct: number;
}): PriceChain {
  const subtotal = input.precio * input.cantidad;
  const iva = subtotal * pct(input.ivaPct);
  const totalConIva = subtotal * (1 + pct(input.ivaPct));
  const margenGobUnit = pct(input.margenGobPct) * input.precio;
  const margenGobTotal = input.cantidad * margenGobUnit;
  const diferencia = input.precio - margenGobUnit;
  // La utilidad es NETA: el Margen Gob ya salió del precio antes de llegar aquí
  // (diferencia) y el costo total unitario ya trae descuento, conversión,
  // gastos% y embellecimiento. Lo único que no entra es el IVA, que es traslado.
  const utilidad = diferencia - input.costoTotalUnit;
  const utilidadTotal = utilidad * input.cantidad;
  const utilidadPct = subtotal > 0 ? Math.round((utilidadTotal / subtotal) * 10000) / 100 : 0;
  return { subtotal, iva, totalConIva, margenGobUnit, margenGobTotal, diferencia, utilidad, utilidadTotal, utilidadPct };
}
