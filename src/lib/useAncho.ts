// Ancho útil (sin padding) de un contenedor, al día con ResizeObserver. Lo usan
// las tablas que se estiran a toda la pantalla en px exactos (ver `estirarGrid`
// en la grid de cotización): con `1fr` cada fila resolvería su propio ancho.
// Ref de CALLBACK a propósito: el contenedor puede montarse después (la vista
// "sin líneas" es otro árbol) y un useRef + efecto de montaje no se enteraría.
import { useCallback, useRef, useState } from 'react';

export function useAncho<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [ancho, setAncho] = useState(0);
  const obs = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    const medir = () => {
      const cs = getComputedStyle(el);
      setAncho(Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    };
    medir();
    obs.current = new ResizeObserver(medir);
    obs.current.observe(el);
  }, []);
  return [ref, ancho];
}
