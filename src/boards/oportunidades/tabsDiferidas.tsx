// Pestañas del drawer de Oportunidades que se cargan al ABRIRLAS (2026-10-08,
// plan CWV paso 5). Antes iban todas estáticas: el chunk del drawer pesaba
// 65 KB gz (EditableItemName-*.js) con las secciones de Proyecto (Órdenes,
// Ejecución, Logística, CrearOcModal…), Actualizaciones, Embellecimientos y
// Documentación adentro, aunque el drawer SIEMPRE abre en Cotización. En la
// red de Mérida (0.7 Mbps) eso eran ~2.5 s de bajada por abrir el primer
// drawer. Cotización y Resumen se quedan estáticas.
//
// Para que abrir una pestaña siga siendo instantáneo, `usePrecargarTabs` las
// pide en ocioso en cuanto el drawer ya pintó su detalle (mismo patrón que el
// drawer mismo, src/lib/lazyPrefetch.ts).
import { lazy, Suspense, type ReactNode } from 'react';
import { usePrefetchOnIdle } from '../../lib/lazyPrefetch';

const cargarActualizaciones = () => import('./tabs/ActualizacionesTab');
const cargarInventario = () => import('./tabs/InventarioCotizacionTab');
const cargarEmbellecimientos = () => import('./tabs/EmbellecimientosTab');
const cargarNuevosProductos = () => import('./tabs/NuevosProductosTab');
const cargarMuestras = () => import('../muestras/MuestrasTab');
const cargarActividad = () => import('./tabs/ActividadTab');
const cargarDocumentacion = () => import('./tabs/DocumentacionTab');
const cargarTallas = () => import('./tabs/TallasTab');
const cargarOrdenes = () => import('./proyecto/OrdenesSection');
const cargarEjecucion = () => import('./proyecto/EjecucionSection');
const cargarLogistica = () => import('./proyecto/LogisticaSection');

export const ActualizacionesTab = lazy(() => cargarActualizaciones().then(m => ({ default: m.ActualizacionesTab })));
export const InventarioCotizacionTab = lazy(() => cargarInventario().then(m => ({ default: m.InventarioCotizacionTab })));
export const EmbellecimientosTab = lazy(() => cargarEmbellecimientos().then(m => ({ default: m.EmbellecimientosTab })));
export const NuevosProductosTab = lazy(() => cargarNuevosProductos().then(m => ({ default: m.NuevosProductosTab })));
export const MuestrasTab = lazy(() => cargarMuestras().then(m => ({ default: m.MuestrasTab })));
export const ActividadTab = lazy(() => cargarActividad().then(m => ({ default: m.ActividadTab })));
export const DocumentacionTab = lazy(() => cargarDocumentacion().then(m => ({ default: m.DocumentacionTab })));
export const TallasTab = lazy(() => cargarTallas().then(m => ({ default: m.TallasTab })));
export const ProyectoOrdenesSection = lazy(() => cargarOrdenes().then(m => ({ default: m.ProyectoOrdenesSection })));
export const EjecucionSection = lazy(() => cargarEjecucion().then(m => ({ default: m.EjecucionSection })));
export const LogisticaSection = lazy(() => cargarLogistica().then(m => ({ default: m.LogisticaSection })));

/** Todas, en ocioso, cuando el drawer ya tiene su detalle en pantalla. Las
 * de post-venta solo si la oportunidad las muestra. */
export function usePrecargarTabs(listo: boolean, postventa: boolean): void {
  usePrefetchOnIdle(cargarActualizaciones, listo);
  usePrefetchOnIdle(cargarEmbellecimientos, listo);
  usePrefetchOnIdle(cargarDocumentacion, listo);
  usePrefetchOnIdle(cargarTallas, listo);
  usePrefetchOnIdle(cargarActividad, listo);
  usePrefetchOnIdle(cargarMuestras, listo);
  usePrefetchOnIdle(cargarNuevosProductos, listo);
  usePrefetchOnIdle(cargarInventario, listo);
  usePrefetchOnIdle(cargarOrdenes, listo && postventa);
  usePrefetchOnIdle(cargarEjecucion, listo && postventa);
  usePrefetchOnIdle(cargarLogistica, listo && postventa);
}

/** Mientras baja el chunk: un hueco con alto, para que la página no brinque
 * (CLS) cuando la pestaña aparece. */
export function TabDiferida({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div style={{ minHeight: 360 }} aria-busy="true" />}>{children}</Suspense>;
}
