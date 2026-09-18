// Qué columnas de un board quiere ver cada persona. Vive en localStorage bajo
// una key por correo + board, igual que useSavedView: es preferencia de
// pantalla, no viaja al server ni se comparte. Reutilizable: cualquier lista
// que declare sus columnas puede usarlo con <ColumnPicker>.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMe } from './useMe';

export interface ColumnaDef {
  key: string;
  label: string;
  /** No se puede ocultar (el folio, el nombre…): sin ella la fila no se entiende. */
  fija?: boolean;
  /** Arranca oculta hasta que la persona la prenda. */
  ocultaPorDefault?: boolean;
}

function storageKey(email: string, boardKey: string): string {
  return `cmp:cols:${email}:${boardKey}`;
}

export function useColumnasVisibles(boardKey: string, columnas: readonly ColumnaDef[]) {
  const me = useMe();
  // Se guardan las OCULTAS, no las visibles: una columna nueva que se agregue
  // al board mañana aparece sola, en vez de nacer escondida para quien ya
  // tenía preferencias guardadas.
  const [ocultas, setOcultas] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!me) return;
    try {
      const raw = localStorage.getItem(storageKey(me.email, boardKey));
      setOcultas(raw ? new Set(JSON.parse(raw) as string[]) : null);
    } catch {
      setOcultas(null);
    }
  }, [me, boardKey]);

  const efectivas = useMemo(
    () => ocultas ?? new Set(columnas.filter(c => c.ocultaPorDefault).map(c => c.key)),
    [ocultas, columnas],
  );
  const visible = useCallback(
    (key: string) => !!columnas.find(c => c.key === key)?.fija || !efectivas.has(key),
    [columnas, efectivas],
  );

  const guardar = useCallback((next: Set<string> | null) => {
    setOcultas(next);
    if (!me) return;
    if (next) localStorage.setItem(storageKey(me.email, boardKey), JSON.stringify([...next]));
    else localStorage.removeItem(storageKey(me.email, boardKey));
  }, [me, boardKey]);

  const toggle = useCallback((key: string) => {
    const next = new Set(efectivas);
    if (!next.delete(key)) next.add(key);
    guardar(next);
  }, [efectivas, guardar]);

  return { visible, toggle, restablecer: () => guardar(null), personalizado: ocultas != null };
}
