// src/lib/useReordenar.ts — el asa ⠿ para reacomodar filas arrastrando.
// Nació en el tab Órdenes de compra (OrdenesSection, Efraín 2026-08-25) y se
// comparte con la grid de Cotización de la Oportunidad (Jorge, 2026-09-28).
// Genérico: cualquier lista de filas con `id`; quien lo usa pone el ref del
// contenedor (SOLO las filas, una por hijo) y conecta el asa.
import { useMemo, useRef, useState } from 'react';

/** Arrastrar para reacomodar las líneas de UNA tarjeta de proveedor (Efraín,
 * 2026-08-25: "un dragger hasta la izquierda para subir y bajar las filas, por
 * proveedor; eso cambia en el PDF también"). El orden se guarda en D1
 * (PUT /orden-lineas → worker/lib/itemOrder.ts) y de ahí lo lee el generador
 * del PDF, así que lo que Compras acomoda aquí es lo que el proveedor lee en
 * la OC.
 *
 * Pointer events y no drag&drop de HTML5: el mismo código sirve con dedo y con
 * mouse (en iOS el drag nativo no existe), y `setPointerCapture` deja de
 * depender de que el puntero siga encima de la fila. El reacomodo se pinta al
 * vuelo y solo se manda al server al soltar — no una llamada por pixel. */
export function useReordenar<T extends { id: string }>(
  lineas: T[], guardar: (ids: string[]) => Promise<{ ok: boolean; error?: string }>,
) {
  const [ordenLocal, setOrdenLocal] = useState<string[] | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  // Orden vivo del arrastre: se lee y escribe dentro del mismo pointermove, y
  // el estado de React llega un render tarde para eso.
  const vivo = useRef<string[]>([]);
  // Orden al EMPEZAR el arrastre, para saber si al soltar cambió algo. No se
  // compara contra `lineas`: esa lista no se actualiza hasta que el padre
  // vuelve a leer del server, y después de un primer reacomodo un simple clic
  // en el asa mandaba otra vez el mismo orden (2026-09-28).
  const inicio = useRef<string[]>([]);

  // Las líneas que el server todavía no acomoda (o que nacieron después del
  // arrastre) se van al final SIN romper su orden relativo — sort es estable.
  const ordenadas = useMemo(() => {
    if (!ordenLocal) return lineas;
    const pos = new Map(ordenLocal.map((id, i) => [id, i]));
    return [...lineas].sort((a, b) => (pos.get(a.id) ?? ordenLocal.length) - (pos.get(b.id) ?? ordenLocal.length));
  }, [lineas, ordenLocal]);

  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    vivo.current = ordenadas.map(l => l.id);
    inicio.current = vivo.current;
    setArrastrando(id);
    setError(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!arrastrando || !contenedor.current) return;
    const filas = [...contenedor.current.children] as HTMLElement[];
    const desde = vivo.current.indexOf(arrastrando);
    const hasta = filas.findIndex(f => {
      const r = f.getBoundingClientRect();
      return e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (desde < 0 || hasta < 0 || hasta === desde) return;
    const next = [...vivo.current];
    next.splice(hasta, 0, ...next.splice(desde, 1));
    vivo.current = next;
    setOrdenLocal(next);
  };

  const onPointerUp = async () => {
    if (!arrastrando) return;
    setArrastrando(null);
    const ids = vivo.current;
    // Soltar en el mismo lugar no manda nada (el asa también se usa de tope
    // para el scroll horizontal de la tabla).
    if (ids.join() === inicio.current.join()) return;
    const res = await guardar(ids);
    if (!res.ok) {
      setOrdenLocal(null); // vuelve al orden del server, que es el que sigue vigente
      setError(res.error ?? 'No se pudo guardar el orden.');
    }
  };

  return { ordenadas, arrastrando, error, contenedor, onPointerDown, onPointerMove, onPointerUp };
}
