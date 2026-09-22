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
  /** Permite evolucionar el filtro inicial sin interpretar una preferencia
   * guardada como una elección explícita de "Todos". */
  defaultsVersion?: number;
  /** Criterio de agrupación elegido por la persona (p.ej. 'estado' | 'zona' en
   * las listas de Proyectos). `undefined` = el default del board. */
  groupBy?: string;
}

const DEFAULT_FILTERS: SavedViewFilters = { vendedor: ALL_VALUE, compras: ALL_VALUE, etapa: ALL_VALUE };
const DEFAULT_STATE: SavedViewState = { filters: DEFAULT_FILTERS, collapsedGroups: {} };

function storageKey(email: string, boardKey: string): string {
  return `cmp:view:${email}:${boardKey}`;
}

function load(email: string, boardKey: string, initialFilters: SavedViewFilters, defaultsVersion?: number): SavedViewState {
  try {
    const raw = localStorage.getItem(storageKey(email, boardKey));
    if (!raw) return { ...DEFAULT_STATE, filters: initialFilters, defaultsVersion };
    const parsed = JSON.parse(raw);
    // Una vista guardada antes de una nueva versión de defaults no expresa una
    // decisión del usuario sobre ese filtro; estrénala con el nuevo default.
    if (defaultsVersion !== undefined && parsed.defaultsVersion !== defaultsVersion) {
      return { ...DEFAULT_STATE, filters: initialFilters, defaultsVersion };
    }
    return {
      filters: { ...DEFAULT_FILTERS, ...parsed.filters },
      collapsedGroups: parsed.collapsedGroups ?? {},
      groupBy: typeof parsed.groupBy === 'string' ? parsed.groupBy : undefined,
      defaultsVersion: parsed.defaultsVersion,
    };
  } catch {
    return { ...DEFAULT_STATE, filters: initialFilters, defaultsVersion };
  }
}

/** `initialFilters` solo aplica al estrenar (o migrar) una vista. "Limpiar"
 * sigue significando ver Todo, para que no esconda la nueva vista de equipo. */
export function useSavedView(boardKey: string, initialFilters: SavedViewFilters = DEFAULT_FILTERS, defaultsVersion?: number) {
  const me = useMe();
  // null hasta que useMe() resuelve — evita pisar lo guardado con defaults
  // antes de saber quién es el viewer.
  const [state, setState] = useState<SavedViewState | null>(null);

  useEffect(() => {
    if (!me) return;
    setState(load(me.email, boardKey, initialFilters, defaultsVersion));
  }, [me, boardKey, initialFilters.vendedor, initialFilters.compras, initialFilters.etapa, defaultsVersion]);

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
