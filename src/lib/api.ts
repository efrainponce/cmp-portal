// ETag-aware polling hooks built on top of ./apiClient. Fall back to mock
// data (Oportunidades only) when /api is unreachable so the UI still demos
// with the worker stopped.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListResponse } from '../../shared/dto';
import { mockList } from './mockFallback';
import {
  AccessError, apiFetch, getBoards, mockBoardMeta, type BoardMeta, type BoardSlug,
} from './apiClient';

export * from './apiClient';

export type PollStatus = 'loading' | 'ready' | 'denied' | 'offline';

export interface PollResult {
  status: PollStatus;
  data: ListResponse | null;
  offlineMock: boolean;
  refetch: () => void;
}

/** Fetches the item list for `slug`, then re-polls every 5s using If-None-Match
 * (a 304 leaves state untouched). Falls back to mock data for `oportunidades`
 * when the request fails outright (worker not running). */
export function usePoll(slug: BoardSlug, q = ''): PollResult {
  const [status, setStatus] = useState<PollStatus>('loading');
  const [data, setData] = useState<ListResponse | null>(null);
  const [offlineMock, setOfflineMock] = useState(false);
  const etagRef = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : '';
      const headers: Record<string, string> = {};
      if (etagRef.current) headers['If-None-Match'] = etagRef.current;
      const res = await apiFetch(`/boards/${slug}/items${params}`, { headers });
      if (res.status === 304) { setStatus('ready'); return; }
      if (!res.ok) throw new Error('list failed: ' + res.status);
      const json: ListResponse = await res.json();
      etagRef.current = json.etag;
      setData(json);
      setOfflineMock(false);
      setStatus('ready');
    } catch (e) {
      if (e instanceof AccessError) { setStatus('denied'); return; }
      const fallback = mockList(slug, q);
      if (fallback) {
        setData(fallback);
        setOfflineMock(true);
        setStatus('ready');
      } else {
        setStatus('offline');
      }
    }
  }, [slug, q]);

  useEffect(() => {
    etagRef.current = undefined;
    setStatus('loading');
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  return { status, data, offlineMock, refetch: load };
}

/** GET /api/boards, falling back to mock column metadata (oportunidades+sub) offline. */
export function useBoards(): { status: PollStatus; boards: BoardMeta[] } {
  const [status, setStatus] = useState<PollStatus>('loading');
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  useEffect(() => {
    let cancelled = false;
    getBoards()
      .then((b) => { if (!cancelled) { setBoards(b); setStatus('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AccessError) { setStatus('denied'); return; }
        setBoards(mockBoardMeta());
        setStatus('ready');
      });
    return () => { cancelled = true; };
  }, []);
  return { status, boards };
}
