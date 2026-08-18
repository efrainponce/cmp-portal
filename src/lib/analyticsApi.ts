// Cliente del tablero de Análisis (admin). A diferencia de useHome/useNotifications
// esto NO hace polling: es una pantalla que se abre a propósito para leerla, y la
// consulta barre las 630 oportunidades con sus 2,964 líneas — repetirla cada 30s
// sería gastar CPU del Worker para redibujar el mismo número. Refresco manual.
import { useCallback, useEffect, useState } from 'react';
import type { AnalyticsResponse, GroupBy } from '../../shared/analytics';
import { AccessError, apiFetch } from './apiClient';

export type {
  AnalyticsResponse, GroupBy, FunnelBucket, GrupoMetrics, Hueco, TiempoCosteo, Conversion,
} from '../../shared/analytics';

/** null = "todo" (sin límite por fecha de creación). */
export type PeriodoDias = 30 | 90 | 180 | null;

export const PERIODOS: Array<{ dias: PeriodoDias; label: string }> = [
  { dias: 30, label: '30 días' },
  { dias: 90, label: '90 días' },
  { dias: 180, label: '6 meses' },
  { dias: null, label: 'Todo' },
];

export async function getAnalytics(por: GroupBy, dias: PeriodoDias): Promise<AnalyticsResponse> {
  const params = new URLSearchParams({ por });
  if (dias) params.set('dias', String(dias));
  const res = await apiFetch(`/admin/analytics?${params}`);
  if (!res.ok) throw new Error('analytics failed: ' + res.status);
  return res.json();
}

export interface UseAnalyticsResult {
  data: AnalyticsResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAnalytics(por: GroupBy, dias: PeriodoDias): UseAnalyticsResult {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAnalytics(por, dias));
    } catch (e) {
      if (e instanceof AccessError) return;   // sin sesión: el shell ya lo maneja
      setError(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [por, dias]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
}
