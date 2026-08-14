// Precarga de un chunk diferido en cuanto el navegador está ocioso.
//
// El problema que resuelve: los drawers se importaban estáticos desde los
// wrappers de board, así que su chunk (~26 KB, más ~24 KB de código
// compartido) bajaba ANTES de que se viera la lista, peleándole el ancho de
// banda al request que de verdad importa — `/items`. Medido en producción con
// red lenta y caché fría: `/items` no arrancaba hasta el segundo 2.5 de una
// carga de 3.6 s.
//
// Hacerlos `lazy` a secas movería el costo al clic, que es peor de sentir. Con
// esto el chunk se pide cuando el hilo principal ya no tiene nada urgente: la
// lista se pinta primero y, para cuando alguien abre un renglón, el chunk casi
// siempre ya está.
//
// A propósito NO envuelve a `lazy()`: hacerlo obligaba a un genérico que se
// peleaba con la inferencia de React y terminaba pidiendo casts. Cada vista
// declara su `lazy()` como siempre y le pasa AQUÍ el mismo cargador.
import { useEffect } from 'react';

// Cargadores ya disparados. Son consts a nivel módulo, así que su identidad es
// estable y sirve de llave; si la carga falla se saca para poder reintentar
// (el clic la volvería a disparar por su cuenta vía Suspense).
const yaPedido = new WeakSet<object>();

/** Dispara `carga` cuando el navegador esté ocioso, una sola vez, con un tope
 * de tiempo para que no se quede esperando en una pestaña siempre ocupada.
 * requestIdleCallback no existe en Safari viejo — ahí cae a un timeout.
 *
 * `habilitado` NO es un detalle: requestIdleCallback mide si el HILO PRINCIPAL
 * está ocioso, no la red. Mientras se espera `/items` el hilo está libre, así
 * que sin este gate la precarga disparaba a los 1.8 s — justo encima del
 * request que se quería proteger (medido). Las vistas lo ponen en true recién
 * cuando la lista ya tiene datos en pantalla. */
export function usePrefetchOnIdle(carga: () => Promise<unknown>, habilitado = true): void {
  useEffect(() => {
    if (!habilitado) return;
    const disparar = () => {
      if (yaPedido.has(carga)) return;
      yaPedido.add(carga);
      carga().catch(() => yaPedido.delete(carga));
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(disparar, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(disparar, 2000);
    return () => window.clearTimeout(t);
  }, [carga, habilitado]);
}
