// Centro de notificaciones — ETag polling clonado de usePoll (src/lib/api.ts)
// pero a ~12s (menos urgente que las listas de boards) y sin filtro server-side:
// un solo poll alimenta la campana y las dos pestañas del centro.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationDTO, NotificationsResponse } from '../../shared/dto';
import { AccessError, apiFetch } from './apiClient';

export type { NotificationDTO, NotificationsResponse };

export async function markNotificationRead(id: number): Promise<void> {
  const res = await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
  if (!res.ok) throw new Error('mark read failed: ' + res.status);
}

export async function markAllNotificationsRead(filter?: 'importante' | 'actualizacion'): Promise<void> {
  const qs = filter ? `?filter=${filter}` : '';
  const res = await apiFetch(`/notifications/read-all${qs}`, { method: 'POST' });
  if (!res.ok) throw new Error('mark all read failed: ' + res.status);
}

export interface UseNotificationsResult {
  notifications: NotificationDTO[];
  unread: { importante: number; actualizacion: number };
  refetch: () => void;
  markRead: (id: number) => Promise<void>;
  markAllRead: (filter?: 'importante' | 'actualizacion') => Promise<void>;
}

const EMPTY_UNREAD = { importante: 0, actualizacion: 0 };

/** Polls GET /notifications every 12s using If-None-Match (304 leaves state
 * untouched); pausa en pestaña oculta, recarga al volver visible. */
export function useNotifications(): UseNotificationsResult {
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const etagRef = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (document.hidden) return;
    try {
      const headers: Record<string, string> = {};
      if (etagRef.current) headers['If-None-Match'] = etagRef.current;
      const res = await apiFetch('/notifications', { headers });
      if (res.status === 304) return;
      if (!res.ok) throw new Error('notifications failed: ' + res.status);
      const etag = res.headers.get('ETag');
      if (etag) etagRef.current = etag;
      const json: NotificationsResponse = await res.json();
      setData(json);
    } catch (e) {
      if (e instanceof AccessError) return; // sin sesión: no truena la UI
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 12000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const markRead = useCallback(async (id: number) => {
    await markNotificationRead(id);
    setData((prev) => {
      if (!prev) return prev;
      const target = prev.notifications.find((n) => n.id === id);
      if (!target || target.read) return prev;
      return {
        notifications: prev.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unread: { ...prev.unread, [target.severity]: Math.max(0, prev.unread[target.severity] - 1) },
      };
    });
    load();
  }, [load]);

  const markAllRead = useCallback(async (filter?: 'importante' | 'actualizacion') => {
    await markAllNotificationsRead(filter);
    setData((prev) => {
      if (!prev) return prev;
      return {
        notifications: prev.notifications.map((n) => (!filter || n.severity === filter ? { ...n, read: true } : n)),
        unread: filter ? { ...prev.unread, [filter]: 0 } : { importante: 0, actualizacion: 0 },
      };
    });
    load();
  }, [load]);

  return {
    notifications: data?.notifications ?? [],
    unread: data?.unread ?? EMPTY_UNREAD,
    refetch: load,
    markRead,
    markAllRead,
  };
}
