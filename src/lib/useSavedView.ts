// Per-person view state (filtros + etapas colapsadas) para los boards tipo
// pipeline. Vive en localStorage de este navegador, bajo una key por email +
// board, para que sea privado de cada persona (no viaja a Monday ni se
// comparte entre viewers) y siga ahí la próxima vez que se conecte.
import { useEffect, useState } from 'react';
import { ALL_VALUE } from '../components/forms/FilterBar';
import { useMe } from './useMe';

export interface SavedViewFilters {
  vendedor: string;
  compras: string;
  etapa: string;
}

interface SavedViewState {
  filters: SavedViewFilters;
  collapsedGroups: Record<string, boolean>;
  /** Criterio de agrupación elegido por la persona (p.ej. 'estado' | 'zona' en
   * las listas de Proyectos). `undefined` = el default del board. */
  groupBy?: string;
}

const DEFAULT_FILTERS: SavedViewFilters = { vendedor: ALL_VALUE, compras: ALL_VALUE, etapa: ALL_VALUE };
const DEFAULT_STATE: SavedViewState = { filters: DEFAULT_FILTERS, collapsedGroups: {} };

function storageKey(email: string, boardKey: string): string {
  return `cmp:view:${email}:${boardKey}`;
}

function load(email: string, boardKey: string): SavedViewState {
  try {
    const raw = localStorage.getItem(storageKey(email, boardKey));
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      filters: { ...DEFAULT_FILTERS, ...parsed.filters },
      collapsedGroups: parsed.collapsedGroups ?? {},
      groupBy: typeof parsed.groupBy === 'string' ? parsed.groupBy : undefined,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function useSavedView(boardKey: string) {
  const me = useMe();
  // null hasta que useMe() resuelve — evita pisar lo guardado con defaults
  // antes de saber quién es el viewer.
  const [state, setState] = useState<SavedViewState | null>(null);

  useEffect(() => {
    if (!me) return;
    setState(load(me.email, boardKey));
  }, [me, boardKey]);

  useEffect(() => {
    if (!me || !state) return;
    localStorage.setItem(storageKey(me.email, boardKey), JSON.stringify(state));
  }, [me, boardKey, state]);

  const setFilters = (updater: (f: SavedViewFilters) => SavedViewFilters) => {
    setState((s) => { const base = s ?? DEFAULT_STATE; return { ...base, filters: updater(base.filters) }; });
  };

  const clearFilters = () => {
    setState((s) => ({ ...(s ?? DEFAULT_STATE), filters: DEFAULT_FILTERS }));
  };

  const toggleGroup = (groupKey: string) => {
    setState((s) => {
      const base = s ?? DEFAULT_STATE;
      return { ...base, collapsedGroups: { ...base.collapsedGroups, [groupKey]: !base.collapsedGroups[groupKey] } };
    });
  };

  const setGroupBy = (groupBy: string) => {
    setState((s) => ({ ...(s ?? DEFAULT_STATE), groupBy }));
  };

  return {
    filters: state?.filters ?? DEFAULT_FILTERS,
    collapsedGroups: state?.collapsedGroups ?? {},
    groupBy: state?.groupBy,
    setFilters,
    clearFilters,
    toggleGroup,
    setGroupBy,
  };
}
