// Barrel de la sección "Proyecto" (tabs Tallas, Órdenes de compra, Ejecución
// y Logística) — antes un solo archivo de ~1200 líneas, dividido en
// src/boards/oportunidades/proyecto/ (shared.tsx + TallasSection.tsx +
// OrdenesSection.tsx + EjecucionSection.tsx + LogisticaSection.tsx) para que
// cada tab se pueda leer sin cargar las otras. Re-exporta exactamente lo que
// los consumidores de este módulo ya importaban, así que ningún import site
// tuvo que cambiar.
export { P_SHEET_LINK, P_OC_CLIENTE, ESTADO_PRODUCTO_COLORS, useProyecto, linkUrl, type ProyectoState } from './proyecto/shared';
export { ProyectoTallasSection } from './proyecto/TallasSection';
export { ProyectoOrdenesSection } from './proyecto/OrdenesSection';
export { EjecucionSection } from './proyecto/EjecucionSection';
export { LogisticaSection } from './proyecto/LogisticaSection';
